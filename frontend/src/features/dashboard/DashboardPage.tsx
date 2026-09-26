import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { currentMonthRange, formatDate, formatMoney, type Currency } from '@/lib/format'
import { CategoryChart } from './CategoryChart'
import { useDashboardSummary } from './queries'

function TotalCard({
  label,
  amount,
  currency,
  tone,
}: {
  label: string
  amount: string
  currency: Currency
  tone: 'income' | 'expense' | 'net'
}) {
  const negative = amount.startsWith('-')
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        data-testid={`total-${tone}`}
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'income' && 'text-income',
          tone === 'expense' && 'text-expense',
          tone === 'net' && (negative ? 'text-expense' : 'text-slate-900'),
        )}
      >
        {formatMoney(amount, currency)}
      </p>
    </div>
  )
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const period = useMemo(() => {
    const defaults = currentMonthRange()
    return { from: params.get('from') || defaults.from, to: params.get('to') || defaults.to }
  }, [params])
  const summary = useDashboardSummary(period)

  const setPeriod = (key: 'from' | 'to', value: string) => {
    if (!value) return
    setParams({ ...period, [key]: value }, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Resultado de caja del ${formatDate(period.from)} al ${formatDate(period.to)}.`}
      />
      <div className="mb-6 grid max-w-md grid-cols-2 gap-3">
        <Input
          id="period-from"
          label="Desde"
          type="date"
          value={period.from}
          max={period.to}
          onChange={(event) => setPeriod('from', event.target.value)}
        />
        <Input
          id="period-to"
          label="Hasta"
          type="date"
          value={period.to}
          min={period.from}
          onChange={(event) => setPeriod('to', event.target.value)}
        />
      </div>

      {summary.isPending ? (
        <LoadingState />
      ) : summary.isError ? (
        <ErrorState onRetry={() => void summary.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <TotalCard
              label="Ingresos"
              amount={summary.data.income}
              currency={summary.data.currency}
              tone="income"
            />
            <TotalCard
              label="Egresos"
              amount={summary.data.expense}
              currency={summary.data.currency}
              tone="expense"
            />
            <TotalCard
              label="Resultado"
              amount={summary.data.net}
              currency={summary.data.currency}
              tone="net"
            />
          </div>
          <p className="text-xs text-slate-500">
            Montos en {summary.data.currency}. Los movimientos en otra moneda se convierten con el
            tipo de cambio guardado en cada uno. El resultado de gestión (con lo facturado) se suma
            cuando esté el módulo de facturas.
          </p>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Por categoría</h2>
            {summary.data.byCategory.length === 0 ? (
              <EmptyState
                title="No hay movimientos en este período"
                action={
                  <Link to="/movimientos" className="font-medium text-brand-700 underline">
                    Cargar un movimiento
                  </Link>
                }
              />
            ) : (
              <CategoryChart data={summary.data.byCategory} currency={summary.data.currency} />
            )}
          </section>
        </div>
      )}
    </>
  )
}
