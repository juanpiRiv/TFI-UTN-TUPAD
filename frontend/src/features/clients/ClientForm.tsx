import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import {
  clientFields,
  clientSchema,
  docTypeLabels,
  taxConditionLabels,
  type Client,
  type ClientFormValues,
  type ClientInput,
} from './schemas'

function toFormValues(client?: Client): ClientFormValues {
  return {
    name: client?.name ?? '',
    docType: client?.docType ?? '',
    docNumber: client?.docNumber ?? '',
    taxCondition: client?.taxCondition ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    address: client?.address ?? '',
  }
}

type ClientFormProps = {
  client?: Client
  onSubmit: (values: ClientInput) => Promise<unknown>
  onDone: () => void
}

export function ClientForm({ client, onSubmit, onDone }: ClientFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClientFormValues, unknown, ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: toFormValues(client),
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onDone()
    } catch (error) {
      setFormError(applyApiError(error, setError, clientFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <Input
        id="client-name"
        label="Nombre o razón social"
        error={errors.name?.message}
        {...register('name')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="client-docType"
          label="Tipo de documento"
          placeholder="Sin documento"
          options={Object.entries(docTypeLabels).map(([value, label]) => ({ value, label }))}
          error={errors.docType?.message}
          {...register('docType')}
        />
        <Input
          id="client-docNumber"
          label="Número"
          inputMode="numeric"
          error={errors.docNumber?.message}
          {...register('docNumber')}
        />
      </div>
      <Select
        id="client-taxCondition"
        label="Condición frente al IVA"
        placeholder="Sin definir"
        hint="Obligatoria antes de facturarle."
        options={Object.entries(taxConditionLabels).map(([value, label]) => ({ value, label }))}
        error={errors.taxCondition?.message}
        {...register('taxCondition')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="client-email"
          label="Email"
          type="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          id="client-phone"
          label="Teléfono"
          type="tel"
          error={errors.phone?.message}
          {...register('phone')}
        />
      </div>
      <Input
        id="client-address"
        label="Domicilio"
        error={errors.address?.message}
        {...register('address')}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {client ? 'Guardar cambios' : 'Crear cliente'}
        </Button>
      </div>
    </form>
  )
}
