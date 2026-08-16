import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { sendOtpEmail } from './email.ts';

const config = { apiKey: 'test-key', from: 'Cue <test@example.com>' };

/** Enough of a logger to satisfy the calls this module makes. */
function logger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as FastifyBaseLogger & { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function accepted(): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })) as never;
}

describe('sendOtpEmail', () => {
  it('posts the code to Resend with the configured sender', async () => {
    const log = logger();
    const doFetch = accepted();

    const sent = await sendOtpEmail({
      config,
      to: 'someone@example.com',
      otp: '123456',
      purpose: 'email-verification',
      expiresInSec: 600,
      log,
      fetchImpl: doFetch,
    });

    expect(sent).toBe(true);

    const [url, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer test-key');

    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };

    expect(body.from).toBe(config.from);
    expect(body.to).toEqual(['someone@example.com']);
    // The code has to survive into both bodies, since a client that refuses
    // HTML would otherwise get a message with no code in it.
    expect(body.html).toContain('123456');
    expect(body.text).toContain('123456');
  });

  it('states the real expiry rather than a fixed number', async () => {
    const doFetch = accepted();

    await sendOtpEmail({
      config,
      to: 'someone@example.com',
      otp: '123456',
      purpose: 'email-verification',
      expiresInSec: 600,
      log: logger(),
      fetchImpl: doFetch,
    });

    const init = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as { text: string };

    expect(body.text).toContain('10 minutes');
  });

  it('says what the code is for, so a reset does not read as a signup', async () => {
    const doFetch = accepted();

    await sendOtpEmail({
      config,
      to: 'someone@example.com',
      otp: '123456',
      purpose: 'forget-password',
      expiresInSec: 600,
      log: logger(),
      fetchImpl: doFetch,
    });

    const init = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string) as { subject: string };

    expect(body.subject).toBe('Reset your password');
  });

  /**
   * The account already exists by the time this runs. Throwing would fail a
   * sign-up that actually succeeded, leaving someone unable to retry with the
   * same address — much worse than a code they can ask for again.
   */
  it('reports a provider rejection without throwing', async () => {
    const log = logger();
    const doFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'domain is not verified' }), { status: 403 }),
    ) as never;

    const sent = await sendOtpEmail({
      config,
      to: 'someone@example.com',
      otp: '123456',
      purpose: 'email-verification',
      expiresInSec: 600,
      log,
      fetchImpl: doFetch,
    });

    expect(sent).toBe(false);
    // The provider's reason is the only clue to a misconfigured sending domain,
    // whose symptom is otherwise just "no email arrived".
    expect(log.error).toHaveBeenCalled();
    expect(JSON.stringify(log.error.mock.calls[0])).toContain('domain is not verified');
  });

  it('survives the provider being unreachable', async () => {
    const log = logger();
    const doFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    await expect(
      sendOtpEmail({
        config,
        to: 'someone@example.com',
        otp: '123456',
        purpose: 'email-verification',
        expiresInSec: 600,
        log,
        fetchImpl: doFetch,
      }),
    ).resolves.toBe(false);

    expect(log.error).toHaveBeenCalled();
  });

  /**
   * Logs travel further than the database does — into a hosting platform's log
   * viewer, and whatever aggregates it. An address is the one identifier here
   * worth keeping out of them, and the code is a live credential.
   */
  it('keeps the address and the code out of the logs', async () => {
    const log = logger();

    await sendOtpEmail({
      config,
      to: 'private@example.com',
      otp: '123456',
      purpose: 'email-verification',
      expiresInSec: 600,
      log,
      fetchImpl: accepted(),
    });

    const logged = JSON.stringify([log.info.mock.calls, log.error.mock.calls]);
    expect(logged).not.toContain('private@example.com');
    expect(logged).not.toContain('123456');
  });
});
