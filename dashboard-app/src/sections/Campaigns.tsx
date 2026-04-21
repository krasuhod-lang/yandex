import { useFilteredRows } from '@/lib/selectors'
import { TopCampaignsHorizontalBarChart } from '@/components/charts/TopCampaignsChart'
import { DetailTable } from '@/components/tables/DetailTable'
import { EmptyState } from './EmptyState'

export function Campaigns(): JSX.Element {
  const { filtered } = useFilteredRows()
  if (filtered.length === 0) return <EmptyState />
  return (
    <div className="flex flex-col gap-4 p-6">
      <TopCampaignsHorizontalBarChart rows={filtered} topN={15} />
      <DetailTable rows={filtered} />
    </div>
  )
}
