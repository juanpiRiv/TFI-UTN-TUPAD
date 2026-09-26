import type { ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { controlClass, Field } from './Field'

export type SelectOption = { value: string; label: string }

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string
  label: string
  options: SelectOption[]
  placeholder?: string
  error?: string
  hint?: ReactNode
}

export function Select({
  id,
  label,
  options,
  placeholder,
  error,
  hint,
  className,
  ...props
}: SelectProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
