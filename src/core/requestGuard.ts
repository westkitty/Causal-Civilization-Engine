// Guards against committing stale or superseded asynchronous results.
//
// Every simulation run is tagged with a monotonically increasing request id.
// A worker (or async fallback) result may only be committed when it belongs to
// the latest request AND the component is still mounted. This prevents a slow,
// superseded run (e.g. an earlier seed) from overwriting newer application
// state, and prevents state writes after unmount.
export function acceptResult(
  latestRequestId: number,
  incomingRequestId: number,
  mounted: boolean
): boolean {
  return mounted && incomingRequestId === latestRequestId;
}
