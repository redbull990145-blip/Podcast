"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Command } from "cmdk";
import { Dialog, VisuallyHidden } from "radix-ui";
import { AnimatePresence, motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import {
  Gauge,
  Keyboard,
  Moon,
  Pause,
  Play,
  Rss,
  Search,
  Settings,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { NAV_ITEMS } from "@/components/nav/nav-items";
import { useTheme } from "@/components/theme/theme-provider";
import { usePlayer } from "@/lib/player/store";
import { usePrefs } from "@/lib/prefs/store";
import { scoreCommand } from "@/lib/command/score";
import { backdrop, dialog } from "@/lib/motion/variants";
import type { PodcastSearchResult } from "@/lib/podcasts/search";
import type { Podcast } from "@/lib/db/schema";

/**
 * One surface that is both the app's search and its command line.
 *
 * Before this, ⌘K pushed the router at /discover and the "search field" in the
 * top bar was a link wearing an input's clothes. That is a reasonable thing to
 * ship early and a strange thing to keep: anyone arriving from another player
 * presses ⌘K expecting a palette, and getting a page navigation instead is the
 * moment they conclude the app is shallower than it is.
 *
 * The design goal is that this reads as two different things to two different
 * people without being two different things. Typed into with no knowledge of
 * the app it is a search box that also happens to find your shows. Typed into
 * by someone who knows what they want it addresses the whole app without a
 * mouse. Neither audience is shown a mode switch, because there isn't one — the
 * groups are ranked so that the answer to a plain word is a show, and the
 * answer to a verb is a command.
 */
export function CommandPalette() {
  const open = usePrefs((s) => s.paletteOpen);
  const setOpen = usePrefs((s) => s.setPaletteOpen);

  const [query, setQuery] = useState("");

  /*
   * The query resets when the palette closes, not when it opens.
   *
   * Doing it on open means the previous query is briefly visible during the
   * entrance animation and then blanks under the cursor, which reads as a
   * glitch. Doing it on close happens behind the exit animation where nothing
   * is legible anyway.
   */
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/*
        `forceMount` on both parts hands presence control to AnimatePresence.
        Without it Radix unmounts the content the instant `open` flips and the
        exit variant never runs — the palette would vanish rather than close.
      */}
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                variants={backdrop}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]"
              />
            </Dialog.Overlay>

            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                variants={dialog}
                initial="hidden"
                animate="visible"
                exit="exit"
                /*
                  Anchored at 12% rather than centred. A centred palette pushes
                  the input to the middle of the screen and the results below
                  the fold on a laptop; sitting it high keeps the caret near
                  where the eye already is after pressing the shortcut, and
                  gives the list the rest of the height.
                */
                className="elev-overlay fixed left-1/2 top-[12%] z-[80] w-[min(92vw,620px)] -translate-x-1/2 overflow-hidden rounded-app-xl"
              >
                <VisuallyHidden.Root>
                  <Dialog.Title>Search and commands</Dialog.Title>
                </VisuallyHidden.Root>

                <PaletteBody query={query} onQueryChange={setQuery} onDone={() => setOpen(false)} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function PaletteBody({
  query,
  onQueryChange,
  onDone,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onDone: () => void;
}) {
  const router = useRouter();

  /*
   * `resolvedTheme`, not `theme`. The stored preference can be "system", and
   * asking "is theme dark?" answers false while a dark page is on screen — so
   * the command would offer to switch to dark when it is already dark. What the
   * label needs to describe is what the user is looking at.
   */
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const powerMode = usePrefs((s) => s.powerMode);
  const setPowerMode = usePrefs((s) => s.setPowerMode);
  const setShortcutsOpen = usePrefs((s) => s.setShortcutsOpen);

  /*
   * Episode identity and playing state only — never `currentTime`. The palette
   * is mounted for the whole session, so subscribing to position here would
   * re-render it, and every row in it, four times a second for as long as
   * anything is playing.
   */
  const hasEpisode = usePlayer((s) => s.episode !== null);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const subscriptions = useSubscriptions();
  const catalogue = useCatalogueSearch(query);

  /** Every action closes the palette; nothing here is a mode you stay in. */
  function run(action: () => void) {
    action();
    onDone();
  }

  return (
    <Command
      /*
       * `loop` so arrowing past the last row returns to the first. With a list
       * this short the alternative is the selection silently refusing to move,
       * which reads as the key not registering.
       */
      loop
      filter={scoreCommand}
      className="flex max-h-[min(70vh,520px)] flex-col"
    >
      <div className="flex items-center gap-3 border-b border-border-2 px-4">
        <Search aria-hidden className="size-[18px] shrink-0 text-subtle" strokeWidth={1.9} />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search shows, jump to a section, run a command…"
          className="h-14 w-full bg-transparent text-body outline-none placeholder:text-subtle-2"
        />
      </div>

      <Command.List className="flex-1 overflow-y-auto overscroll-contain p-2">
        <Command.Empty className="px-3 py-10 text-center text-meta text-muted">
          {catalogue.isFetching ? "Searching…" : "Nothing matched."}
        </Command.Empty>

        <Group heading="Your shows">
          {subscriptions.map((podcast) => (
            <Row
              key={podcast.id}
              value={podcast.title}
              keywords={podcast.author ? [podcast.author] : undefined}
              onSelect={() => run(() => router.push(`/podcast/${podcast.id}`))}
              icon={
                podcast.artworkUrl ? (
                  <Image
                    src={podcast.artworkUrl}
                    alt=""
                    width={64}
                    height={64}
                    sizes="28px"
                    className="size-7 rounded-[7px] object-cover"
                  />
                ) : (
                  <PlateIcon Icon={Rss} />
                )
              }
              label={podcast.title}
              hint={podcast.author ?? undefined}
            />
          ))}
        </Group>

        <Group heading="Go to">
          {NAV_ITEMS.map((item) => (
            <Row
              key={item.href}
              value={item.label}
              keywords={[item.href.replace("/", "")]}
              onSelect={() => run(() => router.push(item.href))}
              icon={<PlateIcon Icon={item.Icon} />}
              label={item.label}
            />
          ))}
          <Row
            value="Settings"
            keywords={["preferences", "account", "theme", "api key"]}
            onSelect={() => run(() => router.push("/settings"))}
            icon={<PlateIcon Icon={Settings} />}
            label="Settings"
          />
        </Group>

        {/*
          Playback commands are hidden outright when nothing is loaded rather
          than shown disabled. A disabled row still has to be arrowed past, and
          "Pause" is not a thing anyone is looking for when there is no audio.
        */}
        {hasEpisode && (
          <Group heading="Playback">
            <Row
              value={isPlaying ? "Pause" : "Play"}
              keywords={["resume", "stop", "toggle"]}
              onSelect={() => run(() => usePlayer.getState().toggle())}
              icon={<PlateIcon Icon={isPlaying ? Pause : Play} />}
              label={isPlaying ? "Pause" : "Play"}
              hint="Space"
            />
            <Row
              value="Open Now Playing"
              keywords={["full screen", "player", "expand", "artwork"]}
              onSelect={() => run(() => usePlayer.getState().setExpanded(true))}
              icon={<PlateIcon Icon={Sparkles} />}
              label="Open Now Playing"
              hint="N"
            />
            <Row
              value="Reset speed to 1×"
              keywords={["playback rate", "normal speed"]}
              onSelect={() => run(() => usePlayer.getState().setRate(1))}
              icon={<PlateIcon Icon={Gauge} />}
              label="Reset speed to 1×"
              hint="0"
            />
          </Group>
        )}

        <Group heading="Commands">
          <Row
            value={isDark ? "Switch to light theme" : "Switch to dark theme"}
            keywords={["appearance", "dark mode", "light mode"]}
            onSelect={() => run(() => setTheme(isDark ? "light" : "dark"))}
            icon={<PlateIcon Icon={isDark ? Sun : Moon} />}
            label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          />
          <Row
            value={powerMode ? "Turn off power mode" : "Turn on power mode"}
            keywords={["advanced", "filters", "shortcuts", "bulk"]}
            onSelect={() => run(() => setPowerMode(!powerMode))}
            icon={<PlateIcon Icon={Zap} />}
            label={powerMode ? "Turn off power mode" : "Turn on power mode"}
          />
          <Row
            value="Keyboard shortcuts"
            keywords={["keys", "help", "bindings"]}
            onSelect={() => run(() => setShortcutsOpen(true))}
            icon={<PlateIcon Icon={Keyboard} />}
            label="Keyboard shortcuts"
            hint="?"
          />
        </Group>

        {/*
          The catalogue is last on purpose. Everything above is something the
          user already has a relationship with, and a subscribed show should
          never be outranked by a search result that happens to share its name.
        */}
        {catalogue.results.length > 0 && (
          <Group heading="Add a new show">
            {catalogue.results.map((result) => (
              <Row
                key={result.feedUrl}
                value={result.title}
                keywords={result.author ? [result.author] : undefined}
                /*
                  Routes to Discover with the term rather than subscribing from
                  here. Subscribing is not reversible from a list that is about
                  to close, and a palette should never commit someone to a feed
                  they have seen one line of.
                */
                onSelect={() =>
                  run(() => router.push(`/discover?q=${encodeURIComponent(result.title)}`))
                }
                icon={
                  result.artworkUrl ? (
                    <Image
                      src={result.artworkUrl}
                      alt=""
                      width={64}
                      height={64}
                      sizes="28px"
                      className="size-7 rounded-[7px] object-cover"
                    />
                  ) : (
                    <PlateIcon Icon={Rss} />
                  )
                }
                label={result.title}
                hint={result.author ?? undefined}
              />
            ))}
          </Group>
        )}
      </Command.List>

      <Footer />
    </Command>
  );
}

/** Skips rendering entirely when it has no children, so no empty heading shows. */
function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-subtle-2"
    >
      {children}
    </Command.Group>
  );
}

function Row({
  value,
  keywords,
  onSelect,
  icon,
  label,
  hint,
}: {
  value: string;
  keywords?: string[];
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      /*
        The selected state is a background on the row itself rather than a
        shared `layoutId` plate. A sliding highlight is the right answer for a
        nav bar, where the items are few and fixed; here the list re-filters on
        every keystroke, so the plate would animate between rows that are
        simultaneously being replaced — and Motion measures the slide against
        positions that no longer exist. It lands visibly wrong, and it has to
        keep up with a held arrow key besides.
      */
      className="flex cursor-pointer items-center gap-3 rounded-app px-3 py-2.5 text-meta transition-colors data-[selected=true]:bg-surface-strong"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {hint && (
        <span className="shrink-0 truncate text-micro tracking-normal text-subtle-2">
          {hint}
        </span>
      )}
    </Command.Item>
  );
}

function PlateIcon({
  Icon,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <span className="grid size-7 place-items-center rounded-[7px] bg-surface-strong text-ink-3">
      <Icon className="size-[15px]" strokeWidth={1.9} />
    </span>
  );
}

function Footer() {
  return (
    <div className="flex items-center gap-4 border-t border-border-2 px-4 py-2.5 text-micro tracking-normal text-subtle-2">
      <Legend keys="↑↓" label="Navigate" />
      <Legend keys="↵" label="Open" />
      <Legend keys="esc" label="Close" />
    </div>
  );
}

function Legend({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded-[5px] border border-border bg-surface-sunken px-1.5 py-0.5 font-sans text-[10.5px] font-semibold">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

/**
 * The user's shows, fetched once the palette has been opened.
 *
 * `staleTime: Infinity` for the session: a subscription list changes when the
 * user subscribes, which happens on another screen that already invalidates
 * this key, so there is nothing a refetch here could learn.
 */
function useSubscriptions(): Podcast[] {
  const { data } = useQuery({
    queryKey: ["subscriptions"],
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch("/api/subscriptions");
      if (!res.ok) throw new Error("Could not load subscriptions");
      return (await res.json()) as { subscriptions: { podcast: Podcast }[] };
    },
  });

  return useMemo(() => data?.subscriptions.map((s) => s.podcast) ?? [], [data]);
}

/**
 * Catalogue results for the current query.
 *
 * Shares the `["podcast-search", term]` key with Discover's own field, so
 * searching here and then landing on Discover shows results immediately rather
 * than repeating the request. The 200ms debounce and the two-character floor
 * both match that screen for the same reason.
 */
function useCatalogueSearch(query: string) {
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["podcast-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/podcasts/search?q=${encodeURIComponent(debounced)}`);
      if (!res.ok) throw new Error("Search failed");
      return (await res.json()) as { results: PodcastSearchResult[] };
    },
  });

  return {
    // Four is enough to show the catalogue has something without burying the
    // groups above it, which are the ones the user already owns.
    results: (data?.results ?? []).slice(0, 4),
    isFetching,
  };
}
