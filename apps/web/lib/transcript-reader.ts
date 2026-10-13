/** Bind only while the asynchronously loaded scroll surface exists. */
export function attachTranscriptReader(
  box: HTMLElement,
  following: { current: boolean },
  onYield: (position: number) => void,
  resumeMs: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const yieldToReader = () => {
    following.current = false;
    onYield(box.scrollTop);
    clearTimeout(timer);
    timer = setTimeout(() => { following.current = true; }, resumeMs);
  };
  box.addEventListener('wheel', yieldToReader, { passive: true });
  box.addEventListener('touchmove', yieldToReader, { passive: true });
  return () => {
    box.removeEventListener('wheel', yieldToReader);
    box.removeEventListener('touchmove', yieldToReader);
    clearTimeout(timer);
  };
}
