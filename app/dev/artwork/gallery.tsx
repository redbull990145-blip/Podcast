"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatedArtwork } from "@/components/artwork/animated-artwork";
import { PROFILES } from "@/lib/artwork/profiles/registry";
import type { Intensity, ProfileId } from "@/lib/artwork/types";

/**
 * The artwork engine, on a page of real covers.
 *
 * This exists because the effect is designed to be almost impossible to notice,
 * which makes it correspondingly hard to develop: "nothing appears to be
 * happening" is both the success condition and every failure mode. Judging it
 * one cover at a time inside the player is also the wrong test — the engine's
 * real claim is that *different artwork gets different treatment*, and that is
 * only visible with a dozen covers side by side.
 *
 * Outside the `(app)` route group and therefore outside the auth middleware's
 * protected prefixes, so it works without a session — which matters, because
 * being unable to sign in should not mean being unable to look at the renderer.
 * It brings its own QueryClient for the same reason.
 *
 * Add `?artwork-debug` for the per-cover readout of what was chosen and why.
 */

/** Real covers, spanning the cases the profile selector is meant to tell apart. */
const COVERS: Array<{ title: string; src: string; note: string }> = [
  {
    title: "Elevation with Steven Furtick",
    src: "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/cbb40a38-726f-4243-a86e-b0ed01477640/ff9164b2-aa64-410d-9ee1-b0ed0147765c/image.jpg?t=1763653590&size=Large",
    note: "Portrait + display type — the hardest case",
  },
  {
    title: "The Joe Rogan Experience",
    src: "https://megaphone.imgix.net/podcasts/8e5bcebc-ca16-11ee-89f0-0fa0b9bdfc7c/image/11f568857987283428d892402e623b21.jpg?ixlib=rails-4.3.1&max-w=3000&max-h=3000&fit=crop&auto=format,compress",
    note: "Dark photographic portrait",
  },
  {
    title: "Podnews Daily",
    src: "https://podnews.net/static/podnews-2000x2000.png",
    note: "Flat vector, heavy type",
  },
  {
    title: "The Diary Of A CEO",
    src: "https://assets.flightcast.com/workspaces/edpmsc3wdznn1aa2txug5e3p/podcasts/xmsftuzjjykcmqwolaqn6mdn/cs9v0tiwz4lv6yfo3vt6q6dx.png",
    note: "High-contrast graphic",
  },
  {
    title: "कहानी ज़िंदगी की",
    src: "http://ichef.bbci.co.uk/images/ic/3000x3000/p0l7x7p9.jpg",
    note: "Illustration — and plain http, which the optimizer still handles",
  },
  {
    title: "The Ranveer Show",
    src: "https://image.simplecastcdn.com/images/6c0ffcab-1640-429f-b7a6-62df20b25024/d3838c2f-27d9-4145-a37c-0a4d6f30dc87/3000x3000/trs-final-audio-1.jpg?aid=rss_feed",
    note: "Colourful photographic",
  },
  {
    title: "The Second Look",
    src: "https://substackcdn.com/feed/podcast/2081284/s/433066/8790bb2c8f989437ac1922d5f52dc09b.jpg",
    note: "Muted / low chroma",
  },
  {
    title: "Professor Jiang",
    src: "https://d3t3ozftmdmh3i.cloudfront.net/staging/podcast_uploaded_nologo/46023574/46023574-1781375768820-6b820f7392779.jpg",
    note: "Mixed subject",
  },
];

const INTENSITIES: Intensity[] = ["off", "subtle", "medium", "expressive"];


export function ArtworkGallery() {
  const [client] = useState(() => new QueryClient());
  const [playing, setPlaying] = useState(true);
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [profile, setProfile] = useState<ProfileId | "">("");

  /*
   * How many covers animate at once.
   *
   * Eight simultaneous WebGL loops on one page do not hold 60fps on any
   * ordinary machine, and each renderer's quality monitor correctly notices and
   * shuts itself down — which is the right behaviour in the app and useless in
   * a gallery, because every cover goes still a few seconds after it starts.
   *
   * One at a time is the honest way to judge the motion, since that is also how
   * it ships: exactly one animating cover, in Now Playing. The full grid stays
   * available for comparing profile *selection* across covers, where the
   * animation stopping does not matter.
   */
  const [limit, setLimit] = useState(1);
  const shown = COVERS.slice(0, limit);

  return (
    <QueryClientProvider client={client}>
      <main className="min-h-dvh bg-[#0a0a0f] p-6 text-white">
        <header className="mb-6 flex flex-wrap items-center gap-4">
          <h1 className="text-lg font-semibold">Artwork engine</h1>

          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-neutral-900"
          >
            {playing ? "Pause all" : "Play all"}
          </button>

          <label className="flex items-center gap-2 text-sm">
            Intensity
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value as Intensity)}
              className="rounded bg-white/10 px-2 py-1"
            >
              {INTENSITIES.map((value) => (
                <option key={value} value={value} className="text-neutral-900">
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            Force profile
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as ProfileId | "")}
              className="rounded bg-white/10 px-2 py-1"
            >
              <option value="" className="text-neutral-900">
                automatic
              </option>
              {PROFILES.map((p) => (
                <option key={p.id} value={p.id} className="text-neutral-900">
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            Covers
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rounded bg-white/10 px-2 py-1"
            >
              {[1, 2, 4, COVERS.length].map((n) => (
                <option key={n} value={n} className="text-neutral-900">
                  {n === 1 ? "1 (as it ships)" : n}
                </option>
              ))}
            </select>
          </label>

          <p className="text-xs text-white/50">
            Add <code>?artwork-debug</code> to the URL for the per-cover readout.
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
          {shown.map((cover) => (
            <figure key={cover.src}>
              <AnimatedArtwork
                src={cover.src}
                alt={cover.title}
                playing={playing}
                intensity={intensity}
                profile={profile || undefined}
                sizes="380px"
                className="aspect-square w-full rounded-2xl"
              />
              <figcaption className="mt-2 text-sm">
                {cover.title}
                <span className="block text-xs text-white/45">{cover.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </main>
    </QueryClientProvider>
  );
}
