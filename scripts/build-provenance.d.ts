export type BuildProvenance = { revision: string | null; dirty: boolean | null };
export function buildProvenance(env?: Record<string, string | undefined>, inspectGit?: () => BuildProvenance | null): BuildProvenance;
export function provenanceHeaders(provenance: BuildProvenance): Array<{ key: string; value: string }>;
