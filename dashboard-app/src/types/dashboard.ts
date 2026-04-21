// Core domain types for the Marketing Performance Dashboard.
// Exactly mirrors the canonical fields from docs/data-dictionary.md §2.

export type DashboardRow = {
  month: string
  product: string
  trafficSource: string
  campaignName: string
  impressions: number
  clicks: number
  ctr: number
  visits: number
  onlineLeads: number
  offlineLeads: number
  crOnline: number
  crOffline: number
  nkOnline: number
  nkOffline: number
  arOnline: number
  arOffline: number
}

export type MetricKey = keyof Omit<
  DashboardRow,
  'month' | 'product' | 'trafficSource' | 'campaignName'
>

export type RowMeta = {
  /** Row is a "Итого ..." aggregate and must be excluded from KPI sums. */
  isAggregate: boolean
  /** Per-field flag: true if the source cell was missing / empty / "-". */
  isMissing: Partial<Record<keyof DashboardRow, boolean>>
  /** Soft-validation warnings collected during parsing. */
  warnings: string[]
  /** 1-based row number in the source Excel sheet (useful for DQ reports). */
  sourceRow: number
}

export type ParsedRow = {
  data: DashboardRow
  meta: RowMeta
}

export type ParseResult = {
  /** File-level blocking errors (missing required columns, wrong structure). */
  errors: string[]
  /** File-level warnings that do not block the import. */
  warnings: string[]
  /** Sheet actually used for parsing. */
  sheetName: string
  /** All sheet names discovered in the workbook. */
  sheetNames: string[]
  /** Missing required column headers, if any. Non-empty array => blocking error. */
  missingColumns: string[]
  /** Parsed rows (data + meta). Empty when there are blocking errors. */
  rows: ParsedRow[]
  /** The original file name for UI display. */
  fileName: string
  /** Parse completion timestamp (ms since epoch). */
  parsedAt: number
}

export type MetricType = 'all' | 'online' | 'offline'

export type FilterState = {
  section: SectionId
  months: string[]
  products: string[]
  sources: string[]
  campaigns: string[]
  metricType: MetricType
  search: string
  compareWith: string | null
}

export type SectionId =
  | 'overview'
  | 'traffic'
  | 'conversions'
  | 'campaigns'
  | 'products'
  | 'data-quality'
  | 'uploads'

export type KpiDefinition = {
  key: MetricKey
  label: string
  group: 'traffic' | 'online' | 'offline' | 'ratio'
  /** Whether the metric is a ratio (shown as %). */
  isRatio: boolean
  /** Short description, shown as tooltip. */
  description: string
}

export type FilterPreset = {
  id: string
  name: string
  filters: Omit<FilterState, 'section'>
  createdAt: number
}

export type UploadHistoryEntry = {
  id: string
  fileName: string
  sheetName: string
  rowCount: number
  uploadedAt: number
}
