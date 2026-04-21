import { useState } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import { useFilteredRows } from '@/lib/selectors'
import type { MetricType } from '@/types/dashboard'
import { MultiSelect } from '@/components/ui/MultiSelect'
import clsx from 'clsx'

const METRIC_OPTIONS: { id: MetricType; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'online', label: 'Онлайн' },
  { id: 'offline', label: 'Офлайн' },
]

export function FilterBar(): JSX.Element | null {
  const filters = useDashboardStore((s) => s.filters)
  const setFilters = useDashboardStore((s) => s.setFilters)
  const resetFilters = useDashboardStore((s) => s.resetFilters)
  const presets = useDashboardStore((s) => s.presets)
  const savePreset = useDashboardStore((s) => s.savePreset)
  const applyPreset = useDashboardStore((s) => s.applyPreset)
  const deletePreset = useDashboardStore((s) => s.deletePreset)
  const parseResult = useDashboardStore((s) => s.parseResult)
  const { options } = useFilteredRows()
  const [presetOpen, setPresetOpen] = useState(false)

  if (!parseResult || parseResult.rows.length === 0) return null

  const activeCount =
    filters.months.length +
    filters.products.length +
    filters.sources.length +
    filters.campaigns.length +
    (filters.metricType !== 'all' ? 1 : 0) +
    (filters.search ? 1 : 0) +
    (filters.compareWith ? 1 : 0)

  function handleSavePreset(): void {
    const name = window.prompt('Название пресета:', `Пресет #${presets.length + 1}`)
    if (name) savePreset(name)
  }

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_auto] items-end gap-3">
        <MultiSelect
          label="Период"
          options={options.months}
          value={filters.months}
          onChange={(next) => setFilters({ months: next })}
          placeholder="Все месяцы"
        />
        <MultiSelect
          label="Страница / продукт"
          options={options.products}
          value={filters.products}
          onChange={(next) => setFilters({ products: next })}
        />
        <MultiSelect
          label="Источник трафика"
          options={options.sources}
          value={filters.sources}
          onChange={(next) => setFilters({ sources: next })}
        />
        <MultiSelect
          label="Рекламная кампания"
          options={options.campaigns}
          value={filters.campaigns}
          onChange={(next) => setFilters({ campaigns: next })}
          searchable
        />
        <div>
          <div className="label-muted mb-1">Тип метрики</div>
          <div className="inline-flex rounded-md border border-slate-300 p-0.5">
            {METRIC_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={clsx(
                  'rounded px-2 py-1 text-xs font-medium transition-colors',
                  filters.metricType === opt.id
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100',
                )}
                onClick={() => setFilters({ metricType: opt.id })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="relative">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPresetOpen((s) => !s)}
            >
              Пресеты {presets.length > 0 && <span className="chip ml-1">{presets.length}</span>}
            </button>
            {presetOpen && (
              <div className="absolute right-0 z-30 mt-1 w-80 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                <div className="border-b border-slate-200 p-2">
                  <button
                    type="button"
                    className="btn-primary w-full text-xs"
                    onClick={() => {
                      handleSavePreset()
                      setPresetOpen(false)
                    }}
                  >
                    + Сохранить текущие фильтры
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {presets.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-slate-500">Пока нет пресетов</div>
                  ) : (
                    presets.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 hover:bg-slate-50"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            applyPreset(p.id)
                            setPresetOpen(false)
                          }}
                        >
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="text-xs text-slate-500">
                            {p.filters.months.length + p.filters.products.length} фильтров
                          </div>
                        </button>
                        <button
                          type="button"
                          className="text-xs text-slate-400 hover:text-red-600"
                          onClick={() => deletePreset(p.id)}
                          aria-label={`Удалить пресет ${p.name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={resetFilters}
            disabled={activeCount === 0}
          >
            Сбросить {activeCount > 0 && `(${activeCount})`}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Поиск по кампании…"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          className="input max-w-xs"
        />
        <div className="ml-2 flex items-center gap-2">
          <label className="label-muted">Сравнить с:</label>
          <select
            className="input max-w-[180px]"
            value={filters.compareWith ?? ''}
            onChange={(e) => setFilters({ compareWith: e.target.value || null })}
          >
            <option value="">— не сравнивать —</option>
            {options.months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
