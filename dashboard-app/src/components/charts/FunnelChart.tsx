import { useMemo } from 'react'
import { aggregate } from '@/lib/metrics'
import type { ParsedRow } from '@/types/dashboard'
import { ChartCard } from './ChartCard'
import { formatNumber, formatPercent } from '@/lib/formatters'

type Stage = { label: string; value: number }

/**
 * Custom funnel chart (показы → клики → визиты → заявки → НК) rendered as
 * pure SVG so the PNG/SVG export in ChartCard works uniformly.
 */
export function FunnelChart({ rows }: { rows: ParsedRow[] }): JSX.Element {
  const stages = useMemo<Stage[]>(() => {
    const agg = aggregate(rows)
    return [
      { label: 'Показы', value: agg.impressions },
      { label: 'Клики', value: agg.clicks },
      { label: 'Визиты', value: agg.visits },
      { label: 'Заявки', value: agg.onlineLeads + agg.offlineLeads },
      { label: 'НК', value: agg.nkOnline + agg.nkOffline },
    ]
  }, [rows])

  const maxValue = Math.max(...stages.map((s) => s.value), 1)
  const WIDTH = 760
  const BAR_HEIGHT = 38
  const GAP = 36
  const LEFT_PAD = 140
  const RIGHT_PAD = 40
  const TOP_PAD = 10
  const innerWidth = WIDTH - LEFT_PAD - RIGHT_PAD
  const HEIGHT = stages.length * (BAR_HEIGHT + GAP) + TOP_PAD

  return (
    <ChartCard
      title="Воронка: Показы → Клики → Визиты → Заявки → НК"
      description="Переходы между этапами воронки по выбранной выборке"
      exportBase="funnel"
      height={HEIGHT + 10}
      isEmpty={maxValue <= 0}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label="Воронка показы → клики → визиты → заявки → НК"
      >
        {stages.map((s, i) => {
          const y = TOP_PAD + i * (BAR_HEIGHT + GAP)
          const barWidth = Math.max(4, (s.value / maxValue) * innerWidth)
          const prev = i > 0 ? stages[i - 1].value : 0
          const stageRate = i === 0 || prev === 0 ? null : s.value / prev
          const labelInside = barWidth > 120
          return (
            <g key={s.label}>
              <text
                x={LEFT_PAD - 10}
                y={y + BAR_HEIGHT / 2}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={12}
                fontWeight={500}
                fill="#334155"
              >
                {s.label}
              </text>
              <rect
                x={LEFT_PAD}
                y={y}
                width={innerWidth}
                height={BAR_HEIGHT}
                fill="#f1f5f9"
                rx={6}
              />
              <rect
                x={LEFT_PAD}
                y={y}
                width={barWidth}
                height={BAR_HEIGHT}
                fill="#2563eb"
                rx={6}
              />
              <text
                x={labelInside ? LEFT_PAD + barWidth - 8 : LEFT_PAD + barWidth + 8}
                y={y + BAR_HEIGHT / 2}
                textAnchor={labelInside ? 'end' : 'start'}
                dominantBaseline="central"
                fontSize={12}
                fontWeight={600}
                fill={labelInside ? '#fff' : '#0f172a'}
              >
                {formatNumber(s.value)}
              </text>
              {stageRate !== null && (
                <text
                  x={LEFT_PAD}
                  y={y + BAR_HEIGHT + 14}
                  fontSize={10}
                  fill="#94a3b8"
                >
                  Конверсия со стадии «{stages[i - 1].label}»: {formatPercent(stageRate)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </ChartCard>
  )
}
