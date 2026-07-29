"use client";

import { create } from "zustand";
import { isDownloadSupported, offlineDb } from "./downloads";

/**
 * Which episodes are downloaded, as one shared answer.
 *
 * Every episode row renders a download button, and each one used to ask
 * IndexedDB about itself on mount. A 50-episode show therefore opened the
 * database and ran 50 keyed lookups before the page settled — enough to be
 * visible as jank on a phone.
 *
 * One `primaryKeys()` call returns the whole set, which is a few hundred strings
 * at most, and every button reads from it.
 */

type DownloadStatusState = {
  ids: Set<string>;
  loaded: boolean;
  /** Loads the set once per session; safe to call from every button. */
  ensureLoaded: () => void;
  markDownloaded: (episodeId: string) => void;
  markRemoved: (episodeId: string) => void;
};

/**
 * Held outside the store so concurrent callers share the same query rather than
 * each starting one before the first has had a chance to set `loaded`.
 */
let loading: Promise<void> | null = null;

export const useDownloadStatus = create<DownloadStatusState>((set) => ({
  ids: new Set(),
  loaded: false,

  ensureLoaded() {
    if (loading) return;
    if (!isDownloadSupported()) {
      set({ loaded: true });
      return;
    }

    loading = offlineDb.downloads
      .toCollection()
      .primaryKeys()
      .then((keys) => {
        set({ ids: new Set(keys as string[]), loaded: true });
      })
      .catch(() => {
        // A blocked or corrupted IndexedDB just means nothing shows as
        // downloaded; it must not stop the page rendering.
        set({ loaded: true });
      });
  },

  markDownloaded(episodeId) {
    set((state) => {
      const ids = new Set(state.ids);
      ids.add(episodeId);
      return { ids };
    });
  },

  markRemoved(episodeId) {
    set((state) => {
      const ids = new Set(state.ids);
      ids.delete(episodeId);
      return { ids };
    });
  },
}));
