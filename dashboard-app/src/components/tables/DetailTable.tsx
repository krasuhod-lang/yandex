import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef as TanColumnDef,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import type { DashboardRow, ParsedRow } from '@/types/dashboard'
import { formatNumber, formatPercent } from '@/lib/formatters'
import { downloadCsv } from '@/lib/export'
import { COLUMN_DEFS } from '@/config/columns'
import clsx from 'clsx'

type Props = {
  rows: ParsedRow[]
  /** Include "Итого ..." rows in the display. Default false. */
  includeAggregates?: boolean
}

/**
 * Detail table with sorting, search (by campaign), CSV export, and a
 * toggle that surfaces "Итого ..." aggregate rows.
 */
export function DetailTable({ rows, includeAggregates = false }: Props): JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [showAgg, setShowAgg] = useState(includeAggregates)
  const [query, setQuery] = useState('')

  const tableRows = useMemo<DashboardRow[]>(() => {
    const filtered = showAgg ? rows : rows.filter((r) => !r.meta.isAggregate)
    const q = query.trim().toLowerCase()
    const searched = q
      ? filtered.filter((r) =>
          r.data.campaignName.toLowerCase().includes(q) ||
          r.data.product.toLowerCase().includes(q),
        )
      : filtered
    return searched.map((r) => r.data)
  }, [rows, showAgg, query])

  const columns = useMemo<TanColumnDef<DashboardRow>[]>(
    () =>
      COLUMN_DEFS.map((def) => ({
        accessorKey: def.field,
        header: def.header,
        cell: ({ getValue }) => {
          const v = getValue()
          if (def.kind === 'string') return <span>{v as string}</span>
          if (def.kind === 'ratio') {
            return <span className="tabular-nums">{formatPercent(v as number)}</span>
          }
          return <span className="tabular-nums">{formatNumber(v as number)}</span>
        },
      })),
    [],
  )

  const table = useReactTable({
    data: tableRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  function handleExport(): void {
    const header = COLUMN_DEFS.map((c) => c.header)
    const body = tableRows.map((row) =>
      COLUMN_DEFS.map((def) => {
        const v = row[def.field]
        if (def.kind === 'string') return String(v)
        if (def.kind === 'ratio') return Number.isFinite(v as number) ? (v as number).toFixed(4) : ''
        return Number.isFinite(v as number) ? String(v) : ''
      }),
    )
    downloadCsv(
      `marketing-dashboard-${new Date().toISOString().slice(0, 10)}.csv`,
      [header, ...body],
    )
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            Таблица детализации
          </div>
          <div className="text-xs text-slate-500">
            {tableRows.length} строк{showAgg ? ' (включая Итого)' : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Поиск…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input !w-52"
          />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand-600"
              checked={showAgg}
              onChange={(e) => setShowAgg(e.target.checked)}
            />
            Показать «Итого…»
          </label>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={handleExport}
            disabled={tableRows.length === 0}
          >
            Экспорт CSV
          </button>
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-slate-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted()
                  return (
                    <th
                      key={h.id}
                      className="cursor-pointer select-none border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-100"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-sm text-slate-400"
                >
                  Нет данных
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={clsx('border-b border-slate-100', i % 2 === 1 && 'bg-slate-50/40')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-1.5 text-slate-800">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
