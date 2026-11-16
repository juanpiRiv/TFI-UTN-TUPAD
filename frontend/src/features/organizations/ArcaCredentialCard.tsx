import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { controlClass, Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { ErrorState, FormError, LoadingState } from '@/components/ui/States'
import { formatDate } from '@/lib/format'
import {
  arcaCredentialSchema,
  type ArcaCredentialFormValues,
  type ArcaCredentialInput,
  MAX_PEM_BYTES,
} from './arca-credential-schemas'
import { errorMessage } from './arca-errors'
import { ArcaConnectWizard } from './ArcaConnectWizard'
import { ArcaDelegationPanel } from './ArcaDelegationPanel'
import {
  useArcaCredential,
  useArcaDelegation,
  useDeleteArcaCredential,
  useSaveArcaCredential,
} from './queries'

const emptyValues: ArcaCredentialFormValues = { certificate: '', privateKey: '' }

type Mode = 'delegation' | 'own'

export function ArcaCredentialCard() {
  const credential = useArcaCredential()
  const delegationQuery = useArcaDelegation()
  const [chosenMode, setChosenMode] = useState<Mode | null>(null)
  const save = useSaveArcaCredential()
  const remove = useDeleteArcaCredential()
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    resetField,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ArcaCredentialFormValues, unknown, ArcaCredentialInput>({
    resolver: zodResolver(arcaCredentialSchema),
    defaultValues: emptyValues,
  })

  const loadFile =
    (field: 'certificate' | 'privateKey') => async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      if (file.size > MAX_PEM_BYTES) {
        setError(field, { type: 'manual', message: 'El archivo es demasiado grande' })
        event.target.value = ''
        return
      }
      try {
        setValue(field, await file.text(), { shouldValidate: true })
      } catch {
        setError(field, { type: 'manual', message: 'No se pudo leer el archivo' })
      }
      // The file input keeps no reference to the content; the key lives only in the textarea.
      event.target.value = ''
    }

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await save.mutateAsync(values)
      leaveWizard()
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      // The private key must not stay in memory once it was sent, whatever the outcome.
      resetField('privateKey', { defaultValue: '' })
    }
  })

  /** Leaves the wizard and forgets whatever was typed in the advanced form (a key included). */
  const leaveWizard = () => {
    reset(emptyValues)
    setFormError(null)
    setReplacing(false)
  }

  const disconnect = async () => {
    setDeleteError(null)
    try {
      await remove.mutateAsync()
      reset(emptyValues)
      setConfirmingDelete(false)
    } catch (error) {
      setDeleteError(errorMessage(error))
    }
  }

  const status = credential.data
  const delegation = delegationQuery.data?.available ? delegationQuery.data : null
  const delegationVerified = delegation?.status === 'VERIFIED'
  // Without a choice yet: delegation, unless the business is already connected with its own certificate.
  const mode: Mode = !delegation
    ? 'own'
    : (chosenMode ?? (status?.configured && !delegationVerified ? 'own' : 'delegation'))
  const connected = Boolean(status?.configured) || delegationVerified
  const showWizard = !status?.configured || replacing

  return (
    <section
      aria-labelledby="arca-title"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <h2 id="arca-title" className="text-lg font-semibold text-slate-900">
        Facturación electrónica con ARCA
      </h2>

      {credential.isPending || delegationQuery.isPending ? (
        <LoadingState label="Cargando la conexión con ARCA…" />
      ) : credential.isError ? (
        <div className="mt-4">
          <ErrorState
            message="No se pudo consultar la conexión con ARCA."
            onRetry={() => void credential.refetch()}
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-5">
          {!connected && (
            <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Todavía no conectaste tu cuenta con ARCA: no podés emitir facturas con validez fiscal.
            </p>
          )}

          {delegation && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-slate-900">
                ¿Cómo querés conectar ARCA?
              </legend>
              {(
                [
                  ['delegation', 'Delegar en nuestra plataforma (recomendado)'],
                  ['own', 'Usar mi propio certificado'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="arca-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setChosenMode(value)}
                    className="size-4 accent-brand-700"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          {delegation && (
            <div role="group" aria-label="Delegar en la plataforma" hidden={mode !== 'delegation'}>
              <ArcaDelegationPanel delegation={delegation} />
            </div>
          )}

          <div hidden={mode !== 'own'} className="flex flex-col gap-5">
            {status?.configured ? (
              <div
                role="status"
                className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800"
              >
                <p className="font-medium">Conectada</p>
                <p>
                  {status.environment === 'PRODUCCION' ? 'Producción' : 'Homologación'}. El
                  certificado vence el {formatDate(status.certificateExpiresAt)}.
                </p>
                <p>Última actualización: {formatDate(status.updatedAt)}.</p>
              </div>
            ) : null}

            {showWizard ? (
              <>
                <ArcaConnectWizard
                  pendingCsr={status?.pendingCsr}
                  onCancel={status?.configured ? leaveWizard : undefined}
                  onConnected={leaveWizard}
                />
                <details className="text-sm text-slate-600">
                  <summary className="cursor-pointer font-medium text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                    Opciones avanzadas
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <h3 className="font-medium text-slate-900">Ya tengo certificado y clave</h3>
                    <p>
                      Si generaste la clave y el pedido de certificado por tu cuenta, cargá los dos
                      archivos. La clave se guarda cifrada y no se vuelve a mostrar.
                    </p>
                    <form
                      onSubmit={submit}
                      noValidate
                      aria-label="Cargar certificado y clave"
                      className="flex flex-col gap-4"
                    >
                      <FormError message={formError} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-3">
                          <Input
                            id="arca-certificate-file"
                            label="Archivo del certificado (.crt, .pem, .cer)"
                            type="file"
                            accept=".crt,.pem,.cer"
                            onChange={(event) => void loadFile('certificate')(event)}
                          />
                          <Field
                            id="arca-certificate"
                            label="O pegá el certificado"
                            error={errors.certificate?.message}
                          >
                            <textarea
                              id="arca-certificate"
                              rows={6}
                              spellCheck={false}
                              autoComplete="off"
                              placeholder="-----BEGIN CERTIFICATE-----"
                              aria-invalid={errors.certificate ? true : undefined}
                              aria-describedby={
                                errors.certificate ? 'arca-certificate-error' : undefined
                              }
                              className={`${controlClass} font-mono text-xs`}
                              {...register('certificate')}
                            />
                          </Field>
                        </div>
                        <div className="flex flex-col gap-3">
                          <Input
                            id="arca-key-file"
                            label="Archivo de la clave (.key, .pem)"
                            type="file"
                            accept=".key,.pem"
                            onChange={(event) => void loadFile('privateKey')(event)}
                          />
                          <Field
                            id="arca-key"
                            label="O pegá la clave privada"
                            error={errors.privateKey?.message}
                          >
                            <textarea
                              id="arca-key"
                              rows={6}
                              spellCheck={false}
                              autoComplete="off"
                              placeholder="-----BEGIN PRIVATE KEY-----"
                              aria-invalid={errors.privateKey ? true : undefined}
                              aria-describedby={errors.privateKey ? 'arca-key-error' : undefined}
                              className={`${controlClass} font-mono text-xs`}
                              {...register('privateKey')}
                            />
                          </Field>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
                          Conectar con ARCA
                        </Button>
                      </div>
                    </form>
                  </div>
                </details>
              </>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setReplacing(true)}>
                  Reemplazar
                </Button>
              </div>
            )}

            {status?.configured && (
              <div className="border-t border-slate-200 pt-4">
                {deleteError && (
                  <p
                    role="alert"
                    className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
                  >
                    {deleteError}
                  </p>
                )}
                {confirmingDelete ? (
                  <div
                    role="group"
                    aria-label="Confirmar eliminación"
                    className="flex flex-col gap-3"
                  >
                    <p className="text-sm text-slate-800">
                      ¿Seguro? Se borra el certificado y la clave.
                    </p>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setConfirmingDelete(false)
                          setDeleteError(null)
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button
                        variant="danger"
                        loading={remove.isPending}
                        onClick={() => void disconnect()}
                      >
                        Confirmar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
                    Eliminar
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
