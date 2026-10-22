import { apiFetch } from '@/lib/api'
import {
  invoiceDetailSchema,
  invoiceListItemSchema,
  type CreatePaymentFormData,
  type InvoiceDetail,
  type InvoiceListItem,
} from './schemas'
import { z } from 'zod'

export async function fetchInvoices(): Promise<InvoiceListItem[]> {
  const data = await apiFetch<unknown>('/api/invoices')
  return z.array(invoiceListItemSchema).parse(data)
}

export async function fetchInvoiceDetail(id: number): Promise<InvoiceDetail> {
  const data = await apiFetch<unknown>(`/api/invoices/${id}`)
  return invoiceDetailSchema.parse(data)
}

export async function createInvoicePayment(
  invoiceId: number,
  input: CreatePaymentFormData,
): Promise<unknown> {
  return await apiFetch<unknown>(`/api/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: input,
  })
}
