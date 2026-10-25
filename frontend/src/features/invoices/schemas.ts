import { z } from 'zod'
import { todayIso } from '@/lib/format'
import { isDecimal, isPositiveDecimal, normalizeDecimal } from '@/lib/schema-helpers'

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
  // true si la autorizó el proveedor simulado: el CAE no tiene validez fiscal.
  simulated: z.boolean().optional(),
  // Datos del emisor al momento de facturar; null mientras sea borrador.
  issuer: z
    .object({
      cuit: z.string(),
      legalName: z.string(),
      tradeName: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      taxCondition: z.string(),
      grossIncomeNumber: z.string().nullable().optional(),
      activityStartDate: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
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

const fiscalMessageSchema = z.object({ code: z.number(), message: z.string() })

/** Respuesta de POST /api/invoices/:id/authorize: la factura y qué dijo el proveedor fiscal. */
export const authorizeResultSchema = z.object({
  invoice: invoiceDetailSchema,
  fiscal: z.object({
    outcome: z.enum(['AUTHORIZED', 'AUTHORIZED_WITH_OBSERVATIONS', 'REJECTED', 'INDETERMINATE']),
    simulated: z.boolean(),
    observations: z.array(fiscalMessageSchema),
    errors: z.array(fiscalMessageSchema),
  }),
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
export type AuthorizeResult = z.infer<typeof authorizeResultSchema>
export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>
export type CreatePaymentFormData = z.infer<typeof createPaymentFormSchema>

export const paymentFields = [
  'amount',
  'paymentDate',
  'currency',
  'exchangeRate',
  'description',
] as const satisfies readonly (keyof CreatePaymentFormData)[]

/** Subtotal de un ítem como el backend: cantidad × precio, a dos decimales, mitad hacia arriba. */
export function itemSubtotal(quantity: string, unitPrice: string): string {
  const q = normalizeDecimal(quantity)
  const p = normalizeDecimal(unitPrice)
  if (!isDecimal(q, 3) || !isDecimal(p, 2)) return '0.00'
  return formatCents(scaled(q, 3) * scaled(p, 2), 3)
}

/** Total de la factura: suma de los subtotales. El backend lo recalcula igual. */
export function invoiceTotal(items: readonly InvoiceItemValues[]): string {
  const cents = items.reduce(
    (sum, item) => sum + toCents(itemSubtotal(item.quantity, item.unitPrice)),
    0n,
  )
  return formatCents(cents, 0)
}

/** "12.34" con `decimals` decimales -> entero escalado, sin pasar por floats. */
function scaled(value: string, decimals: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole + fraction.padEnd(decimals, '0'))
}

function toCents(value: string): bigint {
  return scaled(value, 2)
}

/** Formatea centavos escalados: `extraScale` es la cantidad de decimales que sobran para redondear. */
function formatCents(value: bigint, extraScale: number): string {
  const divisor = 10n ** BigInt(extraScale)
  const cents = extraScale > 0 ? (value + divisor / 2n) / divisor : value
  const text = cents.toString().padStart(3, '0')
  return `${text.slice(0, -2)}.${text.slice(-2)}`
}

export type InvoiceItemValues = { description: string; quantity: string; unitPrice: string }

export const invoiceConceptLabels = {
  PRODUCTOS: 'Productos',
  SERVICIOS: 'Servicios',
  PRODUCTOS_Y_SERVICIOS: 'Productos y servicios',
} as const
export type InvoiceConcept = keyof typeof invoiceConceptLabels

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha inválido')

const invoiceItemFormSchema = z.object({
  description: z.string().trim().min(1, 'La descripción es obligatoria').max(255, 'Hasta 255 caracteres'),
  quantity: z
    .string()
    .trim()
    .min(1, 'La cantidad es obligatoria')
    .transform(normalizeDecimal)
    .refine((value) => isDecimal(value, 3), 'Cantidad inválida (hasta 3 decimales)')
    .refine(isPositiveDecimal, 'La cantidad debe ser mayor a cero'),
  unitPrice: z
    .string()
    .trim()
    .min(1, 'El precio es obligatorio')
    .transform(normalizeDecimal)
    .refine((value) => isDecimal(value, 2), 'Precio inválido (hasta 2 decimales)'),
})

export const createInvoiceFormSchema = z
  .object({
    clientId: z.string(),
    concept: z.enum(['PRODUCTOS', 'SERVICIOS', 'PRODUCTOS_Y_SERVICIOS']),
    issueDate: isoDate,
    serviceFrom: z.string(),
    serviceTo: z.string(),
    paymentDueDate: z.string(),
    items: z.array(invoiceItemFormSchema).min(1, 'Agregá al menos un ítem'),
  })
  .superRefine((values, ctx) => {
    if (values.concept === 'PRODUCTOS') return
    for (const field of ['serviceFrom', 'serviceTo', 'paymentDueDate'] as const) {
      if (!isoDate.safeParse(values[field]).success) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Es obligatoria para servicios' })
      }
    }
    if (values.serviceFrom && values.serviceTo && values.serviceTo < values.serviceFrom) {
      ctx.addIssue({ code: 'custom', path: ['serviceTo'], message: 'No puede ser anterior al inicio' })
    }
  })
  .transform((values) => {
    const withServices = values.concept !== 'PRODUCTOS'
    return {
      ...(values.clientId ? { clientId: Number(values.clientId) } : {}),
      concept: values.concept,
      issueDate: values.issueDate,
      ...(withServices
        ? {
            serviceFrom: values.serviceFrom,
            serviceTo: values.serviceTo,
            paymentDueDate: values.paymentDueDate,
          }
        : {}),
      items: values.items,
    }
  })

export type InvoiceFormValues = z.input<typeof createInvoiceFormSchema>
export type InvoiceInput = z.output<typeof createInvoiceFormSchema>

export const invoiceFormFields = [
  'clientId',
  'concept',
  'issueDate',
  'serviceFrom',
  'serviceTo',
  'paymentDueDate',
] as const satisfies readonly (keyof InvoiceFormValues)[]

/** Propuesta de docs/04: el mes de la factura y el vencimiento a 30 días. */
export function serviceDefaults(issueDate: string): {
  serviceFrom: string
  serviceTo: string
  paymentDueDate: string
} {
  const [year, month, day] = issueDate.split('-').map(Number)
  if (!year || !month || !day) return { serviceFrom: '', serviceTo: '', paymentDueDate: '' }
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  return {
    serviceFrom: iso(new Date(Date.UTC(year, month - 1, 1))),
    serviceTo: iso(new Date(Date.UTC(year, month, 0))),
    paymentDueDate: iso(new Date(Date.UTC(year, month - 1, day + 30))),
  }
}
