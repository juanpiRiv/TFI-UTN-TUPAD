import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/format'
import { delegationErrorMessage } from './arca-errors'
import { useDeleteArcaDelegation, useVerifyArcaDelegation } from './queries'
import type { ArcaDelegationStatus } from './types'

function CopyCuit({ cuit }: { cuit: string }) {
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cuit)
      setCopied('ok')
    } catch {
      setCopied('error')
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <strong className="font-semibold text-slate-900">{cuit}</strong>
      <Button variant="secondary" className="min-h-8 px-2 py-1" onClick={() => void copy()}>
        Copiar
      </Button>
      <span role="status" className="text-slate-600">
        {copied === 'ok' && 'CUIT copiado.'}
        {copied === 'error' && 'No se pudo copiar: seleccioná el número y copialo a mano.'}
      </span>
    </span>
  )
}

function Alert({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  )
}

export function ArcaDelegationPanel({ delegation }: { delegation: ArcaDelegationStatus }) {
  const verify = useVerifyArcaDelegation()
  const remove = useDeleteArcaDelegation()
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const check = async () => {
    setVerifyError(null)
    try {
      await verify.mutateAsync()
    } catch (error) {
      setVerifyError(delegationErrorMessage(error))
    }
  }

  const disconnect = async () => {
    setDeleteError(null)
    try {
      await remove.mutateAsync()
      setConfirmingDisconnect(false)
    } catch (error) {
      setDeleteError(delegationErrorMessage(error))
    }
  }

  const verified = delegation.status === 'VERIFIED'

  return (
    <div className="flex flex-col gap-4">
      {verified ? (
        <div role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <p className="font-medium">Conectado por delegación</p>
          {delegation.verifiedAt && <p>Verificado el {formatDate(delegation.verifiedAt)}.</p>}
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-700">
            Nos autorizás desde ARCA a facturar en tu nombre. No hace falta que generes ni cargues
            ningún archivo.
          </p>
          <ol
            aria-label="Pasos para delegar en la plataforma"
            className="list-decimal space-y-2 pl-5 text-sm text-slate-700"
          >
            <li>
              Entrá a ARCA con tu clave fiscal y abrí «Administrador de Relaciones de Clave Fiscal».
            </li>
            <li>
              Elegí «Nueva relación», después «Buscar» y seleccioná ARCA › Web Services ›
              «Facturación Electrónica».
            </li>
            <li>
              En representante poné el CUIT{' '}
              {delegation.platformCuit ? (
                <CopyCuit cuit={delegation.platformCuit} />
              ) : (
                'de la plataforma'
              )}{' '}
              y confirmá.
            </li>
            <li>Volvé acá y tocá «Verificar conexión».</li>
          </ol>
          <p className="text-sm text-slate-600">
            Hace falta clave fiscal nivel 3 y un punto de venta de tipo Web Services.
          </p>
          {delegation.status === 'FAILED' && delegation.message && (
            <Alert message={delegation.message} />
          )}
        </>
      )}

      {verifyError && <Alert message={verifyError} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant={verified ? 'secondary' : 'primary'}
          loading={verify.isPending}
          onClick={() => void check()}
        >
          {verified ? 'Volver a verificar' : 'Verificar conexión'}
        </Button>
      </div>

      {verified && (
        <div className="border-t border-slate-200 pt-4">
          {deleteError && (
            <div className="mb-3">
              <Alert message={deleteError} />
            </div>
          )}
          {confirmingDisconnect ? (
            <div role="group" aria-label="Confirmar desconexión" className="flex flex-col gap-3">
              <p className="text-sm text-slate-800">
                ¿Seguro? Vas a dejar de poder emitir facturas con validez fiscal hasta que vuelvas a
                conectar ARCA.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setConfirmingDisconnect(false)
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
            <Button variant="secondary" onClick={() => setConfirmingDisconnect(true)}>
              Desconectar
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
