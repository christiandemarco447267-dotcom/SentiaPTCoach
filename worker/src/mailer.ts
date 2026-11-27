// Account emails (verify your email, reset your password) sent through Resend's HTTP API.
//   https://resend.com/docs/api-reference/emails/send-email
// Needs the RESEND_API_KEY secret; EMAIL_FROM is optional (default below). Without the key,
// email sign-up and password reset are switched off (no bypass) and /health says so.

import type { Env } from "./env";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const DEFAULT_EMAIL_FROM = "Sentia <no-reply@sentiacoach.com>";
export const DEFAULT_SITE_URL = "https://sentiacoach.com";
/** Replies to account emails go to the support inbox (forwarded by Cloudflare Email Routing). */
export const SUPPORT_EMAIL = "support@sentiacoach.com";

export type OutgoingEmail = { to: string; subject: string; html: string; text: string };

export function emailConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_API_KEY.trim() && env.SENTIA_KV);
}

export function emailFrom(env: Env): string {
  const from = (env.EMAIL_FROM ?? "").trim();
  return from || DEFAULT_EMAIL_FROM;
}

/** Send one email. Resolves true when Resend accepted it; never throws. */
export async function sendEmail(env: Env, email: OutgoingEmail, f: typeof fetch = fetch): Promise<boolean> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return false;
  try {
    const res = await f(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: emailFrom(env), to: [email.to], reply_to: SUPPORT_EMAIL, subject: email.subject, html: email.html, text: email.text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- templates ---------------------------------------------------------------------------

const PURPLE = "#7c3aed";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

type TemplateInput = { heading: string; intro: string; code: string; buttonLabel: string; link: string; expiresMinutes: number; ignoreLine: string };

function render(input: TemplateInput): { html: string; text: string } {
  const code = escapeHtml(input.code);
  const link = escapeHtml(input.link);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f2fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f1b2e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2fb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:${PURPLE};padding:18px 24px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.2px;">Sentia</td></tr>
        <tr><td style="padding:28px 24px 8px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#1f1b2e;">${escapeHtml(input.heading)}</h1>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#3b3550;">${escapeHtml(input.intro)}</p>
          <p style="margin:0 0 6px;font-size:13px;color:#6b6480;">Your code</p>
          <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:8px;color:${PURPLE};font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${code}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="border-radius:10px;background:${PURPLE};">
            <a href="${link}" style="display:inline-block;padding:13px 22px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(input.buttonLabel)}</a>
          </td></tr></table>
          <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#3b3550;">The code and button work once and expire in ${input.expiresMinutes} minutes.</p>
          <p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#6b6480;">Button not working? Copy this link into your browser:<br><a href="${link}" style="color:${PURPLE};word-break:break-all;">${link}</a></p>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;border-top:1px solid #ece9f5;font-size:13px;line-height:1.5;color:#6b6480;">${escapeHtml(input.ignoreLine)}<br>Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${PURPLE};">${SUPPORT_EMAIL}</a>.<br>Sentia is a paper-trading practice app. No real money.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    input.heading,
    "",
    input.intro,
    "",
    `Your code: ${input.code}`,
    "",
    `${input.buttonLabel}: ${input.link}`,
    "",
    `The code and link work once and expire in ${input.expiresMinutes} minutes.`,
    "",
    input.ignoreLine,
    `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    "",
    "Sentia — paper-trading practice. No real money.",
  ].join("\n");
  return { html, text };
}

export function verificationEmail(to: string, code: string, link: string, expiresMinutes: number): OutgoingEmail {
  const { html, text } = render({
    heading: "Confirm your email",
    intro: "Welcome to Sentia! Enter this code in the app, or tap the button, to confirm this is your email and finish creating your account.",
    code,
    buttonLabel: "Confirm my email",
    link,
    expiresMinutes,
    ignoreLine: "Didn't sign up for Sentia? You can ignore this email. No account is created unless the address is confirmed.",
  });
  return { to, subject: `${code} is your Sentia verification code`, html, text };
}

export function passwordResetEmail(to: string, code: string, link: string, expiresMinutes: number): OutgoingEmail {
  const { html, text } = render({
    heading: "Reset your password",
    intro: "Someone (hopefully you) asked to reset the password for this Sentia account. Enter this code, or tap the button, to choose a new password.",
    code,
    buttonLabel: "Choose a new password",
    link,
    expiresMinutes,
    ignoreLine: "Didn't ask for this? You can ignore this email. Your password stays the same.",
  });
  return { to, subject: `${code} is your Sentia password reset code`, html, text };
}
