import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { Table, type Column } from '@/components/ui/Table'
import { useTransactions } from '@/features/transactions/queries'
import type { Transaction } from '@/features/transactions/schemas'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney, formatRate } from '@/lib/format'
import { useClient } from './queries'
import { docTypeLabels, taxConditionLabels } from './schemas'

const columns: Column<Transaction>[] = [
  {
    header: 'Fecha',
    className: 'whitespace-nowrap',
    cell: (tx) => formatDate(tx.transactionDate),
  },
  {
    header: 'Detalle',
    cell: (tx) => (
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{tx.category.name}</p>
        {tx.description && <p className="text-xs text-slate-500">{tx.description}</p>}
      </div>
    ),
  },
  {
    header: 'Tipo',
    cell: (tx) => (
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
          tx.type === 'INCOME'
            ? 'bg-emerald-50 text-emerald-800'
            : 'bg-rose-50 text-rose-800',
        )}
      >
        {tx.type === 'INCOME' ? 'Ingreso' : 'Egreso'}
      </span>
    ),
  },
  {
    header: 'Importe',
    className: 'text-right whitespace-nowrap',
    cell: (tx) => (
      <span className={cn('font-medium', tx.type === 'INCOME' ? 'text-income' : 'text-expense')}>
        {tx.type === 'INCOME' ? '+' : '−'} {formatMoney(tx.amount, tx.currency)}
      </span>
    ),
  },
  {
    header: 'Tipo de cambio',
    hideOnMobile: true,
    className: 'text-right',
    cell: (tx) => (tx.exchangeRate ? formatRate(tx.exchangeRate) : '—'),
  },
]

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const clientId = Number(id)

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return (
      <div className="py-6">
        <div className="mb-2">
          <Link
            to="/clientes"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline"
          >
            ← Volver a clientes
          </Link>
        </div>
        <ErrorState message="Cliente inválido" />
      </div>
    )
  }

  return <ClientDetailContent clientId={clientId} />
}

function ClientDetailContent({ clientId }: { clientId: number }) {
  const [params, setParams] = useSearchParams()

  const from = params.get('from') || ''
  const to = params.get('to') || ''

  const client = useClient(clientId)
  const transactions = useTransactions(
    useMemo(
      () => ({
        clientId,
        from: from || undefined,
        to: to || undefined,
      }),
      [clientId, from, to],
    ),
  )

  const setDateFilter = (key: 'from' | 'to', value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  const clearFilters = () => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('from')
        next.delete('to')
        return next
      },
      { replace: true },
    )
  }

  const hasDateFilters = Boolean(from || to)

  if (client.isPending) return <LoadingState />
  if (client.isError || !client.data) {
    return (
      <ErrorState
        message="No se pudo cargar el cliente. Verificá que exista y pertenezca a tu organización."
        onRetry={() => void client.refetch()}
      />
    )
  }

  const currentClient = client.data

  return (
    <>
      <div className="mb-2">
        <Link
          to="/clientes"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 underline"
        >
          ← Volver a clientes
        </Link>
      </div>

      <PageHeader
        title={currentClient.name}
        description={`Historial de operaciones y datos comerciales de ${currentClient.name}.`}
        actions={
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium',
              currentClient.isActive
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-slate-100 text-slate-600',
            )}
          >
            {currentClient.isActive ? 'Cliente Activo' : 'Cliente Inactivo (de baja)'}
          </span>
        }
      />

      <div className="mb-6 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Documento</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {currentClient.docType
              ? `${docTypeLabels[currentClient.docType]} ${currentClient.docNumber ?? ''}`
              : 'Sin identificar'}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Condición IVA</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {currentClient.taxCondition
              ? taxConditionLabels[currentClient.taxCondition]
              : 'Sin especificar'}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Contacto</p>
          <p className="mt-1 text-sm text-slate-900">
            {currentClient.email && <span className="block truncate">{currentClient.email}</span>}
            {currentClient.phone && <span className="block">{currentClient.phone}</span>}
            {!currentClient.email && !currentClient.phone && (
              <span className="text-slate-400">—</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Dirección</p>
          <p className="mt-1 text-sm text-slate-900">
            {currentClient.address || <span className="text-slate-400">—</span>}
          </p>
        </div>
      </div>

      <section aria-labelledby="historial-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="historial-title" className="text-lg font-semibold text-slate-900">
            Historial de movimientos
          </h2>
          <Link to={`/movimientos?clientId=${currentClient.id}`}>
            <Button variant="secondary">Ver movimientos</Button>
          </Link>
        </div>

        <div className="grid max-w-md grid-cols-2 gap-3">
          <Input
            id="filter-client-from"
            label="Desde"
            type="date"
            value={from}
            onChange={(e) => setDateFilter('from', e.target.value)}
          />
          <Input
            id="filter-client-to"
            label="Hasta"
            type="date"
            value={to}
            onChange={(e) => setDateFilter('to', e.target.value)}
          />
        </div>

        {hasDateFilters && (
          <div>
            <button
              type="button"
              className="text-sm text-slate-700 underline"
              onClick={clearFilters}
            >
              Limpiar filtros de fecha
            </button>
          </div>
        )}

        {transactions.isPending ? (
          <LoadingState />
        ) : transactions.isError ? (
          <ErrorState onRetry={() => void transactions.refetch()} />
        ) : transactions.data.length === 0 ? (
          <EmptyState
            title={
              hasDateFilters
                ? 'No hay movimientos en este rango de fechas'
                : 'Todavía no hay movimientos asociados a este cliente'
            }
          />
        ) : (
          <Table
            caption={`Movimientos de ${currentClient.name}`}
            columns={columns}
            rows={transactions.data}
            rowKey={(tx) => tx.id}
          />
        )}
      </section>
    </>
  )
}
