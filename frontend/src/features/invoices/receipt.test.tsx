import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_URL } from '@/lib/api'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import type { InvoiceDetail } from './schemas'

const authorized: InvoiceDetail = {
  invoiceId: 7,
  voucherType: 'FACTURA_C',
  voucherNumber: 7,
  pointOfSale: 3,
  status: 'AUTHORIZED',
  currency: 'ARS',
  issueDate: '2026-10-24',
  concept: 'SERVICIOS',
  serviceFrom: '2026-10-01',
  serviceTo: '2026-10-31',
  paymentDueDate: '2026-11-23',
  cae: '74123456789012',
  caeExpiration: '2026-11-04',
  simulated: true,
  issuer: {
    cuit: '20000000001',
    legalName: 'Recorrido SAS',
    tradeName: 'Recorrido',
    address: 'Av. Siempre Viva 742',
    taxCondition: 'MONOTRIBUTO',
    grossIncomeNumber: '901-123456-7',
    activityStartDate: '2020-03-01',
  },
  recipientName: 'Estudio García',
  recipient: {
    name: 'Estudio García',
    docType: 'CUIT',
    docNumber: '30712345678',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    address: 'Calle 1',
  },
  client: { id: 7, name: 'Estudio García' },
  items: [
    { id: 1, description: 'Consultoría técnica', quantity: '1.5', unitPrice: '100.00', subtotal: '150.00' },
    { id: 2, description: 'Hosting', quantity: '2', unitPrice: '32.51', subtotal: '65.02' },
  ],
  totalAmount: '215.02',
  totalPaid: '0.00',
  pendingBalance: '215.02',
  commercialStatus: 'PENDING',
  payments: [],
}

describe('comprobante para ver e imprimir (Issue #55)', () => {
  beforeEach(() => {
    const user = seedUser()
    seedOrganization(user.id)
    loginAs(user.id)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const serve = (invoice: InvoiceDetail) =>
    server.use(http.get(`${API_URL}/api/invoices/${invoice.invoiceId}`, () => HttpResponse.json(invoice)))

  it('muestra el emisor, el receptor, el número, los ítems, el total y el CAE con su vencimiento', async () => {
    serve(authorized)
    renderApp('/facturas/7/comprobante')

    const receipt = await screen.findByTestId('receipt')
    expect(within(receipt).getByText('Factura C')).toBeInTheDocument()
    expect(within(receipt).getByText(/Cód\. 011/)).toBeInTheDocument()
    expect(within(receipt).getByText('0003-00000007')).toBeInTheDocument()
    expect(within(receipt).getByText('24/10/2026')).toBeInTheDocument()
    // Emisor, tomado de la copia que guarda la factura
    expect(within(receipt).getByText('Recorrido SAS')).toBeInTheDocument()
    expect(within(receipt).getByText(/20000000001/)).toBeInTheDocument()
    expect(within(receipt).getByText('Av. Siempre Viva 742')).toBeInTheDocument()
    // Receptor
    expect(within(receipt).getByText('Estudio García')).toBeInTheDocument()
    expect(within(receipt).getByText(/30712345678/)).toBeInTheDocument()
    // Ítems y total
    expect(within(receipt).getByText('Consultoría técnica')).toBeInTheDocument()
    expect(within(receipt).getByText('Hosting')).toBeInTheDocument()
    expect(within(receipt).getByTestId('receipt-total')).toHaveTextContent('$ 215,02')
    // Servicio y CAE
    expect(within(receipt).getByText(/01\/10\/2026/)).toBeInTheDocument()
    expect(within(receipt).getByText('74123456789012')).toBeInTheDocument()
    expect(within(receipt).getByText('04/11/2026')).toBeInTheDocument()
  })

  it('una factura del proveedor simulado lleva la leyenda de comprobante de prueba', async () => {
    serve(authorized)
    renderApp('/facturas/7/comprobante')

    expect(await screen.findByTestId('receipt-simulated')).toHaveTextContent(/sin validez fiscal/i)
  })

  it('con un proveedor real no aparece la leyenda', async () => {
    serve({ ...authorized, simulated: false })
    renderApp('/facturas/7/comprobante')

    await screen.findByTestId('receipt')
    expect(screen.queryByTestId('receipt-simulated')).not.toBeInTheDocument()
  })

  it('un borrador se ve marcado como borrador, sin número ni CAE', async () => {
    serve({
      ...authorized,
      status: 'DRAFT',
      voucherNumber: null,
      cae: null,
      caeExpiration: null,
      simulated: false,
      issuer: null,
    })
    renderApp('/facturas/7/comprobante')

    const receipt = await screen.findByTestId('receipt')
    expect(within(receipt).getByTestId('receipt-draft')).toHaveTextContent(/borrador/i)
    expect(within(receipt).queryByText('74123456789012')).not.toBeInTheDocument()
    expect(within(receipt).queryByText('0003-00000007')).not.toBeInTheDocument()
  })

  it('el botón imprime con el navegador', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    serve(authorized)
    const view = renderApp('/facturas/7/comprobante')

    await view.user.click(await screen.findByRole('button', { name: /Imprimir o guardar como PDF/ }))

    expect(print).toHaveBeenCalledTimes(1)
  })

  it('el menú y los botones no se imprimen', async () => {
    serve(authorized)
    renderApp('/facturas/7/comprobante')

    await screen.findByTestId('receipt')
    expect(screen.getByRole('navigation', { name: 'Principal' }).closest('aside')).toHaveClass('print:hidden')
    expect(screen.getByRole('button', { name: /Imprimir o guardar como PDF/ }).closest('[data-print="hide"]')).not.toBeNull()
  })

  it('el detalle de la factura ofrece ver el comprobante', async () => {
    serve({ ...authorized, items: [] })
    renderApp('/facturas/7')

    const link = await screen.findByRole('link', { name: /Ver comprobante/ })
    expect(link).toHaveAttribute('href', '/facturas/7/comprobante')
  })
})
