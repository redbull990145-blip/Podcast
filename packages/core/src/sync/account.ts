/** A verified identity and a fence for asynchronous work admitted under it. */
export type AccountSnapshot = Readonly<{ accountId: string | null; generation: number }>;

export class AccountScope {
  private state: AccountSnapshot = { accountId: null, generation: 0 };
  private listeners = new Set<() => void>();

  snapshot = (): AccountSnapshot => this.state;
  generation = (): number => this.state.generation;
  matches = (snapshot: AccountSnapshot): boolean => snapshot === this.state;

  set(accountId: string | null, force = false): void {
    if (!force && accountId === this.state.accountId) return;
    this.state = { accountId, generation: this.state.generation + 1 };
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
