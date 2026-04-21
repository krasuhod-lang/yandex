import { useMemo } from 'react'
import { KpiCard } from './KpiCard'
import { KPI_DEFINITIONS, OFFLINE_METRICS, ONLINE_METRICS } from '@/config/columns'
import { aggregate, pickMetric, relativeDelta, uniqueValues } from '@/lib/metrics'
import type { MetricKey, ParsedRow } from '@/types/dashboard'
import { useDashboardStore } from '@/store/dashboardStore'

type Props = {
  rows: ParsedRow[]
}

/**
 * Render the 12 KPI cards. Uses:
 *   - `filters.metricType` to hide irrelevant cards
 *   - `filters.compareWith` (a specific month) or, by default, the
 *      previous month derived from the available months to compute delta
 *   - Per-month time series for the sparkline
 */
export function KpiGrid({ rows }: Props): JSX.Element {
  const filters = useDashboardStore((s) => s.filters)

  const visibleDefs = useMemo(() => {
    return KPI_DEFINITIONS.filter((def) => {
      if (filters.metricType === 'online' && OFFLINE_METRICS.includes(def.key)) return false
      if (filters.metricType === 'offline' && ONLINE_METRICS.includes(def.key)) return false
      return true
    })
  }, [filters.metricType])

  const { currentAgg, previousAgg, perMonth } = useMemo(() => {
    const months = uniqueValues(rows, 'month')
    const perMonthAgg = new Map(months.map((m) => [m, aggregate(rows.filter((r) => r.data.month === m))]))

    // Determine the "previous" period:
    //   1. Explicit compareWith from filter state (user's choice).
    //   2. If exactly one month is selected, the previous month from the
    //      dataset ordering.
    //   3. Otherwise no delta.
    let previousAgg = null as ReturnType<typeof aggregate> | null
    if (filters.compareWith) {
      const base = rows.filter((r) => r.data.month === filters.compareWith)
      previousAgg = base.length > 0 ? aggregate(base) : null
    } else if (filters.months.length === 1) {
      const current = filters.months[0]
      const idx = months.indexOf(current)
      if (idx > 0) {
        const prevMonth = months[idx - 1]
        previousAgg = perMonthAgg.get(prevMonth) ?? null
      }
    } else if (filters.months.length === 0 && months.length > 1) {
      // Full dataset view: delta vs the previous-to-last month.
      previousAgg = perMonthAgg.get(months[months.length - 2]) ?? null
    }

    return {
      currentAgg: aggregate(rows),
      previousAgg,
      perMonth: months.map((m) => ({ month: m, agg: perMonthAgg.get(m)! })),
    }
  }, [rows, filters.compareWith, filters.months])

  const columns = visibleDefs.length > 8 ? 'grid-cols-4' : 'grid-cols-4'

  return (
    <div className={`grid gap-3 ${columns}`}>
      {visibleDefs.map((def) => {
        const value = pickMetric(currentAgg, def.key)
        const prev = previousAgg ? pickMetric(previousAgg, def.key) : null
        const delta = prev !== null ? relativeDelta(value, prev) : null
        const spark = perMonth
          .map((m) => pickMetric(m.agg, def.key))
          .map((v) => (v === null ? 0 : v)) as number[]
        return (
          <KpiCard
            key={def.key as MetricKey}
            def={def}
            value={value}
            delta={delta}
            sparkline={spark}
          />
        )
      })}
    </div>
  )
}
