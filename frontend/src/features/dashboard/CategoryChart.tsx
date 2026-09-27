import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, type Currency } from '@/lib/format'
import type { DashboardSummary } from './schemas'

const COLORS = { INCOME: 'var(--color-income)', EXPENSE: 'var(--color-expense)' }

/**
 * Totals per category. Recharts needs numbers to size the bars, so the string is parsed only
 * to draw; labels and tooltips always show the exact string from the API.
 */
export function CategoryChart({
  data,
  currency,
}: {
  data: DashboardSummary['byCategory']
  currency: Currency
}) {
  const rows = data.map((item) => ({ ...item, value: Number(item.total) }))

  return (
    <BarChart
      responsive
      data={rows}
      layout="vertical"
      margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      style={{ width: '100%', height: Math.max(160, rows.length * 44) }}
    >
      <CartesianGrid horizontal={false} stroke="#e2e8f0" />
      <XAxis type="number" hide />
      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
      <Tooltip
        formatter={(_value, _name, entry) =>
          formatMoney((entry.payload as { total: string }).total, currency)
        }
        labelStyle={{ fontWeight: 600 }}
      />
      <Bar dataKey="value" name="Total" radius={[0, 4, 4, 0]}>
        {rows.map((row) => (
          <Cell key={row.categoryId} fill={COLORS[row.type]} />
        ))}
      </Bar>
    </BarChart>
  )
}
