import { useDashboardStore } from '@/store/dashboardStore'
import { REQUIRED_HEADERS } from '@/config/columns'
import { Uploader } from './Uploader'

/**
 * Full-screen onboarding shown when no file is loaded. Offers upload, an
 * overview of required columns, and a one-click button that fetches the
 * bundled sample dataset (public/datank.xlsx).
 */
export function Onboarding(): JSX.Element {
  const loadFileFromUrl = useDashboardStore((s) => s.loadFileFromUrl)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="card p-6">
        <h1 className="text-xl font-semibold text-slate-900">Marketing Performance Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Загрузите Excel-файл с данными по трафику, конверсиям и рекламным кампаниям —
          дашборд автоматически построит KPI, графики и таблицу детализации. Никакие
          данные не уходят с вашего устройства: парсинг выполняется прямо в браузере.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">Загрузить свой файл</div>
          <div className="mt-1 text-xs text-slate-500">
            Перетащите .xlsx или .xls либо воспользуйтесь кнопкой.
          </div>
          <div className="mt-3">
            <Uploader />
          </div>
        </div>

        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-900">Попробовать на демо-данных</div>
          <div className="mt-1 text-xs text-slate-500">
            Встроенный пример <code>datank.xlsx</code>: 3 месяца, 5 продуктов, 2 источника.
          </div>
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() =>
              loadFileFromUrl('./datank.xlsx', { fileName: 'datank.xlsx (демо)' })
            }
          >
            Загрузить пример
          </button>
          <a
            href="./datank.xlsx"
            download
            className="ml-2 text-xs text-brand-600 hover:underline"
          >
            Скачать файл-образец
          </a>
        </div>
      </div>

      <div className="card p-4">
        <div className="text-sm font-semibold text-slate-900">Обязательные колонки файла</div>
        <div className="mt-1 text-xs text-slate-500">
          Заголовок — первая строка листа. Лист по умолчанию — <code>datank</code>.
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {REQUIRED_HEADERS.map((h) => (
            <span key={h} className="chip">
              {h}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Полное описание структуры и правил нормализации — в файле{' '}
          <code>docs/data-dictionary.md</code> репозитория.
        </p>
      </div>
    </div>
  )
}
