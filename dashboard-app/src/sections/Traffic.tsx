import { useMemo } from 'react'
import { useFilteredRows } from '@/lib/selectors'
import { VisitsLeadsNkLineChart } from '@/components/charts/LineChart'
import { TopCampaignsHorizontalBarChart } from '@/components/charts/TopCampaignsChart'
import { DetailTable } from '@/components/tables/DetailTable'
import { EmptyState } from './EmptyState'
import { KpiCard } from '@/components/kpi/KpiCard'
import { KPI_DEFINITIONS } from '@/config/columns'
import { aggregate, pickMetric, relativeDelta, uniqueValues } from '@/lib/metrics'
import { useDashboardStore } from '@/store/dashboardStore'

const TRAFFIC_KEYS = new Set(['impressions', 'clicks', 'ctr', 'visits'])

export function Traffic(): JSX.Element {
  const { filtered } = useFilteredRows()
  const filters = useDashboardStore((s) => s.filters)

  const { currentAgg, previousAgg, perMonth } = useMemo(() => {
    const months = uniqueValues(filtered, 'month')
    const perMonthAgg = new Map(
      months.map((m) => [m, aggregate(filtered.filter((r) => r.data.month === m))]),
    )
    let prev = null as ReturnType<typeof aggregate> | null
    if (filters.compareWith) {
      const base = filtered.filter((r) => r.data.month === filters.compareWith)
      prev = base.length ? aggregate(base) : null
    } else if (months.length > 1) {
      prev = perMonthAgg.get(months[months.length - 2]) ?? null
    }
    return {
      currentAgg: aggregate(filtered),
      previousAgg: prev,
      perMonth: months.map((m) => perMonthAgg.get(m)!),
    }
  }, [filtered, filters.compareWith])

  if (filtered.length === 0) return <EmptyState />

  const trafficDefs = KPI_DEFINITIONS.filter((d) => TRAFFIC_KEYS.has(d.key))

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="grid gap-3 grid-cols-4">
        {trafficDefs.map((def) => {
          const value = pickMetric(currentAgg, def.key)
          const prev = previousAgg ? pickMetric(previousAgg, def.key) : null
          const delta = prev !== null ? relativeDelta(value, prev) : null
          const spark = perMonth.map((a) => {
            const v = pickMetric(a, def.key)
            return v === null ? 0 : v
          })
          return <KpiCard key={def.key} def={def} value={value} delta={delta} sparkline={spark} />
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <VisitsLeadsNkLineChart rows={filtered} />
        <TopCampaignsHorizontalBarChart rows={filtered} />
      </div>
      <DetailTable rows={filtered} />
    </div>
  )
}
