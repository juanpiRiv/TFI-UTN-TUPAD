import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import {
  organizationFields,
  organizationSchema,
  taxConditionLabels,
  type OrganizationFormValues,
  type OrganizationInput,
} from './schemas'
import type { Organization } from './types'

const emptyValues: OrganizationFormValues = {
  cuit: '',
  legalName: '',
  tradeName: '',
  commercialAddress: '',
  taxCondition: 'MONOTRIBUTO',
  monotributoCategory: '',
  activityStartDate: '',
  grossIncomeNumber: '',
  baseCurrency: 'ARS',
}

function toFormValues(organization: Organization): OrganizationFormValues {
  return {
    cuit: organization.cuit,
    legalName: organization.legalName,
    tradeName: organization.tradeName ?? '',
    commercialAddress: organization.commercialAddress ?? '',
    taxCondition: organization.taxCondition,
    monotributoCategory: organization.monotributoCategory ?? '',
    activityStartDate: organization.activityStartDate?.slice(0, 10) ?? '',
    grossIncomeNumber: organization.grossIncomeNumber ?? '',
    baseCurrency: organization.baseCurrency,
  }
}

type OrganizationFormProps = {
  organization?: Organization
  submitLabel: string
  onSubmit: (values: OrganizationInput) => Promise<unknown>
  onSuccess?: () => void
}

export function OrganizationForm({
  organization,
  submitLabel,
  onSubmit,
  onSuccess,
}: OrganizationFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<OrganizationFormValues, unknown, OrganizationInput>({
    resolver: zodResolver(organizationSchema),
    defaultValues: organization ? toFormValues(organization) : emptyValues,
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onSuccess?.()
    } catch (error) {
      setFormError(applyApiError(error, setError, organizationFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="cuit"
          label="CUIT"
          inputMode="numeric"
          placeholder="20-12345678-9"
          error={errors.cuit?.message}
          {...register('cuit')}
        />
        <Input
          id="legalName"
          label="Razón social o nombre y apellido"
          error={errors.legalName?.message}
          {...register('legalName')}
        />
        <Input
          id="tradeName"
          label="Nombre de fantasía (opcional)"
          error={errors.tradeName?.message}
          {...register('tradeName')}
        />
        <Select
          id="taxCondition"
          label="Condición frente al IVA"
          options={Object.entries(taxConditionLabels).map(([value, label]) => ({ value, label }))}
          error={errors.taxCondition?.message}
          {...register('taxCondition')}
        />
        <Select
          id="baseCurrency"
          label="Moneda base"
          hint="En esta moneda se muestran los totales."
          options={[
            { value: 'ARS', label: 'Pesos (ARS)' },
            { value: 'USD', label: 'Dólares (USD)' },
          ]}
          error={errors.baseCurrency?.message}
          {...register('baseCurrency')}
        />
        <Input
          id="monotributoCategory"
          label="Categoría de monotributo (opcional)"
          error={errors.monotributoCategory?.message}
          {...register('monotributoCategory')}
        />
        <Input
          id="commercialAddress"
          label="Domicilio comercial (opcional)"
          hint="Hace falta antes de facturar."
          error={errors.commercialAddress?.message}
          {...register('commercialAddress')}
        />
        <Input
          id="activityStartDate"
          label="Inicio de actividades (opcional)"
          type="date"
          error={errors.activityStartDate?.message}
          {...register('activityStartDate')}
        />
        <Input
          id="grossIncomeNumber"
          label="Ingresos brutos (opcional)"
          error={errors.grossIncomeNumber?.message}
          {...register('grossIncomeNumber')}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
