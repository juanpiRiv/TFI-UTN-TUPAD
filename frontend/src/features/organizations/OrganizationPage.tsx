import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useOrganization } from '@/features/auth/queries'
import { OrganizationForm } from './OrganizationForm'
import { useUpdateOrganization } from './queries'

export function OrganizationPage() {
  const organization = useOrganization()
  const updateOrganization = useUpdateOrganization()
  const [saved, setSaved] = useState(false)

  return (
    <>
      <PageHeader title="Mi negocio" description="Datos fiscales de tu organización." />
      {saved && (
        <p role="status" className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Cambios guardados.
        </p>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <OrganizationForm
          organization={organization}
          submitLabel="Guardar cambios"
          onSubmit={(values) => {
            setSaved(false)
            return updateOrganization.mutateAsync(values)
          }}
          onSuccess={() => setSaved(true)}
        />
      </div>
    </>
  )
}
