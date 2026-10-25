import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import {
  activityFields,
  activityKindLabels,
  activitySchema,
  type Activity,
  type ActivityFormValues,
  type ActivityInput,
} from './schemas'

type ActivityFormProps = {
  activity?: Activity
  onSubmit: (values: ActivityInput) => Promise<unknown>
  onDone: () => void
}

export function ActivityForm({ activity, onSubmit, onDone }: ActivityFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ActivityFormValues, unknown, ActivityInput>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      description: activity?.description ?? '',
      kind: activity?.kind ?? 'SERVICES',
      arcaActivityCode: activity?.arcaActivityCode ?? '',
    },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onDone()
    } catch (error) {
      setFormError(applyApiError(error, setError, activityFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <Input
        id="activity-description"
        label="Descripción"
        placeholder="Desarrollo de software"
        error={errors.description?.message}
        {...register('description')}
      />
      <Select
        id="activity-kind"
        label="¿Qué vendés con esta actividad?"
        options={Object.entries(activityKindLabels).map(([value, label]) => ({ value, label }))}
        error={errors.kind?.message}
        {...register('kind')}
      />
      <Input
        id="activity-code"
        label="Código de actividad de ARCA (opcional)"
        inputMode="numeric"
        placeholder="620100"
        hint="Los 6 números del nomenclador de actividades (figura en tu constancia de inscripción)."
        error={errors.arcaActivityCode?.message}
        {...register('arcaActivityCode')}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {activity ? 'Guardar cambios' : 'Crear actividad'}
        </Button>
      </div>
    </form>
  )
}
