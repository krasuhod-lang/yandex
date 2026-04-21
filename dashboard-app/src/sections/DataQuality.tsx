import { useMemo } from 'react'
import { useDashboardStore } from '@/store/dashboardStore'
import { detectDuplicates } from '@/lib/validators'
import { COLUMN_DEFS } from '@/config/columns'
import { downloadCsv } from '@/lib/export'

export function DataQuality(): JSX.Element {
  const parseResult = useDashboardStore((s) => s.parseResult)

  const { warnings, duplicates, aggregateRows, missingByField } = useMemo(() => {
    const rows = parseResult?.rows ?? []
    const warnings = rows.filter((r) => r.meta.warnings.length > 0)
    const duplicates = detectDuplicates(rows)
    const aggregateRows = rows.filter((r) => r.meta.isAggregate)
    const missingByField = new Map<string, number>()
    for (const def of COLUMN_DEFS) {
      let count = 0
      for (const r of rows) if (r.meta.isMissing[def.field]) count++
      if (count > 0) missingByField.set(def.header, count)
    }
    return { warnings, duplicates, aggregateRows, missingByField }
  }, [parseResult])

  if (!parseResult) {
    return <div className="p-6 text-sm text-slate-500">Файл не загружен.</div>
  }

  function exportIssues(): void {
    const rows: (string | number)[][] = [
      ['Тип', 'Строка', 'Поле/Поля', 'Сообщение'],
    ]
    for (const w of warnings) {
      for (const msg of w.meta.warnings) {
        rows.push([
          'warning',
          w.meta.sourceRow,
          `${w.data.month}/${w.data.product}/${w.data.campaignName}`,
          msg,
        ])
      }
    }
    for (const d of duplicates) {
      rows.push(['duplicate', d.rows.map((r) => r.meta.sourceRow).join(','), d.key, 'Дубликат ключа'])
    }
    for (const [field, count] of missingByField) {
      rows.push(['missing', '', field, `Пропущено значений: ${count}`])
    }
    downloadCsv('data-quality.csv', rows)
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {parseResult.missingColumns.length > 0 && (
        <div className="card border-red-200 bg-red-50 p-4">
          <div className="text-sm font-semibold text-red-800">
            Отсутствуют обязательные колонки
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {parseResult.missingColumns.map((c) => (
              <li key={c}>«{c}»</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-600">
            Переименуйте заголовки в Excel в соответствии с data-dictionary.md и загрузите файл заново.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Качество данных</div>
          <div className="text-xs text-slate-500">
            Проверки, применённые при импорте файла «{parseResult.fileName}»
          </div>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={exportIssues}>
          Экспорт отчёта CSV
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard title="Всего строк" value={parseResult.rows.length} />
        <StatCard
          title="Строк «Итого…»"
          value={aggregateRows.length}
          hint="Исключаются из KPI"
        />
        <StatCard
          title="Строк с предупреждениями"
          value={warnings.length}
          tone={warnings.length > 0 ? 'warn' : 'ok'}
        />
        <StatCard
          title="Дубликатов ключа"
          value={duplicates.length}
          tone={duplicates.length > 0 ? 'warn' : 'ok'}
        />
      </div>

      {missingByField.size > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">Пропуски по колонкам</div>
          <table className="mt-2 min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1">Колонка</th>
                <th className="py-1">Пропусков</th>
              </tr>
            </thead>
            <tbody>
              {[...missingByField.entries()].map(([h, c]) => (
                <tr key={h} className="border-t border-slate-100">
                  <td className="py-1.5">{h}</td>
                  <td className="py-1.5 tabular-nums">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">
            Строки с предупреждениями
          </div>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-3">Строка</th>
                  <th className="py-1 pr-3">Месяц</th>
                  <th className="py-1 pr-3">Продукт</th>
                  <th className="py-1 pr-3">Кампания</th>
                  <th className="py-1">Предупреждения</th>
                </tr>
              </thead>
              <tbody>
                {warnings.slice(0, 200).map((w) => (
                  <tr key={w.meta.sourceRow} className="border-t border-slate-100">
                    <td className="py-1 pr-3 tabular-nums">{w.meta.sourceRow}</td>
                    <td className="py-1 pr-3">{w.data.month}</td>
                    <td className="py-1 pr-3">{w.data.product}</td>
                    <td className="py-1 pr-3 max-w-[320px] truncate">{w.data.campaignName}</td>
                    <td className="py-1 text-amber-700">{w.meta.warnings.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {warnings.length > 200 && (
              <div className="mt-2 text-xs text-slate-400">
                Показаны первые 200 из {warnings.length} строк. Выгрузите CSV для полного отчёта.
              </div>
            )}
          </div>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">Дубликаты ключа</div>
          <div className="mt-1 text-xs text-slate-500">
            Комбинации месяц + продукт + источник + кампания, встречающиеся более одного раза.
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
            {duplicates.slice(0, 20).map((d) => (
              <li key={d.key}>
                <span className="font-mono">{d.key.replace(/§/g, ' / ')}</span>{' '}
                — строки {d.rows.map((r) => r.meta.sourceRow).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatCard({
  title,
  value,
  hint,
  tone = 'neutral',
}: {
  title: string
  value: number
  hint?: string
  tone?: 'ok' | 'warn' | 'neutral'
}): JSX.Element {
  const color =
    tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-slate-900'
  return (
    <div className="card p-4">
      <div className="label-muted">{title}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}
