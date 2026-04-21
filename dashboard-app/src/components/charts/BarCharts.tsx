import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { aggregateBy } from '@/lib/metrics'
import type { ParsedRow } from '@/types/dashboard'
import { ChartCard } from './ChartCard'
import { formatNumber } from '@/lib/formatters'

type Props = {
  rows: ParsedRow[]
}

/** Grouped bar: visits vs leads per product. */
export function ProductsGroupedBarChart({ rows }: Props): JSX.Element {
  const data = useMemo(() => {
    return aggregateBy(rows, 'product').map((p) => ({
      product: p.group,
      visits: p.agg.visits,
      leads: p.agg.onlineLeads + p.agg.offlineLeads,
    }))
  }, [rows])

  return (
    <ChartCard
      title="Продукты: визиты и заявки"
      description="Сравнение продуктов по объёму трафика и числу заявок"
      exportBase="products-grouped"
      isEmpty={data.length === 0}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="product" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(v: number) => formatNumber(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="visits" name="Визиты" fill="#2563eb" isAnimationActive={false} />
          <Bar dataKey="leads" name="Заявки" fill="#10b981" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Stacked bar: online vs offline leads per product. */
export function LeadsStackedBarChart({ rows }: Props): JSX.Element {
  const data = useMemo(() => {
    return aggregateBy(rows, 'product').map((p) => ({
      product: p.group,
      onlineLeads: p.agg.onlineLeads,
      offlineLeads: p.agg.offlineLeads,
    }))
  }, [rows])

  return (
    <ChartCard
      title="Онлайн vs офлайн заявки"
      description="Заявки по продуктам в разрезе канала выдачи"
      exportBase="leads-stacked"
      isEmpty={data.length === 0}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 20, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="product" tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip formatter={(v: number) => formatNumber(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="onlineLeads"
            name="Заявки онлайн"
            stackId="leads"
            fill="#2563eb"
            isAnimationActive={false}
          />
          <Bar
            dataKey="offlineLeads"
            name="Заявки офлайн"
            stackId="leads"
            fill="#f59e0b"
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
