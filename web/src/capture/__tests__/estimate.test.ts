import { describe, expect, it } from 'vitest';
import { estimateStorage, formatBytes } from '../estimate';

describe('estimateStorage', () => {
  it('matches the spec example: 2h at 5s = 1440 frames ≈ 72 MB vs ~7.2 GB video', () => {
    const e = estimateStorage(120, 5);
    expect(e.frames).toBe(1440);
    expect(e.bytes).toBe(1440 * 50_000);
    expect(e.videoBytesEquivalent).toBe(120 * 60 * 1_000_000);
  });

  it('rounds frames up', () => {
    expect(estimateStorage(1, 30).frames).toBe(2);
    expect(estimateStorage(1, 7).frames).toBe(Math.ceil(60 / 7));
  });

  it('handles zero / invalid input', () => {
    expect(estimateStorage(0, 5)).toEqual({ frames: 0, bytes: 0, videoBytesEquivalent: 0 });
    expect(estimateStorage(10, 0).frames).toBe(0);
  });
});

describe('formatBytes', () => {
  it('formats decimal units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(72_000_000)).toBe('72 MB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(7_200_000_000)).toBe('7.2 GB');
  });
});
