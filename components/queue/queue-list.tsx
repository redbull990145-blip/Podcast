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
import { GripVertical, ListMusic, Loader2, Play, X } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { useRealtimeSync } from "@/lib/sync/use-realtime-sync";
import { EmptyState } from "@/components/ui/page";
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
      <EmptyState
        Icon={ListMusic}
        title="Your queue is empty"
        description="Add episodes from any show and they'll line up here, in the order you want them."
      />
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="queue">
        {(droppable) => (
          <ul
            ref={droppable.innerRef}
            {...droppable.droppableProps}
            className="space-y-1"
          >
            {items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(draggable, snapshot) => (
                  <li
                    ref={draggable.innerRef}
                    {...draggable.draggableProps}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border bg-surface px-2 py-2.5 transition-shadow",
                      snapshot.isDragging
                        ? "border-accent shadow-[var(--shadow-lifted)]"
                        : "border-border",
                    )}
                  >
                    {/* The handle carries the drag listeners, which is what gives
                        @hello-pangea/dnd its built-in keyboard support: focus it
                        and use space then the arrow keys. */}
                    <span
                      {...draggable.dragHandleProps}
                      aria-label={`Reorder ${item.episode.title}`}
                      className="grid size-8 shrink-0 cursor-grab place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </span>

                    <span className="w-5 shrink-0 text-center text-xs tabular-nums text-subtle-foreground">
                      {index + 1}
                    </span>

                    <QueueRowContent item={item} />

                    <button
                      onClick={() => remove.mutate(item.id)}
                      aria-label={`Remove ${item.episode.title} from queue`}
                      className="grid size-8 shrink-0 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-danger"
                    >
                      <X className="size-4" />
                    </button>
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
      <button
        onClick={play}
        aria-label={`Play ${episode.title}`}
        className="relative shrink-0"
      >
        {artwork ? (
          <Image
            src={artwork}
            alt=""
            width={40}
            height={40}
            unoptimized
            className="size-10 rounded-lg object-cover"
          />
        ) : (
          <span className="grid size-10 place-items-center rounded-lg bg-accent-subtle text-accent">
            <ListMusic className="size-4" />
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 opacity-0 transition-opacity hover:opacity-100">
          <Play className="size-4 fill-white text-white" />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <Link
          href={`/episode/${episode.id}`}
          className={cn(
            "block truncate text-sm font-medium hover:underline",
            isCurrent && "text-accent",
          )}
        >
          {episode.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
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
