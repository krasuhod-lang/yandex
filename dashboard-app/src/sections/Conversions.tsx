import { useFilteredRows } from '@/lib/selectors'
import { LeadsStackedBarChart } from '@/components/charts/BarCharts'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { ProductSourceHeatmap } from '@/components/charts/Heatmap'
import { DetailTable } from '@/components/tables/DetailTable'
import { EmptyState } from './EmptyState'
import { KpiGrid } from '@/components/kpi/KpiGrid'

export function Conversions(): JSX.Element {
  const { filtered } = useFilteredRows()
  if (filtered.length === 0) return <EmptyState />
  return (
    <div className="flex flex-col gap-4 p-6">
      <KpiGrid rows={filtered} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelChart rows={filtered} />
        <LeadsStackedBarChart rows={filtered} />
      </div>
      <ProductSourceHeatmap rows={filtered} />
      <DetailTable rows={filtered} />
    </div>
  )
}
