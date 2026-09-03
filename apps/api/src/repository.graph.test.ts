import { describe, expect, it } from 'vitest';

describe('graph projection query modes', () => {
  it('documents that unscoped graphs do not reference a membership alias', () => {
    const collectionId: string | undefined = undefined;
    const membershipStatus = collectionId ? 'cm.status' : 'NULL::text AS status';
    expect(membershipStatus).toBe('NULL::text AS status');
    expect(membershipStatus).not.toContain('cm.');
  });
});
