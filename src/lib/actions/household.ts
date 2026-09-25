"use server";

import { randomUUID } from "crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ACTIVE_HOUSEHOLD_COOKIE, requireHousehold, requireUserId } from "@/lib/session";
import { sendHouseholdInviteEmail, sendVerificationEmail } from "@/lib/email";
import type { ActionState, SignupState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLocale } from "@/lib/i18n/get-dictionary";

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
  const { household } = await requireHousehold();

  let invitation;
  try {
    invitation = await prisma.invitation.create({
      data: {
        householdId: household.id,
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

// Building this from the request's Host/X-Forwarded-Host header would let
// anyone who can shape their own HTTP request (trivial with curl — the
// browser's address bar plays no part in it) get this app to mail a
// household invite link that points at an attacker-controlled domain, while
// the token embedded in it is entirely real. That's a phishing primer
// disguised as a legitimate invite, so the base URL must come from a value
// only the deployer controls. APP_URL is checked first; the header-derived
// guess only remains as a local-dev convenience when it's unset (so
// `npm run dev` keeps working with no setup).
async function absoluteAppUrl(path: string): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}${path}`;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${path}`;
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
    include: { household: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return null;
  }
  return invitation;
}

export async function getInvitationForDisplay(token: string) {
  const invitation = await getValidInvitation(token);
  if (!invitation) return null;
  return { householdName: invitation.household.name };
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
      await prisma.$transaction([
        prisma.householdMember.create({
          data: { householdId: invitation.householdId, userId, role: "CONTRIBUTOR" },
        }),
        prisma.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        }),
      ]);
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
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash, displayName } });
      await tx.householdMember.create({
        data: { householdId: invitation.householdId, userId: user.id, role: "CONTRIBUTOR" },
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      return user.id;
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE, invitation.householdId, {
    maxAge: ACTIVE_HOUSEHOLD_COOKIE_MAX_AGE,
    path: "/",
  });

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
    const verificationToken = await prisma.emailVerificationToken.create({
      data: {
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      },
    });
    const verifyUrl = await absoluteAppUrl(`/verify-email/${verificationToken.token}`);
    const locale = await getLocale();
    const { error } = await sendVerificationEmail({ to: email, verifyUrl, locale });
    if (error) emailError = true;
  } catch (error) {
    toFriendlyError(error);
    emailError = true;
  }

  return { status: "verification-sent", email, ...(emailError ? { emailError: true } : {}) };
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
const HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX = "household_step_skipped_";
const HOUSEHOLD_STEP_SKIP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function isHouseholdStepSkipped(householdId: string): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(`${HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX}${householdId}`)?.value === "1";
}

export async function skipHouseholdStepAction(): Promise<void> {
  const { household } = await requireHousehold();
  const cookieStore = await cookies();
  cookieStore.set(`${HOUSEHOLD_STEP_SKIP_COOKIE_PREFIX}${household.id}`, "1", {
    maxAge: HOUSEHOLD_STEP_SKIP_COOKIE_MAX_AGE,
    path: "/",
  });
  revalidatePath("/dashboard");
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

  let household;
  try {
    household = await prisma.household.create({
      data: {
        name: parsed.data.name,
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
    await prisma.householdMember.delete({ where: { id: member.id } });
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
    await prisma.householdMember.delete({ where: { id: membership.id } });
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
