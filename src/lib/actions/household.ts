"use server";

import { randomUUID } from "crypto";
import { cookies, headers } from "next/headers";
import { absoluteAppUrl } from "@/lib/app-url";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVE_HOUSEHOLD_COOKIE, requireHousehold, requireUserId } from "@/lib/session";
import { sendHouseholdInviteEmail, sendVerificationEmail } from "@/lib/email";
import type { ActionState, SignupState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { hashToken } from "@/lib/token-hash";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLocale } from "@/lib/i18n/get-dictionary";
import { settleDepartingMemberSplits } from "@/lib/settle-departing-member";
import { generateCalendarFeedToken } from "@/lib/calendar-feed";
import { defaultCurrencyForNewHousehold, parseHouseholdCurrency } from "@/lib/currency";
import { HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX } from "@/lib/household-step-skip";
import { MAX_BUDGET_MONTH_START_DAY, MIN_BUDGET_MONTH_START_DAY } from "@/lib/budget-date-utils";
import {
  GETTING_STARTED_DISMISS_COOKIE_PREFIX,
  GETTING_STARTED_DONE_COOKIE_PREFIX,
} from "@/lib/getting-started-dismiss";

const ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Mirrors auth.ts's PASSWORD_MAX_LENGTH — bcrypt silently ignores bytes past
// 72, so anything longer is rejected rather than accepted-but-misleading.
const PASSWORD_MAX_LENGTH = 72;

const INVITE_TTL_DAYS = 7;

// Mirrors auth.ts's EMAIL_VERIFICATION_TOKEN_TTL_MS — duplicated locally
// rather than imported for the same reason absoluteAppUrl below is: this
// file shouldn't pick up a dependency on auth.ts's internals.
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 36 * 60 * 60 * 1000;

export async function createInviteAction(): Promise<{ url?: string; token?: string; error?: string }> {
  const { household, userId } = await requireHousehold();

  let invitation;
  try {
    invitation = await prisma.invitation.create({
      data: {
        householdId: household.id,
        invitedById: userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return { url: `/join/${invitation.token}`, token: invitation.token };
}


const sendInviteEmailSchema = z.object({
  token: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254, "Email is too long"),
});

// Unlike JOIN_SIGNUP_RATE_LIMIT (keyed on the invitee's email, to slow down
// account-creation/enumeration abuse), this is keyed on the *sender*
// (requireHousehold()'s userId) — any authenticated household member can
// otherwise trigger an outbound email to an arbitrary address with no
// throttle at all, which is a cost/abuse vector (spamming arbitrary inboxes
// via this app's sending domain) once there are many real accounts. 10/hour
// is well above what a household ever legitimately needs (inviting a
// handful of people), while still bounding the damage a compromised or
// malicious account can do.
const INVITE_EMAIL_RATE_LIMIT = 10;
const INVITE_EMAIL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// SEC-4: close one pending invite from the Household page. The owner may
// close any; a contributor only their own, matching who could mint it. The
// household scope is in the where clause so a forged id from another
// household deletes nothing. Accepted invites aren't listed or deletable
// here: they're history, not a live way in.
export async function revokeInviteAction(invitationId: string): Promise<ActionState> {
  const { household, role, userId } = await requireHousehold();

  try {
    const { count } = await prisma.invitation.deleteMany({
      where: {
        id: invitationId,
        householdId: household.id,
        acceptedAt: null,
        ...(role === "OWNER" ? {} : { invitedById: userId }),
      },
    });
    if (count === 0) return { error: "Invite not found" };
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

// Sends the same link the on-screen "copy link" UI already shows for this
// invite (see InviteButton) — email delivery is additive, not a
// replacement, so the invite still works via manual copy/paste if this
// fails or if RESEND_API_KEY isn't configured (see src/lib/email.ts).
export async function sendInviteEmailAction(token: string, email: string): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  if (
    !(await checkRateLimit(`invite-email:${userId}`, INVITE_EMAIL_RATE_LIMIT, INVITE_EMAIL_RATE_LIMIT_WINDOW_MS))
  ) {
    return { error: "Too many invite emails sent. Please wait a while and try again." };
  }

  const parsed = sendInviteEmailSchema.safeParse({ token, email });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const invitation = await prisma.invitation.findFirst({
    where: { token: parsed.data.token, householdId: household.id },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return { error: "This invite link is invalid or has expired" };
  }

  const inviteUrl = await absoluteAppUrl(`/join/${invitation.token}`);
  // The invitee has no account/preference of their own yet — the inviter's
  // own locale (getLocale() reads their stored account preference, since
  // they're signed in here) is the best available signal.
  const locale = await getLocale();
  return sendHouseholdInviteEmail({
    to: parsed.data.email,
    householdName: household.name,
    inviteUrl,
    locale,
  });
}

async function getValidInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { household: true, invitedBy: { select: { displayName: true } } },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return null;
  }
  return invitation;
}

export async function getInvitationForDisplay(token: string) {
  const invitation = await getValidInvitation(token);
  if (!invitation) return null;
  // UX-62: /join is public, so the inviter is exposed as a display name and
  // nothing else (no id, no email), and only to someone holding a valid token.
  // Null for links made before the column existed.
  return {
    householdName: invitation.household.name,
    inviterName: invitation.invitedBy?.displayName ?? null,
  };
}

export async function acceptInviteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get("token");
  if (typeof token !== "string") return { error: "Invalid invite link" };

  const invitation = await getValidInvitation(token);
  if (!invitation) return { error: "This invite link is invalid or has expired" };

  // requireUserId, not requireHousehold: accepting an invite is one of the
  // two ways out of the no-household page (see NO_HOUSEHOLD_PATH), so it
  // must work for a signed-in user who currently has zero memberships.
  const userId = await requireUserId();

  const alreadyMember = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: invitation.householdId, userId } },
  });

  if (!alreadyMember) {
    try {
      const redeemed = await prisma.$transaction(async (tx) => {
        // SEC-8: claim the invite atomically; a concurrent accept that
        // passed getValidInvitation gets count 0 and joins nobody.
        const claimed = await tx.invitation.updateMany({
          where: { id: invitation.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count === 0) return false;
        await tx.householdMember.create({
          data: { householdId: invitation.householdId, userId, role: "CONTRIBUTOR" },
        });
        return true;
      });
      if (!redeemed) return { error: "This invite link is invalid or has expired" };
    } catch (error) {
      return toFriendlyError(error);
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, invitation.householdId, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

  redirect("/dashboard");
}

// Mirrors auth.ts's SIGNUP_RATE_LIMIT — same account-creation/enumeration
// abuse this join-via-invite flow is equally exposed to.
const JOIN_SIGNUP_RATE_LIMIT = 5;
const JOIN_SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const joinSignupSchema = z
  .object({
    token: z.string().min(1),
    displayName: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(254, "Email is too long"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function joinViaInviteSignupAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = joinSignupSchema.safeParse({
    token: formData.get("token"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token, displayName, email, password } = parsed.data;

  if (!(await checkRateLimit(`join-signup:${email}`, JOIN_SIGNUP_RATE_LIMIT, JOIN_SIGNUP_RATE_LIMIT_WINDOW_MS))) {
    return { error: "Too many attempts. Please wait a while and try again." };
  }

  const invitation = await getValidInvitation(token);
  if (!invitation) return { error: "This invite link is invalid or has expired" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists. Please log in, then open the invite link again." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // Store the language the join form was shown in (UX-56); see signupAction.
  const locale = await getLocale();
  let userId: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      // SEC-8: claim the invite first, atomically (see acceptInviteAction).
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) return null;
      const user = await tx.user.create({ data: { email, passwordHash, displayName, locale } });
      await tx.householdMember.create({
        data: { householdId: invitation.householdId, userId: user.id, role: "CONTRIBUTOR" },
      });
      return user.id;
    });
    if (!created) return { error: "This invite link is invalid or has expired" };
    userId = created;
  } catch (error) {
    return toFriendlyError(error);
  }

  // No active-household cookie here (UX-55): this account has exactly one
  // household, which requireHousehold falls back to, and setting a cookie in
  // a Server Action re-renders the current route. /join/<token> would then
  // see the invite as already used and replace the verification-sent panel
  // with "Invalid invite" at the moment the join succeeded.

  // Same posture as signupAction (src/lib/actions/auth.ts): additive, not a
  // hard dependency, and no auto sign-in — this account's email must be
  // verified before its first successful sign-in (see EmailNotVerifiedSignin
  // in src/lib/auth.ts). A generic invite link carries no proof that
  // whoever typed this email address actually owns it, so it needs the same
  // verification gate as a plain signup. Same enumeration reasoning as
  // signupAction too: the caller just typed this email into this form, so
  // there's nothing lost by telling them plainly if the send failed (see A1
  // in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md).
  let emailError = false;
  try {
    const rawToken = randomUUID();
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        token: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const verifyUrl = await absoluteAppUrl(`/verify-email/${rawToken}`);
    const { error } = await sendVerificationEmail({ to: email, verifyUrl, locale });
    if (error) emailError = true;
  } catch (error) {
    toFriendlyError(error);
    emailError = true;
  }

  return {
    status: "verification-sent",
    email,
    householdName: invitation.household.name,
    ...(emailError ? { emailError: true } : {}),
  };
}

// --- Getting-started household step -------------------------------------

// The getting-started household step's own copy says "or skip it and use it
// solo" (see dashboard.gettingStarted.steps.household), but with no way to
// actually record that choice the step never went away for a deliberately
// solo household — see A11 in docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md. This is a
// lightweight, per-browser dismissal (like ACTIVE_HOUSEHOLD_COOKIE above),
// not account state, so no schema change is needed for it; keyed per
// household (rather than one flag for the whole account) since a user can
// belong to more than one household and skipping the nudge for one solo
// household shouldn't hide it for a different, genuinely-just-getting-set-up
// one.
const HOUSEHOLD_STEP_SKIP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function skipHouseholdStepAction(): Promise<void> {
  const { household } = await requireHousehold();
  const cookieStore = await cookies();
  cookieStore.set(`${HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX}${household.id}`, "1", {
    maxAge: HOUSEHOLD_STEP_SKIP_COOKIE_MAX_AGE,
    path: "/",
  });
  revalidatePath("/dashboard");
}

// UX-26: the whole "Get set up" card can be hidden too, for someone who has
// done the steps they care about and doesn't want the rest pushing today's
// tasks below the fold. Same per-browser, per-household cookie as the
// household step above, for the same reasons.
const GETTING_STARTED_DISMISS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function dismissGettingStartedAction(): Promise<void> {
  const { household } = await requireHousehold();
  const cookieStore = await cookies();
  cookieStore.set(`${GETTING_STARTED_DISMISS_COOKIE_PREFIX}${household.id}`, "1", {
    maxAge: GETTING_STARTED_DISMISS_COOKIE_MAX_AGE,
    path: "/",
  });
  revalidatePath("/dashboard");
}

// UX-69: called once by the "You're all set" moment when it first shows. No
// revalidatePath: the moment must stay on screen until the person leaves the
// overview; the cookie only stops it from appearing again.
export async function markGettingStartedCelebratedAction(): Promise<void> {
  const { household } = await requireHousehold();
  const cookieStore = await cookies();
  cookieStore.set(`${GETTING_STARTED_DONE_COOKIE_PREFIX}${household.id}`, "1", {
    maxAge: GETTING_STARTED_DISMISS_COOKIE_MAX_AGE,
    path: "/",
  });
}

// `returnTo` lets a caller land somewhere other than /dashboard after
// switching, e.g. the budget page's read-only banner going straight back to
// the same month, now writable (see src/lib/budget-household-view.ts). Only
// in-app /dashboard paths are honoured, so a crafted value can't turn this
// into an open redirect; anything else falls back to /dashboard.
function safeDashboardPath(returnTo: string | undefined): string {
  if (!returnTo) return "/dashboard";
  const isDashboardPath =
    returnTo === "/dashboard" || returnTo.startsWith("/dashboard/") || returnTo.startsWith("/dashboard?");
  return isDashboardPath && !returnTo.includes("\\") ? returnTo : "/dashboard";
}

export async function switchHouseholdAction(householdId: string, returnTo?: string) {
  const session = await requireHousehold();
  const isMember = session.households.some((h) => h.id === householdId);
  if (!isMember) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

  revalidatePath("/dashboard");
  redirect(safeDashboardPath(returnTo));
}

const createHouseholdSchema = z.object({
  name: z.string().trim().min(1, "Household name is required").max(60, "Household name is too long"),
});

export async function createHouseholdAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // requireUserId for the same reason as acceptInviteAction: the
  // no-household page uses this to create the user's first household again.
  const userId = await requireUserId();

  const parsed = createHouseholdSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // UX-73: same derived starting currency as signupAction.
  const currencyCode = defaultCurrencyForNewHousehold(
    await getLocale(),
    (await headers()).get("accept-language"),
  );
  let household;
  try {
    household = await prisma.household.create({
      data: {
        name: parsed.data.name,
        currencyCode,
        members: { create: { userId, role: "OWNER" } },
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, household.id, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// --- Owner-only administration -----------------------------------------

// Owner-only like the currency and inventory-sync settings: the name is the
// household's identity for every member (page header, switcher, invite emails,
// the join page), so changing it is administration rather than day-to-day use.
// Same length and trimming rules as creation (createHouseholdSchema), so a
// name that could be typed at signup can be typed here. Called directly in a
// transition (the card toasts on success), so it takes the value rather than
// FormData; the household comes from the session, never the client.
const RENAME_OWNER_ONLY_MESSAGE = "Only the household owner can rename the household";

export async function renameHouseholdAction(name: string): Promise<ActionState> {
  const { household, role } = await requireHousehold();
  if (role !== "OWNER") return { error: RENAME_OWNER_ONLY_MESSAGE };

  const parsed = createHouseholdSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await prisma.household.update({
      where: { id: household.id },
      data: { name: parsed.data.name },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // The name is in the dashboard shell (header, switcher), so revalidate the
  // whole layout. The join page and invite emails read it from the database
  // on each request, so they pick it up without help.
  revalidatePath("/dashboard", "layout");
  return {};
}

// SEC-4: what a departing member could still reach on their own once their
// membership row is gone, closed in the same transaction as the delete.
// - Their pending invites (any role can mint a 7-day link), or a removed
//   contributor could hand themselves a way back in.
// - Every active shopping-list share link in the household. These never
//   expire and need no login, so anyone who held one (the leaver certainly
//   did) keeps reading and ticking the list. We can't tell which links the
//   leaver saw, so all of them are closed; members share again in one tap.
// - The calendar feed token, regenerated (not switched off) so the feed
//   stays enabled; the owner re-copies the new URL from the Household page.
// Rotating automatically beats prompting the owner: a prompt is skippable,
// and a forgotten rotation is the exact hole this closes. The cost is a
// one-off re-share, acceptable for an owner-initiated removal or a leave.
async function revokeDepartingMemberAccess(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string,
) {
  await tx.invitation.deleteMany({
    where: { householdId, invitedById: userId, acceptedAt: null },
  });
  await tx.shoppingListShareLink.updateMany({
    where: { revokedAt: null, shoppingList: { householdId } },
    data: { revokedAt: new Date() },
  });
  await tx.household.updateMany({
    where: { id: householdId, calendarFeedToken: { not: null } },
    data: { calendarFeedToken: generateCalendarFeedToken() },
  });
}

export async function removeMemberAction(memberId: string): Promise<ActionState> {
  const { household, role, userId } = await requireHousehold();
  if (role !== "OWNER") {
    return { error: "Only the household owner can remove members" };
  }

  const member = await prisma.householdMember.findFirst({
    where: { id: memberId, householdId: household.id },
  });
  if (!member) return { error: "Member not found" };
  if (member.userId === userId) return { error: "You can't remove yourself" };
  if (member.role === "OWNER") return { error: "The owner can't be removed" };

  try {
    // settleDepartingMemberSplits must run before (and atomically with) the
    // delete — see its doc comment — since HouseholdMember->TransactionSplit
    // cascades and would otherwise take the member's payment history with it.
    await prisma.$transaction(async (tx) => {
      await settleDepartingMemberSplits(tx, member.id);
      await tx.householdMember.delete({ where: { id: member.id } });
      await revokeDepartingMemberAccess(tx, household.id, member.userId);
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

// Shared by deleteHouseholdAction's own guard below and
// getHouseholdDeleteEligibilityAction, which DeleteHouseholdDialog calls
// up front (before the type-to-confirm flow even opens) so this is stated
// before the user invests any effort in confirming, not after — see A9 in
// docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md. Every other piece of a household's data
// cascades on delete (see schema.prisma's onDelete: Cascade throughout), so
// "this is your only household" is the one real blocker to surface.
const ONLY_HOUSEHOLD_BLOCKED_MESSAGE = "You can't delete your only household. Create another one first.";

export async function getHouseholdDeleteEligibilityAction(): Promise<{ blocked: boolean; reason?: string }> {
  const { role, households } = await requireHousehold();
  if (role !== "OWNER") {
    return { blocked: true, reason: "Only the household owner can delete the household" };
  }
  if (households.length <= 1) {
    return { blocked: true, reason: ONLY_HOUSEHOLD_BLOCKED_MESSAGE };
  }
  return { blocked: false };
}

export async function deleteHouseholdAction(): Promise<ActionState> {
  const { household, role, households } = await requireHousehold();
  if (role !== "OWNER") {
    return { error: "Only the household owner can delete the household" };
  }
  if (households.length <= 1) {
    return { error: ONLY_HOUSEHOLD_BLOCKED_MESSAGE };
  }

  try {
    await prisma.household.delete({ where: { id: household.id } });
  } catch (error) {
    return toFriendlyError(error);
  }

  const fallback = households.find((h) => h.id !== household.id);
  const cookieStore = await cookies();
  if (fallback) {
    cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, fallback.id, {
      maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// A CONTRIBUTOR leaving removes their own membership — mirrors
// removeMemberAction's shape but self-targeted, so there's no "target
// member id" to trust from the client at all. The owner can't use this:
// they must transferOwnershipAction or deleteHouseholdAction instead,
// since a household always needs exactly one OWNER.
export async function leaveHouseholdAction(): Promise<ActionState> {
  const { household, role, userId, households } = await requireHousehold();
  if (role === "OWNER") {
    return { error: "Transfer ownership to another member before leaving, or delete the household instead" };
  }
  if (households.length <= 1) {
    return { error: "You can't leave your only household. Create another one first." };
  }

  const membership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: household.id, userId } },
  });
  if (!membership) return { error: "Membership not found" };

  try {
    // See removeMemberAction's identical comment — settleDepartingMemberSplits
    // must run before (and atomically with) the delete, since it's the
    // leaving member's own membership that's about to cascade away their
    // split rows here too.
    await prisma.$transaction(async (tx) => {
      await settleDepartingMemberSplits(tx, membership.id);
      await tx.householdMember.delete({ where: { id: membership.id } });
      await revokeDepartingMemberAccess(tx, household.id, userId);
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  const fallback = households.find((h) => h.id !== household.id);
  const cookieStore = await cookies();
  if (fallback) {
    cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, fallback.id, {
      maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// Swaps OWNER/CONTRIBUTOR between the caller and the target member in a
// $transaction, same pattern as removeMemberAction/deleteHouseholdAction:
// re-derive both memberships from the session-scoped household rather than
// trusting anything but the target's id from the client.
export async function transferOwnershipAction(newOwnerMemberId: string): Promise<ActionState> {
  const { household, role, userId } = await requireHousehold();
  if (role !== "OWNER") {
    return { error: "Only the household owner can transfer ownership" };
  }

  const currentOwnerMembership = await prisma.householdMember.findUnique({
    where: { householdId_userId: { householdId: household.id, userId } },
  });
  if (!currentOwnerMembership) return { error: "Membership not found" };

  const target = await prisma.householdMember.findFirst({
    where: { id: newOwnerMemberId, householdId: household.id },
  });
  if (!target) return { error: "Member not found" };
  if (target.userId === userId) return { error: "You're already the owner" };
  if (target.role === "OWNER") return { error: "This member is already the owner" };

  try {
    await prisma.$transaction([
      prisma.householdMember.update({
        where: { id: currentOwnerMembership.id },
        data: { role: "CONTRIBUTOR" },
      }),
      prisma.householdMember.update({
        where: { id: target.id },
        data: { role: "OWNER" },
      }),
    ]);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

// AUTO-8's household-wide switch for the low-stock auto-add (see
// addToDefaultListOnLowStock in src/lib/shopping/default-list.ts). Open to
// every member, not owner-gated: REQUIREMENTS.md's "Roles" keeps owner-only
// to removing members and deleting the household, and this is day-to-day
// shopping behaviour that both roles already fully operate. A click action
// (a switch), so it takes the value directly rather than FormData; the
// household comes from the session, never the client.
export async function setAutoAddLowStockToListAction(enabled: boolean): Promise<ActionState> {
  const { household } = await requireHousehold();

  if (typeof enabled !== "boolean") return { error: "Invalid input" };

  try {
    await prisma.household.update({
      where: { id: household.id },
      data: { autoAddLowStockToList: enabled },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

// Which expense category completed shopping lists and registered receipts
// log to (Household.shoppingExpenseCategory, read by
// resolveShoppingExpenseCategory in src/lib/budget-groceries-category.ts).
// Open to every member like the auto-add switch above: budget categories
// themselves aren't role-gated either. `null` goes back to the automatic
// "Groceries" default. A click action (the Household page's select saves on
// change); the category must be one of the session household's EXPENSE
// categories — its id comes from the client, so it's looked up scoped to
// that household rather than trusted.
export async function setShoppingExpenseCategoryAction(categoryId: string | null): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = z.string().trim().min(1).max(100).nullable().safeParse(categoryId);
  if (!parsed.success) return { error: "Invalid input" };

  try {
    if (parsed.data !== null) {
      const category = await prisma.budgetCategory.findFirst({
        where: { id: parsed.data, householdId: household.id, type: "EXPENSE" },
        select: { id: true },
      });
      if (!category) return { error: "Category not found" };
    }
    await prisma.household.update({
      where: { id: household.id },
      data: { shoppingExpenseCategoryId: parsed.data },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

// --- Calendar feed (GAP-3) ----------------------------------------------

// Owner-only, unlike the auto-add switch above and the per-list shopping
// share links (which any member manages). A shopping share link exposes one
// list; this publishes the whole household's meal plan and bill names to
// anyone holding a URL, one that ends up stored by third-party calendar
// services. Deciding to publish that for everyone is administration, the
// same bucket as removing members. Contributors still see and copy the link
// once it's on: they can already read everything in it.
const CALENDAR_FEED_OWNER_ONLY_MESSAGE = "Only the household owner can manage the calendar feed";

async function setCalendarFeedToken(mode: "enable" | "regenerate" | "disable"): Promise<ActionState> {
  const { household, role } = await requireHousehold();
  if (role !== "OWNER") return { error: CALENDAR_FEED_OWNER_ONLY_MESSAGE };

  try {
    if (mode === "enable") {
      // updateMany with `calendarFeedToken: null` in the filter makes a
      // double click (or a second tab) a no-op instead of silently
      // regenerating, which would break a link someone subscribed to a
      // moment ago. Regenerating is its own, confirmed action.
      await prisma.household.updateMany({
        where: { id: household.id, calendarFeedToken: null },
        data: { calendarFeedToken: generateCalendarFeedToken() },
      });
    } else {
      await prisma.household.update({
        where: { id: household.id },
        data: { calendarFeedToken: mode === "regenerate" ? generateCalendarFeedToken() : null },
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  return {};
}

export async function enableCalendarFeedAction(): Promise<ActionState> {
  return setCalendarFeedToken("enable");
}

// Replacing the token is the only way to revoke a link that leaked: the old
// URL starts returning 404 on its next fetch.
export async function regenerateCalendarFeedAction(): Promise<ActionState> {
  return setCalendarFeedToken("regenerate");
}

export async function disableCalendarFeedAction(): Promise<ActionState> {
  return setCalendarFeedToken("disable");
}

// --- Display currency (GAP-13) -------------------------------------------

// Owner-only, like the calendar feed above: the choice relabels every amount
// every member sees, so it's household administration rather than
// day-to-day use (contrast the auto-add switch). Contributors still see the
// current value on the Household page.
const CURRENCY_OWNER_ONLY_MESSAGE = "Only the household owner can change the currency";

/**
 * Sets (or, with null/"", clears) the household's display currency. Only
 * the label changes: no stored amount is converted or rewritten, and
 * receipt conversion keeps targeting HOUSEHOLD_BASE_CURRENCY (see
 * src/lib/currency.ts). A click action — the Household page's select saves
 * on change — so it takes the value directly rather than FormData.
 */
export async function setHouseholdCurrencyAction(currencyCode: string | null): Promise<ActionState> {
  const { household, role } = await requireHousehold();
  if (role !== "OWNER") return { error: CURRENCY_OWNER_ONLY_MESSAGE };

  const parsed = parseHouseholdCurrency(currencyCode);
  if (parsed === undefined) return { error: "Choose a currency from the list" };

  try {
    await prisma.household.update({
      where: { id: household.id },
      data: { currencyCode: parsed },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // Every page that shows an amount (budget, shopping lists, recipes, the
  // household page itself) reads the setting, so the whole dashboard is
  // revalidated rather than listing each route and missing one later.
  revalidatePath("/dashboard", "layout");
  return {};
}

// --- Budget month start day (UX-134) ---------------------------------------

const BUDGET_START_DAY_OWNER_ONLY_MESSAGE = "Only the household owner can change when the budget month starts";

/**
 * Sets the day the household budget's month starts on (1 to 28; 25 for a
 * payday month, the 25th to the 24th). Owner-only like the currency: it
 * moves every member's month boundaries. Nothing stored changes, since
 * transactions keep their dates and only which period each falls in does. A
 * click action (the Household page's select saves on change), so it takes
 * the value directly.
 */
export async function setBudgetMonthStartDayAction(day: number): Promise<ActionState> {
  const { household, role } = await requireHousehold();
  if (role !== "OWNER") return { error: BUDGET_START_DAY_OWNER_ONLY_MESSAGE };

  const parsed = z
    .number()
    .int()
    .min(MIN_BUDGET_MONTH_START_DAY)
    .max(MAX_BUDGET_MONTH_START_DAY)
    .safeParse(day);
  if (!parsed.success) return { error: "Choose a day from 1 to 28" };

  try {
    await prisma.household.update({
      where: { id: household.id },
      data: { budgetMonthStartDay: parsed.data },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // The budget, the overview's Safe to spend and the digest all read it.
  revalidatePath("/dashboard", "layout");
  return {};
}

// --- Inventory sync mode (put-away) --------------------------------------

// Owner-only, like the currency above: it changes what every member's tick
// on every list does to the shared inventory, so it's a household-wide
// decision rather than day-to-day use (contrast the auto-add switch).
// Contributors still see the current choice on the Household page.
const INVENTORY_SYNC_OWNER_ONLY_MESSAGE = "Only the household owner can change when inventory is updated";

const inventorySyncModeSchema = z.enum(["ON_CHECK", "ON_PUT_AWAY"]);

/**
 * Chooses whether ticking a shopping-list row updates inventory straight
 * away (ON_CHECK) or waits for the list's "Put away" step (ON_PUT_AWAY) —
 * see Household.inventorySyncMode. Switching is always safe mid-trip:
 * togglePurchasedAction decides an un-tick by the row's own `putAwayAt`,
 * never the mode, and rows ticked under ON_PUT_AWAY stay in the put-away
 * dialog after a switch to ON_CHECK rather than being counted or dropped
 * silently. A click action (the Household page's select saves on change),
 * so it takes the value directly rather than FormData.
 */
export async function setInventorySyncModeAction(mode: string): Promise<ActionState> {
  const { household, role } = await requireHousehold();
  if (role !== "OWNER") return { error: INVENTORY_SYNC_OWNER_ONLY_MESSAGE };

  const parsed = inventorySyncModeSchema.safeParse(mode);
  if (!parsed.success) return { error: "Invalid input" };

  try {
    await prisma.household.update({
      where: { id: household.id },
      data: { inventorySyncMode: parsed.data },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/household");
  revalidatePath("/dashboard/shopping-list", "layout");
  return {};
}
