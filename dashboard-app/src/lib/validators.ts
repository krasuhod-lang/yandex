import { z } from 'zod'
import type { DashboardRow, ParsedRow } from '@/types/dashboard'

/**
 * Per-row Zod schema. Missing/invalid values surface as warnings during
 * parsing, not as hard failures — the parser still produces usable rows
 * and the user sees them in Data Quality (docs/data-dictionary.md §6).
 */
export const dashboardRowSchema = z.object({
  month: z.string().min(1),
  product: z.string().min(1),
  trafficSource: z.string().min(1),
  campaignName: z.string(),
  impressions: z.number().nonnegative().finite(),
  clicks: z.number().nonnegative().finite(),
  ctr: z.number().finite(),
  visits: z.number().nonnegative().finite(),
  onlineLeads: z.number().nonnegative().finite(),
  offlineLeads: z.number().nonnegative().finite(),
  crOnline: z.number().finite(),
  crOffline: z.number().finite(),
  nkOnline: z.number().nonnegative().finite(),
  nkOffline: z.number().nonnegative().finite(),
  arOnline: z.number().finite(),
  arOffline: z.number().finite(),
}) satisfies z.ZodType<DashboardRow>

/**
 * Soft-validation rules run after the hard Zod check succeeded.
 * Each returned string becomes a user-facing warning in Data Quality.
 */
export function softValidate(row: DashboardRow): string[] {
  const warnings: string[] = []
  if (row.visits > 0 && row.onlineLeads + row.offlineLeads > row.visits) {
    warnings.push(
      `Заявки (${row.onlineLeads + row.offlineLeads}) > Визиты (${row.visits}) — возможна ошибка данных`,
    )
  }
  if (row.onlineLeads > 0 && row.nkOnline > row.onlineLeads) {
    warnings.push('НК онлайн больше, чем Заявки онлайн')
  }
  if (row.offlineLeads > 0 && row.nkOffline > row.offlineLeads) {
    warnings.push('НК офлайн больше, чем Заявки офлайн')
  }
  for (const [k, v] of [
    ['ctr', row.ctr],
    ['crOnline', row.crOnline],
    ['crOffline', row.crOffline],
    ['arOnline', row.arOnline],
    ['arOffline', row.arOffline],
  ] as const) {
    if (v < 0 || v > 1.01) {
      warnings.push(`${k} = ${v} вне допустимого диапазона [0; 1]`)
    }
  }
  return warnings
}

/**
 * Detect duplicate (month + product + trafficSource + campaignName)
 * combinations. Aggregates are excluded because several "Итого ..."
 * rows per month are expected.
 */
export function detectDuplicates(rows: ParsedRow[]): {
  key: string
  rows: ParsedRow[]
}[] {
  const map = new Map<string, ParsedRow[]>()
  for (const row of rows) {
    if (row.meta.isAggregate) continue
    const key = [
      row.data.month,
      row.data.product,
      row.data.trafficSource,
      row.data.campaignName,
    ].join('§')
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  const duplicates: { key: string; rows: ParsedRow[] }[] = []
  for (const [key, list] of map) {
    if (list.length > 1) duplicates.push({ key, rows: list })
  }
  return duplicates
}
