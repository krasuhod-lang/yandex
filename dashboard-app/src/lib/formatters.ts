/**
 * Locale-aware number and percent formatters.
 * Division by zero and missing values render as "—" (U+2014) per docs/data-dictionary.md §3.
 */

const EM_DASH = '—'

const integerFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const decimalFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const percentFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const signedPercentFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
})

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  return integerFormatter.format(value)
}

export function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  return decimalFormatter.format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  return percentFormatter.format(value)
}

/**
 * Format a relative delta as a signed percent. Returns em-dash if the
 * baseline is zero / missing (i.e. the delta is undefined).
 */
export function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return EM_DASH
  return signedPercentFormatter.format(delta)
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`
}

export { EM_DASH }
