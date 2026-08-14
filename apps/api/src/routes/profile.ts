/**
 * The user's own settings, as opposed to this device's.
 *
 * Playback speed lives in local storage because headphones on a train and a
 * kitchen speaker genuinely want different values. Language does not: someone
 * who reads the app in Hindi reads it in Hindi everywhere, and having to set it
 * again on each device is the kind of small friction that makes a translated
 * app feel like an afterthought.
 *
 * So the choice is stored twice on purpose — a cookie so the *server* can pick
 * the right language before the first byte of HTML, and this row so a new
 * device inherits it on sign-in.
 */

import { profiles } from '@cue/db';
import { languageTag } from '@cue/validation';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/plugin.ts';
import { ok } from '../errors.ts';

const profilePatch = z.object({ locale: languageTag });

export function profileRoutes(app: FastifyInstance): void {
  app.get('/me/profile', async (request) => {
    const user = requireUser(request);

    const [profile] = await app.db
      .select({ locale: profiles.locale, displayName: profiles.displayName })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);

    // A row is created on first write rather than at sign-up, so its absence is
    // normal and means "nothing customised yet" — not an error.
    return ok({ profile: { locale: profile?.locale ?? null, displayName: profile?.displayName ?? null } });
  });

  app.patch('/me/profile', async (request) => {
    const user = requireUser(request);
    const { locale } = profilePatch.parse(request.body);

    const values = { userId: user.id, locale, updatedAt: new Date() };

    await app.db
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({ target: profiles.userId, set: { locale, updatedAt: values.updatedAt } });

    return ok({ profile: { locale } });
  });
}
