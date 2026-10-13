type BuildProvenance = { revision: string | null; dirty: boolean | null };
declare const __CUE_BUILD_PROVENANCE__: BuildProvenance;

// esbuild replaces the symbol with a literal in both API and worker artifacts.
// Running TypeScript source has no artifact revision to report.
export const buildProvenance: BuildProvenance = typeof __CUE_BUILD_PROVENANCE__ === 'undefined'
  ? { revision: null, dirty: null }
  : __CUE_BUILD_PROVENANCE__;
