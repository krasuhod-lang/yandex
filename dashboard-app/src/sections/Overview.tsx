import { KpiGrid } from '@/components/kpi/KpiGrid'
import { useFilteredRows } from '@/lib/selectors'
import { VisitsLeadsNkLineChart } from '@/components/charts/LineChart'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { DetailTable } from '@/components/tables/DetailTable'
import { EmptyState } from './EmptyState'

export function Overview(): JSX.Element {
  const { filtered } = useFilteredRows()
  if (filtered.length === 0) return <EmptyState />
  return (
    <div className="flex flex-col gap-4 p-6">
      <KpiGrid rows={filtered} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VisitsLeadsNkLineChart rows={filtered} />
        <FunnelChart rows={filtered} />
      </div>
      <DetailTable rows={filtered} />
    </div>
  )
}
