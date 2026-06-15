export const DEFAULT_BROADCAST_RATE_PER_SEC = Number(process.env.BROADCAST_RATE_PER_SEC ?? 10)

export function computeRunAtOffsetMs(index: number, ratePerSec: number): number {
  const rate = Number.isFinite(ratePerSec) && ratePerSec > 0 ? Math.floor(ratePerSec) : 1
  return Math.floor(index / rate) * 1000
}
