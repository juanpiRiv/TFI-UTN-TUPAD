import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/States'
import { formatMoney, todayIso, type Currency } from '@/lib/format'
import { applyApiError } from '@/lib/form'
import { useCreateInvoicePaymentMutation } from './queries'
import {
  createPaymentFormSchema,
  paymentFields,
  type CreatePaymentFormData,
} from './schemas'

type PaymentFormProps = {
  invoiceId: number
  pendingBalance: string
  currency: Currency
  issueDate?: string
  onSuccess?: () => void
}

export function PaymentForm({
  invoiceId,
  pendingBalance,
  currency,
  issueDate,
  onSuccess,
}: PaymentFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const mutation = useCreateInvoicePaymentMutation(invoiceId)

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreatePaymentFormData>({
    resolver: zodResolver(createPaymentFormSchema),
    defaultValues: {
      amount: '',
      paymentDate: todayIso(),
      currency,
      description: '',
    },
  })

  const amountWatched = useWatch({ control, name: 'amount' })
  const pendingNum = Number(pendingBalance) || 0
  const typedAmountNum = Number(amountWatched) || 0
  const isOverpaying = typedAmountNum > pendingNum

  const handleFillFullBalance = () => {
    setValue('amount', pendingBalance, { shouldValidate: true })
    setFormError(null)
  }

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    setSuccessMsg(null)

    // Validación en el cliente: no puede pagar más del saldo pendiente
    if (Number(values.amount) > pendingNum) {
      setError('amount', {
        type: 'manual',
        message: `El importe no puede superar el saldo pendiente de ${formatMoney(pendingBalance, currency)}`,
      })
      return
    }

    // Validación de fecha no anterior a la emisión
    if (issueDate && values.paymentDate < issueDate) {
      setError('paymentDate', {
        type: 'manual',
        message: `La fecha de cobro no puede ser anterior a la fecha de emisión (${issueDate})`,
      })
      return
    }

    try {
      await mutation.mutateAsync(values)
      setSuccessMsg(`Pago de ${formatMoney(values.amount, currency)} registrado con éxito.`)
      reset({
        amount: '',
        paymentDate: todayIso(),
        currency,
        description: '',
      })
      onSuccess?.()
    } catch (err) {
      setFormError(applyApiError(err, setError, paymentFields))
    }
  })

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Registrar nuevo cobro</h2>
          <p className="text-xs text-slate-500">
            Podés registrar un pago total o parcial. Se creará automáticamente el movimiento de ingreso correspondiente.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleFillFullBalance}
          disabled={pendingNum <= 0 || isSubmitting}
        >
          Cobrar total ({formatMoney(pendingBalance, currency)})
        </Button>
      </div>

      <FormError message={formError} />

      {successMsg && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          ✓ {successMsg}
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="amount"
            label={`Importe a cobrar (${currency}) *`}
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            error={errors.amount?.message}
            hint={
              isOverpaying ? (
                <span className="text-amber-600 font-medium">
                  Atención: el importe supera el saldo pendiente de {formatMoney(pendingBalance, currency)}
                </span>
              ) : typedAmountNum > 0 ? (
                `Nuevo saldo tras este pago: ${formatMoney(String((pendingNum - typedAmountNum).toFixed(2)), currency)}`
              ) : undefined
            }
            {...register('amount')}
          />

          <Input
            id="paymentDate"
            label="Fecha de cobro *"
            type="date"
            max={todayIso()}
            min={issueDate}
            error={errors.paymentDate?.message}
            {...register('paymentDate')}
          />
        </div>

        <Input
          id="description"
          label="Detalle / Referencia (opcional)"
          type="text"
          placeholder="Ej: Transferencia bancaria, cheque, etc."
          error={errors.description?.message}
          {...register('description')}
        />

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={isSubmitting || isOverpaying || typedAmountNum <= 0}
          >
            {isSubmitting ? 'Registrando cobro...' : 'Registrar cobro'}
          </Button>
        </div>
      </form>
    </div>
  )
}
