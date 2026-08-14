/**
 * The one error path.
 *
 * Every failure leaves this API as `{ ok: false, error: { code, message } }`
 * with an HTTP status derived from the code. Clients switch on `code` and
 * never parse prose.
 *
 * The rule that matters: an unexpected exception is logged in full and
 * reported as a generic `internal`. Leaking a Postgres error string to a
 * client tells an attacker the schema and tells a user nothing.
 */

import { apiErrorStatus, type ApiErrorCode } from '@cue/types';
import { formatFieldErrors } from '@cue/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly retryAfterSec: number | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { fields?: Record<string, string>; retryAfterSec?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.fields = options.fields;
    this.retryAfterSec = options.retryAfterSec;
  }
}

export const notFound = (what: string) => new AppError('not_found', `${what} not found`);
export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError('bad_request', message, fields ? { fields } : {});
export const upstreamUnavailable = (message: string, cause?: unknown) =>
  new AppError('upstream_unavailable', message, { cause });

/** Shape a successful body. Kept here so the envelope lives in one file. */
export function ok<T>(data: T) {
  return { ok: true as const, data };
}

/**
 * Fastify types the error handler's argument as `unknown`, which is correct —
 * anything can be thrown. These narrow it without pretending otherwise.
 */
function statusCodeOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Request could not be processed';
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    void reply.status(404).send({
      ok: false,
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    // Validation failures become field-addressed messages a form can render.
    if (error instanceof ZodError) {
      void reply.status(400).send({
        ok: false,
        error: {
          code: 'bad_request',
          message: 'Request validation failed',
          fields: formatFieldErrors(error),
        },
      });
      return;
    }

    if (error instanceof AppError) {
      // Expected failures are logged at warn — they are information about the
      // caller, not about the server being broken.
      request.log.warn({ code: error.code, err: error }, 'request failed');

      if (error.retryAfterSec !== undefined) {
        void reply.header('Retry-After', String(error.retryAfterSec));
      }

      void reply.status(apiErrorStatus[error.code]).send({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          ...(error.retryAfterSec !== undefined ? { retryAfterSec: error.retryAfterSec } : {}),
        },
      });
      return;
    }

    // Fastify's own errors (malformed JSON, payload too large) carry a status
    // and a message that is safe to repeat back to the caller.
    const status = statusCodeOf(error);
    if (status !== null && status < 500) {
      void reply.status(status).send({
        ok: false,
        error: { code: 'bad_request', message: messageOf(error) },
      });
      return;
    }

    // Anything reaching here is a bug. Log everything, say nothing.
    request.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send({
      ok: false,
      error: { code: 'internal', message: 'Something went wrong on our end' },
    });
  });
}
