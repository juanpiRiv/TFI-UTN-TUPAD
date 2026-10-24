import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createInvoice, createInvoicePayment, fetchInvoiceDetail, fetchInvoices } from './api'
import type { CreatePaymentFormData } from './schemas'

export const invoicesKeys = {
  all: ['invoices'] as const,
  detail: (id: number) => ['invoices', id] as const,
}

export function useInvoicesQuery() {
  return useQuery({
    queryKey: invoicesKeys.all,
    queryFn: fetchInvoices,
  })
}

export function useInvoiceDetailQuery(id: number) {
  return useQuery({
    queryKey: invoicesKeys.detail(id),
    queryFn: () => fetchInvoiceDetail(id),
    enabled: Number.isInteger(id) && id > 0,
  })
}

export function useCreateInvoicePaymentMutation(invoiceId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreatePaymentFormData) => createInvoicePayment(invoiceId, data),
    onSuccess: () => {
      // Invalida la factura para refrescar el saldo y la lista de cobros
      void queryClient.invalidateQueries({ queryKey: invoicesKeys.detail(invoiceId) })
      void queryClient.invalidateQueries({ queryKey: invoicesKeys.all })
      // También invalida transacciones y dashboard para reflejar el ingreso recién cobrado
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useCreateInvoiceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createInvoice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoicesKeys.all })
    },
  })
}
