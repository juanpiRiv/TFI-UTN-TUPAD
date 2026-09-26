import { useNavigate } from 'react-router'
import { useLogout } from '@/features/auth/queries'
import { OrganizationForm } from './OrganizationForm'
import { useCreateOrganization } from './queries'

export function OnboardingPage() {
  const navigate = useNavigate()
  const createOrganization = useCreateOrganization()
  const logout = useLogout()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Contanos de tu actividad</h1>
          <p className="mt-1 text-sm text-slate-500">
            Con estos datos armamos tu organización. Los podés cambiar después.
          </p>
        </div>
        <button type="button" onClick={logout} className="text-sm text-slate-600 underline">
          Salir
        </button>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <OrganizationForm
          submitLabel="Crear organización"
          onSubmit={createOrganization.mutateAsync}
          onSuccess={() => void navigate('/', { replace: true })}
        />
      </div>
    </main>
  )
}
