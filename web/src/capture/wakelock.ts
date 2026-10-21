/** Thin wrapper around the Screen Wake Lock API. All failures resolve to `false` / no-op. */
export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private pending: Promise<boolean> | null = null;

  get active(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  /** Request a screen wake lock. Safe to call repeatedly (e.g. after visibilitychange). */
  acquire(): Promise<boolean> {
    if (this.active) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const p = this.doAcquire().finally(() => {
      if (this.pending === p) this.pending = null;
    });
    this.pending = p;
    return p;
  }

  private async doAcquire(): Promise<boolean> {
    const wl = typeof navigator !== 'undefined' ? navigator.wakeLock : undefined;
    if (!wl || typeof wl.request !== 'function') return false;
    try {
      const s = await wl.request('screen');
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    if (!s) return;
    try {
      await s.release();
    } catch {
      /* already released */
    }
  }
}
