import type { DashboardRow, KpiDefinition, MetricKey } from '@/types/dashboard'

/**
 * Mapping between Russian Excel headers and canonical DashboardRow fields.
 * See docs/data-dictionary.md §2. All 16 columns are required.
 *
 * `aliases` lets us tolerate minor variations (trailing spaces, NBSP) without
 * falsely rejecting a valid file.
 */
export type ColumnDef = {
  field: keyof DashboardRow
  header: string
  aliases: string[]
  kind: 'string' | 'number' | 'ratio'
}

export const COLUMN_DEFS: ColumnDef[] = [
  { field: 'month', header: 'Месяц', aliases: ['Месяц'], kind: 'string' },
  {
    field: 'product',
    header: 'Страница/продукт',
    aliases: ['Страница/продукт', 'Страница / продукт'],
    kind: 'string',
  },
  {
    field: 'trafficSource',
    header: 'Источник трафика',
    aliases: ['Источник трафика'],
    kind: 'string',
  },
  {
    field: 'campaignName',
    header: 'Название рекламной кампании',
    aliases: ['Название рекламной кампании', 'Рекламная кампания'],
    kind: 'string',
  },
  { field: 'impressions', header: 'Показы', aliases: ['Показы'], kind: 'number' },
  { field: 'clicks', header: 'Клики', aliases: ['Клики'], kind: 'number' },
  { field: 'ctr', header: 'CTR', aliases: ['CTR'], kind: 'ratio' },
  { field: 'visits', header: 'Визиты', aliases: ['Визиты'], kind: 'number' },
  {
    field: 'onlineLeads',
    header: 'Заявки онлайн-выдача',
    aliases: ['Заявки онлайн-выдача', 'Заявки онлайн'],
    kind: 'number',
  },
  {
    field: 'offlineLeads',
    header: 'Заявки офлайн-выдача',
    aliases: ['Заявки офлайн-выдача', 'Заявки офлайн'],
    kind: 'number',
  },
  { field: 'crOnline', header: 'CR онлайн', aliases: ['CR онлайн'], kind: 'ratio' },
  { field: 'crOffline', header: 'CR офлайн', aliases: ['CR офлайн'], kind: 'ratio' },
  { field: 'nkOnline', header: 'НК онлайн', aliases: ['НК онлайн'], kind: 'number' },
  { field: 'nkOffline', header: 'НК офлайн', aliases: ['НК офлайн'], kind: 'number' },
  { field: 'arOnline', header: 'AR онлайн', aliases: ['AR онлайн'], kind: 'ratio' },
  { field: 'arOffline', header: 'AR офлайн', aliases: ['AR офлайн'], kind: 'ratio' },
]

/** Exported for the README "required columns" table. */
export const REQUIRED_HEADERS: string[] = COLUMN_DEFS.map((c) => c.header)

/** KPI cards shown on the Overview screen, in display order. */
export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    key: 'impressions',
    label: 'Показы',
    group: 'traffic',
    isRatio: false,
    description: 'Сумма показов по выбранной выборке',
  },
  {
    key: 'clicks',
    label: 'Клики',
    group: 'traffic',
    isRatio: false,
    description: 'Сумма кликов по выбранной выборке',
  },
  {
    key: 'ctr',
    label: 'CTR',
    group: 'ratio',
    isRatio: true,
    description: 'Клики / Показы (пересчёт на клиенте после фильтрации)',
  },
  {
    key: 'visits',
    label: 'Визиты',
    group: 'traffic',
    isRatio: false,
    description: 'Сумма визитов по выбранной выборке',
  },
  {
    key: 'onlineLeads',
    label: 'Заявки онлайн',
    group: 'online',
    isRatio: false,
    description: 'Сумма онлайн-заявок',
  },
  {
    key: 'offlineLeads',
    label: 'Заявки офлайн',
    group: 'offline',
    isRatio: false,
    description: 'Сумма офлайн-заявок',
  },
  {
    key: 'crOnline',
    label: 'CR онлайн',
    group: 'ratio',
    isRatio: true,
    description: 'Заявки онлайн / Визиты',
  },
  {
    key: 'crOffline',
    label: 'CR офлайн',
    group: 'ratio',
    isRatio: true,
    description: 'Заявки офлайн / Визиты',
  },
  {
    key: 'nkOnline',
    label: 'НК онлайн',
    group: 'online',
    isRatio: false,
    description: 'Сумма НК (новых клиентов) онлайн',
  },
  {
    key: 'nkOffline',
    label: 'НК офлайн',
    group: 'offline',
    isRatio: false,
    description: 'Сумма НК офлайн',
  },
  {
    key: 'arOnline',
    label: 'AR онлайн',
    group: 'ratio',
    isRatio: true,
    description: 'НК онлайн / Заявки онлайн',
  },
  {
    key: 'arOffline',
    label: 'AR офлайн',
    group: 'ratio',
    isRatio: true,
    description: 'НК офлайн / Заявки офлайн',
  },
]

/**
 * Metrics that should be excluded from KPI display when the "online"
 * metric-type filter is selected.
 */
export const OFFLINE_METRICS: MetricKey[] = ['offlineLeads', 'crOffline', 'nkOffline', 'arOffline']

/** Same, for "offline" filter. */
export const ONLINE_METRICS: MetricKey[] = ['onlineLeads', 'crOnline', 'nkOnline', 'arOnline']
