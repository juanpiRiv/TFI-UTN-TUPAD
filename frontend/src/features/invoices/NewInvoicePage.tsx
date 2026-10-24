import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/States'
import { useClients } from '@/features/clients/queries'
import { formatMoney, todayIso } from '@/lib/format'
import { applyApiError } from '@/lib/form'
import { useCreateInvoiceMutation } from './queries'
import {
  createInvoiceFormSchema,
  invoiceConceptLabels,
  invoiceFormFields,
  invoiceTotal,
  itemSubtotal,
  serviceDefaults,
  type InvoiceFormValues,
  type InvoiceInput,
} from './schemas'

const emptyItem = { description: '', quantity: '', unitPrice: '' }

export function NewInvoicePage() {
  const navigate = useNavigate()
  const clients = useClients()
  const createInvoice = useCreateInvoiceMutation()
  const [formError, setFormError] = useState<string | null>(null)

  const today = todayIso()
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getFieldState,
    control,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues, unknown, InvoiceInput>({
    resolver: zodResolver(createInvoiceFormSchema),
    defaultValues: {
      clientId: '',
      concept: 'SERVICIOS',
      issueDate: today,
      ...serviceDefaults(today),
      items: [emptyItem],
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const [concept, issueDate, items] = useWatch({ control, name: ['concept', 'issueDate', 'items'] })
  const withServices = concept !== 'PRODUCTOS'
  const total = useMemo(() => invoiceTotal(items ?? []), [items])

  useEffect(() => {
    // Mientras el usuario no tocó las fechas del servicio, siguen el mes de la factura.
    const defaults = serviceDefaults(issueDate)
    for (const field of ['serviceFrom', 'serviceTo', 'paymentDueDate'] as const) {
      if (!getFieldState(field).isDirty) setValue(field, defaults[field])
    }
  }, [issueDate, getFieldState, setValue])

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const invoice = await createInvoice.mutateAsync(values)
      await navigate(`/facturas/${invoice.invoiceId}`)
    } catch (error) {
      setFormError(applyApiError(error, setError, invoiceFormFields))
    }
  })

  return (
    <div>
      <PageHeader
        title="Nueva factura"
        description="Se guarda como borrador. El total lo calcula el sistema; la autorización con ARCA es un paso posterior."
        actions={
          <Link
            to="/facturas"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
          >
            Volver a facturas
          </Link>
        }
      />

      <form onSubmit={submit} noValidate className="flex max-w-4xl flex-col gap-6">
        <FormError message={formError} />

        <section className="grid gap-4 sm:grid-cols-2">
          <Select
            id="invoice-client"
            label="Cliente"
            placeholder="Consumidor final (sin cliente)"
            options={(clients.data ?? [])
              .filter((client) => client.isActive)
              .map((client) => ({ value: String(client.id), label: client.name }))}
            error={errors.clientId?.message}
            {...register('clientId')}
          />
          <Select
            id="invoice-concept"
            label="Concepto"
            options={Object.entries(invoiceConceptLabels).map(([value, label]) => ({ value, label }))}
            error={errors.concept?.message}
            {...register('concept')}
          />
          <Input
            id="invoice-issue-date"
            label="Fecha de emisión"
            type="date"
            error={errors.issueDate?.message}
            {...register('issueDate')}
          />
        </section>

        {withServices && (
          <section className="grid gap-4 sm:grid-cols-3">
            <Input
              id="invoice-service-from"
              label="Servicio desde"
              type="date"
              error={errors.serviceFrom?.message}
              {...register('serviceFrom')}
            />
            <Input
              id="invoice-service-to"
              label="Servicio hasta"
              type="date"
              error={errors.serviceTo?.message}
              {...register('serviceTo')}
            />
            <Input
              id="invoice-due-date"
              label="Vencimiento del pago"
              type="date"
              error={errors.paymentDueDate?.message}
              {...register('paymentDueDate')}
            />
          </section>
        )}

        <section aria-labelledby="invoice-items-title" className="flex flex-col gap-3">
          <h2 id="invoice-items-title" className="text-base font-semibold text-slate-900">
            Ítems
          </h2>
          {errors.items?.message && <FormError message={errors.items.message} />}
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid items-start gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_7rem_9rem_auto]"
            >
              <Input
                id={`invoice-item-${index}-description`}
                label="Descripción"
                error={errors.items?.[index]?.description?.message}
                {...register(`items.${index}.description`)}
              />
              <Input
                id={`invoice-item-${index}-quantity`}
                label="Cantidad"
                inputMode="decimal"
                error={errors.items?.[index]?.quantity?.message}
                {...register(`items.${index}.quantity`)}
              />
              <Input
                id={`invoice-item-${index}-unit-price`}
                label="Precio unitario"
                inputMode="decimal"
                placeholder="0,00"
                error={errors.items?.[index]?.unitPrice?.message}
                {...register(`items.${index}.unitPrice`)}
              />
              <div className="flex flex-col items-end gap-2 sm:pt-6">
                <span className="text-sm font-medium text-slate-700">
                  {formatMoney(
                    itemSubtotal(items?.[index]?.quantity ?? '', items?.[index]?.unitPrice ?? ''),
                  )}
                </span>
                {fields.length > 1 && (
                  <Button
                    variant="ghost"
                    aria-label={`Quitar ítem ${index + 1}`}
                    onClick={() => remove(index)}
                  >
                    Quitar
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div>
            <Button variant="secondary" onClick={() => append(emptyItem)}>
              Agregar ítem
            </Button>
          </div>
        </section>

        <div className="flex flex-col gap-4 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-lg font-semibold text-slate-900">
            Total estimado:{' '}
            <span data-testid="invoice-total">{formatMoney(total)}</span>
          </p>
          <Button type="submit" loading={isSubmitting}>
            Crear borrador
          </Button>
        </div>
      </form>
    </div>
  )
}
