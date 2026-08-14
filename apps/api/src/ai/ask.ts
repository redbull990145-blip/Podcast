/**
 * Asking a question about one episode.
 *
 * The whole value is in the word *grounded*. A model asked "what did they say
 * about X" without the transcript will answer anyway — fluently, plausibly, and
 * from whatever it absorbed about the topic in training. That answer is worse
 * than no feature, because it is indistinguishable from a real one.
 *
 * So the transcript goes in the prompt with **numbered lines**, the model is
 * required to cite the numbers it used, and the client turns those citations
 * into timestamps you can tap. A claim that cannot point at a line it came from
 * is visibly unsupported, which is the only honest way to ship this.
 */

import { transcripts, type StoredSegment } from '@cue/db';
import type { AskCitation } from '@cue/types';
import { formatTimestamp } from '@cue/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.ts';
import type { ChatMessage } from './groq.ts';

/** Same budget as the generations: room for the transcript and the answer. */
const MAX_TRANSCRIPT_CHARS = 300_000;

export async function loadSegments(
  app: FastifyInstance,
  episodeId: string,
): Promise<StoredSegment[]> {
  const [row] = await app.db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, episodeId))
    .limit(1);

  if (!row || row.status !== 'ready' || row.segments.length === 0) {
    throw new AppError(
      'bad_request',
      'There is nothing to ask about yet — this episode has no transcript.',
    );
  }

  return row.segments;
}

/**
 * Number every line so the model has something to point at.
 *
 * The timestamp is included as well as the index because it costs almost
 * nothing and lets the model reason about ordering and duration — "early on"
 * and "towards the end" are questions people actually ask.
 */
function numbered(segments: StoredSegment[]): string {
  const lines = segments.map(
    (segment) => `[${segment.index}] (${formatTimestamp(segment.startMs / 1000)}) ${segment.text}`,
  );

  const joined = lines.join('\n');

  return joined.length > MAX_TRANSCRIPT_CHARS
    ? `${joined.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated]`
    : joined;
}

export function buildAskMessages(
  segments: StoredSegment[],
  question: string,
  language: string,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You answer questions about one podcast episode, using only its transcript.',
        'Rules:',
        '- Use ONLY what the transcript says. You have no other knowledge of this episode.',
        '- If the transcript does not answer the question, say so plainly. Do not guess.',
        '- Cite the line numbers you used, in square brackets, like [42] or [17][18].',
        '- Put each citation directly after the claim it supports.',
        '- Be concise. Two or three sentences unless more is genuinely needed.',
        `- Answer in ${language}.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Transcript, one numbered line per entry:\n\n${numbered(segments)}\n\n---\n\nQuestion: ${question}`,
    },
  ];
}

/**
 * Resolve `[n]` markers in an answer back to transcript lines.
 *
 * Run over the finished answer rather than the stream, because a citation can
 * be split across two tokens — `[4` and `2]` arrive separately often enough
 * that parsing mid-stream would drop roughly the citations it was written for.
 *
 * Indices the model invented are dropped rather than clamped. A citation that
 * points at the wrong line is worse than a missing one: it looks like evidence.
 */
export function citationsFrom(answer: string, segments: StoredSegment[]): AskCitation[] {
  const byIndex = new Map(segments.map((segment) => [segment.index, segment]));
  const found: AskCitation[] = [];
  const seen = new Set<number>();

  for (const match of answer.matchAll(/\[(\d{1,6})\]/g)) {
    const index = Number(match[1]);
    if (seen.has(index)) continue;

    const segment = byIndex.get(index);
    if (!segment) continue;

    seen.add(index);
    found.push({
      segmentIndex: segment.index,
      startMs: segment.startMs,
      text: segment.text,
    });
  }

  return found.sort((a, b) => a.startMs - b.startMs);
}
