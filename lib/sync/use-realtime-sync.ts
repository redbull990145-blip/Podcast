"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Cross-device sync.
 *
 * Supabase Realtime streams Postgres changes over a websocket, and RLS applies
 * to the stream as well as to queries, so each client only ever receives its
 * own rows. Rather than merging individual change payloads into local state, a
 * change simply invalidates the relevant React Query cache — the refetch is one
 * cheap request and it sidesteps a whole class of ordering bugs from applying
 * out-of-order events by hand.
 *
 * This is the fix for the "started on my laptop, phone doesn't know" complaint:
 * updates are pushed, not polled, so the other device catches up in seconds.
 */
export function useRealtimeSync(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`user-sync:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_items",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["queue"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "playback_state",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["playback"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ai_jobs",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["ai-jobs"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
