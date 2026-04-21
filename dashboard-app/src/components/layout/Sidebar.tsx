import { useDashboardStore } from '@/store/dashboardStore'
import type { SectionId } from '@/types/dashboard'
import clsx from 'clsx'

type NavItem = {
  id: SectionId
  label: string
  description: string
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', description: 'Сводка KPI' },
  { id: 'traffic', label: 'Traffic', description: 'Показы, клики, визиты' },
  { id: 'conversions', label: 'Conversions', description: 'Заявки, CR, НК, AR' },
  { id: 'campaigns', label: 'Campaigns', description: 'Эффективность кампаний' },
  { id: 'products', label: 'Products / Pages', description: 'Сравнение продуктов' },
  { id: 'data-quality', label: 'Data Quality', description: 'Пропуски и ошибки' },
  { id: 'uploads', label: 'Uploads', description: 'Загрузка и история' },
]

export function Sidebar(): JSX.Element {
  const activeSection = useDashboardStore((s) => s.filters.section)
  const setSection = useDashboardStore((s) => s.setSection)
  const parseResult = useDashboardStore((s) => s.parseResult)
  const hasFile = Boolean(parseResult && parseResult.rows.length > 0)
  const warningsCount = parseResult
    ? parseResult.rows.reduce((acc, r) => acc + (r.meta.warnings.length > 0 ? 1 : 0), 0) +
      (parseResult.missingColumns.length > 0 ? 1 : 0)
    : 0

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-200">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white font-bold">
          MP
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            Marketing Performance
          </div>
          <div className="truncate text-xs text-slate-500">Dashboard v1</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((item) => {
          const isUploads = item.id === 'uploads'
          const disabled = !hasFile && !isUploads
          const showDqBadge = item.id === 'data-quality' && hasFile && warningsCount > 0
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => setSection(item.id)}
              className={clsx(
                'mb-0.5 flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-700 hover:bg-slate-100 active:bg-slate-200',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-slate-500">{item.description}</span>
              </span>
              {showDqBadge && (
                <span className="mt-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  {warningsCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
        {hasFile && parseResult ? (
          <div className="space-y-0.5">
            <div className="truncate" title={parseResult.fileName}>
              📄 {parseResult.fileName}
            </div>
            <div>
              {parseResult.rows.length} строк · лист «{parseResult.sheetName}»
            </div>
          </div>
        ) : (
          <span>Файл не загружен</span>
        )}
      </div>
    </aside>
  )
}
