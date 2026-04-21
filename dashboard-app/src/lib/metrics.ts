import type { DashboardRow, MetricKey, ParsedRow } from '@/types/dashboard'

/**
 * All aggregations in the dashboard go through this file.
 *
 * Core rule (docs/data-dictionary.md §4):
 *   1. Sum absolute metrics first (impressions, clicks, visits, ...).
 *   2. Then derive ratios (ctr, crOnline, crOffline, arOnline, arOffline).
 *   3. Never average ratios across rows.
 *   4. Division by zero → null (UI shows em-dash "—").
 *
 * Rows marked as `isAggregate` ("Итого ...") are excluded by default to avoid
 * double-counting. Callers that explicitly want the raw rows must opt-out.
 */

export type Aggregated = {
  impressions: number
  clicks: number
  visits: number
  onlineLeads: number
  offlineLeads: number
  nkOnline: number
  nkOffline: number
  ctr: number | null
  crOnline: number | null
  crOffline: number | null
  arOnline: number | null
  arOffline: number | null
}

/** Safe ratio: returns null when denominator is zero or inputs are not finite. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (denominator === 0) return null
  return numerator / denominator
}

export function excludeAggregates(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((r) => !r.meta.isAggregate)
}

export function aggregate(rows: ParsedRow[]): Aggregated {
  let impressions = 0
  let clicks = 0
  let visits = 0
  let onlineLeads = 0
  let offlineLeads = 0
  let nkOnline = 0
  let nkOffline = 0

  for (const { data, meta } of rows) {
    if (meta.isAggregate) continue
    impressions += finite(data.impressions)
    clicks += finite(data.clicks)
    visits += finite(data.visits)
    onlineLeads += finite(data.onlineLeads)
    offlineLeads += finite(data.offlineLeads)
    nkOnline += finite(data.nkOnline)
    nkOffline += finite(data.nkOffline)
  }

  return {
    impressions,
    clicks,
    visits,
    onlineLeads,
    offlineLeads,
    nkOnline,
    nkOffline,
    ctr: safeRatio(clicks, impressions),
    crOnline: safeRatio(onlineLeads, visits),
    crOffline: safeRatio(offlineLeads, visits),
    arOnline: safeRatio(nkOnline, onlineLeads),
    arOffline: safeRatio(nkOffline, offlineLeads),
  }
}

/**
 * Pick a metric value from an Aggregated result. Returns null for missing ratios.
 */
export function pickMetric(agg: Aggregated, key: MetricKey): number | null {
  const v = (agg as unknown as Record<MetricKey, number | null>)[key]
  return v === undefined ? null : v
}

export function groupBy<K extends keyof DashboardRow>(
  rows: ParsedRow[],
  key: K,
): Map<string, ParsedRow[]> {
  const map = new Map<string, ParsedRow[]>()
  for (const row of rows) {
    const k = String(row.data[key] ?? '')
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

/** Aggregate per group and return an array sorted by the provided metric desc. */
export function aggregateBy<K extends keyof DashboardRow>(
  rows: ParsedRow[],
  key: K,
): { group: string; agg: Aggregated; rowCount: number }[] {
  const grouped = groupBy(excludeAggregates(rows), key)
  const result: { group: string; agg: Aggregated; rowCount: number }[] = []
  for (const [group, groupRows] of grouped) {
    result.push({ group, agg: aggregate(groupRows), rowCount: groupRows.length })
  }
  return result
}

/**
 * Relative change: (current - previous) / previous.
 * Returns null when previous is zero (undefined growth) or not finite.
 */
export function relativeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return null
  return (current - previous) / previous
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0
}

/**
 * Extract the unique sorted list of a column's values from rows.
 * Aggregates are *not* excluded (we want "Итого ..." to appear as a
 * discoverable campaign option in DQ, just not in KPI sums).
 */
export function uniqueValues<K extends keyof DashboardRow>(
  rows: ParsedRow[],
  key: K,
): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    const v = row.data[key]
    if (typeof v === 'string' && v.length > 0) set.add(v)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
}
