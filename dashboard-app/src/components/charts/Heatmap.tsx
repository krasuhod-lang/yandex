import { useMemo, useState } from 'react'
import { aggregate, pickMetric, uniqueValues } from '@/lib/metrics'
import type { ParsedRow } from '@/types/dashboard'
import { ChartCard } from './ChartCard'
import { formatPercent } from '@/lib/formatters'

type HeatMetric = 'crOnline' | 'crOffline' | 'arOnline' | 'arOffline'

const METRIC_LABELS: Record<HeatMetric, string> = {
  crOnline: 'CR онлайн',
  crOffline: 'CR офлайн',
  arOnline: 'AR онлайн',
  arOffline: 'AR офлайн',
}

/**
 * Heatmap: product × trafficSource, colored by the chosen ratio metric.
 * Rendered as pure SVG to support PNG/SVG export. Cells additionally
 * display the numeric value so colour is not the only carrier of meaning.
 */
export function ProductSourceHeatmap({ rows }: { rows: ParsedRow[] }): JSX.Element {
  const [metric, setMetric] = useState<HeatMetric>('crOnline')

  const { products, sources, matrix, max, min } = useMemo(() => {
    const products = uniqueValues(rows, 'product')
    const sources = uniqueValues(rows, 'trafficSource')
    const matrix = new Map<string, number | null>()
    let max = 0
    let min = Infinity
    for (const p of products) {
      for (const s of sources) {
        const slice = rows.filter((r) => r.data.product === p && r.data.trafficSource === s)
        const v = slice.length === 0 ? null : pickMetric(aggregate(slice), metric)
        matrix.set(`${p}§${s}`, v)
        if (v !== null && Number.isFinite(v)) {
          if (v > max) max = v
          if (v < min) min = v
        }
      }
    }
    if (min === Infinity) min = 0
    return { products, sources, matrix, max, min }
  }, [rows, metric])

  const WIDTH = 760
  const CELL_H = 44
  const LEFT = 160
  const TOP = 40
  const BOTTOM_PAD = 10
  const innerWidth = WIDTH - LEFT - 20
  const cellW = sources.length > 0 ? innerWidth / sources.length : 0
  const HEIGHT = TOP + products.length * CELL_H + BOTTOM_PAD

  function colorFor(v: number | null): string {
    if (v === null) return '#f1f5f9'
    if (max === min) return '#c7d2fe'
    const t = (v - min) / (max - min)
    // Interpolate from light-blue to brand-blue.
    const r = Math.round(239 + (37 - 239) * t)
    const g = Math.round(246 + (99 - 246) * t)
    const b = Math.round(255 + (235 - 255) * t)
    return `rgb(${r},${g},${b})`
  }

  return (
    <ChartCard
      title="Heatmap: продукт × источник"
      description={`Цвет и число показывают ${METRIC_LABELS[metric].toLowerCase()}`}
      exportBase={`heatmap-${metric}`}
      height={HEIGHT + 20}
      isEmpty={products.length === 0 || sources.length === 0}
      actions={
        <select
          className="input !w-auto !py-1 !text-xs"
          value={metric}
          onChange={(e) => setMetric(e.target.value as HeatMetric)}
          aria-label="Метрика heatmap"
        >
          {(Object.keys(METRIC_LABELS) as HeatMetric[]).map((k) => (
            <option key={k} value={k}>
              {METRIC_LABELS[k]}
            </option>
          ))}
        </select>
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={`Heatmap ${METRIC_LABELS[metric]}`}
      >
        {sources.map((s, c) => (
          <text
            key={s}
            x={LEFT + c * cellW + cellW / 2}
            y={TOP - 12}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="#334155"
          >
            {s}
          </text>
        ))}
        {products.map((p, r) => (
          <g key={p}>
            <text
              x={LEFT - 8}
              y={TOP + r * CELL_H + CELL_H / 2}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={11}
              fill="#334155"
            >
              {p}
            </text>
            {sources.map((s, c) => {
              const v = matrix.get(`${p}§${s}`) ?? null
              return (
                <g key={`${p}-${s}`}>
                  <rect
                    x={LEFT + c * cellW + 2}
                    y={TOP + r * CELL_H + 2}
                    width={cellW - 4}
                    height={CELL_H - 4}
                    fill={colorFor(v)}
                    rx={4}
                    stroke="#e2e8f0"
                  />
                  <text
                    x={LEFT + c * cellW + cellW / 2}
                    y={TOP + r * CELL_H + CELL_H / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={11}
                    fontWeight={500}
                    fill="#0f172a"
                  >
                    {formatPercent(v)}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </ChartCard>
  )
}
