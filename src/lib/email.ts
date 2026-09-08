import "server-only";
import { Resend } from "resend";
import { logger } from "@/lib/logger";

// Resend chosen over alternatives (Nodemailer+SMTP, SendGrid, Postmark) as
// the least-friction option for a Next.js app: no SMTP server to run, a
// generous free tier for a household-scale app, and a small SDK with no
// extra config beyond an API key. There was no existing email provider or
// preference anywhere in the codebase before this.
//
// Without RESEND_API_KEY set (e.g. in local dev without a Resend account),
// sending is a no-op that returns an error the caller surfaces in the UI —
// the on-screen invite link (see createInviteAction) always works
// regardless, so email is additive, not a hard dependency.

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// resend.dev's shared sending domain works out of the box with no domain
// verification, which keeps local/dev setup to just an API key. Production
// deployments should set EMAIL_FROM to a verified sending address instead.
const DEFAULT_FROM = "Household Hub <onboarding@resend.dev>";

export async function sendHouseholdInviteEmail({
  to,
  householdName,
  inviteUrl,
}: {
  to: string;
  householdName: string;
  inviteUrl: string;
}): Promise<{ error?: string }> {
  if (!resend) {
    return { error: "Email delivery isn't configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject: `You're invited to join ${householdName} on Household Hub`,
      html: `
        <p>You've been invited to join <strong>${escapeHtml(householdName)}</strong> on Household Hub.</p>
        <p><a href="${inviteUrl}">Accept the invite</a></p>
        <p>Or copy and paste this link into your browser:<br />${inviteUrl}</p>
        <p style="color:#666;font-size:12px;">This link expires in 7 days.</p>
      `,
    });

    if (error) {
      return { error: error.message || "Failed to send email" };
    }
    return {};
  } catch (err) {
    logger.error("Failed to send invite email", { error: err });
    return { error: "Failed to send email" };
  }
}

// Unlike sendHouseholdInviteEmail's link, this one has no on-screen
// fallback: it must only ever reach the account owner's inbox (see
// requestPasswordResetAction in src/lib/actions/auth.ts). If this fails or
// RESEND_API_KEY isn't configured, the caller must NOT expose that — surface
// only the same generic "if an account exists..." message either way, never
// "couldn't reach you, here's the link instead."
export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}): Promise<{ error?: string }> {
  if (!resend) {
    return { error: "Email delivery isn't configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject: "Reset your Household Hub password",
      html: `
        <p>We received a request to reset your Household Hub password.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>Or copy and paste this link into your browser:<br />${resetUrl}</p>
        <p style="color:#666;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    if (error) {
      return { error: error.message || "Failed to send email" };
    }
    return {};
  } catch (err) {
    logger.error("Failed to send password reset email", { error: err });
    return { error: "Failed to send email" };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
