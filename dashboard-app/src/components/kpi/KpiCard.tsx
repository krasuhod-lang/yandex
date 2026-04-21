import { formatDelta, formatNumber, formatPercent } from '@/lib/formatters'
import type { KpiDefinition } from '@/types/dashboard'
import clsx from 'clsx'
import { LineChart, Line, ResponsiveContainer } from 'recharts'

export type KpiCardProps = {
  def: KpiDefinition
  value: number | null
  delta: number | null
  sparkline?: number[]
}

export function KpiCard({ def, value, delta, sparkline }: KpiCardProps): JSX.Element {
  const formatted = def.isRatio ? formatPercent(value) : formatNumber(value)
  const deltaStr = delta === null ? '' : formatDelta(delta)
  const deltaClass =
    delta === null
      ? 'text-slate-400'
      : delta >= 0
        ? 'text-emerald-600'
        : 'text-red-600'

  const sparkData = (sparkline ?? []).map((v, i) => ({ i, v }))

  return (
    <div className="card p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label-muted">{def.label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {formatted}
          </div>
          <div className={clsx('mt-0.5 text-xs tabular-nums', deltaClass)}>
            {delta === null ? <span className="text-slate-400">—</span> : `Δ ${deltaStr}`}
          </div>
        </div>
        {sparkData.length > 1 && (
          <div className="h-10 w-20 shrink-0">
            <ResponsiveContainer>
              <LineChart data={sparkData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-slate-500" title={def.description}>
        {def.description}
      </div>
    </div>
  )
}
