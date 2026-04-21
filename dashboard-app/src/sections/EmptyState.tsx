import { useDashboardStore } from '@/store/dashboardStore'

/**
 * Shown inside a section when filters produced zero rows. Includes a
 * reset button to recover without navigating elsewhere.
 */
export function EmptyState(): JSX.Element {
  const resetFilters = useDashboardStore((s) => s.resetFilters)
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <div className="text-4xl">🗂️</div>
      <div className="text-sm font-semibold text-slate-700">
        Нет данных по выбранным условиям
      </div>
      <div className="max-w-md text-xs text-slate-500">
        Попробуйте очистить фильтры или выбрать другой период / продукт / источник.
      </div>
      <button type="button" className="btn-secondary" onClick={resetFilters}>
        Сбросить фильтры
      </button>
    </div>
  )
}
