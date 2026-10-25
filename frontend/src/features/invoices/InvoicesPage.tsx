import { Link } from 'react-router'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, LoadingState } from '@/components/ui/States'
import { Table, type Column } from '@/components/ui/Table'
import { formatDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useInvoicesQuery } from './queries'
import type { InvoiceListItem } from './schemas'

export function InvoicesPage() {
  const { data: invoices, isLoading } = useInvoicesQuery()

  const statusBadge = (commercialStatus: 'PENDING' | 'PARTIALLY_PAID' | 'PAID') => {
    switch (commercialStatus) {
      case 'PAID':
        return {
          label: 'Cobrada',
          classes: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        }
      case 'PARTIALLY_PAID':
        return {
          label: 'Cobrada en parte',
          classes: 'bg-blue-50 text-blue-800 border-blue-200',
        }
      default:
        return {
          label: 'Pendiente',
          classes: 'bg-amber-50 text-amber-800 border-amber-200',
        }
    }
  }

  const columns: Column<InvoiceListItem>[] = [
    {
      header: 'Comprobante',
      cell: (inv) => (
        <div>
          <span className="font-semibold text-slate-900">
            {inv.voucherNumber
              ? `${inv.voucherType.replace(/_/g, ' ')} #${String(inv.voucherNumber).padStart(8, '0')}`
              : `Factura #${inv.id}`}
          </span>
          {inv.cae && <span className="block text-xs text-slate-400">CAE: {inv.cae}</span>}
        </div>
      ),
    },
    {
      header: 'Receptor / Cliente',
      cell: (inv) => (
        <span className="font-medium text-slate-700">{inv.recipientName}</span>
      ),
    },
    {
      header: 'Fecha emisión',
      cell: (inv) => formatDate(inv.issueDate),
      hideOnMobile: true,
    },
    {
      header: 'Total Facturado',
      className: 'text-right font-medium text-slate-900',
      cell: (inv) => formatMoney(inv.totalAmount, inv.currency),
    },
    {
      header: 'Saldo Pendiente',
      className: 'text-right font-medium',
      cell: (inv) => (
        <span
          className={cn(
            inv.commercialStatus === 'PAID' ? 'text-slate-400' : 'font-semibold text-brand-700',
          )}
        >
          {formatMoney(inv.pendingBalance, inv.currency)}
        </span>
      ),
    },
    {
      header: 'Estado',
      cell: (inv) => {
        const badge = statusBadge(inv.commercialStatus)
        return (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
              badge.classes,
            )}
          >
            {badge.label}
          </span>
        )
      },
    },
    {
      header: 'Acciones',
      className: 'text-right',
      cell: (inv) => (
        <Link
          to={`/facturas/${inv.id}`}
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900"
        >
          {inv.commercialStatus === 'PAID' ? 'Ver cobros' : 'Cobrar / Ver'}
        </Link>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Facturas y Cobros"
        description="Consultá el estado de cobranza de tus facturas y registrá pagos parciales o totales."
        actions={
          <Link
            to="/facturas/nueva"
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            Nueva factura
          </Link>
        }
      />

      {isLoading ? (
        <LoadingState label="Cargando facturas..." />
      ) : !invoices || invoices.length === 0 ? (
        <EmptyState
          title="Sin facturas emitidas"
          description="Aún no tenés facturas registradas. Creá una con “Nueva factura”; cuando esté autorizada, vas a poder gestionar sus cobros desde acá."
        />
      ) : (
        <Table
          columns={columns}
          rows={invoices}
          rowKey={(inv) => inv.id}
          caption="Listado de facturas"
        />
      )}
    </div>
  )
}
