/**
 * Input for the AI endpoints.
 *
 * The bounds here are product decisions, not paranoia. A question is a
 * question — anything past a few hundred characters is a pasted document, which
 * costs the asker's quota and produces a worse answer than the shorter question
 * hiding inside it.
 */

import { z } from 'zod';
import { languageTag } from './common.ts';

export const QUESTION_MAX = 500;

export const askInput = z.object({
  question: z
    .string()
    .trim()
    .min(3, 'Ask a longer question')
    .max(QUESTION_MAX, `Keep it under ${QUESTION_MAX} characters`),
  /** Answer in this language; falls back to the transcript's on the server. */
  language: languageTag.optional(),
});

export type AskInput = z.infer<typeof askInput>;

/**
 * A provider key, checked for shape only.
 *
 * Deliberately not validated against a `gsk_` prefix: the real test is whether
 * the provider accepts it, and a format rule here would reject a key from a
 * future key format and be indistinguishable, to the user, from the key being
 * wrong.
 */
export const apiKeyInput = z.object({
  key: z
    .string()
    .trim()
    .min(20, 'That looks too short to be an API key')
    .max(400, 'That looks too long to be an API key'),
});

export type ApiKeyInput = z.infer<typeof apiKeyInput>;

export const aiLanguageQuery = z.object({
  language: languageTag.optional(),
});
