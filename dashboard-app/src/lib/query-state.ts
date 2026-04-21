import type { FilterState, MetricType, SectionId } from '@/types/dashboard'

/**
 * Serialise / deserialise FilterState ↔ URLSearchParams.
 * Multi-valued fields use a single comma-separated string.
 * See docs/ux-flow.md §8 for the scheme.
 */

const SECTIONS: SectionId[] = [
  'overview',
  'traffic',
  'conversions',
  'campaigns',
  'products',
  'data-quality',
  'uploads',
]
const METRIC_TYPES: MetricType[] = ['all', 'online', 'offline']

export const DEFAULT_FILTERS: FilterState = {
  section: 'overview',
  months: [],
  products: [],
  sources: [],
  campaigns: [],
  metricType: 'all',
  search: '',
  compareWith: null,
}

function parseList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => decodeURIComponent(s).trim())
    .filter((s) => s.length > 0)
}

function formatList(list: string[]): string {
  return list.map((s) => encodeURIComponent(s)).join(',')
}

export function parseQuery(search: string): FilterState {
  const params = new URLSearchParams(search)
  const sectionRaw = params.get('section')
  const section: SectionId =
    sectionRaw && (SECTIONS as string[]).includes(sectionRaw)
      ? (sectionRaw as SectionId)
      : 'overview'

  const metricRaw = params.get('metricType')
  const metricType: MetricType =
    metricRaw && (METRIC_TYPES as string[]).includes(metricRaw)
      ? (metricRaw as MetricType)
      : 'all'

  return {
    section,
    months: parseList(params.get('months')),
    products: parseList(params.get('products')),
    sources: parseList(params.get('sources')),
    campaigns: parseList(params.get('campaigns')),
    metricType,
    search: params.get('search') ?? '',
    compareWith: params.get('compareWith') || null,
  }
}

export function stringifyQuery(state: FilterState): string {
  const params = new URLSearchParams()
  if (state.section && state.section !== 'overview') params.set('section', state.section)
  if (state.months.length) params.set('months', formatList(state.months))
  if (state.products.length) params.set('products', formatList(state.products))
  if (state.sources.length) params.set('sources', formatList(state.sources))
  if (state.campaigns.length) params.set('campaigns', formatList(state.campaigns))
  if (state.metricType !== 'all') params.set('metricType', state.metricType)
  if (state.search) params.set('search', state.search)
  if (state.compareWith) params.set('compareWith', state.compareWith)
  const str = params.toString()
  return str ? `?${decodeURIComponent(str)}` : ''
}

export function areFiltersEqual(a: FilterState, b: FilterState): boolean {
  return (
    a.section === b.section &&
    a.metricType === b.metricType &&
    a.search === b.search &&
    a.compareWith === b.compareWith &&
    listsEqual(a.months, b.months) &&
    listsEqual(a.products, b.products) &&
    listsEqual(a.sources, b.sources) &&
    listsEqual(a.campaigns, b.campaigns)
  )
}

function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
