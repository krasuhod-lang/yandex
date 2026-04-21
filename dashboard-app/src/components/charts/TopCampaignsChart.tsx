import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from 'recharts'
import { aggregateBy, pickMetric } from '@/lib/metrics'
import type { MetricKey, ParsedRow } from '@/types/dashboard'
import { ChartCard } from './ChartCard'
import { formatNumber, formatPercent } from '@/lib/formatters'

type SortMetric = Extract<MetricKey, 'visits' | 'crOnline' | 'arOnline'>

const METRIC_LABELS: Record<SortMetric, string> = {
  visits: 'Визиты',
  crOnline: 'CR онлайн',
  arOnline: 'AR онлайн',
}

const IS_RATIO: Record<SortMetric, boolean> = {
  visits: false,
  crOnline: true,
  arOnline: true,
}

type Props = {
  rows: ParsedRow[]
  /** Upper limit for bars shown. */
  topN?: number
}

/**
 * Horizontal bar: top campaigns by the selected metric.
 * Metric can be toggled between Visits / CR online / AR online.
 */
export function TopCampaignsHorizontalBarChart({ rows, topN = 10 }: Props): JSX.Element {
  const [metric, setMetric] = useState<SortMetric>('visits')

  const data = useMemo(() => {
    const aggs = aggregateBy(rows, 'campaignName')
    return aggs
      .map((a) => ({
        campaign: a.group,
        value: pickMetric(a.agg, metric) ?? 0,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, topN)
      // Recharts renders first-on-top; reverse to make the largest bar at the top visually.
      .reverse()
  }, [rows, metric, topN])

  const isRatio = IS_RATIO[metric]
  const fmt = (v: number) => (isRatio ? formatPercent(v) : formatNumber(v))

  return (
    <ChartCard
      title={`Топ кампаний: ${METRIC_LABELS[metric]}`}
      description={`Первые ${topN} кампаний по ${METRIC_LABELS[metric].toLowerCase()}`}
      exportBase={`top-campaigns-${metric}`}
      height={Math.max(320, data.length * 26 + 60)}
      isEmpty={data.length === 0}
      actions={
        <select
          className="input !w-auto !py-1 !text-xs"
          value={metric}
          onChange={(e) => setMetric(e.target.value as SortMetric)}
          aria-label="Метрика"
        >
          {(Object.keys(METRIC_LABELS) as SortMetric[]).map((k) => (
            <option key={k} value={k}>
              {METRIC_LABELS[k]}
            </option>
          ))}
        </select>
      }
    >
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 60, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={fmt}
          />
          <YAxis
            type="category"
            dataKey="campaign"
            tick={{ fontSize: 10, fill: '#334155' }}
            width={200}
            interval={0}
          />
          <Tooltip formatter={(v: number) => fmt(v)} />
          <Bar dataKey="value" fill="#2563eb" isAnimationActive={false}>
            <LabelList dataKey="value" position="right" formatter={fmt} style={{ fontSize: 10 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
