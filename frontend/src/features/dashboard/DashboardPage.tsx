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
  testId,
  hint,
}: {
  label: string
  amount: string
  currency: Currency
  tone: 'income' | 'expense' | 'net' | 'invoiced' | 'collected' | 'pending'
  testId?: string
  hint?: string
}) {
  const negative = amount.startsWith('-')
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p
        data-testid={testId ?? `total-${tone}`}
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'income' && 'text-income',
          tone === 'expense' && 'text-expense',
          tone === 'net' && (negative ? 'text-expense' : 'text-slate-900'),
          tone === 'invoiced' && 'text-brand-700',
          tone === 'collected' && 'text-emerald-700',
          tone === 'pending' && (Number(amount) > 0 ? 'text-amber-700' : 'text-slate-900'),
        )}
      >
        {formatMoney(amount, currency)}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
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
        description={`Resumen financiero y de facturación del ${formatDate(period.from)} al ${formatDate(period.to)}.`}
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
          {/* Bloque 1: Facturación vs Cobro (RF-33 / Issue #53) */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Facturación vs. Cobranza</h2>
                <p className="text-xs text-slate-500">
                  Diferenciación entre lo facturado fiscalmente y lo efectivamente cobrado en el período (RF-33).
                </p>
              </div>
              <Link
                to="/facturas"
                className="text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
              >
                Gestionar facturas →
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TotalCard
                label="Total Facturado"
                amount={summary.data.invoiced}
                currency={summary.data.currency}
                tone="invoiced"
                testId="total-invoiced"
                hint="Comprobantes autorizados emitidos en el período"
              />
              <TotalCard
                label="Total Cobrado"
                amount={summary.data.collected}
                currency={summary.data.currency}
                tone="collected"
                testId="total-collected"
                hint="Pagos registrados imputados a facturas"
              />
              <TotalCard
                label="Pendiente de cobro"
                amount={
                  summary.data.difference ??
                  String(
                    (
                      Number(summary.data.invoiced || 0) - Number(summary.data.collected || 0)
                    ).toFixed(2),
                  )
                }
                currency={summary.data.currency}
                tone="pending"
                testId="total-difference"
                hint="Diferencia a cobrar de lo facturado en el período"
              />
            </div>
          </div>

          {/* Bloque 2: Caja y Movimientos */}
          <div>
            <h2 className="mb-3 text-base font-semibold text-slate-900">Resultado de Caja (Flujo Real)</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <TotalCard
                label="Ingresos en Caja"
                amount={summary.data.income}
                currency={summary.data.currency}
                tone="income"
                hint="Cobros de facturas e ingresos directos"
              />
              <TotalCard
                label="Egresos en Caja"
                amount={summary.data.expense}
                currency={summary.data.currency}
                tone="expense"
                hint="Gastos y pagos del período"
              />
              <TotalCard
                label="Resultado Neto de Caja"
                amount={summary.data.net}
                currency={summary.data.currency}
                tone="net"
                hint={
                  summary.data.managementResult
                    ? `Resultado de gestión: ${formatMoney(summary.data.managementResult, summary.data.currency)}`
                    : undefined
                }
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Montos expresados en {summary.data.currency}. Los movimientos y comprobantes en otra moneda se convierten con el
            tipo de cambio registrado en cada operación.
          </p>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-semibold text-slate-900">Por categoría</h2>
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
