/**
 * The AI endpoints.
 *
 * Every one of them requires a signed-in user, which is not a gate for its own
 * sake: these are the only routes in the API that spend money, and the quota
 * that governs them has to be attributable to somebody. An anonymous caller
 * cannot be metered, so an anonymous caller cannot spend the operator's key.
 *
 * The split between GET and POST is the important part of the shape. `GET
 * /episodes/:id/ai` reads the shared cache and costs nothing; the POSTs are the
 * only routes that can reach a model. A client can therefore render the whole
 * panel — including "no summary yet" — without ever risking someone's
 * allowance on a page load.
 */

import { episodes, transcripts, userApiKeys } from '@cue/db';
import { aiLanguageQuery, apiKeyInput, askInput, uuidParam } from '@cue/validation';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { requireUser } from '../auth/plugin.ts';
import { AppError, badRequest, notFound, ok } from '../errors.ts';
import { quotaFor, resolve } from '../ai/access.ts';
import { buildAskMessages, citationsFrom, loadSegments } from '../ai/ask.ts';
import { encryptSecret, keyHint } from '../ai/crypto.ts';
import { cached, generateBrief, generateChapters } from '../ai/generate.ts';
import { chatStream } from '../ai/groq.ts';
import { isTranscribing, startTranscription } from '../ai/transcribe.ts';
import { rateLimit } from '../rate-limit.ts';

const DEFAULT_LANGUAGE = 'en';

export function aiRoutes(app: FastifyInstance): void {
  /**
   * Everything the AI panel needs to render, spending nothing.
   *
   * Bundles the cached generations, the transcript's state and the caller's
   * quota into one response because the panel cannot draw a single control
   * correctly without all three — whether to offer "Summarise" depends on
   * whether a transcript exists, and whether to warn about the allowance
   * depends on how much of it is left.
   */
  app.get('/episodes/:id/ai', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);
    const { language = DEFAULT_LANGUAGE } = aiLanguageQuery.parse(request.query);

    const [episode] = await app.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, id))
      .limit(1);

    if (!episode) throw notFound('Episode');

    const [row] = await app.db
      .select()
      .from(transcripts)
      .where(eq(transcripts.episodeId, id))
      .limit(1);

    const [bundle, quota] = await Promise.all([cached(app, id, language), quotaFor(app, user.id)]);

    return ok({
      ...bundle,
      transcript: {
        present: Boolean(row && row.status === 'ready' && row.segments.length > 0),
        source: row?.source ?? null,
        // `processing` is reported from the in-process set as well as the row,
        // so a job that started a moment ago is visible before its write lands.
        status: isTranscribing(id) ? 'processing' : (row?.status ?? null),
        timed: Boolean(row?.segments.some((segment) => segment.endMs > 0)),
      },
      quota,
    });
  });

  /**
   * Generate a transcript for an episode the publisher never transcribed.
   *
   * Answers as soon as the work is under way rather than when it is done — an
   * hour of audio is several large uploads, and holding the request open for
   * that would time out at every proxy in between. Clients poll the transcript
   * endpoint they already use.
   */
  app.post(
    '/episodes/:id/transcribe',
    { preHandler: rateLimit(app, 'expensive') },
    async (request) => {
      const user = requireUser(request);
      const { id } = uuidParam.parse(request.params);

      const { started, detail } = await startTranscription(app, id, user.id);

      return ok({ started, detail, quota: await quotaFor(app, user.id) });
    },
  );

  app.post(
    '/episodes/:id/ai/brief',
    { preHandler: rateLimit(app, 'expensive') },
    async (request) => {
      const user = requireUser(request);
      const { id } = uuidParam.parse(request.params);
      const { language = DEFAULT_LANGUAGE } = aiLanguageQuery.parse(request.query);

      // Cached already: return it rather than charging for the same answer
      // twice. The shared cache is what makes the quota workable.
      const existing = await cached(app, id, language);
      if (existing.summary && existing.takeaways) {
        return ok({ ...existing, quota: await quotaFor(app, user.id) });
      }

      const generated = await generateBrief(app, id, language, user.id);

      return ok({
        ...generated,
        chapters: existing.chapters,
        quota: await quotaFor(app, user.id),
      });
    },
  );

  app.post(
    '/episodes/:id/ai/chapters',
    { preHandler: rateLimit(app, 'expensive') },
    async (request) => {
      const user = requireUser(request);
      const { id } = uuidParam.parse(request.params);
      const { language = DEFAULT_LANGUAGE } = aiLanguageQuery.parse(request.query);

      const existing = await cached(app, id, language);
      if (existing.chapters) {
        return ok({ ...existing, quota: await quotaFor(app, user.id) });
      }

      const generated = await generateChapters(app, id, language, user.id);

      return ok({
        summary: existing.summary,
        takeaways: existing.takeaways,
        chapters: generated.chapters,
        quota: await quotaFor(app, user.id),
      });
    },
  );

  /**
   * Ask about this episode, streamed.
   *
   * Server-sent events rather than a websocket: this is one-directional, short
   * lived, and survives every proxy that would break a socket upgrade. The
   * answer takes several seconds to write and about three hundred milliseconds
   * to *start*, and streaming is the difference between those being what the
   * reader waits for.
   *
   * Citations are sent as a final event rather than parsed from the stream by
   * the client — a `[42]` marker is routinely split across two tokens, so
   * anything parsing mid-stream would miss roughly the citations it exists for.
   */
  app.post(
    '/episodes/:id/ask',
    { preHandler: rateLimit(app, 'expensive') },
    async (request, reply) => {
      const user = requireUser(request);
      const { id } = uuidParam.parse(request.params);
      const { question, language = DEFAULT_LANGUAGE } = askInput.parse(request.body);

      // Both of these can fail, and both must fail *before* any bytes are
      // written — once the stream opens there is no status code left to send.
      const segments = await loadSegments(app, id);
      const funding = await resolve(app, user.id);

      /**
       * Streamed through Fastify's reply rather than written to `reply.raw`.
       *
       * Writing to the raw socket skips every `onSend` hook — which is where
       * `@fastify/cors` adds `Access-Control-Allow-Origin`. The result was a
       * response that curl read perfectly and a browser refused outright, since
       * a cross-origin fetch without that header is blocked before the caller
       * ever sees it. Handing Fastify a stream keeps the whole hook chain
       * intact and still sends bytes as they are produced.
       */
      const stream = new Readable({ read() {} });

      void reply
        .header('content-type', 'text/event-stream; charset=utf-8')
        .header('cache-control', 'no-cache, no-transform')
        // Nginx and several platform proxies buffer responses by default,
        // which would hold the whole answer until it finished and turn a
        // streaming endpoint into a slow non-streaming one.
        .header('x-accel-buffering', 'no');

      const send = (event: string, data: unknown) => {
        stream.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      /**
       * Stop generating when the reader leaves.
       *
       * Without this, closing the tab leaves the model writing an answer nobody
       * will read, billed to whoever asked for it.
       */
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());

      /**
       * Generation runs alongside the response rather than before it.
       *
       * The reply is returned immediately so Fastify starts piping; tokens are
       * pushed into the stream as they arrive. Awaiting the whole answer first
       * would produce a correct response with none of the point of one.
       */
      void (async () => {
        let answer = '';

        try {
          for await (const token of chatStream({
            key: funding.key,
            byok: funding.byok,
            messages: buildAskMessages(segments, question, language),
            signal: controller.signal,
          })) {
            answer += token;
            send('token', { token });
          }

          send('citations', { citations: citationsFrom(answer, segments) });
          send('done', {});
          await funding.settle('ok');
        } catch (error) {
          await funding.settle('failed');

          // The headers are long gone, so a failure cannot become a status
          // code. It becomes an event the client renders in place of the
          // answer — a stream that simply stopped would look like a complete
          // but truncated reply.
          if (!controller.signal.aborted) {
            request.log.warn({ err: error, episodeId: id }, 'ask failed');
            send('error', {
              message:
                error instanceof AppError ? error.message : 'The answer stopped unexpectedly',
            });
          }
        } finally {
          stream.push(null);
        }
      })();

      return reply.send(stream);
    },
  );

  // ------------------------------------------------------------- byok --

  /** The caller's allowance, and which key is funding it. Never the key itself. */
  app.get('/me/ai', async (request) => {
    const user = requireUser(request);
    return ok({ quota: await quotaFor(app, user.id) });
  });

  /**
   * Save a personal key.
   *
   * Verified against the provider before it is stored. A key that is saved and
   * silently broken turns every later feature into an unexplained failure, and
   * the user has no way to tell a bad key from a bad server — so it is checked
   * once, here, where the answer can be attached to the field they just typed.
   */
  app.put('/me/ai/key', { preHandler: rateLimit(app, 'expensive') }, async (request) => {
    const user = requireUser(request);
    const { key } = apiKeyInput.parse(request.body);

    const secret = app.config.ai.encryptionSecret;
    if (!secret) {
      throw badRequest(
        'This server cannot store API keys — it has no encryption secret configured.',
      );
    }

    const probe = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!probe) {
      throw new AppError('upstream_unavailable', 'Could not reach Groq to check that key');
    }

    if (probe.status === 401 || probe.status === 403) {
      throw badRequest('Groq rejected that key', { key: 'This key is not valid' });
    }

    if (!probe.ok) {
      throw new AppError('upstream_unavailable', `Groq returned ${probe.status} checking that key`);
    }

    const values = {
      userId: user.id,
      provider: 'groq',
      secret: encryptSecret(key, secret),
      hint: keyHint(key),
      createdAt: new Date(),
      lastUsedAt: null,
    };

    await app.db
      .insert(userApiKeys)
      .values(values)
      .onConflictDoUpdate({
        target: [userApiKeys.userId, userApiKeys.provider],
        set: values,
      });

    return ok({ quota: await quotaFor(app, user.id) });
  });

  /** Forget it. The row is deleted, not blanked — there is nothing worth keeping. */
  app.delete('/me/ai/key', async (request) => {
    const user = requireUser(request);

    await app.db
      .delete(userApiKeys)
      .where(and(eq(userApiKeys.userId, user.id), eq(userApiKeys.provider, 'groq')));

    return ok({ quota: await quotaFor(app, user.id) });
  });
}
