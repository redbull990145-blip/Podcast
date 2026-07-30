# Local Whisper server for development

Runs `faster-whisper` on Colab's free GPU instead of spending the shared Groq
quota while you iterate on captions. The app tries this server first and
falls back to Groq automatically — on every request, not just once — so
there's nothing to switch back manually when the notebook isn't running.

## One-time setup

1. Open [`whisper-server.ipynb`](./whisper-server.ipynb) in Colab (upload it,
   or open via `File → Upload notebook` from colab.research.google.com).
2. `Runtime → Change runtime type → T4 GPU`.
3. Run all three cells in order. The first two take a minute or so (installs,
   then the model download). The third prints a URL like:

   ```
   Whisper server is live at: https://random-words-1234.trycloudflare.com
   ```

4. Add it to `.env.local`:

   ```
   COLAB_WHISPER_URL=https://random-words-1234.trycloudflare.com
   ```

5. Restart your dev server (`npm run dev`) so it picks up the new env var.

That's it — "Generate captions" now tries Colab first.

## Every time after that

The tunnel URL is different every time the notebook restarts. Re-run cell 3
(cells 1 and 2 don't need re-running unless you restart the Colab *runtime*,
not just the cell), copy the new URL into `.env.local`, and restart `npm run
dev`.

## How the fallback works

`transcribeWithFallback` in
[`lib/ai/transcribe.ts`](../lib/ai/transcribe.ts) is what the API route calls
instead of talking to a provider directly:

1. If `COLAB_WHISPER_URL` isn't set, it skips straight to Groq (or your own
   BYOK key) — this entire feature is inert for anyone who hasn't opted in,
   including production.
2. Otherwise it sends a `GET /health` to the notebook with a 4-second
   timeout. A notebook that isn't running fails this in a couple of seconds,
   not after a slow timeout trying to upload fifty megabytes to nowhere.
3. If health passes, it sends the real transcription request. If Colab
   fails partway through (OOM, a bad response, disconnect mid-upload), it
   retries the *same* request against Groq rather than surfacing an error —
   the point is that you never have to notice which one actually answered.

The notebook's `/audio/transcriptions` endpoint deliberately mimics the same
OpenAI-compatible wire format the app already speaks to Groq (multipart
upload, `verbose_json`-shaped response with segments and word-level
timestamps), so no other code needed to change — Colab is just another
`SttConfig` with a different `baseUrl`.

## Why this is dev-only

- The tunnel URL is ephemeral and manual (you paste a new one in every
  session) — there's no path from this to a deployed instance.
- Free Colab disconnects after ~90 minutes idle or a 12-hour hard cap, at
  which point the fallback to Groq just starts happening silently.
- `COLAB_WHISPER_URL` is a plain env var, not something stored per-user or
  exposed anywhere in the UI — it only ever affects whoever set it locally.

## Adjusting the model

Edit `MODEL_SIZE` in cell 2 of the notebook. `large-v3` is the closest match
to Groq's `whisper-large-v3-turbo` and comfortably fits a free-tier T4;
`medium` or `small` transcribe faster at some accuracy cost if you're
iterating on something other than transcript quality itself.

## Optional: a shared secret

By default the notebook accepts any request — the tunnel URL's randomness is
the only barrier, which is a reasonable bar for a session that dies in hours
anyway. To add a real check, set `SHARED_SECRET` in cell 2 to some string and
set the same value as `COLAB_SHARED_SECRET` in `.env.local`.
