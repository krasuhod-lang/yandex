import { useFilteredRows } from '@/lib/selectors'
import {
  LeadsStackedBarChart,
  ProductsGroupedBarChart,
} from '@/components/charts/BarCharts'
import { ProductSourceHeatmap } from '@/components/charts/Heatmap'
import { DetailTable } from '@/components/tables/DetailTable'
import { EmptyState } from './EmptyState'

export function Products(): JSX.Element {
  const { filtered } = useFilteredRows()
  if (filtered.length === 0) return <EmptyState />
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <ProductsGroupedBarChart rows={filtered} />
        <LeadsStackedBarChart rows={filtered} />
      </div>
      <ProductSourceHeatmap rows={filtered} />
      <DetailTable rows={filtered} />
    </div>
  )
}
