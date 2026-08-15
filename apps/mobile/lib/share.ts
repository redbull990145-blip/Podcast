import { episodeShareUrl } from '@cue/core';
import { Share } from 'react-native';

/**
 * Where the web app lives, for building a link someone else can open.
 *
 * A share always points at the web, never at `cue://` — a scheme URL does
 * nothing for everybody who has not installed this app, which is everybody the
 * sender is sharing with. Falling back to the API's own origin is a guess, but
 * a link to a real host beats a link to nowhere, and in a deployment where the
 * two differ this is one environment variable away from correct.
 */
const webUrl =
  process.env['EXPO_PUBLIC_WEB_URL'] ??
  process.env['EXPO_PUBLIC_API_URL'] ??
  'http://localhost:3000';

/**
 * Hand an episode to the OS share sheet, at a moment.
 *
 * `Share` from React Native rather than `expo-sharing`: the built-in module
 * does exactly this — text and a URL into the system sheet — and it is already
 * in the bundle. `expo-sharing` exists for sharing *files*, which this is not.
 *
 * A dismissed sheet is not a failure and is not reported as one. Android
 * resolves the promise either way, and treating "changed their mind" as an
 * error is how an app ends up apologising for something the user did on purpose.
 */
export async function shareEpisode(options: {
  episodeId: string;
  title: string;
  positionSec?: number | null;
  durationSec?: number | null;
}): Promise<void> {
  const url = episodeShareUrl({
    origin: webUrl,
    episodeId: options.episodeId,
    positionSec: options.positionSec ?? null,
    durationSec: options.durationSec ?? null,
  });

  try {
    await Share.share({
      // Both, because Android's sheet hands `message` to messaging apps and
      // `url` to link handlers, and different targets read different fields.
      message: `${options.title}\n${url}`,
      url,
      title: options.title,
    });
  } catch {
    // The sheet could not open at all. Nothing useful to say about it — the
    // episode is still on screen and the button can be pressed again.
  }
}
