import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/States'
import type { Category } from '@/features/categories/schemas'
import type { Client } from '@/features/clients/schemas'
import { formatDate, todayIso, type Currency } from '@/lib/format'
import { applyApiError } from '@/lib/form'
import { useUsdExchangeRate } from './queries'
import {
  createTransactionSchema,
  transactionFields,
  type TransactionFormValues,
  type TransactionInput,
} from './schemas'

/** "1385.500000" -> "1385.5", "1400.000000" -> "1400". */
function trimZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/\.?0+$/, '') : decimal
}

type TransactionFormProps = {
  baseCurrency: Currency
  categories: Category[]
  clients: Client[]
  onSubmit: (values: TransactionInput) => Promise<unknown>
  onDone: () => void
}

export function TransactionForm({
  baseCurrency,
  categories,
  clients,
  onSubmit,
  onDone,
}: TransactionFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const schema = useMemo(
    () => createTransactionSchema({ categories, baseCurrency }),
    [categories, baseCurrency],
  )
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getFieldState,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TransactionFormValues, unknown, TransactionInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'INCOME',
      amount: '',
      currency: baseCurrency,
      exchangeRate: '',
      categoryId: '',
      clientId: '',
      transactionDate: todayIso(),
      description: '',
    },
  })

  const [type, currency, transactionDate, categoryId] = useWatch({
    control,
    name: ['type', 'currency', 'transactionDate', 'categoryId'],
  })
  const needsRate = currency !== '' && currency !== baseCurrency
  // The BCRA suggestion is USD -> ARS, so it only applies to USD movements in a peso organization.
  const suggestRate = needsRate && currency === 'USD' && baseCurrency === 'ARS'
  const rate = useUsdExchangeRate(transactionDate, suggestRate)

  useEffect(() => {
    // Fill in the suggestion only while the user has not typed a rate of their own.
    if (rate.data && !getFieldState('exchangeRate').isDirty) {
      setValue('exchangeRate', trimZeros(rate.data.value))
    }
  }, [rate.data, getFieldState, setValue])

  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => category.type === type && category.isActive)
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categories, type],
  )

  useEffect(() => {
    // Changing the type invalidates a category of the other type.
    if (categoryId && !categoryOptions.some((option) => option.value === categoryId)) {
      setValue('categoryId', '')
    }
  }, [categoryId, categoryOptions, setValue])

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onDone()
    } catch (error) {
      setFormError(applyApiError(error, setError, transactionFields))
    }
  })

  const rateHint = rate.data
    ? `Sugerido: BCRA del ${formatDate(rate.data.observedAt)}. Podés cambiarlo.`
    : suggestRate && rate.isError
      ? 'No pudimos traer la cotización. Cargala a mano.'
      : 'Pesos por cada dólar.'

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <fieldset className="flex gap-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">Tipo</legend>
        {(['INCOME', 'EXPENSE'] as const).map((value) => (
          <label
            key={value}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-checked:border-brand-600 has-checked:bg-brand-50"
          >
            <input type="radio" value={value} className="accent-brand-700" {...register('type')} />
            {value === 'INCOME' ? 'Ingreso' : 'Egreso'}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="tx-amount"
          label="Importe"
          inputMode="decimal"
          placeholder="0,00"
          error={errors.amount?.message}
          {...register('amount')}
        />
        <Select
          id="tx-currency"
          label="Moneda"
          placeholder="Elegí la moneda"
          options={[
            { value: 'ARS', label: 'Pesos (ARS)' },
            { value: 'USD', label: 'Dólares (USD)' },
          ]}
          error={errors.currency?.message}
          {...register('currency')}
        />
      </div>
      {needsRate && (
        <Input
          id="tx-exchangeRate"
          label="Tipo de cambio"
          inputMode="decimal"
          hint={rateHint}
          error={errors.exchangeRate?.message}
          {...register('exchangeRate')}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="tx-categoryId"
          label="Categoría"
          placeholder="Elegí una categoría"
          options={categoryOptions}
          error={errors.categoryId?.message}
          {...register('categoryId')}
        />
        <Input
          id="tx-transactionDate"
          label="Fecha"
          type="date"
          error={errors.transactionDate?.message}
          {...register('transactionDate')}
        />
      </div>
      <Select
        id="tx-clientId"
        label="Cliente (opcional)"
        placeholder="Sin cliente"
        options={clients.map((client) => ({ value: String(client.id), label: client.name }))}
        error={errors.clientId?.message}
        {...register('clientId')}
      />
      <Input
        id="tx-description"
        label="Descripción (opcional)"
        error={errors.description?.message}
        {...register('description')}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Guardar movimiento
        </Button>
      </div>
    </form>
  )
}
