import { useLogout, useMe } from '@/features/auth/queries'
import { AppLayout } from './AppLayout'

/** Connects the presentational layout with the session. */
export function AppShell() {
  const { data: me } = useMe()
  const logout = useLogout()
  const organization = me?.organization

  return (
    <AppLayout
      organizationName={organization?.tradeName ?? organization?.legalName}
      userEmail={me?.email}
      onLogout={logout}
    />
  )
}
