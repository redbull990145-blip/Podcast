/**
 * A stable channel for values that change while the canvas is mounted.
 *
 * This exists because of a hard constraint discovered by measurement: **React
 * Three Fiber's `<Canvas>` must not re-render.**
 *
 * Its implementation re-renders its children into a separate reconciler root
 * from a layout effect with no dependency array, wrapped in a context bridge
 * whose component identity is recreated each time. A new element type is a
 * different component as far as React is concerned, so every re-render of
 * `<Canvas>` unmounts the entire scene and mounts a fresh one. Measured
 * directly: four renders produced four mounts and four unmounts, and each new
 * scene's texture load was cancelled by the next teardown before it could
 * finish, so the engine never started at all.
 *
 * Passing `playing` down as a prop is therefore not an option, however natural
 * it looks — and Now Playing re-renders on buffering alone, so it would have
 * fired constantly. Instead the values live in one object whose identity never
 * changes, and the scene subscribes.
 *
 * This is also what the performance design wanted independently. `now-playing.tsx`
 * goes to real trouble to keep the four-times-a-second position tick away from
 * the artwork; an engine that re-rendered React to communicate with itself would
 * have undone that work.
 */

export type EngineSettings = {
  /** The artwork is alive while the episode plays, and settles when it stops. */
  playing: boolean;
  /** Resolved 0–1 amplitude scalar. */
  intensity: number;
};

export type EngineSignal = {
  /** Read at frame time. Never destructure and hold — the point is the mutation. */
  readonly current: EngineSettings;
  /** Publishes new values and notifies subscribers if anything actually changed. */
  set: (next: EngineSettings) => void;
  /** Returns an unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
};

export function createEngineSignal(initial: EngineSettings): EngineSignal {
  const current = { ...initial };
  const listeners = new Set<() => void>();

  return {
    current,

    set(next) {
      // Compared rather than assigned blindly: `set` is called from a render
      // effect on every render of the host, and waking the scene for a value
      // that did not change would reintroduce exactly the churn this avoids.
      if (next.playing === current.playing && next.intensity === current.intensity) {
        return;
      }

      current.playing = next.playing;
      current.intensity = next.intensity;
      for (const listener of listeners) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
