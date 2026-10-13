/** Only moving between two different shows announces a palette transition. */
export function shouldSweepPodcast(previous: string | null, next: string | null): boolean {
  return previous !== null && next !== null && previous !== next;
}
