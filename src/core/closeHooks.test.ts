import { describe, expect, it } from 'vitest';
import { buildDemo } from '../data/seed';
import { inventoryProof, registerCloseHooks } from './closeHooks';
import { proveStep } from './close';

describe('close: inventory counted, proved by the inside-store counts', () => {
  const s = buildDemo();
  it('September and October month-end counts prove the step at every operating store that counts', () => {
    for (const p of ['2026-09', '2026-10']) {
      for (const st of ['st_hm11', 'st_hm13', 'st_hm15']) {
        const proof = inventoryProof(s, st, p)!;
        expect(proof, `${st} ${p}`).not.toBeNull();
        expect(proof.ok, `${st} ${p}: ${proof.missing.join(' ')}`).toBe(true);
        expect(proof.evidence[0]).toMatch(/Count posted/);
      }
    }
  });
  it('a month with no month-end count is not proved, and a store with no counts stays manual', () => {
    const nov = inventoryProof(s, 'st_hm11', '2026-11')!;
    expect(nov.ok).toBe(false);
    expect(nov.missing[0]).toMatch(/No count posted|not posted/);
    expect(inventoryProof(s, 'st_corp', '2026-10')).toBeNull();
  });
  it('once registered, the close checklist uses it', () => {
    registerCloseHooks();
    registerCloseHooks();
    expect(proveStep(s, 'inventory', 'st_hm13', '2026-10')?.ok).toBe(true);
  });
});
