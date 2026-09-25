import "server-only";
import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { getDictionaryForLocale } from "@/lib/i18n/dictionaries";
import { isLocale, defaultLocale } from "@/lib/i18n/locales";
import { format } from "@/lib/i18n/format";

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
const DEFAULT_FROM = "Squirrel <onboarding@resend.dev>";

// Matches manifest.ts's theme_color / globals.css's --primary (oklch(0.56
// 0.22 300)) — kept as a plain hex here since email clients don't support
// oklch(), and hardcoded rather than themed since an email is rendered once,
// server-side, with no CSS variables or dark-mode media query support to
// rely on across mail clients.
const BRAND_COLOR = "#a855f7";

// APP_URL is the same "deployer-controlled base URL" env var absoluteAppUrl()
// in auth.ts/household.ts builds links from — reused here (rather than
// threading a resolved origin through every send call) purely to point the
// logo <img> at a real, publicly-reachable URL. Left out entirely in local
// dev without APP_URL set, since a bare-hostname/localhost logo URL
// wouldn't load in an email client anyway; the text wordmark alone still
// reads fine.
const APP_URL = process.env.APP_URL?.trim().replace(/\/+$/, "");
const LOGO_URL = APP_URL ? `${APP_URL}/icon-192.png` : undefined;

function normalizeLocale(locale: string | undefined) {
  return isLocale(locale) ? locale : defaultLocale;
}

// Shared chrome (logo, card, button, footer) around each email's own
// heading/body/CTA text — kept intentionally simple (plain divs, inline
// styles, no external stylesheet) rather than a bulletproof-table layout:
// this app's recipients are read in modern mail clients (Gmail, Apple Mail,
// Outlook.com), not legacy desktop Outlook, so that complexity isn't earning
// its keep here.
function renderEmailHtml({
  heading,
  bodyHtml,
  ctaLabel,
  ctaUrl,
  copyLinkPrefix,
  footerNote,
}: {
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  copyLinkPrefix: string;
  footerNote: string;
}): string {
  const logo = LOGO_URL
    ? `<img src="${LOGO_URL}" width="48" height="48" alt="" style="display:block;margin:0 auto 8px;border-radius:12px;" />`
    : "";

  return `
    <div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;">
        <div style="padding:32px 32px 0;text-align:center;">
          ${logo}
          <div style="font-size:18px;font-weight:700;color:#18181b;">Squirrel</div>
        </div>
        <div style="padding:24px 32px 32px;">
          <h1 style="font-size:20px;line-height:1.3;margin:0 0 12px;color:#18181b;">${heading}</h1>
          <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">${bodyHtml}</p>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${ctaUrl}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:9999px;">${ctaLabel}</a>
          </div>
          <p style="font-size:13px;line-height:1.6;color:#71717a;margin:0 0 8px;">
            ${copyLinkPrefix} <a href="${ctaUrl}" style="color:${BRAND_COLOR};">${ctaLabel}</a>
          </p>
          <p style="font-size:12px;line-height:1.5;color:#a1a1aa;margin:16px 0 0;">${footerNote}</p>
        </div>
      </div>
    </div>
  `;
}

// Plain-text alternative sent alongside the HTML part (multipart), matching
// renderEmailHtml's content — mail clients that prefer/require text fall
// back to this, and its presence is itself a positive signal to spam
// filters versus an HTML-only send.
function renderEmailText({
  heading,
  bodyText,
  ctaLabel,
  ctaUrl,
  footerNote,
}: {
  heading: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  footerNote: string;
}): string {
  return [heading, bodyText, `${ctaLabel}: ${ctaUrl}`, footerNote].join("\n\n");
}

export async function sendHouseholdInviteEmail({
  to,
  householdName,
  inviteUrl,
  locale,
}: {
  to: string;
  householdName: string;
  inviteUrl: string;
  locale?: string;
}): Promise<{ error?: string }> {
  if (!resend) {
    return { error: "Email delivery isn't configured" };
  }

  const dict = getDictionaryForLocale(normalizeLocale(locale)).email;

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject: format(dict.invite.subject, { householdName }),
      html: renderEmailHtml({
        heading: dict.invite.heading,
        bodyHtml: format(dict.invite.body, { householdName: escapeHtml(householdName) }),
        ctaLabel: dict.invite.cta,
        ctaUrl: inviteUrl,
        copyLinkPrefix: dict.copyLinkPrefix,
        footerNote: dict.invite.expiry,
      }),
      text: renderEmailText({
        heading: dict.invite.heading,
        bodyText: format(dict.invite.body, { householdName }),
        ctaLabel: dict.invite.cta,
        ctaUrl: inviteUrl,
        footerNote: dict.invite.expiry,
      }),
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
  locale,
}: {
  to: string;
  resetUrl: string;
  locale?: string;
}): Promise<{ error?: string }> {
  if (!resend) {
    return { error: "Email delivery isn't configured" };
  }

  const dict = getDictionaryForLocale(normalizeLocale(locale)).email;

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject: dict.passwordReset.subject,
      html: renderEmailHtml({
        heading: dict.passwordReset.heading,
        bodyHtml: dict.passwordReset.body,
        ctaLabel: dict.passwordReset.cta,
        ctaUrl: resetUrl,
        copyLinkPrefix: dict.copyLinkPrefix,
        footerNote: dict.passwordReset.expiry,
      }),
      text: renderEmailText({
        heading: dict.passwordReset.heading,
        bodyText: dict.passwordReset.body,
        ctaLabel: dict.passwordReset.cta,
        ctaUrl: resetUrl,
        footerNote: dict.passwordReset.expiry,
      }),
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

// Unlike sendPasswordResetEmail's link, this one is casual: holding it lets
// someone mark an email address verified, not take over an account (see
// verifyEmailAction in src/lib/actions/auth.ts). A delivery failure here
// must never block signup — signupAction still creates the account either
// way, and resendVerificationEmailAction lets the user retry from the
// dashboard banner.
export async function sendVerificationEmail({
  to,
  verifyUrl,
  locale,
}: {
  to: string;
  verifyUrl: string;
  locale?: string;
}): Promise<{ error?: string }> {
  if (!resend) {
    return { error: "Email delivery isn't configured" };
  }

  const dict = getDictionaryForLocale(normalizeLocale(locale)).email;

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject: dict.verification.subject,
      html: renderEmailHtml({
        heading: dict.verification.heading,
        bodyHtml: dict.verification.body,
        ctaLabel: dict.verification.cta,
        ctaUrl: verifyUrl,
        copyLinkPrefix: dict.copyLinkPrefix,
        footerNote: dict.verification.expiry,
      }),
      text: renderEmailText({
        heading: dict.verification.heading,
        bodyText: dict.verification.body,
        ctaLabel: dict.verification.cta,
        ctaUrl: verifyUrl,
        footerNote: dict.verification.expiry,
      }),
    });

    if (error) {
      return { error: error.message || "Failed to send email" };
    }
    return {};
  } catch (err) {
    logger.error("Failed to send verification email", { error: err });
    return { error: "Failed to send email" };
  }
}

// Lets a batch sender (the weekly digest cron, src/lib/weekly-digest.ts)
// skip all of its database work up front when nothing could be sent anyway,
// instead of loading every household's data only to have each send no-op.
export function isEmailConfigured(): boolean {
  return resend !== null;
}

// Logo URL for callers that render their own email body (the weekly digest's
// multi-section layout doesn't fit renderEmailHtml's one-paragraph shape).
export function emailLogoUrl(): string | undefined {
  return LOGO_URL;
}

// GAP-27's weekly digest. The subject/HTML/text are rendered by the pure
// renderWeeklyDigest (src/lib/weekly-digest-content.ts); this only adds the
// transport concerns. `List-Unsubscribe` + `List-Unsubscribe-Post` are the
// RFC 8058 one-click unsubscribe headers — Gmail and Yahoo require them for
// bulk-style mail and show a native "Unsubscribe" button next to the sender
// when they're present. The URL they point at is POST-able
// (src/app/api/digest/unsubscribe/[token]/route.ts) and signed, so it works
// without a login.
export async function sendWeeklyDigestEmail({
  to,
  subject,
  html,
  text,
  unsubscribeUrl,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<{ error?: string }> {
  if (!resend) {
    return { error: "Email delivery isn't configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (error) {
      return { error: error.message || "Failed to send email" };
    }
    return {};
  } catch (err) {
    logger.error("Failed to send weekly digest email", { error: err });
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
