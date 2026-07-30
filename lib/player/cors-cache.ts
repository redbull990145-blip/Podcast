"use client";

/**
 * Remembers which audio hosts allow cross-origin reads.
 *
 * This exists to keep a dangerous decision synchronous. Routing playback
 * through Web Audio requires the audio to have been fetched with CORS, and an
 * element that has been connected to an AudioContext can never go back — feed
 * it a host that sends no CORS headers and it outputs silence, permanently, for
 * the rest of the page's life.
 *
 * So the choice of element has to be made in the same tick as the click that
 * starts playback (an await there would break the user-gesture chain and get
 * autoplay blocked). Probing the network is not an option at that moment, but
 * consulting a cache is. Unknown hosts simply play plain the first time and are
 * probed in the background, so enhancements switch on from the second play.
 */

const STORAGE_KEY = "cadence-cors-hosts";

type Verdict = boolean;

let memory: Map<string, Verdict> | null = null;

function load(): Map<string, Verdict> {
  if (memory) return memory;
  memory = new Map();
  if (typeof window === "undefined") return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      for (const [host, verdict] of Object.entries(JSON.parse(raw) as Record<string, boolean>)) {
        memory.set(host, verdict);
      }
    }
  } catch {
    // A corrupt cache just means everything is treated as unknown.
  }
  return memory;
}

function save() {
  if (!memory || typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
  } catch {
    // Not worth surfacing; the cache rebuilds itself next session.
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** true / false when known, undefined when this host has never been probed. */
export function corsVerdict(url: string): Verdict | undefined {
  const host = hostOf(url);
  return host ? load().get(host) : undefined;
}

export function rememberCors(url: string, allowed: boolean) {
  const host = hostOf(url);
  if (!host) return;
  load().set(host, allowed);
  save();
}
