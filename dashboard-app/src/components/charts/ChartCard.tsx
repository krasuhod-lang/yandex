import { useRef, type ReactNode } from 'react'
import { downloadSvg, downloadSvgAsPng } from '@/lib/export'

type Props = {
  title: string
  description?: string
  /** Height of the chart area. */
  height?: number
  children: ReactNode
  /** Slug used for the exported file names. */
  exportBase?: string
  /** Extra actions (e.g. toggles) rendered to the left of export buttons. */
  actions?: ReactNode
  emptyHint?: string
  isEmpty?: boolean
}

/**
 * Standard chart card: title, description, PNG/SVG export buttons,
 * and fixed-height SVG container for recharts ResponsiveContainer.
 */
export function ChartCard({
  title,
  description,
  height = 320,
  children,
  exportBase,
  actions,
  emptyHint,
  isEmpty,
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  function findSvg(): SVGElement | null {
    const root = ref.current
    if (!root) return null
    return root.querySelector('svg') as SVGElement | null
  }

  async function handlePng(): Promise<void> {
    const svg = findSvg()
    if (!svg) return
    await downloadSvgAsPng(`${exportBase ?? 'chart'}.png`, svg)
  }

  function handleSvg(): void {
    const svg = findSvg()
    if (!svg) return
    downloadSvg(`${exportBase ?? 'chart'}.svg`, svg)
  }

  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {description && (
            <div className="text-xs text-slate-500">{description}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            className="btn-ghost !px-2 text-xs"
            onClick={handlePng}
            aria-label="Скачать как PNG"
            disabled={isEmpty}
          >
            PNG
          </button>
          <button
            type="button"
            className="btn-ghost !px-2 text-xs"
            onClick={handleSvg}
            aria-label="Скачать как SVG"
            disabled={isEmpty}
          >
            SVG
          </button>
        </div>
      </div>
      <div ref={ref} className="flex-1 px-2 pb-4" style={{ minHeight: height }}>
        {isEmpty ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">
            {emptyHint ?? 'Нет данных по выбранным условиям'}
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </div>
  )
}
