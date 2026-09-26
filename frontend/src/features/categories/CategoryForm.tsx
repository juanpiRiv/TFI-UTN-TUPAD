import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import {
  categoryFields,
  categorySchema,
  movementTypeLabels,
  type Category,
  type CategoryInput,
  type MovementType,
} from './schemas'

type CategoryFormProps = {
  category?: Category
  defaultType?: MovementType
  onSubmit: (values: CategoryInput) => Promise<unknown>
  onDone: () => void
}

export function CategoryForm({
  category,
  defaultType = 'INCOME',
  onSubmit,
  onDone,
}: CategoryFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: category?.name ?? '', type: category?.type ?? defaultType },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await onSubmit(values)
      onDone()
    } catch (error) {
      setFormError(applyApiError(error, setError, categoryFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <Input id="category-name" label="Nombre" error={errors.name?.message} {...register('name')} />
      <Select
        id="category-type"
        label="Tipo"
        options={Object.entries(movementTypeLabels).map(([value, label]) => ({ value, label }))}
        // Changing the type would leave existing movements with a category of the other type.
        disabled={Boolean(category)}
        hint={category ? 'El tipo no se puede cambiar una vez creada.' : undefined}
        error={errors.type?.message}
        {...register('type')}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {category ? 'Guardar cambios' : 'Crear categoría'}
        </Button>
      </div>
    </form>
  )
}
