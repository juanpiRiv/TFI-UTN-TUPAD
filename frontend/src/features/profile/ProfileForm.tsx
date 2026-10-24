import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { User } from '@/features/auth/schemas'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import { useUpdateProfile } from './queries'
import {
  createProfileSchema,
  profileFields,
  type ProfileFormValues,
  type UpdateProfileInput,
} from './schemas'

type ProfileFormProps = {
  user: User
  onSuccess: () => void
}

export function ProfileForm({ user, onSuccess }: ProfileFormProps) {
  const updateProfile = useUpdateProfile()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues, unknown, UpdateProfileInput>({
    resolver: zodResolver(createProfileSchema(user.email)),
    defaultValues: { name: user.name ?? '', email: user.email, currentPassword: '' },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await updateProfile.mutateAsync(values)
      onSuccess()
    } catch (error) {
      setFormError(applyApiError(error, setError, profileFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="name"
          label="Nombre (opcional)"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          id="profileCurrentPassword"
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
          hint="Solo hace falta si cambiás el email."
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
          Guardar datos
        </Button>
      </div>
    </form>
  )
}
