import { useMemo } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { ParsedRow } from '@/types/dashboard'

/**
 * Hook returning:
 *   - filtered rows for the active dashboard view (respects all filters)
 *   - the list of available filter options (derived from the full dataset)
 *
 * Campaign-name "search" filter is applied as a case-insensitive substring
 * match. The `metricType` filter does NOT exclude rows — it only affects
 * which KPIs / series are displayed in the UI layer.
 */
export function useFilteredRows(): {
  all: ParsedRow[]
  filtered: ParsedRow[]
  options: {
    months: string[]
    products: string[]
    sources: string[]
    campaigns: string[]
  }
} {
  const parseResult = useDashboardStore((s) => s.parseResult)
  const filters = useDashboardStore((s) => s.filters)

  return useMemo(() => {
    const all = parseResult?.rows ?? []
    const options = {
      months: unique(all.map((r) => r.data.month)),
      products: unique(all.map((r) => r.data.product)),
      sources: unique(all.map((r) => r.data.trafficSource)),
      campaigns: unique(
        all.filter((r) => !r.meta.isAggregate).map((r) => r.data.campaignName),
      ),
    }

    const q = filters.search.trim().toLowerCase()

    const filtered = all.filter((row) => {
      if (filters.months.length && !filters.months.includes(row.data.month)) return false
      if (filters.products.length && !filters.products.includes(row.data.product)) return false
      if (filters.sources.length && !filters.sources.includes(row.data.trafficSource)) return false
      if (filters.campaigns.length && !filters.campaigns.includes(row.data.campaignName))
        return false
      if (q && !row.data.campaignName.toLowerCase().includes(q)) return false
      return true
    })

    return { all, filtered, options }
  }, [parseResult, filters])
}

function unique(list: string[]): string[] {
  const set = new Set<string>()
  for (const s of list) if (s && s.length > 0) set.add(s)
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
}
