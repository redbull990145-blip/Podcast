import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Public metadata captured once during a build; never derive it at request time. */
export function buildProvenance(env = process.env, inspectGit = readGit) {
  const candidate = env.BUILD_REVISION || env.GITHUB_SHA || env.RENDER_GIT_COMMIT || env.VERCEL_GIT_COMMIT_SHA;
  if (candidate && !/^[a-f0-9]{40}$/i.test(candidate)) {
    throw new Error('Build revision must be a full hexadecimal Git commit SHA');
  }
  const git = inspectGit();
  if (candidate && git && candidate.toLowerCase() !== git.revision) {
    throw new Error('Configured build revision does not match the checked-out commit');
  }
  return {
    revision: git?.revision ?? candidate?.toLowerCase() ?? null,
    dirty: git?.dirty ?? null,
  };
}

function readGit() {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^[a-f0-9]{40}$/.test(revision)) return null;
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return { revision, dirty: status.length > 0 };
  } catch { return null; }
}

export function provenanceHeaders(provenance) {
  return [
    ...(provenance.revision ? [{ key: 'X-Cue-Revision', value: provenance.revision }] : []),
    { key: 'X-Cue-Source-Dirty', value: provenance.dirty === null ? 'unknown' : String(provenance.dirty) },
  ];
}
