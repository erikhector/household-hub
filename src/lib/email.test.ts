// Tests src/lib/email.ts's own logic directly: the email templates built for
// each exported send function, and the module's handling of an unconfigured
// RESEND_API_KEY / a failing Resend API call. Resend itself is mocked (no
// network call is made) — see src/lib/push.test.ts for the same
// module-reads-env-at-load-time pattern this file follows: RESEND_API_KEY is
// read once, at import time, into a module-level `resend` singleton, so each
// case resets modules and re-imports after setting/clearing the env var
// rather than importing once at the top of the file.
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendMock, ResendMock, loggerErrorMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  ResendMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

// email.ts imports "server-only", which Vitest's Node environment can't
// resolve outside a Next.js build (same class of issue documented in
// src/lib/actions/auth.test.ts) — stub it out.
vi.mock("server-only", () => ({}));

vi.mock("resend", () => ({
  Resend: ResendMock.mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() },
}));

const ORIGINAL_ENV = { ...process.env };

async function loadEmail() {
  vi.resetModules();
  return import("@/lib/email");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("when RESEND_API_KEY is configured", () => {
  function setConfigured() {
    process.env.RESEND_API_KEY = "test-api-key";
    delete process.env.EMAIL_FROM;
  }

  describe("sendHouseholdInviteEmail", () => {
    it("sends an invite email with the right recipient, subject, and link", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
      const { sendHouseholdInviteEmail } = await loadEmail();

      const result = await sendHouseholdInviteEmail({
        to: "invitee@example.com",
        householdName: "The Smiths",
        inviteUrl: "https://app.example.com/join/abc123",
      });

      expect(result).toEqual({});
      expect(sendMock).toHaveBeenCalledTimes(1);
      const call = sendMock.mock.calls[0][0];
      expect(call.from).toBe("Squirrel <onboarding@resend.dev>");
      expect(call.to).toBe("invitee@example.com");
      expect(call.subject).toBe("You're invited to join The Smiths on Squirrel");
      expect(call.html).toContain("https://app.example.com/join/abc123");
      expect(call.html).toContain('href="https://app.example.com/join/abc123"');
      expect(call.html).toContain("The Smiths");
    });

    it("HTML-escapes the household name but not the invite URL", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
      const { sendHouseholdInviteEmail } = await loadEmail();

      await sendHouseholdInviteEmail({
        to: "invitee@example.com",
        householdName: `<script>alert("hi")</script> & Co`,
        inviteUrl: "https://app.example.com/join/abc123?x=1&y=2",
      });

      const call = sendMock.mock.calls[0][0];
      expect(call.html).not.toContain("<script>alert(\"hi\")</script>");
      expect(call.html).toContain("&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; &amp; Co");
      expect(call.html).toContain("https://app.example.com/join/abc123?x=1&y=2");
    });

    it("renders the invite in Swedish when locale is 'sv', still escaping the household name", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
      const { sendHouseholdInviteEmail } = await loadEmail();

      await sendHouseholdInviteEmail({
        to: "invitee@example.com",
        householdName: "Familjen <Svensson>",
        inviteUrl: "https://app.example.com/join/abc123",
        locale: "sv",
      });

      const call = sendMock.mock.calls[0][0];
      expect(call.subject).toBe("Du är inbjuden till Familjen <Svensson> på Squirrel");
      expect(call.html).toContain("Du är inbjuden!");
      expect(call.html).toContain("Familjen &lt;Svensson&gt;");
      expect(call.html).not.toContain("Familjen <Svensson>");
    });

    it("includes the app logo when APP_URL is configured, omits it otherwise", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });

      process.env.APP_URL = "https://app.example.com";
      const { sendHouseholdInviteEmail: sendWithLogo } = await loadEmail();
      await sendWithLogo({
        to: "invitee@example.com",
        householdName: "The Smiths",
        inviteUrl: "https://app.example.com/join/abc123",
      });
      expect(sendMock.mock.calls[0][0].html).toContain(
        '<img src="https://app.example.com/icon-192.png"',
      );

      sendMock.mockClear();
      delete process.env.APP_URL;
      const { sendHouseholdInviteEmail: sendWithoutLogo } = await loadEmail();
      await sendWithoutLogo({
        to: "invitee@example.com",
        householdName: "The Smiths",
        inviteUrl: "https://app.example.com/join/abc123",
      });
      expect(sendMock.mock.calls[0][0].html).not.toContain("<img");
    });

    it("respects EMAIL_FROM when set", async () => {
      setConfigured();
      process.env.EMAIL_FROM = "Squirrel <hello@example.com>";
      sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
      const { sendHouseholdInviteEmail } = await loadEmail();

      await sendHouseholdInviteEmail({
        to: "invitee@example.com",
        householdName: "The Smiths",
        inviteUrl: "https://app.example.com/join/abc123",
      });

      expect(sendMock.mock.calls[0][0].from).toBe("Squirrel <hello@example.com>");
    });
  });

  describe("sendPasswordResetEmail", () => {
    it("sends a password reset email with the right recipient, subject, and link", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-2" }, error: null });
      const { sendPasswordResetEmail } = await loadEmail();

      const result = await sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: "https://app.example.com/reset-password/tok-1",
      });

      expect(result).toEqual({});
      const call = sendMock.mock.calls[0][0];
      expect(call.to).toBe("user@example.com");
      expect(call.subject).toBe("Reset your Squirrel password");
      expect(call.html).toContain("https://app.example.com/reset-password/tok-1");
      expect(call.html).toContain('href="https://app.example.com/reset-password/tok-1"');
    });

    it("renders in Swedish when locale is 'sv'", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-2" }, error: null });
      const { sendPasswordResetEmail } = await loadEmail();

      await sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: "https://app.example.com/reset-password/tok-1",
        locale: "sv",
      });

      const call = sendMock.mock.calls[0][0];
      expect(call.subject).toBe("Återställ ditt Squirrel-lösenord");
      expect(call.html).toContain("Återställ ditt lösenord");
    });

    it("falls back to English for an unrecognized locale", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-2" }, error: null });
      const { sendPasswordResetEmail } = await loadEmail();

      await sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: "https://app.example.com/reset-password/tok-1",
        locale: "fr",
      });

      expect(sendMock.mock.calls[0][0].subject).toBe("Reset your Squirrel password");
    });
  });

  describe("sendVerificationEmail", () => {
    it("sends a verification email with the right recipient, subject, and link", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: { id: "email-3" }, error: null });
      const { sendVerificationEmail } = await loadEmail();

      const result = await sendVerificationEmail({
        to: "newuser@example.com",
        verifyUrl: "https://app.example.com/verify-email/tok-2",
      });

      expect(result).toEqual({});
      const call = sendMock.mock.calls[0][0];
      expect(call.to).toBe("newuser@example.com");
      expect(call.subject).toBe("Verify your Squirrel email address");
      expect(call.html).toContain("https://app.example.com/verify-email/tok-2");
      expect(call.html).toContain('href="https://app.example.com/verify-email/tok-2"');
    });
  });

  describe("when the Resend API call fails", () => {
    it("returns the API's error message when Resend responds with an error payload", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: null, error: { message: "Invalid `to` field" } });
      const { sendHouseholdInviteEmail } = await loadEmail();

      const result = await sendHouseholdInviteEmail({
        to: "invitee@example.com",
        householdName: "The Smiths",
        inviteUrl: "https://app.example.com/join/abc123",
      });

      expect(result).toEqual({ error: "Invalid `to` field" });
    });

    it("falls back to a generic message when the error payload has no message", async () => {
      setConfigured();
      sendMock.mockResolvedValue({ data: null, error: {} });
      const { sendPasswordResetEmail } = await loadEmail();

      const result = await sendPasswordResetEmail({
        to: "user@example.com",
        resetUrl: "https://app.example.com/reset-password/tok-1",
      });

      expect(result).toEqual({ error: "Failed to send email" });
    });

    it("returns a generic error and logs when the send call rejects (network failure)", async () => {
      setConfigured();
      sendMock.mockRejectedValue(new Error("network error"));
      const { sendVerificationEmail } = await loadEmail();

      const result = await sendVerificationEmail({
        to: "newuser@example.com",
        verifyUrl: "https://app.example.com/verify-email/tok-2",
      });

      expect(result).toEqual({ error: "Failed to send email" });
      expect(loggerErrorMock).toHaveBeenCalledWith(
        "Failed to send verification email",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("does not throw when Resend rejects with a non-2xx-style HTTP error", async () => {
      setConfigured();
      sendMock.mockRejectedValue(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
      const { sendHouseholdInviteEmail } = await loadEmail();

      await expect(
        sendHouseholdInviteEmail({
          to: "invitee@example.com",
          householdName: "The Smiths",
          inviteUrl: "https://app.example.com/join/abc123",
        }),
      ).resolves.toEqual({ error: "Failed to send email" });
    });
  });
});

describe("when RESEND_API_KEY is not configured", () => {
  function setUnconfigured() {
    delete process.env.RESEND_API_KEY;
  }

  it("sendHouseholdInviteEmail fails gracefully instead of calling Resend", async () => {
    setUnconfigured();
    const { sendHouseholdInviteEmail } = await loadEmail();

    const result = await sendHouseholdInviteEmail({
      to: "invitee@example.com",
      householdName: "The Smiths",
      inviteUrl: "https://app.example.com/join/abc123",
    });

    expect(result).toEqual({ error: "Email delivery isn't configured" });
    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sendPasswordResetEmail fails gracefully instead of calling Resend", async () => {
    setUnconfigured();
    const { sendPasswordResetEmail } = await loadEmail();

    const result = await sendPasswordResetEmail({
      to: "user@example.com",
      resetUrl: "https://app.example.com/reset-password/tok-1",
    });

    expect(result).toEqual({ error: "Email delivery isn't configured" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sendVerificationEmail fails gracefully instead of calling Resend", async () => {
    setUnconfigured();
    const { sendVerificationEmail } = await loadEmail();

    const result = await sendVerificationEmail({
      to: "newuser@example.com",
      verifyUrl: "https://app.example.com/verify-email/tok-2",
    });

    expect(result).toEqual({ error: "Email delivery isn't configured" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not throw when RESEND_API_KEY is unset", async () => {
    setUnconfigured();
    const { sendHouseholdInviteEmail } = await loadEmail();

    await expect(
      sendHouseholdInviteEmail({
        to: "invitee@example.com",
        householdName: "The Smiths",
        inviteUrl: "https://app.example.com/join/abc123",
      }),
    ).resolves.not.toThrow();
  });
});

// email.ts does no recipient validation of its own (no email-format check,
// no rejection of malformed addresses) — `to` is passed straight through to
// Resend's API, which is the layer that would reject it. Callers (see
// src/lib/actions/auth.ts / household.ts) validate the address with Zod
// before calling into this module. So there's no in-module "malformed
// recipient" behavior to test here.
