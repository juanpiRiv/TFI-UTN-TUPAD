import { z } from 'zod'
import { todayIso } from '@/lib/format'

export const paymentItemSchema = z.object({
  id: z.number(),
  invoiceId: z.number(),
  amount: z.string(),
  currency: z.enum(['ARS', 'USD']),
  exchangeRate: z.string().nullable().optional(),
  paymentDate: z.string(),
  voidedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  transaction: z
    .object({
      id: z.number(),
      type: z.string(),
      categoryId: z.number(),
      description: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

export const invoiceDetailSchema = z.object({
  invoiceId: z.number(),
  voucherType: z.string(),
  voucherNumber: z.number().nullable().optional(),
  status: z.string(),
  currency: z.enum(['ARS', 'USD']),
  issueDate: z.string().optional(),
  concept: z.string().optional(),
  cae: z.string().nullable().optional(),
  recipientName: z.string().optional(),
  client: z
    .object({
      id: z.number(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  totalAmount: z.string(),
  totalPaid: z.string(),
  pendingBalance: z.string(),
  commercialStatus: z.enum(['PENDING', 'PARTIALLY_PAID', 'PAID']),
  payments: z.array(paymentItemSchema),
})

export const invoiceListItemSchema = z.object({
  id: z.number(),
  voucherType: z.string(),
  voucherNumber: z.number().nullable().optional(),
  concept: z.string().optional(),
  issueDate: z.string(),
  recipientName: z.string(),
  currency: z.enum(['ARS', 'USD']),
  totalAmount: z.string(),
  totalPaid: z.string(),
  pendingBalance: z.string(),
  status: z.string(),
  commercialStatus: z.enum(['PENDING', 'PARTIALLY_PAID', 'PAID']),
  cae: z.string().nullable().optional(),
  client: z
    .object({
      id: z.number(),
      name: z.string(),
    })
    .nullable()
    .optional(),
})

export const createPaymentFormSchema = z.object({
  amount: z
    .string()
    .min(1, 'El importe es obligatorio')
    .regex(/^\d+(\.\d{1,2})?$/, 'Formato de importe inválido (ej: 500.00)')
    .refine((val) => Number(val) > 0, 'El importe debe ser mayor a cero'),
  paymentDate: z
    .string()
    .min(1, 'La fecha es obligatoria')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido (YYYY-MM-DD)')
    .refine((val) => val <= todayIso(), 'La fecha de cobro no puede ser futura'),
  currency: z.enum(['ARS', 'USD']),
  exchangeRate: z.string().optional(),
  description: z.string().max(255).optional(),
})

export type PaymentItem = z.infer<typeof paymentItemSchema>
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>
export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>
export type CreatePaymentFormData = z.infer<typeof createPaymentFormSchema>

export const paymentFields = [
  'amount',
  'paymentDate',
  'currency',
  'exchangeRate',
  'description',
] as const satisfies readonly (keyof CreatePaymentFormData)[]
