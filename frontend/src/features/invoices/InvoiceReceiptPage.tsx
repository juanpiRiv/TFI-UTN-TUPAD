import { QRCodeSVG } from 'qrcode.react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States'
import { docTypeLabels, taxConditionLabels } from '@/features/clients/schemas'
import type { DocType } from '@/features/clients/schemas'
import type { TaxCondition } from '@/features/organizations/types'
import { formatDate, formatMoney } from '@/lib/format'
import { useInvoiceDetailQuery } from './queries'

const voucherNames: Record<string, { name: string; code: string }> = {
  FACTURA_C: { name: 'FACTURA', code: '011' },
  NOTA_DEBITO_C: { name: 'NOTA DE DÉBITO', code: '012' },
  NOTA_CREDITO_C: { name: 'NOTA DE CRÉDITO', code: '013' },
}

const conditionLabel = (condition: string | null | undefined) => {
  if (!condition) return ''
  if (condition === 'MONOTRIBUTO') return 'Responsable Monotributo'
  return taxConditionLabels[condition as TaxCondition] ?? condition
}

const pad = (value: number | null | undefined, size: number) => String(value ?? 0).padStart(size, '0')
const formatQuantity = (value: string) => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 3 })

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-sm">
      <span className="font-semibold text-slate-900">{label}: </span>
      <span className="text-slate-900">{children}</span>
    </p>
  )
}

/** Comprobante de una factura con el formato oficial de ARCA, para imprimirlo o guardarlo como PDF. */
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
  const withServices = invoice.concept && invoice.concept !== 'PRODUCTOS'
  const items = invoice.items ?? []
  const identified = recipient?.docType && recipient.docType !== 'SIN_IDENTIFICAR' && recipient.docNumber
  const showAuthorization = !isDraft && Boolean(invoice.cae)
  const showQr = showAuthorization && Boolean(invoice.qrUrl)

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
        {(invoice.simulated || invoice.testEnvironment) && !isDraft && (
          <p data-testid="receipt-simulated" className="mb-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-center text-sm font-semibold text-amber-900">
            Comprobante de prueba, sin validez fiscal
          </p>
        )}

        <p className="border border-b-0 border-slate-900 py-1 text-center text-base font-bold tracking-widest text-slate-900">ORIGINAL</p>

        <header className="grid grid-cols-[1fr_auto_1fr] border border-slate-900">
          <div className="space-y-1 p-3">
            <p className="text-xl font-bold text-slate-900">{issuer?.legalName ?? 'Emisor'}</p>
            {issuer ? (
              <>
                <Field label="Razón Social">{issuer.legalName}</Field>
                {issuer.address && <Field label="Domicilio Comercial">{issuer.address}</Field>}
                <Field label="Condición frente al IVA">{conditionLabel(issuer.taxCondition)}</Field>
              </>
            ) : (
              <p className="text-sm text-slate-500">Los datos del emisor se completan al facturar.</p>
            )}
          </div>
          <div className="flex flex-col items-center border-x border-slate-900 px-4 pb-2">
            <p className="-mt-px flex size-14 items-center justify-center border border-t-0 border-slate-900 text-4xl font-bold text-slate-900">C</p>
            {voucher.code && <p className="mt-1 text-xs font-semibold text-slate-900">COD. {voucher.code}</p>}
          </div>
          <div className="space-y-1 p-3">
            <p className="text-xl font-bold text-slate-900">{voucher.name}</p>
            {invoice.voucherNumber ? (
              <p className="text-sm text-slate-900">
                <span className="font-semibold">Punto de Venta: </span>
                <span>{pad(invoice.pointOfSale, 4)}</span>
                <span className="font-semibold">{'   '}Comp. Nro: </span>
                <span>{pad(invoice.voucherNumber, 8)}</span>
              </p>
            ) : (
              <p className="text-sm text-slate-500">Sin número todavía</p>
            )}
            {invoice.issueDate && <Field label="Fecha de Emisión">{formatDate(invoice.issueDate)}</Field>}
            {issuer && (
              <>
                <Field label="CUIT">{issuer.cuit}</Field>
                {issuer.grossIncomeNumber && <Field label="Ingresos Brutos">{issuer.grossIncomeNumber}</Field>}
                {issuer.activityStartDate && (
                  <Field label="Fecha de Inicio de Actividades">{formatDate(issuer.activityStartDate)}</Field>
                )}
              </>
            )}
          </div>
        </header>

        {withServices && (invoice.serviceFrom || invoice.serviceTo || invoice.paymentDueDate) && (
          <section data-testid="receipt-period" className="flex flex-wrap justify-between gap-x-4 border border-t-0 border-slate-900 px-3 py-2">
            {invoice.serviceFrom && <Field label="Período Facturado Desde">{formatDate(invoice.serviceFrom)}</Field>}
            {invoice.serviceTo && <Field label="Hasta">{formatDate(invoice.serviceTo)}</Field>}
            {invoice.paymentDueDate && <Field label="Fecha de Vto. para el pago">{formatDate(invoice.paymentDueDate)}</Field>}
          </section>
        )}

        <section className="grid gap-1 border border-t-0 border-slate-900 px-3 py-2 sm:grid-cols-2">
          {identified ? (
            <Field label="CUIT/DNI">
              {recipient.docNumber}
              {recipient.docType !== 'CUIT' && recipient.docType !== 'DNI' && ` (${docTypeLabels[recipient.docType as DocType] ?? recipient.docType})`}
            </Field>
          ) : (
            <p className="text-sm font-semibold text-slate-900">Consumidor Final</p>
          )}
          <Field label="Apellido y Nombre / Razón Social">{recipient?.name ?? invoice.recipientName ?? 'Consumidor Final'}</Field>
          <Field label="Condición frente al IVA">
            {recipient?.taxCondition ? conditionLabel(recipient.taxCondition) : 'Consumidor Final'}
          </Field>
          {recipient?.address && <Field label="Domicilio">{recipient.address}</Field>}
          <Field label="Condición de venta">Contado</Field>
        </section>

        <section className="border border-t-0 border-slate-900">
          {items.length === 0 ? (
            <EmptyState title="Sin ítems" description="Esta factura no trae el detalle de ítems." />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-900 bg-slate-100 text-left print:bg-transparent">
                  <th className="px-2 py-1.5 font-semibold">Código</th>
                  <th className="px-2 py-1.5 font-semibold">Producto / Servicio</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Cantidad</th>
                  <th className="px-2 py-1.5 font-semibold">U. Medida</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Precio Unit.</th>
                  <th className="px-2 py-1.5 text-right font-semibold">% Bonif</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Imp. Bonif.</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className="border-b border-slate-200">
                    <td className="px-2 py-1.5">{index + 1}</td>
                    <td className="px-2 py-1.5">{item.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
                    <td className="px-2 py-1.5">unidades</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(item.unitPrice, invoice.currency)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">0,00</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney('0', invoice.currency)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(item.subtotal, invoice.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="ml-auto mt-2 w-full max-w-xs space-y-0.5 border border-slate-900 px-3 py-2 text-right text-sm">
          <p>
            <span className="font-semibold">Subtotal: </span>
            <span className="tabular-nums">{formatMoney(invoice.totalAmount, invoice.currency)}</span>
          </p>
          <p>
            <span className="font-semibold">Importe Otros Tributos: </span>
            <span className="tabular-nums">{formatMoney('0', invoice.currency)}</span>
          </p>
          <p className="text-base font-bold text-slate-900">
            Importe Total: <span data-testid="receipt-total" className="tabular-nums">{formatMoney(invoice.totalAmount, invoice.currency)}</span>
          </p>
        </section>

        <footer className="mt-4 grid grid-cols-[auto_1fr_1fr] items-end gap-4 border-t border-slate-900 pt-3 text-sm">
          <div className="min-w-[110px]">
            {showQr && invoice.qrUrl && (
              <div data-testid="receipt-qr" role="img" aria-label="Código QR de ARCA para verificar el comprobante">
                <QRCodeSVG value={invoice.qrUrl} size={110} level="M" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="text-center">
            {showAuthorization && <p className="font-bold italic text-slate-900">Comprobante Autorizado</p>}
            <p className="text-xs text-slate-600">Pág. 1/1</p>
          </div>
          <div className="space-y-0.5 text-right">
            {showAuthorization ? (
              <>
                <p>
                  <span className="font-semibold">CAE N°: </span>
                  <span className="font-mono">{invoice.cae}</span>
                </p>
                {invoice.caeExpiration && (
                  <p>
                    <span className="font-semibold">Fecha de Vto. de CAE: </span>
                    <span>{formatDate(invoice.caeExpiration)}</span>
                  </p>
                )}
              </>
            ) : isDraft ? (
              <p className="text-slate-500">Sin CAE: la factura todavía es un borrador.</p>
            ) : (
              <p className="text-slate-500">Pendiente de autorización: todavía no tiene CAE.</p>
            )}
          </div>
        </footer>
      </article>
    </div>
  )
}
