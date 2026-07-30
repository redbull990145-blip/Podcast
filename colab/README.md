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

## How it works: URL in, poll for result

The app **never uploads audio** to the local server. It POSTs the episode's
URL to `/jobs`, gets a job id back immediately, and polls `/jobs/{id}` until
the notebook reports `done`.

That indirection is what makes it fast. The obvious design — download the
episode here, upload it to Colab — moves every byte twice over the slowest
link involved, and a Cloudflare quick tunnel abandons any request unanswered
after **about 100 seconds**, so a long episode had to go up in dozens of
small pieces. That was slow *and* it hammered the podcast host with a range
request per piece until one was refused. Colab fetching the file once, itself,
from Google's network beats both legs of that round trip.

Polling keeps every HTTP request short, so the 100-second limit stops
mattering at all.

Speed comes from three things:

- **No audio proxying** — the biggest win by far.
- **Batched inference** (`BatchedInferencePipeline`), roughly 3x faster than
  sequential decoding at identical quality.
- **`medium` rather than `large-v3`**, about twice the speed and ample for
  captions.

A three-hour episode lands in a few minutes rather than a quarter of an hour.

Only one transcription runs on the GPU at a time — a second job queues rather
than risking VRAM exhaustion. `/health` and `/jobs/{id}` stay responsive
throughout, because the work happens on a background thread.

Tunables in `.env.local`: `COLAB_TIMEOUT_MS` (per-request ceiling),
`COLAB_JOB_DEADLINE_MS` (how long to keep polling), `COLAB_POLL_INTERVAL_MS`.
Model and `BATCH_SIZE` live in cell 2 of the notebook.

## Troubleshooting

**"Your local Whisper server didn't respond"** — the app's health check
failed. In order of likelihood:

1. The tunnel URL changed (it does on every restart) and `.env.local` still
   has the old one. Re-copy it and restart `npm run dev`.
2. The notebook's cell 3 stopped, or Colab disconnected the runtime.
3. The runtime is still running an older version of the server code. Restart
   the runtime and re-run all three cells.

You can check the tunnel independently:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://your-tunnel.trycloudflare.com/health
```

`200` means the server is fine and the problem is on the app side (usually a
stale URL in `.env.local`, or not having restarted the dev server).

**Captions blocked by "You've used all 5 free AI generations"** — shouldn't
happen with a local server configured: the daily quota meters operator spend,
and local compute costs the operator nothing, so caption generation bypasses
it entirely. If you see this, `COLAB_WHISPER_URL` isn't reaching the server
process — check it's in `.env.local` and that you restarted `npm run dev`
after adding it. (Show notes and chapters *do* still consume quota, since
those need an operator-funded LLM call whoever produced the transcript.)

## Why this is dev-only

- The tunnel URL is ephemeral and manual (you paste a new one in every
  session) — there's no path from this to a deployed instance.
- Free Colab disconnects after ~90 minutes idle or a 12-hour hard cap, at
  which point the fallback to Groq just starts happening silently.
- `COLAB_WHISPER_URL` is a plain env var, not something stored per-user or
  exposed anywhere in the UI — it only ever affects whoever set it locally.

## Adjusting the model

Edit `MODEL_SIZE` in cell 2 of the notebook. `medium` is the default and the
right choice for most work. `large-v3` is the closest match to Groq's
`whisper-large-v3-turbo` if you're specifically evaluating transcript quality,
at roughly half the speed. `small` is faster still, for when you're iterating
on something other than the transcript itself.

`BATCH_SIZE` (also cell 2) trades VRAM for speed — 8 is comfortable on a
free-tier T4. Drop it to 4 if you hit out-of-memory errors.

## Optional: a shared secret

By default the notebook accepts any request — the tunnel URL's randomness is
the only barrier, which is a reasonable bar for a session that dies in hours
anyway. To add a real check, set `SHARED_SECRET` in cell 2 to some string and
set the same value as `COLAB_SHARED_SECRET` in `.env.local`.
