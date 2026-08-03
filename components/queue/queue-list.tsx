"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { GripVertical, ListMusic, Loader2, Play, X } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { useRealtimeSync } from "@/lib/sync/use-realtime-sync";
import { EmptyState, PlayingBars } from "@/components/ui/page";
import { press } from "@/lib/motion/gestures";
import { fadeUp } from "@/lib/motion/variants";
import { cn, formatDurationLong } from "@/lib/utils";

type QueueRow = {
  id: string;
  episodeId: string;
  position: number;
  episode: {
    id: string;
    title: string;
    enclosureUrl: string;
    durationSeconds: number | null;
    imageUrl: string | null;
    podcast: {
      id: string;
      title: string;
      artworkUrl: string | null;
      categories: string[];
    };
  };
};

export function QueueList({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  useRealtimeSync(userId);

  const { data, isLoading } = useQuery({
    queryKey: ["queue"],
    queryFn: async () => {
      const res = await fetch("/api/queue");
      if (!res.ok) throw new Error("Failed to load queue");
      return (await res.json()) as { queue: QueueRow[] };
    },
  });

  // Local mirror so a drag reorders instantly instead of waiting for the server
  // and then the realtime echo.
  const [items, setItems] = useState<QueueRow[]>([]);
  useEffect(() => {
    if (data?.queue) setItems(data.queue);
  }, [data?.queue]);

  const reorder = useMutation({
    mutationFn: async (vars: {
      itemId: string;
      beforePosition: number | null;
      afterPosition: number | null;
    }) => {
      const res = await fetch("/api/queue", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error("Reorder failed");
      return res.json();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["queue"] }),
  });

  const remove = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/queue?itemId=${itemId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Remove failed");
    },
    onMutate: (itemId) => {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["queue"] }),
  });

  function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination || destination.index === source.index) return;

    const next = [...items];
    const [moved] = next.splice(source.index, 1);
    next.splice(destination.index, 0, moved);
    setItems(next);

    const before = next[destination.index - 1]?.position ?? null;
    const after = next[destination.index + 1]?.position ?? null;
    reorder.mutate({ itemId: draggableId, beforePosition: before, afterPosition: after });
  }

  if (isLoading) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <NowPlayingCard />
        <EmptyState
          Icon={ListMusic}
          title="Nothing lined up"
          description="Add episodes from any show and they'll queue here, in the order you want them."
        />
      </>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <NowPlayingCard />

      <Droppable droppableId="queue">
        {(droppable) => (
          <ul
            ref={droppable.innerRef}
            {...droppable.droppableProps}
            className="space-y-2"
          >
            {items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(draggable, snapshot) => (
                  /*
                    Deliberately a plain <li>. @hello-pangea/dnd drives this
                    element's `transform` directly while dragging, and a Motion
                    component would be writing the same property from its own
                    animation loop — whichever wrote last would win, frame by
                    frame. The interactive parts inside it animate instead.
                  */
                  <li
                    ref={draggable.innerRef}
                    {...draggable.draggableProps}
                    className={cn(
                      "flex items-center gap-3.5 rounded-app-md border bg-surface px-3.5 py-3 transition-shadow",
                      snapshot.isDragging
                        ? "border-accent shadow-[var(--shadow-lifted)]"
                        : "border-border-2 hover:border-border-strong hover:shadow-[0_6px_18px_rgb(34_32_29_/_0.06)]",
                    )}
                  >
                    {/* The handle carries the drag listeners, which is what gives
                        @hello-pangea/dnd its built-in keyboard support: focus it
                        and use space then the arrow keys. */}
                    <span
                      {...draggable.dragHandleProps}
                      aria-label={`Reorder ${item.episode.title}`}
                      className="grid size-7 shrink-0 cursor-grab place-items-center rounded-lg text-faint-3 transition-colors hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </span>

                    {/*
                      The ordinal is desktop-only. Between the handle, the
                      cover and the remove button a phone row has about 160px
                      left for an episode title, and the position is the one
                      thing in the row the list itself already states by being
                      a list.
                    */}
                    <span className="hidden w-3.5 shrink-0 text-center text-[12.5px] tabular-nums text-faint sm:block">
                      {index + 1}
                    </span>

                    <QueueRowContent item={item} />

                    <motion.button
                      {...press}
                      onClick={() => remove.mutate(item.id)}
                      aria-label={`Remove ${item.episode.title} from queue`}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-surface-hover hover:text-danger"
                    >
                      <X className="size-4" />
                    </motion.button>
                  </li>
                )}
              </Draggable>
            ))}
            {droppable.placeholder}
          </ul>
        )}
      </Droppable>
    </DragDropContext>
  );
}

/**
 * What is playing, above the queue proper.
 *
 * The current episode is not a queue item — it has already left the list — so
 * without this the page opens on "Up Next" with no indication of what it is next
 * *to*. It is deliberately not draggable and not numbered: nothing about it can
 * be reordered.
 */
function NowPlayingCard() {
  const episode = usePlayer((s) => s.episode);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);

  const remaining = duration > currentTime ? duration - currentTime : 0;

  return (
    /*
      Starting playback pushes the whole queue down by the height of this card.
      Without a bridge the list simply jumps, which reads as the page having
      reloaded rather than as something having arrived. `fadeUp` gives it the
      same short lift every other block of arriving content in the app uses.
    */
    <AnimatePresence initial={false}>
      {episode && (
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          exit="exit"
          layout
          className="mb-4.5 flex items-center gap-3.5 rounded-app-lg border border-accent-subtle-3 bg-accent-subtle-4 p-4.5"
        >
          {episode.artworkUrl ? (
            <Image
              src={episode.artworkUrl}
              alt=""
              width={128}
              height={128}
              sizes="64px"
              className="size-16 shrink-0 rounded-[13px] object-cover shadow-[0_6px_16px_rgb(34_32_29_/_0.16)]"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-[13px] bg-accent-subtle text-accent">
              <ListMusic className="size-6" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
              {isPlaying ? "Playing now" : "Paused"}
            </p>
            <Link
              href={`/episode/${episode.id}`}
              className="mt-1.5 block truncate text-[15px] font-semibold hover:underline"
            >
              {episode.title}
            </Link>
            <p className="mt-1 truncate text-[12.5px] text-muted">
              {episode.podcastTitle}
              {remaining > 0 && (
                <>
                  <span className="mx-1.5" aria-hidden>
                    ·
                  </span>
                  {formatDurationLong(remaining)} left
                </>
              )}
            </p>
          </div>

          {isPlaying && <PlayingBars className="h-4.5 shrink-0 self-center" />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QueueRowContent({ item }: { item: QueueRow }) {
  const currentId = usePlayer((s) => s.episode?.id);
  const load = usePlayer((s) => s.load);
  const { episode } = item;
  const artwork = episode.imageUrl ?? episode.podcast.artworkUrl;
  const isCurrent = currentId === episode.id;

  function play() {
    const playable: PlayableEpisode = {
      id: episode.id,
      title: episode.title,
      enclosureUrl: episode.enclosureUrl,
      durationSeconds: episode.durationSeconds,
      artworkUrl: artwork,
      podcastId: episode.podcast.id,
      podcastTitle: episode.podcast.title,
      categories: episode.podcast.categories,
    };
    load(playable);
  }

  return (
    <>
      <motion.button
        {...press}
        onClick={play}
        aria-label={`Play ${episode.title}`}
        className="relative shrink-0"
      >
        {artwork ? (
          <Image
            src={artwork}
            alt=""
            width={88}
            height={88}
            sizes="44px"
            className="size-11 rounded-[11px] object-cover"
          />
        ) : (
          <span className="grid size-11 place-items-center rounded-[11px] bg-accent-subtle text-accent">
            <ListMusic className="size-4" />
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center rounded-[11px] bg-black/50 opacity-0 transition-opacity hover:opacity-100">
          <Play className="size-4 fill-white text-white" />
        </span>
      </motion.button>

      <div className="min-w-0 flex-1">
        <Link
          href={`/episode/${episode.id}`}
          className={cn(
            "block truncate text-[13.5px] font-semibold hover:underline",
            isCurrent && "text-accent",
          )}
        >
          {episode.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-subtle-2">
          {episode.podcast.title}
          {episode.durationSeconds ? (
            <>
              <span className="mx-1.5" aria-hidden>
                ·
              </span>
              {formatDurationLong(episode.durationSeconds)}
            </>
          ) : null}
        </p>
      </div>
    </>
  );
}
