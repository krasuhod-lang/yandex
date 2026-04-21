import { useMemo } from 'react'
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { aggregate, uniqueValues } from '@/lib/metrics'
import type { ParsedRow } from '@/types/dashboard'
import { ChartCard } from './ChartCard'
import { formatNumber } from '@/lib/formatters'

type Props = {
  rows: ParsedRow[]
}

/** Monthly time series: visits, leads (online+offline), НК (online+offline). */
export function VisitsLeadsNkLineChart({ rows }: Props): JSX.Element {
  const data = useMemo(() => {
    const months = uniqueValues(rows, 'month')
    return months.map((m) => {
      const agg = aggregate(rows.filter((r) => r.data.month === m))
      return {
        month: m,
        visits: agg.visits,
        leads: agg.onlineLeads + agg.offlineLeads,
        nk: agg.nkOnline + agg.nkOffline,
      }
    })
  }, [rows])

  return (
    <ChartCard
      title="Динамика по месяцам"
      description="Визиты, заявки (онлайн + офлайн) и НК"
      exportBase="months-line"
      isEmpty={data.length === 0}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(v: number) => formatNumber(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="visits"
            name="Визиты"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="leads"
            name="Заявки"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="nk"
            name="НК"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
