import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import { todayIso } from '@/lib/format'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import type { InvoiceDetail } from './schemas'

const mockInvoiceDetail: InvoiceDetail = {
  invoiceId: 1,
  voucherType: 'FACTURA_C',
  voucherNumber: 1001,
  status: 'AUTHORIZED',
  currency: 'ARS',
  issueDate: '2026-10-01',
  concept: 'SERVICIOS',
  cae: '74123456789012',
  recipientName: 'Acme Corp SRL',
  client: { id: 1, name: 'Acme Corp SRL' },
  totalAmount: '1000.00',
  totalPaid: '400.00',
  pendingBalance: '600.00',
  commercialStatus: 'PARTIALLY_PAID',
  payments: [
    {
      id: 10,
      invoiceId: 1,
      amount: '400.00',
      currency: 'ARS',
      exchangeRate: null,
      paymentDate: '2026-10-05',
      voidedAt: null,
      createdAt: '2026-10-05T12:00:00.000Z',
      transaction: {
        id: 20,
        type: 'INCOME',
        categoryId: 8,
        description: 'Cobro de Factura C #00001001',
      },
    },
  ],
}

describe('pantalla de pagos de una factura (Issue #52)', () => {
  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
  })

  it('muestra el saldo pendiente actualizado y el estado comercial de la factura', async () => {
    server.use(
      http.get(`${API_URL}/api/invoices/1`, () => {
        return HttpResponse.json(mockInvoiceDetail)
      }),
    )

    renderApp('/facturas/1')

    // Título con número de comprobante y badge de estado
    expect(await screen.findByRole('heading', { name: /Factura C #00001001/i })).toBeInTheDocument()
    expect(screen.getByText('Cobrada en parte')).toBeInTheDocument()
    expect(screen.getByText(/Acme Corp SRL/i)).toBeInTheDocument()

    // Criterio de cierre 1: Se ve el saldo pendiente actualizado y los totales
    expect(screen.getByText('Total Facturado')).toBeInTheDocument()
    expect(screen.getByText('Total Cobrado')).toBeInTheDocument()
    expect(screen.getByText('Saldo Pendiente')).toBeInTheDocument()
    expect(screen.getByText('$ 600,00')).toBeInTheDocument()

    // Historial de cobros existentes
    expect(screen.getByText('Cobros registrados')).toBeInTheDocument()
    expect(screen.getByText('05/10/2026')).toBeInTheDocument()
  })

  it('permite registrar un pago parcial o total desde la misma pantalla', async () => {
    let recordedBody: unknown = null

    server.use(
      http.get(`${API_URL}/api/invoices/1`, () => {
        return HttpResponse.json(mockInvoiceDetail)
      }),
      http.post(`${API_URL}/api/invoices/1/payments`, async ({ request }) => {
        recordedBody = await request.json()
        return HttpResponse.json({
          payment: {
            id: 11,
            invoiceId: 1,
            amount: '200.00',
            currency: 'ARS',
            paymentDate: '2026-10-13',
          },
          invoiceSummary: {
            invoiceId: 1,
            totalAmount: '1000.00',
            totalPaid: '600.00',
            pendingBalance: '400.00',
            commercialStatus: 'PARTIALLY_PAID',
          },
        }, { status: 201 })
      }),
    )

    const view = renderApp('/facturas/1')

    // Criterio de cierre 2: Formulario integrado en la misma pantalla
    expect(await screen.findByRole('heading', { name: 'Registrar nuevo cobro' })).toBeInTheDocument()

    // Botón de atajo para cobrar el saldo total
    const fullButton = screen.getByRole('button', { name: /Cobrar total/i })
    expect(fullButton).toBeInTheDocument()

    // Cargar un pago parcial de $ 200,00
    const amountInput = screen.getByLabelText(/Importe a cobrar/i)
    await view.user.type(amountInput, '200')

    const submitBtn = screen.getByRole('button', { name: 'Registrar cobro' })
    await view.user.click(submitBtn)

    // Confirmar que se envió el pago a la API
    expect(recordedBody).toEqual(
      expect.objectContaining({
        amount: '200',
        currency: 'ARS',
      }),
    )

    // Mensaje de confirmación
    expect(await screen.findByText(/Pago de.*200,00.*registrado con éxito/i)).toBeInTheDocument()
  })

  it('muestra factura saldada y no permite más cobros cuando el saldo pendiente es 0', async () => {
    server.use(
      http.get(`${API_URL}/api/invoices/1`, () => {
        return HttpResponse.json({
          ...mockInvoiceDetail,
          totalPaid: '1000.00',
          pendingBalance: '0.00',
          commercialStatus: 'PAID',
        })
      }),
    )

    renderApp('/facturas/1')

    expect(await screen.findByText('Cobrada')).toBeInTheDocument()
    expect(screen.getByText('Factura totalmente saldada')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Registrar nuevo cobro' })).not.toBeInTheDocument()
  })

  it('oculta el formulario de cobro y muestra advertencia informativa si la factura no está autorizada (P2)', async () => {
    server.use(
      http.get(`${API_URL}/api/invoices/1`, () => {
        return HttpResponse.json({
          ...mockInvoiceDetail,
          status: 'DRAFT',
        })
      }),
    )

    renderApp('/facturas/1')

    expect(await screen.findByText('Factura no disponible para cobro')).toBeInTheDocument()
    expect(
      screen.getByText(/Solo se pueden registrar cobros sobre facturas autorizadas por AFIP\/ARCA/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Registrar nuevo cobro' })).not.toBeInTheDocument()
  })

  it('delimita la fecha de cobro con max=hoy y min=fecha de emisión (P2)', async () => {
    server.use(
      http.get(`${API_URL}/api/invoices/1`, () => {
        return HttpResponse.json(mockInvoiceDetail)
      }),
    )

    renderApp('/facturas/1')

    const dateInput = await screen.findByLabelText(/Fecha de cobro/i)
    expect(dateInput).toHaveAttribute('max', todayIso())
    expect(dateInput).toHaveAttribute('min', '2026-10-01')
  })
})
