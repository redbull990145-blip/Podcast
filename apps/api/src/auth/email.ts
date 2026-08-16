/**
 * Sending the verification code.
 *
 * Resend over plain HTTP rather than their SDK, for the same reason `ai/groq.ts`
 * talks to Groq directly: the surface used here is one endpoint and one response
 * shape, and an SDK would bring its own fetch, its own retries and its own
 * opinions to wrap thirty lines. `fetch` is in the runtime already.
 *
 * Nothing here throws. A provider outage must not turn into a failed sign-up:
 * the account is already created by the time this runs, and a person who never
 * receives a code can ask for another one, whereas a person whose sign-up 500s
 * has lost the account entirely. Failures are logged and reported to the caller
 * as a boolean.
 */

import type { FastifyBaseLogger } from 'fastify';

const ENDPOINT = 'https://api.resend.com/emails';

/** Generous enough for a cold provider, short enough not to hold a request open. */
const TIMEOUT_MS = 10_000;

export type EmailConfig = { apiKey: string; from: string };

/** What the code is for, which decides what the message says. */
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

type Copy = { subject: string; heading: string; lead: string };

/**
 * Wording per purpose.
 *
 * The same six digits mean different things, and a message that says "verify
 * your email" when someone asked to reset a password reads as a phishing
 * attempt — which is exactly the instinct we want people to keep.
 */
const COPY: Record<OtpPurpose, Copy> = {
  'email-verification': {
    subject: 'Verify your email',
    heading: 'Verify your email',
    lead: 'Enter this code to finish setting up your Cue account.',
  },
  'sign-in': {
    subject: 'Your sign-in code',
    heading: 'Sign in to Cue',
    lead: 'Enter this code to sign in.',
  },
  'forget-password': {
    subject: 'Reset your password',
    heading: 'Reset your password',
    lead: 'Enter this code to choose a new password.',
  },
  'change-email': {
    subject: 'Confirm your new email',
    heading: 'Confirm your new email',
    lead: 'Enter this code to start using this address for your Cue account.',
  },
};

/**
 * Escape anything interpolated into the HTML body.
 *
 * The OTP is generated here and the purpose is a closed set, so neither is
 * attacker-controlled today. This is not for them: it is so that the next value
 * someone adds to this template — a display name, most likely, which is
 * user-supplied and arbitrary — cannot inject markup into mail we send in the
 * user's name.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A deliberately plain message.
 *
 * Inline styles and a table-free single column, because mail clients are not
 * browsers: Gmail strips `<style>` blocks, Outlook renders with Word, and dark
 * mode inverts what it likes. Anything more elaborate degrades in a way we
 * cannot see from here, and the entire job is showing six digits legibly.
 */
function render(otp: string, minutes: number, copy: Copy): string {
  const code = escapeHtml(otp);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#0f0f10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#18181b;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#fafafa;">${escapeHtml(copy.heading)}</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#a1a1aa;">${escapeHtml(copy.lead)}</p>
      <div style="margin:0 0 24px;padding:16px;background:#0f0f10;border-radius:8px;text-align:center;">
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:600;letter-spacing:8px;color:#fafafa;">${code}</span>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
        This code expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.
      </p>
    </div>
  </body>
</html>`;
}

/** The same message as text, for clients that refuse HTML. */
function renderText(otp: string, minutes: number, copy: Copy): string {
  return [
    copy.heading,
    '',
    copy.lead,
    '',
    otp,
    '',
    `This code expires in ${minutes} minutes.`,
    "If you didn't ask for it, you can ignore this email.",
  ].join('\n');
}

export type SendOtpArgs = {
  config: EmailConfig;
  to: string;
  otp: string;
  purpose: OtpPurpose;
  /** How long the code lasts, for the message to say so honestly. */
  expiresInSec: number;
  log: FastifyBaseLogger;
  /** Injectable so tests never reach the network. */
  fetchImpl?: typeof fetch;
};

/** Returns whether the provider accepted it. Never throws. */
export async function sendOtpEmail(args: SendOtpArgs): Promise<boolean> {
  const { config, to, otp, purpose, expiresInSec, log } = args;
  const doFetch = args.fetchImpl ?? fetch;

  const copy = COPY[purpose];
  const minutes = Math.max(1, Math.round(expiresInSec / 60));

  try {
    const response = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: copy.subject,
        html: render(otp, minutes, copy),
        text: renderText(otp, minutes, copy),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries Resend's own reason — an unverified sending domain,
      // or the sandbox sender refusing a third-party address. Both are
      // configuration problems that are invisible without this line, and both
      // look identical from the outside: no email arrives.
      const detail = await response.text().catch(() => '');
      log.error(
        { status: response.status, detail: detail.slice(0, 400), purpose },
        'could not send verification email',
      );
      return false;
    }

    // The address is deliberately not logged. Logs travel further than the
    // database does, and an address is the one identifier here worth keeping
    // out of them.
    log.info({ purpose }, 'verification email sent');
    return true;
  } catch (error) {
    log.error({ err: error, purpose }, 'could not reach the email provider');
    return false;
  }
}
