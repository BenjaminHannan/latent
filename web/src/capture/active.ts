// Tracks sessions that are being recorded by this page right now, so that
// listRecoverableSessions() doesn't offer to "recover" the live session.
const active = new Set<string>();

export function markActive(id: string): void {
  active.add(id);
}
export function unmarkActive(id: string): void {
  active.delete(id);
}
export function isActive(id: string): boolean {
  return active.has(id);
}
