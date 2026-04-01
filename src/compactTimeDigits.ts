export function sanitizeDurationDigitInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 7)
}

export function parseCompactDurationMs(digits: string): number | null {
  const d = digits.replace(/\D/g, '')
  if (d.length !== 6 && d.length !== 7) return null
  let minPart: number
  let sec2: number
  let ms3: number
  if (d.length === 6) {
    minPart = d.charCodeAt(0) - 48
    sec2 = parseInt(d.slice(1, 3), 10)
    ms3 = parseInt(d.slice(3, 6), 10)
  } else {
    minPart = parseInt(d.slice(0, 2), 10)
    sec2 = parseInt(d.slice(2, 4), 10)
    ms3 = parseInt(d.slice(4, 7), 10)
  }
  if (!Number.isFinite(minPart) || minPart < 0) return null
  if (!Number.isFinite(sec2) || sec2 < 0 || sec2 > 59) return null
  if (!Number.isFinite(ms3) || ms3 < 0 || ms3 > 999) return null
  const totalMs = (minPart * 60 + sec2) * 1000 + ms3
  if (!Number.isFinite(totalMs) || totalMs <= 0) return null
  return totalMs
}

export function formatMsAsMinSecMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const t = Math.floor(ms)
  const milli = t % 1000
  const totalSec = Math.floor(t / 1000)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const msStr = String(milli).padStart(3, '0')
  const sStr = String(sec).padStart(2, '0')
  return `${totalMin}:${sStr}.${msStr}`
}
