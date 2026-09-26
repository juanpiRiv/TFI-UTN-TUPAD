import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/Select'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { Table, type Column } from '@/components/ui/Table'
import { useOrganization } from '@/features/auth/queries'
import { useCategories } from '@/features/categories/queries'
import type { MovementType } from '@/features/categories/schemas'
import { useClients } from '@/features/clients/queries'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney, formatRate } from '@/lib/format'
import { useCreateTransaction, useTransactions } from './queries'
import type { Transaction, TransactionFilters } from './schemas'
import { TransactionForm } from './TransactionForm'

function readFilters(params: URLSearchParams): TransactionFilters {
  const type = params.get('type')
  const categoryId = Number(params.get('categoryId'))
  const clientId = Number(params.get('clientId'))
  return {
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    type: type === 'INCOME' || type === 'EXPENSE' ? (type as MovementType) : undefined,
    categoryId: categoryId > 0 ? categoryId : undefined,
    clientId: clientId > 0 ? clientId : undefined,
  }
}

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
    header: 'Cliente',
    hideOnMobile: true,
    cell: (tx) => tx.client?.name ?? '—',
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

export function TransactionsPage() {
  const organization = useOrganization()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const [creating, setCreating] = useState(false)

  const transactions = useTransactions(filters)
  const categories = useCategories({ includeInactive: true })
  const clients = useClients({ includeInactive: true })
  const createTransaction = useCreateTransaction()

  const setFilter = (key: keyof TransactionFilters, value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        // A category of the other type makes no sense once the type filter changes.
        if (key === 'type') next.delete('categoryId')
        return next
      },
      { replace: true },
    )
  }

  const filterCategories = (categories.data ?? []).filter(
    (category) => !filters.type || category.type === filters.type,
  )
  const selectedClient = clients.data?.find((client) => client.id === filters.clientId)
  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <>
      <PageHeader
        title="Movimientos"
        description="Ingresos y egresos cargados a mano."
        actions={<Button onClick={() => setCreating(true)}>Nuevo movimiento</Button>}
      />

      <section
        aria-label="Filtros"
        className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Input
          id="filter-from"
          label="Desde"
          type="date"
          value={filters.from ?? ''}
          onChange={(event) => setFilter('from', event.target.value)}
        />
        <Input
          id="filter-to"
          label="Hasta"
          type="date"
          value={filters.to ?? ''}
          onChange={(event) => setFilter('to', event.target.value)}
        />
        <Select
          id="filter-type"
          label="Tipo"
          placeholder="Todos"
          options={[
            { value: 'INCOME', label: 'Ingresos' },
            { value: 'EXPENSE', label: 'Egresos' },
          ]}
          value={filters.type ?? ''}
          onChange={(event) => setFilter('type', event.target.value)}
        />
        <Select
          id="filter-category"
          label="Categoría"
          placeholder="Todas"
          options={filterCategories.map((category) => ({
            value: String(category.id),
            label: category.name,
          }))}
          value={filters.categoryId ? String(filters.categoryId) : ''}
          onChange={(event) => setFilter('categoryId', event.target.value)}
        />
        {(selectedClient || hasFilters) && (
          <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-2 lg:col-span-4">
            {selectedClient && (
              <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">
                Cliente: {selectedClient.name}
              </span>
            )}
            {hasFilters && (
              <button
                type="button"
                className="text-slate-700 underline"
                onClick={() => setParams({}, { replace: true })}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </section>

      {transactions.isPending ? (
        <LoadingState />
      ) : transactions.isError ? (
        <ErrorState onRetry={() => void transactions.refetch()} />
      ) : transactions.data.length === 0 ? (
        <EmptyState
          title={
            hasFilters ? 'No hay movimientos con estos filtros' : 'Todavía no cargaste movimientos'
          }
          action={
            !hasFilters && <Button onClick={() => setCreating(true)}>Nuevo movimiento</Button>
          }
        />
      ) : (
        <Table
          caption="Movimientos"
          columns={columns}
          rows={transactions.data}
          rowKey={(tx) => tx.id}
        />
      )}

      <Modal open={creating} title="Nuevo movimiento" onClose={() => setCreating(false)}>
        {creating && (
          <TransactionForm
            baseCurrency={organization.baseCurrency}
            categories={categories.data ?? []}
            clients={(clients.data ?? []).filter((client) => client.isActive)}
            onSubmit={createTransaction.mutateAsync}
            onDone={() => setCreating(false)}
          />
        )}
      </Modal>
    </>
  )
}
