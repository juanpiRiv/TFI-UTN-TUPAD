import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { LoadingState } from '@/components/ui/States'
import { useMe } from '@/features/auth/queries'
import { PasswordForm } from './PasswordForm'
import { ProfileForm } from './ProfileForm'

function SavedMessage({ children }: { children: string }) {
  return (
    <p role="status" className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
      {children}
    </p>
  )
}

export function ProfilePage() {
  const { data: me } = useMe()
  const [profileSaved, setProfileSaved] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  if (!me) return <LoadingState />

  return (
    <>
      <PageHeader title="Mi perfil" description="Tus datos de acceso al sistema." />

      <section aria-labelledby="profile-data" className="mb-6">
        <h2 id="profile-data" className="mb-3 font-semibold text-slate-800">
          Datos personales
        </h2>
        {profileSaved && <SavedMessage>Datos guardados.</SavedMessage>}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          {/* key: Si el email cambia, el formulario reaparece con el nuevo*/}
          <ProfileForm
            key={me.email}
            user={me}
            onSuccess={() => {
              setProfileSaved(true)
              setPasswordSaved(false)
            }}
          />
        </div>
      </section>

      <section aria-labelledby="profile-password">
        <h2 id="profile-password" className="mb-3 font-semibold text-slate-800">
          Contraseña
        </h2>
        {passwordSaved && <SavedMessage>Contraseña actualizada.</SavedMessage>}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <PasswordForm
            onSuccess={() => {
              setPasswordSaved(true)
              setProfileSaved(false)
            }}
          />
        </div>
      </section>
    </>
  )
}
