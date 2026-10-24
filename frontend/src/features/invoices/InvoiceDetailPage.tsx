import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState, LoadingState } from '@/components/ui/States'
import { Table, type Column } from '@/components/ui/Table'
import { formatDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiError } from '@/lib/api'
import { useAuthorizeInvoiceMutation, useInvoiceDetailQuery } from './queries'
import { PaymentForm } from './PaymentForm'
import type { PaymentItem } from './schemas'

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const invoiceId = Number(id)
  const { data: invoice, isLoading, error } = useInvoiceDetailQuery(invoiceId)
  const authorize = useAuthorizeInvoiceMutation(invoiceId)

  const handleAuthorize = () => {
    const ok = window.confirm(
      'Al facturar se pide la autorización (CAE) y se numera el comprobante. No se puede deshacer. ¿Continuar?',
    )
    if (ok) authorize.mutate()
  }
  const fiscal = authorize.data?.fiscal
  const authorizeError =
    authorize.error instanceof ApiError
      ? authorize.error.message
      : authorize.error
        ? 'Ocurrió un error inesperado. Probá de nuevo.'
        : null

  if (isLoading) {
    return <LoadingState label="Cargando información de la factura y sus cobros..." />
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-base font-medium text-slate-800">Factura no encontrada</p>
        <p className="mt-1 text-sm text-slate-500">
          La factura solicitada no existe o no pertenece a tu organización.
        </p>
        <Link
          to="/facturas"
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Volver a facturas
        </Link>
      </div>
    )
  }

  const voucherLabel = invoice.voucherNumber
    ? `${invoice.voucherType.replace(/_/g, ' ')} #${String(invoice.voucherNumber).padStart(8, '0')}`
    : `Factura #${invoice.invoiceId}`

  const statusBadge = () => {
    if (invoice.status === 'DRAFT') {
      return { label: 'Borrador', classes: 'bg-slate-100 text-slate-700 border-slate-300' }
    }
    switch (invoice.commercialStatus) {
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
          label: 'Pendiente de cobro',
          classes: 'bg-amber-50 text-amber-800 border-amber-200',
        }
    }
  }

  const badge = statusBadge()

  const paymentColumns: Column<PaymentItem>[] = [
    {
      header: 'Fecha',
      cell: (p) => formatDate(p.paymentDate),
    },
    {
      header: 'Movimiento en caja',
      cell: (p) => (
        <div>
          <span className="font-medium text-slate-800">
            {p.transaction?.description || `Movimiento #${p.transaction?.id ?? '-'}`}
          </span>
          <span className="block text-xs text-slate-400">Categoría: Cobro de facturas</span>
        </div>
      ),
    },
    {
      header: 'Importe',
      className: 'text-right font-medium text-emerald-700',
      cell: (p) => formatMoney(p.amount, p.currency),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Navegación y encabezado */}
      <div>
        <Link
          to="/facturas"
          className="mb-2 inline-flex items-center text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          ← Volver a Facturas
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{voucherLabel}</h1>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                  badge.classes,
                )}
              >
                {badge.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Cliente:{' '}
              <span className="font-medium text-slate-700">
                {invoice.recipientName || invoice.client?.name || 'Consumidor Final'}
              </span>
              {invoice.issueDate && ` • Emitida: ${formatDate(invoice.issueDate)}`}
              {invoice.cae && ` • CAE: ${invoice.cae}`}
            </p>
            {invoice.issuer && (
              <p className="mt-1 text-sm text-slate-500" data-testid="invoice-issuer">
                Emisor:{' '}
                <span className="font-medium text-slate-700">{invoice.issuer.legalName}</span>
                {` • CUIT ${invoice.issuer.cuit}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tarjetas resumen de saldo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Total Facturado
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {formatMoney(invoice.totalAmount, invoice.currency)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Total Cobrado
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">
            {formatMoney(invoice.totalPaid, invoice.currency)}
          </p>
        </div>

        <div
          className={cn(
            'rounded-xl border p-5 shadow-sm transition-colors',
            invoice.commercialStatus === 'PAID'
              ? 'border-emerald-200 bg-emerald-50/50'
              : 'border-brand-200 bg-brand-50/40',
          )}
        >
          <p
            className={cn(
              'text-xs font-medium uppercase tracking-wider',
              invoice.commercialStatus === 'PAID' ? 'text-emerald-700' : 'text-brand-700',
            )}
          >
            Saldo Pendiente
          </p>
          <p
            className={cn(
              'mt-2 text-2xl font-bold',
              invoice.commercialStatus === 'PAID' ? 'text-emerald-700' : 'text-brand-900',
            )}
          >
            {formatMoney(invoice.pendingBalance, invoice.currency)}
          </p>
        </div>
      </div>

      {authorizeError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {authorizeError}
        </p>
      )}
      {fiscal?.outcome === 'REJECTED' && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-semibold">ARCA rechazó la factura.</p>
          <ul className="mt-1 list-disc pl-5">
            {fiscal.errors.map((item) => (
              <li key={`${item.code}-${item.message}`}>
                {item.code}: {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {fiscal?.outcome === 'INDETERMINATE' && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ARCA no respondió. La factura quedó pendiente: no la vuelvas a emitir hasta confirmar qué pasó.
        </p>
      )}
      {(fiscal?.outcome === 'AUTHORIZED' || fiscal?.outcome === 'AUTHORIZED_WITH_OBSERVATIONS') && (
        <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="font-semibold">Factura autorizada. CAE: {authorize.data?.invoice.cae}</p>
          {fiscal.simulated && (
            <p className="mt-1">
              Comprobante de prueba, sin validez fiscal: lo generó el proveedor simulado.
            </p>
          )}
          {fiscal.observations.map((item) => (
            <p key={`${item.code}-${item.message}`} className="mt-1">
              Observación {item.code}: {item.message}
            </p>
          ))}
        </div>
      )}

      {/* Formulario integrado de pago (Criterio F6-8) */}
      {invoice.status === 'DRAFT' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <p className="text-base font-semibold text-slate-900">Esta factura es un borrador</p>
          <p className="mt-1 text-xs text-slate-500">
            Para poder cobrarla hay que facturarla: se pide la autorización (CAE) y se numera el comprobante.
          </p>
          <Button className="mt-4" onClick={handleAuthorize} loading={authorize.isPending}>
            Facturar
          </Button>
        </div>
      ) : invoice.status !== 'AUTHORIZED' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 text-center">
          <p className="text-base font-semibold text-amber-900">
            Factura no disponible para cobro
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Solo se pueden registrar cobros sobre facturas autorizadas por AFIP/ARCA (estado actual: {invoice.status}).
          </p>
        </div>
      ) : invoice.commercialStatus === 'PAID' || Number(invoice.pendingBalance) <= 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
          <p className="text-base font-semibold text-emerald-900">
            Factura totalmente saldada
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Todos los cobros de esta factura fueron registrados correctamente. Saldo pendiente: $ 0,00.
          </p>
        </div>
      ) : (
        <PaymentForm
          invoiceId={invoice.invoiceId}
          pendingBalance={invoice.pendingBalance}
          currency={invoice.currency}
          issueDate={invoice.issueDate}
        />
      )}

      {/* Historial de cobros */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Cobros registrados</h2>
        {invoice.payments.length === 0 ? (
          <EmptyState
            title="Sin cobros registrados"
            description="Esta factura todavía no tiene ningún cobro cargado. Podés registrar el primer pago con el formulario superior."
          />
        ) : (
          <Table
            columns={paymentColumns}
            rows={invoice.payments}
            rowKey={(p) => p.id}
            caption="Cobros de la factura"
          />
        )}
      </div>
    </div>
  )
}
