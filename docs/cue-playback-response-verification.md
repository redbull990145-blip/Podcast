# Playback responsiveness and interaction fixes

Verified locally on October 15, 2026. No commit or deployment was made.

## Changes

- Play uses the position already present in Home/history or a loaded episode-list batch. Unknown positions warm on hover/focus; a cold per-episode lookup has a 200 ms deadline. Session-only cache entries are bounded, cleared on account changes, and protected from late responses. Newer local seeks/restarts take precedence over older visible cards. An unknown position falls back to cached progress or the beginning if the lookup fails or exceeds the deadline; publisher loading time remains separate.
- The Home banner's pop, ring and glyph motion run only when that button is activated. Bottom transport and media state changes update its label/glyph without triggering click feedback.
- Native icon controls share press and spring-release feedback. Seek and volume show a grab handle; scrubbing follows synchronous pointer state, handles cancellation/lost capture, and supports keyboard navigation. Sheet drags stop an interrupted spring, discard stale fling velocity and return on cancellation.
- Shared JS motion preferences now update when reduced motion changes while the page is open. The installed Motion hook only captured that preference at mount.

## Controlled browser evidence

Chromium used the actual web player store, HTMLAudioElement engine, Home banner, episode Play buttons, listening-state provider, transport, sliders and sheet-drag hook. Fixture-only Next navigation/image shims were used. Audio was a local 120-second WAV; API replies were synthetic. This is component/browser evidence, not signed-in production, publisher-CDN, Cloudflare or Render verification.

The comparison loaded the original HEAD player store directly into the same fixture, without changing the tracked checkout. Both cold cases delayed the saved-progress response by three seconds.

| Measurement | Result |
| --- | --- |
| Original cold click to audio `playing` | 3128.9 ms |
| Updated cold click to audio `playing` | 316.8 ms |
| Updated warmed click to audio `playing` | 33.2 ms |
| Existing batch progress click to audio `playing` | 32.9 ms |
| Batch resume point | 40 s, from 45 s with existing 5 s rewind |
| Banner animations after bottom control activation | 0 |
| Seek drag target / result | 90 s / 90 s |
| Volume drag target / result | 80% / 80% |
| Sheet open / cancel endpoint | 1 / 1 |
| New local restart against older history | 0 s preserved |
| Live reduced-motion change | Passed |
| Browser page errors | 0 |

Desktop and 390-pixel mobile screenshots were inspected. Raw browser reports and the reproducible harness are in ignored `node_modules/.cache/playback-fix/`.

## Validation

- Web tests: 80 passed, including startup deadlines, warm deduplication, offline/cache fallback, late replies, account transitions and stale history/restart handling.
- Web ESLint and TypeScript: passed.
- Next production build and 140 KB shell bundle gate: passed (127.0 KB gzip).
- Git whitespace check: passed.

The existing Next middleware-to-proxy deprecation warning remains. No real publisher-CDN start-time guarantee is implied by these loopback measurements.
