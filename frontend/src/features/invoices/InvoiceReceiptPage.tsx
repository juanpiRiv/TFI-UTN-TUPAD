import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { docTypeLabels, taxConditionLabels } from '@/features/clients/schemas'
import type { DocType } from '@/features/clients/schemas'
import type { TaxCondition } from '@/features/organizations/types'
import { formatDate, formatMoney } from '@/lib/format'
import { useInvoiceDetailQuery } from './queries'
import { invoiceConceptLabels, type InvoiceConcept } from './schemas'

const voucherNames: Record<string, { name: string; code: string }> = {
  FACTURA_C: { name: 'Factura C', code: '011' },
  NOTA_DEBITO_C: { name: 'Nota de débito C', code: '012' },
  NOTA_CREDITO_C: { name: 'Nota de crédito C', code: '013' },
}

const pad = (value: number | null | undefined, size: number) => String(value ?? 0).padStart(size, '0')
const formatQuantity = (value: string) => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 3 })

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm">
      <span className="text-slate-500">{label}: </span>
      <span className="font-medium text-slate-900">{children}</span>
    </p>
  )
}

/** Comprobante de una factura, pensado para imprimirlo o guardarlo como PDF desde el navegador. */
export function InvoiceReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const invoiceId = Number(id)
  const { data: invoice, isLoading, error } = useInvoiceDetailQuery(invoiceId)

  if (isLoading) return <LoadingState label="Armando el comprobante..." />
  if (error || !invoice) {
    return (
      <div className="space-y-3">
        <ErrorState message="No encontramos esa factura o no pertenece a tu organización." />
        <Link to="/facturas" className="text-sm text-slate-600 underline">
          Volver a facturas
        </Link>
      </div>
    )
  }

  const voucher = voucherNames[invoice.voucherType] ?? { name: invoice.voucherType, code: '' }
  const isDraft = invoice.status === 'DRAFT'
  const issuer = invoice.issuer
  const recipient = invoice.recipient
  const number = invoice.voucherNumber ? `${pad(invoice.pointOfSale, 4)}-${pad(invoice.voucherNumber, 8)}` : null
  const withServices = invoice.concept && invoice.concept !== 'PRODUCTOS'
  const items = invoice.items ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <div data-print="hide" className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/facturas/${invoice.invoiceId}`} className="text-sm text-slate-600 underline">
          Volver a la factura
        </Link>
        <Button onClick={() => window.print()}>Imprimir o guardar como PDF</Button>
      </div>

      <article data-testid="receipt" className="rounded-lg border border-slate-300 bg-white p-6 print:rounded-none print:border-0 print:p-0">
        {isDraft && (
          <p data-testid="receipt-draft" className="mb-4 rounded border border-slate-400 bg-slate-100 px-3 py-2 text-center text-sm font-semibold uppercase tracking-wide text-slate-700">
            Borrador: todavía no se facturó y no tiene validez
          </p>
        )}
        {invoice.simulated && !isDraft && (
          <p data-testid="receipt-simulated" className="mb-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-center text-sm font-semibold text-amber-900">
            Comprobante de prueba, sin validez fiscal
          </p>
        )}

        <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-4 border-b border-slate-300 pb-4">
          <div>
            <p className="text-lg font-semibold text-slate-900">{issuer?.legalName ?? 'Emisor'}</p>
            {issuer ? (
              <div className="mt-1 space-y-0.5 text-sm text-slate-600">
                {issuer.tradeName && <p>{issuer.tradeName}</p>}
                {issuer.address && <p>{issuer.address}</p>}
                <p>CUIT {issuer.cuit}</p>
                <p>{taxConditionLabels[issuer.taxCondition as TaxCondition] ?? issuer.taxCondition}</p>
                {issuer.grossIncomeNumber && <p>Ingresos brutos: {issuer.grossIncomeNumber}</p>}
                {issuer.activityStartDate && <p>Inicio de actividades: {formatDate(issuer.activityStartDate)}</p>}
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Los datos del emisor se completan al facturar.</p>
            )}
          </div>
          <div className="text-center">
            <p className="mx-auto flex size-14 items-center justify-center rounded border-2 border-slate-900 text-3xl font-bold">C</p>
            {voucher.code && <p className="mt-1 text-xs text-slate-500">Cód. {voucher.code}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-slate-900">{voucher.name}</p>
            {number ? (
              <p className="mt-1 text-sm">
                <span className="text-slate-500">Nº </span>
                <span className="font-mono font-medium">{number}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Sin número todavía</p>
            )}
            {invoice.issueDate && <Field label="Fecha">{formatDate(invoice.issueDate)}</Field>}
          </div>
        </header>

        <section className="grid gap-1 border-b border-slate-300 py-4 sm:grid-cols-2">
          <Field label="Señor/a">{recipient?.name ?? invoice.recipientName ?? 'Consumidor Final'}</Field>
          {recipient?.docType && recipient.docType !== 'SIN_IDENTIFICAR' && (
            <Field label="Documento">
              {docTypeLabels[recipient.docType as DocType] ?? recipient.docType} {recipient.docNumber}
            </Field>
          )}
          {recipient?.taxCondition && (
            <Field label="Condición frente al IVA">
              {taxConditionLabels[recipient.taxCondition as TaxCondition] ?? recipient.taxCondition}
            </Field>
          )}
          {recipient?.address && <Field label="Domicilio">{recipient.address}</Field>}
          {invoice.concept && (
            <Field label="Concepto">{invoiceConceptLabels[invoice.concept as InvoiceConcept] ?? invoice.concept}</Field>
          )}
          {withServices && invoice.serviceFrom && invoice.serviceTo && (
            <Field label="Período del servicio">
              {formatDate(invoice.serviceFrom)} al {formatDate(invoice.serviceTo)}
            </Field>
          )}
          {withServices && invoice.paymentDueDate && (
            <Field label="Vencimiento del pago">{formatDate(invoice.paymentDueDate)}</Field>
          )}
        </section>

        <section className="py-4">
          {items.length === 0 ? (
            <EmptyState title="Sin ítems" description="Esta factura no trae el detalle de ítems." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-slate-500">
                  <th className="py-2 font-medium">Descripción</th>
                  <th className="py-2 text-right font-medium">Cantidad</th>
                  <th className="py-2 text-right font-medium">Precio unitario</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="py-2">{item.description}</td>
                    <td className="py-2 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(item.unitPrice, invoice.currency)}</td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(item.subtotal, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-4 text-right text-lg font-semibold text-slate-900">
            Total: <span data-testid="receipt-total">{formatMoney(invoice.totalAmount, invoice.currency)}</span>
          </p>
        </section>

        <footer className="border-t border-slate-300 pt-4 text-sm">
          {invoice.cae ? (
            <div className="space-y-0.5">
              <p>
                <span className="text-slate-500">CAE: </span>
                <span className="font-mono font-medium">{invoice.cae}</span>
              </p>
              {invoice.caeExpiration && (
                <p>
                  <span className="text-slate-500">Vencimiento del CAE: </span>
                  <span className="font-medium">{formatDate(invoice.caeExpiration)}</span>
                </p>
              )}
            </div>
          ) : isDraft ? (
            <p className="text-slate-500">Sin CAE: la factura todavía es un borrador.</p>
          ) : (
            <p className="text-slate-500">Pendiente de autorización: todavía no tiene CAE.</p>
          )}
        </footer>
      </article>
    </div>
  )
}
