import { describe, expect, it } from 'vitest';
import { buildProvenance, provenanceHeaders } from '../../../scripts/build-provenance.js';
import { buildProvenance as sourceBuild } from './build-provenance.ts';

const revision = 'a'.repeat(40);
describe('artifact provenance', () => {
  it('reports source execution as unknown rather than claiming a build SHA', () => {
    expect(sourceBuild).toEqual({ revision: null, dirty: null });
  });
  it('captures a dirty checkout separately from its commit', () => {
    const metadata = buildProvenance({}, () => ({ revision, dirty: true }));
    expect(metadata).toEqual({ revision, dirty: true });
    expect(provenanceHeaders(metadata)).toEqual([{ key: 'X-Cue-Revision', value: revision }, { key: 'X-Cue-Source-Dirty', value: 'true' }]);
  });
  it('accepts provider provenance without inventing checkout cleanliness', () => {
    expect(buildProvenance({ GITHUB_SHA: revision }, () => null)).toEqual({ revision, dirty: null });
    expect(buildProvenance({}, () => null)).toEqual({ revision: null, dirty: null });
  });
  it('rejects malformed or contradictory supplied revisions', () => {
    expect(() => buildProvenance({ BUILD_REVISION: 'injected\r\nHeader: value' }, () => null)).toThrow();
    expect(() => buildProvenance({ BUILD_REVISION: 'b'.repeat(40) }, () => ({ revision, dirty: false }))).toThrow('does not match');
  });
});
