/**
 * Summaries, takeaways and chapters, generated once and shared by everyone.
 *
 * The cache is per **episode**, not per user: what an episode is about is a
 * fact about the episode. The first person to open it pays a model call; the
 * thousandth pays nothing. That is also what makes a 20-a-day quota generous
 * rather than stingy — most requests never reach a model at all.
 *
 * Summary and takeaways are produced by a *single* call and written as two
 * rows. They are always rendered together, they read the same transcript, and
 * asking twice would double the cost and let the two disagree with each other.
 */

import { episodeAi, transcripts, type StoredSegment } from '@cue/db';
import type { Chapter } from '@cue/types';
import { formatTimestamp } from '@cue/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { resolve } from './access.ts';
import { CHAT_MODEL, chat } from './groq.ts';

/**
 * Ceiling on how much transcript goes into a prompt.
 *
 * 131k tokens of context is roughly 500k characters, and the answer needs room
 * too. 300k characters is about six hours of speech — past any real episode —
 * and truncating there is far better than a request that fails outright on the
 * one show that runs long.
 */
const MAX_TRANSCRIPT_CHARS = 300_000;

/** Beyond this many chapters the list stops being navigation and becomes a transcript. */
const MAX_CHAPTERS = 12;

export type AiBundle = {
  summary: string | null;
  takeaways: string[] | null;
  chapters: Chapter[] | null;
};

/** What the model is asked to return, and what it actually returns are different things. */
const briefSchema = z.object({
  summary: z.string().min(1),
  takeaways: z.array(z.string().min(1)).min(1),
});

const chaptersSchema = z.object({
  chapters: z
    .array(
      z.object({
        // Accepts either, because models produce both no matter which you ask
        // for. Rejecting the wrong one would fail a generation that is correct
        // in every way that matters.
        startMs: z.coerce.number().min(0).optional(),
        startSec: z.coerce.number().min(0).optional(),
        title: z.string().min(1),
      }),
    )
    .min(1),
});

function transcriptText(segments: StoredSegment[], withTimestamps: boolean): string {
  const lines = segments.map((segment) =>
    withTimestamps
      ? `[${formatTimestamp(segment.startMs / 1000)}] ${segment.text}`
      : segment.text,
  );

  const joined = lines.join('\n');

  return joined.length > MAX_TRANSCRIPT_CHARS
    ? `${joined.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated]`
    : joined;
}

/**
 * Parse a model's JSON, tolerating the wrapping it sometimes adds.
 *
 * `response_format: json_object` makes this rare rather than impossible —
 * fenced code blocks and a leading sentence both still happen, and losing a
 * good generation to a stray backtick would be a waste of someone's quota.
 */
function parseJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: the outermost braces. A model that prefixed prose to
    // otherwise valid JSON is still telling us the answer.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new AppError('upstream_unavailable', 'The model returned something unreadable');
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new AppError('upstream_unavailable', 'The model returned something unreadable');
    }
  }
}

async function loadTranscript(app: FastifyInstance, episodeId: string) {
  const [row] = await app.db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, episodeId))
    .limit(1);

  if (!row || row.status !== 'ready' || row.segments.length === 0) {
    throw new AppError(
      'bad_request',
      'This episode has no transcript yet. Generate one first and the rest follows from it.',
    );
  }

  return row;
}

/** Read whatever is already cached, spending nothing. */
export async function cached(
  app: FastifyInstance,
  episodeId: string,
  language: string,
): Promise<AiBundle> {
  const rows = await app.db
    .select()
    .from(episodeAi)
    .where(
      and(
        eq(episodeAi.episodeId, episodeId),
        eq(episodeAi.language, language),
        inArray(episodeAi.kind, ['summary', 'takeaways', 'chapters']),
      ),
    );

  const find = (kind: string) => rows.find((row) => row.kind === kind)?.content;

  return {
    summary: (find('summary') as string | undefined) ?? null,
    takeaways: (find('takeaways') as string[] | undefined) ?? null,
    chapters: (find('chapters') as Chapter[] | undefined) ?? null,
  };
}

async function store(
  app: FastifyInstance,
  episodeId: string,
  language: string,
  entries: { kind: string; content: unknown }[],
): Promise<void> {
  for (const entry of entries) {
    const values = {
      episodeId,
      kind: entry.kind,
      language,
      content: entry.content,
      model: CHAT_MODEL,
      createdAt: new Date(),
    };

    await app.db
      .insert(episodeAi)
      .values(values)
      .onConflictDoUpdate({
        target: [episodeAi.episodeId, episodeAi.kind, episodeAi.language],
        set: values,
      });
  }
}

/**
 * The summary and its takeaways.
 *
 * The prompt's job is almost entirely to prevent the two failure modes that
 * make AI summaries worthless: describing the *show* instead of the episode,
 * and padding with generic observations that would be true of any conversation
 * about the topic.
 */
export async function generateBrief(
  app: FastifyInstance,
  episodeId: string,
  language: string,
  userId: string,
): Promise<AiBundle> {
  const transcript = await loadTranscript(app, episodeId);
  const funding = await resolve(app, userId);

  try {
    const raw = await chat({
      key: funding.key,
      byok: funding.byok,
      json: true,
      maxTokens: 1200,
      messages: [
        {
          role: 'system',
          content: [
            'You summarise a single podcast episode from its transcript.',
            'Rules:',
            '- Describe what THIS episode covered, never what the show is generally about.',
            '- Every claim must be supported by the transcript. Do not add outside knowledge.',
            '- Name the specific things discussed: people, products, numbers, arguments.',
            '- No filler like "the hosts discuss various topics" or "an interesting conversation".',
            `- Write in ${language}.`,
            'Return JSON: {"summary": "2-4 sentences", "takeaways": ["4-6 specific points"]}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Transcript:\n\n${transcriptText(transcript.segments, false)}`,
        },
      ],
    });

    const parsed = briefSchema.safeParse(parseJson(raw));

    if (!parsed.success) {
      throw new AppError('upstream_unavailable', 'The model returned an unexpected shape');
    }

    const summary = parsed.data.summary.trim();
    const takeaways = parsed.data.takeaways.map((item) => item.trim()).filter(Boolean);

    await store(app, episodeId, language, [
      { kind: 'summary', content: summary },
      { kind: 'takeaways', content: takeaways },
    ]);

    await funding.settle('ok');

    return { summary, takeaways, chapters: null };
  } catch (error) {
    await funding.settle('failed');
    throw error;
  }
}

/**
 * Chapters.
 *
 * Only possible on a **timed** transcript, which in practice means one we
 * generated — publishers' HTML transcripts carry no timecodes at all, and a
 * chapter list whose timestamps were invented would send every tap to the wrong
 * place. That is checked here rather than left to the model to fail at.
 */
export async function generateChapters(
  app: FastifyInstance,
  episodeId: string,
  language: string,
  userId: string,
): Promise<AiBundle> {
  const transcript = await loadTranscript(app, episodeId);

  const timed = transcript.segments.some((segment) => segment.endMs > 0);
  if (!timed) {
    throw new AppError(
      'bad_request',
      'Chapters need a transcript with timings. This one is the publisher’s prose, which has none — generate a transcript to get chapters.',
    );
  }

  const lastMs = transcript.segments.reduce(
    (max, segment) => Math.max(max, segment.endMs || segment.startMs),
    0,
  );

  const funding = await resolve(app, userId);

  try {
    const raw = await chat({
      key: funding.key,
      byok: funding.byok,
      json: true,
      maxTokens: 1500,
      messages: [
        {
          role: 'system',
          content: [
            'You divide a podcast episode into chapters using its timestamped transcript.',
            'Rules:',
            `- Between 3 and ${MAX_CHAPTERS} chapters. Fewer is better than padding.`,
            '- Every startMs must be the timestamp of a real transition in the transcript.',
            '- The first chapter starts at 0.',
            '- Titles name the actual subject in 2-6 words. Not "Introduction" or "Main discussion".',
            `- Write titles in ${language}.`,
            'Return JSON: {"chapters": [{"startMs": 0, "title": "..."}]}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Transcript with timestamps:\n\n${transcriptText(transcript.segments, true)}`,
        },
      ],
    });

    const parsed = chaptersSchema.safeParse(parseJson(raw));

    if (!parsed.success) {
      throw new AppError('upstream_unavailable', 'The model returned an unexpected shape');
    }

    const chapters = normaliseChapters(parsed.data.chapters, lastMs);

    if (chapters.length === 0) {
      throw new AppError('upstream_unavailable', 'The model produced no usable chapters');
    }

    await store(app, episodeId, language, [{ kind: 'chapters', content: chapters }]);
    await funding.settle('ok');

    return { summary: null, takeaways: null, chapters };
  } catch (error) {
    await funding.settle('failed');
    throw error;
  }
}

/**
 * Make a model's chapter list safe to render.
 *
 * Everything here is a failure seen in practice: timestamps past the end of the
 * episode, two chapters at the same moment, an unsorted list, and a first
 * chapter that starts three minutes in and leaves the opening unreachable. A
 * chapter list is navigation — a wrong entry sends the listener somewhere they
 * did not ask to go, which is worse than having no chapters.
 */
export function normaliseChapters(
  raw: { startMs?: number | undefined; startSec?: number | undefined; title: string }[],
  lastMs: number,
): Chapter[] {
  const seen = new Set<number>();

  const cleaned = raw
    .map((entry) => ({
      startMs: Math.round(entry.startMs ?? (entry.startSec ?? 0) * 1000),
      title: entry.title.trim(),
    }))
    .filter((entry) => entry.title !== '' && entry.startMs <= lastMs)
    .sort((a, b) => a.startMs - b.startMs)
    .filter((entry) => {
      if (seen.has(entry.startMs)) return false;
      seen.add(entry.startMs);
      return true;
    })
    .slice(0, MAX_CHAPTERS);

  if (cleaned.length === 0) return [];

  // The opening must be reachable. A list that begins at 3:40 makes the first
  // few minutes unaddressable by the only navigation on offer.
  cleaned[0]!.startMs = 0;

  return cleaned.map((entry, index) => ({
    startMs: entry.startMs,
    endMs: cleaned[index + 1]?.startMs ?? lastMs,
    title: entry.title,
    imageUrl: null,
    url: null,
  }));
}
