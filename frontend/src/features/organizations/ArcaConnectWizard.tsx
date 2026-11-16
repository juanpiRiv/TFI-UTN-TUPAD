import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { controlClass, Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { FormError } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import {
  arcaCertificateSchema,
  type ArcaCertificateFormValues,
  type ArcaCertificateInput,
  MAX_PEM_BYTES,
} from './arca-credential-schemas'
import { errorMessage } from './arca-errors'
import { useGenerateArcaCsr, useUploadArcaCertificate } from './queries'
import type { ArcaPendingCsr } from './types'

type Step = 1 | 2 | 3

const STEPS: { id: Step; title: string }[] = [
  { id: 1, title: 'Generar la solicitud' },
  { id: 2, title: 'Pedir el certificado en ARCA' },
  { id: 3, title: 'Subir el certificado' },
]

function CsrBox({ csr }: { csr: string }) {
  const [copied, setCopied] = useState<'ok' | 'error' | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csr)
      setCopied('ok')
    } catch {
      setCopied('error')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Field id="arca-csr" label="Solicitud de certificado (CSR)">
        <textarea
          id="arca-csr"
          readOnly
          rows={6}
          spellCheck={false}
          value={csr}
          className={`${controlClass} font-mono text-xs`}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          Copiar
        </Button>
        <a
          href={`data:application/x-pem-file;charset=utf-8,${encodeURIComponent(csr)}`}
          download="solicitud-arca.csr"
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Descargar .csr
        </a>
        <span role="status" className="text-sm text-slate-600">
          {copied === 'ok' && 'Copiado al portapapeles.'}
          {copied === 'error' && 'No se pudo copiar: seleccioná el texto o usá Descargar .csr.'}
        </span>
      </div>
    </div>
  )
}

type WizardProps = {
  pendingCsr?: ArcaPendingCsr
  /** Shown when the wizard replaces a connected credential. */
  onCancel?: () => void
  onConnected: () => void
}

export function ArcaConnectWizard({ pendingCsr, onCancel, onConnected }: WizardProps) {
  const generate = useGenerateArcaCsr()
  const upload = useUploadArcaCertificate()
  const [manualStep, setManualStep] = useState<Step | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const csr = generate.data ?? pendingCsr
  const step: Step = manualStep ?? (csr ? 2 : 1)

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ArcaCertificateFormValues, unknown, ArcaCertificateInput>({
    resolver: zodResolver(arcaCertificateSchema),
    defaultValues: { certificate: '' },
  })

  const createRequest = async () => {
    setGenerateError(null)
    try {
      await generate.mutateAsync()
      setManualStep(1)
    } catch (error) {
      setGenerateError(errorMessage(error))
    }
  }

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PEM_BYTES) {
      setError('certificate', { type: 'manual', message: 'El archivo es demasiado grande' })
      event.target.value = ''
      return
    }
    try {
      setValue('certificate', await file.text(), { shouldValidate: true })
    } catch {
      setError('certificate', { type: 'manual', message: 'No se pudo leer el archivo' })
    }
    event.target.value = ''
  }

  const submit = handleSubmit(async (values) => {
    setUploadError(null)
    try {
      await upload.mutateAsync(values)
      generate.reset()
      onConnected()
    } catch (error) {
      setUploadError(errorMessage(error))
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label="Pasos para conectar ARCA" className="flex flex-col gap-2 sm:flex-row">
        {STEPS.map((item) => (
          <li
            key={item.id}
            aria-current={item.id === step ? 'step' : undefined}
            className={cn(
              'flex-1 rounded-lg border px-3 py-2 text-sm',
              item.id === step
                ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800'
                : 'border-slate-200 text-slate-600',
            )}
          >
            Paso {item.id}: {item.title}
          </li>
        ))}
      </ol>

      <FormError message={generateError} />

      {step === 1 && (
        <section aria-label="Paso 1: Generar la solicitud" className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">
            Generamos una solicitud de certificado (CSR) para tu CUIT. La clave privada se crea y se
            guarda cifrada: nunca tenés que verla ni cargarla.
          </p>
          {csr && <CsrBox csr={csr.csr} />}
          {csr && (
            <p className="text-sm text-slate-600">
              Si generás una nueva solicitud, la anterior deja de servir: si ya la usaste en ARCA,
              tendrías que pedir el certificado de nuevo.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant={csr ? 'secondary' : 'primary'}
              loading={generate.isPending}
              onClick={() => void createRequest()}
            >
              {csr ? 'Generar una nueva solicitud' : 'Generar solicitud'}
            </Button>
            {csr && <Button onClick={() => setManualStep(2)}>Continuar</Button>}
          </div>
        </section>
      )}

      {step === 2 && (
        <section aria-label="Paso 2: Pedir el certificado en ARCA" className="flex flex-col gap-3">
          {csr && <CsrBox csr={csr.csr} />}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Ingresá a ARCA (arca.gob.ar) con tu CUIT y tu clave fiscal.</li>
            <li>
              Homologación (pruebas): abrí el servicio WSASS, elegí «Nuevo certificado», poné un
              alias y pegá la solicitud (o subí el archivo .csr).
            </li>
            <li>
              En WSASS, asociá el servicio web <code>wsfe</code> al alias del certificado.
            </li>
            <li>Descargá el certificado (.crt) que te entrega ARCA.</li>
            <li>
              Producción: usá «Administración de Certificados» y creá un punto de venta de tipo «Web
              Services».
            </li>
          </ol>
          {csr && (
            <p className="text-sm text-slate-600">
              Si generás una nueva solicitud, la anterior deja de servir: si ya la usaste en ARCA,
              tendrías que pedir el certificado de nuevo.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setManualStep(1)}>
              Volver
            </Button>
            <Button
              variant="secondary"
              loading={generate.isPending}
              onClick={() => void createRequest()}
            >
              Generar una nueva solicitud
            </Button>
            <Button onClick={() => setManualStep(3)}>Ya tengo el certificado</Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <form
          onSubmit={submit}
          noValidate
          aria-label="Subir el certificado"
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-slate-700">
            Subí el certificado que te dio ARCA. Solo el certificado: la clave privada ya la guardamos
            nosotros.
          </p>
          <FormError message={uploadError} />
          <Input
            id="arca-wizard-certificate-file"
            label="Elegí el archivo del certificado (.crt, .pem)"
            type="file"
            accept=".crt,.pem,.cer"
            onChange={(event) => void loadFile(event)}
          />
          <Field
            id="arca-wizard-certificate"
            label="Pegá el certificado"
            error={errors.certificate?.message}
          >
            <textarea
              id="arca-wizard-certificate"
              rows={6}
              spellCheck={false}
              autoComplete="off"
              placeholder="-----BEGIN CERTIFICATE-----"
              aria-invalid={errors.certificate ? true : undefined}
              aria-describedby={errors.certificate ? 'arca-wizard-certificate-error' : undefined}
              className={`${controlClass} font-mono text-xs`}
              {...register('certificate')}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setManualStep(2)}>
              Volver
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Subir certificado
            </Button>
          </div>
        </form>
      )}

      {onCancel && (
        <div>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  )
}
