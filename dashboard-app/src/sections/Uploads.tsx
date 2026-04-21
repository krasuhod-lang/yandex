import { useDashboardStore } from '@/store/dashboardStore'
import { Uploader } from '@/components/upload/Uploader'
import { formatDate } from '@/lib/formatters'
import { COLUMN_DEFS } from '@/config/columns'

export function Uploads(): JSX.Element {
  const parseResult = useDashboardStore((s) => s.parseResult)
  const parseError = useDashboardStore((s) => s.parseError)
  const history = useDashboardStore((s) => s.history)

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-lg font-semibold text-slate-900">Загрузка файла</div>
        <div className="text-xs text-slate-500">
          Парсинг выполняется в браузере: файл не отправляется на сервер.
        </div>
      </div>

      <Uploader />

      {parseError && (
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">Ошибка импорта</div>
          <div className="mt-1 text-xs">{parseError}</div>
          {parseResult && parseResult.missingColumns.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold">Отсутствующие колонки:</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {parseResult.missingColumns.map((c) => (
                  <li key={c}>«{c}»</li>
                ))}
              </ul>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-red-700 underline">
                  Показать список всех обязательных колонок
                </summary>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {COLUMN_DEFS.map((d) => (
                    <span key={d.field} className="chip">
                      {d.header}
                    </span>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      )}

      {parseResult && !parseError && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">Превью загруженных данных</div>
          <div className="mt-1 text-xs text-slate-500">
            Первые 20 строк активного файла «{parseResult.fileName}», лист «{parseResult.sheetName}».
          </div>
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {COLUMN_DEFS.map((d) => (
                    <th
                      key={d.field}
                      className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600"
                    >
                      {d.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parseResult.rows.slice(0, 20).map((r) => (
                  <tr key={r.meta.sourceRow} className="border-b border-slate-100">
                    {COLUMN_DEFS.map((d) => {
                      const v = r.data[d.field]
                      return (
                        <td
                          key={d.field}
                          className="px-2 py-1 text-slate-700"
                        >
                          {typeof v === 'number' ? v : String(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parseResult.sheetNames.length > 1 && (
            <div className="mt-3 text-xs text-slate-500">
              Доступные листы в файле: {parseResult.sheetNames.map((s) => `«${s}»`).join(', ')}.
              Повторная загрузка другого листа — через кнопку «Загрузить Excel» выше (выбор листа поддержан в следующей итерации).
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">История загрузок</div>
          <ul className="mt-2 space-y-1">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate">
                  📄 <span className="font-medium">{h.fileName}</span> ·{' '}
                  <span className="text-slate-500">лист «{h.sheetName}», {h.rowCount} строк</span>
                </span>
                <span className="text-slate-400">{formatDate(h.uploadedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
