import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/States'
import { applyApiError } from '@/lib/form'
import { useChangePassword } from './queries'
import {
  passwordFields,
  passwordSchema,
  type ChangePasswordInput,
  type PasswordFormValues,
} from './schemas'

const emptyValues: PasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

export function PasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const changePassword = useChangePassword()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormValues, unknown, ChangePasswordInput>({
    resolver: zodResolver(passwordSchema),
    defaultValues: emptyValues,
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await changePassword.mutateAsync(values)
      reset(emptyValues)
      onSuccess()
    } catch (error) {
      setFormError(applyApiError(error, setError, passwordFields))
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          id="currentPassword"
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <Input
          id="newPassword"
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <Input
          id="confirmPassword"
          label="Repetir contraseña nueva"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
          Cambiar contraseña
        </Button>
      </div>
    </form>
  )
}
