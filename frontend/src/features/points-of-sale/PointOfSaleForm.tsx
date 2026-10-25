import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import {
  pointOfSaleFields,
  pointOfSaleSchema,
  type PointOfSale,
  type PointOfSaleFormValues,
  type PointOfSaleInput,
} from './schemas'

type PointOfSaleFormProps = {
  pointOfSale?: PointOfSale
  onSubmit: (values: PointOfSaleInput) => Promise<unknown>
  onDone: () => void
}

export function PointOfSaleForm({ pointOfSale, onSubmit, onDone }: PointOfSaleFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PointOfSaleFormValues, unknown, PointOfSaleInput>({
    resolver: zodResolver(pointOfSaleSchema),
    defaultValues: {
      number: pointOfSale ? String(pointOfSale.number) : '',
      address: pointOfSale?.address ?? '',
    },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onDone()
    } catch (error) {
      setFormError(applyApiError(error, setError, pointOfSaleFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <Input
        id="pos-number"
        label="Número"
        inputMode="numeric"
        placeholder="1"
        hint="El número con el que habilitaste el punto de venta en ARCA (Web Service)."
        error={errors.number?.message}
        {...register('number')}
      />
      <Input
        id="pos-address"
        label="Domicilio (opcional)"
        error={errors.address?.message}
        {...register('address')}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {pointOfSale ? 'Guardar cambios' : 'Crear punto de venta'}
        </Button>
      </div>
    </form>
  )
}
