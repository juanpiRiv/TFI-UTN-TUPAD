import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { API_URL } from '@/lib/api'
import {
  resetArcaCredentials,
  seedConfiguredCredential,
  seedPendingCsr,
} from '@/mocks/handlers/arca-credential'
import { server } from '@/mocks/node'
import { loginAs, seedOrganization, seedUser } from '@/test/fixtures'
import { renderApp } from '@/test/render'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nSUPERSECRETKEYBODY\n-----END PRIVATE KEY-----'
const PATH = `${API_URL}/api/organizations/me/arca-credential`

let organizationId: number

beforeEach(() => {
  resetArcaCredentials()
  const user = seedUser('lucia@example.com')
  organizationId = seedOrganization(user.id).id
  loginAs(user.id)
})

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

type App = ReturnType<typeof renderApp>

/** Opens the wizard on step 3 (certificate upload) with a pending request. */
async function toUploadStep(app: App) {
  seedPendingCsr(organizationId)
  await app.user.click(await screen.findByRole('button', { name: 'Ya tengo el certificado' }))
  return screen.getByRole('form', { name: 'Subir el certificado' })
}

function fileInput(label: RegExp | string) {
  return screen.getByLabelText(label) as HTMLInputElement
}

function alertsText() {
  return screen.queryAllByRole('alert').map((node) => node.textContent ?? '')
}

function captureUploads() {
  const bodies: { certificate: string }[] = []
  server.use(
    http.post(`${PATH}/certificate`, async ({ request }) => {
      bodies.push((await request.json()) as { certificate: string })
      return HttpResponse.json({ message: 'Rechazado por la prueba.' }, { status: 422 })
    }),
  )
  return bodies
}

describe('wizard: generate the request', () => {
  it('a double click creates ONE request and the button is disabled meanwhile', async () => {
    let posts = 0
    server.use(
      http.post(`${PATH}/csr`, async () => {
        posts += 1
        await delay(150)
        return HttpResponse.json(
          {
            csr: '-----BEGIN CERTIFICATE REQUEST-----\nUNA\n-----END CERTIFICATE REQUEST-----',
            createdAt: '2026-11-15T12:00:00.000Z',
          },
          { status: 201 },
        )
      }),
    )
    const { user } = renderApp('/organizacion')

    await user.dblClick(await screen.findByRole('button', { name: 'Generar solicitud' }))

    expect(screen.getByRole('button', { name: 'Procesando…' })).toBeDisabled()
    expect(await screen.findByDisplayValue(/UNA/)).toBeInTheDocument()
    expect(posts).toBe(1)
  })

  it.each([
    [
      503,
      { message: 'El servidor no tiene clave de cifrado.' },
      'El servidor no tiene clave de cifrado.',
    ],
    [500, { error: 'Error interno' }, 'Error interno'],
    [500, null, 'Error 500'],
  ])('shows a %s error as an alert and stays on step 1', async (status, body, expected) => {
    server.use(
      http.post(`${PATH}/csr`, () =>
        body ? HttpResponse.json(body, { status }) : new HttpResponse(null, { status }),
      ),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Generar solicitud' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
    expect(screen.getByRole('button', { name: 'Generar solicitud' })).toBeEnabled()
    expect(screen.queryByLabelText('Solicitud de certificado (CSR)')).not.toBeInTheDocument()
  })

  it('a network error says it could not reach the server', async () => {
    server.use(http.post(`${PATH}/csr`, () => HttpResponse.error()))
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Generar solicitud' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo conectar con el servidor',
    )
  })

  it('retrying after an error works and clears the error', async () => {
    let fail = true
    server.use(
      http.post(`${PATH}/csr`, () =>
        fail
          ? HttpResponse.json({ message: 'Intentá de nuevo en un rato.' }, { status: 503 })
          : HttpResponse.json(
              {
                csr: '-----BEGIN CERTIFICATE REQUEST-----\nREINTENTO\n-----END CERTIFICATE REQUEST-----',
                createdAt: '2026-11-15T12:00:00.000Z',
              },
              { status: 201 },
            ),
      ),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Generar solicitud' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Intentá de nuevo en un rato.')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Generar solicitud' }))

    expect(await screen.findByDisplayValue(/REINTENTO/)).toBeInTheDocument()
    expect(screen.queryByText('Intentá de nuevo en un rato.')).not.toBeInTheDocument()
  })

  it('after a reload the pending request resumes on step 2', async () => {
    const first = renderApp('/organizacion')
    await first.user.click(await screen.findByRole('button', { name: 'Generar solicitud' }))
    await screen.findByDisplayValue(/NUEVA/)
    first.unmount()

    renderApp('/organizacion')

    expect(await screen.findByDisplayValue(/NUEVA/)).toBeInTheDocument()
    const steps = within(screen.getByRole('list', { name: 'Pasos para conectar ARCA' }))
    expect(steps.getByText(/Paso 2/).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Ya tengo el certificado' })).toBeInTheDocument()
  })

  it('warns, before asking, that a new request invalidates the previous one', async () => {
    seedPendingCsr(organizationId)
    renderApp('/organizacion')

    expect(await screen.findByText(/la anterior deja de servir/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar una nueva solicitud' })).toBeInTheDocument()
  })
})

describe('wizard: copy and download the request', () => {
  it('falls back to a message when navigator.clipboard is undefined', async () => {
    seedPendingCsr(organizationId)
    const { user } = renderApp('/organizacion')
    const button = await screen.findByRole('button', { name: 'Copiar' })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    await user.click(button)

    expect(await screen.findByText(/No se pudo copiar/)).toBeInTheDocument()
    expect(screen.getByLabelText('Solicitud de certificado (CSR)')).toHaveDisplayValue(/PENDIENTE/)
  })

  it('falls back to a message when the clipboard rejects, and the text stays selectable', async () => {
    seedPendingCsr(organizationId)
    const { user } = renderApp('/organizacion')
    const button = await screen.findByRole('button', { name: 'Copiar' })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      configurable: true,
    })

    await user.click(button)

    expect(await screen.findByText(/No se pudo copiar/)).toBeInTheDocument()
    const box = screen.getByLabelText('Solicitud de certificado (CSR)') as HTMLTextAreaElement
    expect(box).not.toBeDisabled()
    box.select()
    expect(box.value.slice(box.selectionStart, box.selectionEnd)).toBe(box.value)
  })

  it('the download link carries the exact CSR with a .csr filename', async () => {
    const pending = seedPendingCsr(organizationId)
    renderApp('/organizacion')

    const link = await screen.findByRole('link', { name: 'Descargar .csr' })

    expect(link).toHaveAttribute('download', 'solicitud-arca.csr')
    const href = link.getAttribute('href') ?? ''
    expect(href).toMatch(/^data:application\/x-pem-file;charset=utf-8,/)
    expect(decodeURIComponent(href.split(',')[1] ?? '')).toBe(pending.csr)
  })

  it('the CSR box is read-only: typing does not change it', async () => {
    seedPendingCsr(organizationId)
    const { user } = renderApp('/organizacion')
    const box = await screen.findByLabelText('Solicitud de certificado (CSR)')
    const before = (box as HTMLTextAreaElement).value

    await user.type(box, 'hola')

    expect(box).toHaveAttribute('readonly')
    expect(box).toHaveValue(before)
  })
})

describe('wizard: upload the certificate', () => {
  it('a file with a foreign extension is ignored by the picker filter', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)

    await app.user.upload(
      fileInput(/Elegí el archivo del certificado/),
      new File([CERT], 'notas.txt', { type: 'text/plain' }),
    )

    expect(screen.getByLabelText('Pegá el certificado')).toHaveValue('')
  })

  it('a foreign file that gets through is rejected by content, never sent', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()

    fireEvent.change(fileInput(/Elegí el archivo del certificado/), {
      target: { files: [new File(['hola, esto es un txt'], 'notas.txt', { type: 'text/plain' })] },
    })
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByText(/debe incluir BEGIN CERTIFICATE/)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('an empty file shows the "pegá o subí" message and sends nothing', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()

    await app.user.upload(
      fileInput(/Elegí el archivo del certificado/),
      new File([''], 'vacio.crt', { type: 'application/x-x509-ca-cert' }),
    )

    expect(await screen.findByText('Pegá o subí el certificado')).toBeInTheDocument()
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))
    expect(bodies).toHaveLength(0)
  })

  it('a file over the size limit is refused without loading it', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()
    const big = new File([`${CERT}\n${'A'.repeat(1_100_000)}`], 'enorme.crt')

    await app.user.upload(fileInput(/Elegí el archivo del certificado/), big)

    expect(await screen.findByText('El archivo es demasiado grande')).toBeInTheDocument()
    expect(screen.getByLabelText('Pegá el certificado')).toHaveValue('')
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))
    expect(bodies).toHaveLength(0)
  })

  it('a binary (DER) file is rejected by the PEM check', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()
    const der = new File(
      [new Uint8Array([0x30, 0x82, 0x03, 0x4d, 0xff, 0xfe, 0x00, 0x01])],
      'cert.cer',
    )

    await app.user.upload(fileInput(/Elegí el archivo del certificado/), der)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByText(/debe incluir BEGIN CERTIFICATE/)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('a read failure shows "No se pudo leer el archivo"', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const broken = new File([CERT], 'roto.crt')
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('io')) })

    fireEvent.change(fileInput(/Elegí el archivo del certificado/), { target: { files: [broken] } })

    expect(await screen.findByText('No se pudo leer el archivo')).toBeInTheDocument()
  })

  it('cancelling the picker keeps what was already pasted', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    fill('Pegá el certificado', CERT)

    fireEvent.change(fileInput(/Elegí el archivo del certificado/), { target: { files: [] } })

    expect(screen.getByLabelText('Pegá el certificado')).toHaveValue(CERT)
    expect(alertsText()).toEqual([])
  })

  it('sends pasted text trimmed (a textarea normalizes CRLF to LF, as browsers do)', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()

    fill('Pegá el certificado', `  \r\n\t${CERT.replaceAll('\n', '\r\n')}\r\n   \n`)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    await screen.findByText('Rechazado por la prueba.')
    expect(bodies).toEqual([{ certificate: CERT }])
  })

  it('a CRLF file is sent trimmed with its line breaks intact', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()
    const crlf = CERT.replaceAll('\n', '\r\n')

    await app.user.upload(
      fileInput(/Elegí el archivo del certificado/),
      new File([`\r\n  ${crlf}\r\n\r\n`], 'windows.crt'),
    )
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    await screen.findByText('Rechazado por la prueba.')
    expect(bodies).toEqual([{ certificate: crlf }])
  })

  it('an empty submit is blocked with a clear message', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()

    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pegá o subí el certificado')
    fill('Pegá el certificado', '   \n  ')
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pegá o subí el certificado')
    expect(bodies).toHaveLength(0)
  })

  it('a pasted PRIVATE KEY is rejected, never sent and never echoed in an alert', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()

    fill('Pegá el certificado', KEY)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(
      await screen.findByText('Eso es una clave privada. Pegá solo el certificado (.crt).'),
    ).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
    for (const text of alertsText()) {
      expect(text).not.toContain('SUPERSECRETKEYBODY')
      expect(text).not.toContain('PRIVATE KEY-----')
    }
  })

  it('a certificate bundled with a private key is rejected too', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const bodies = captureUploads()

    fill('Pegá el certificado', `${CERT}\n${KEY}`)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByText(/Eso es una clave privada/)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('a key loaded from a file into the certificate box is rejected the same way', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)

    await app.user.upload(
      fileInput(/Elegí el archivo del certificado/),
      new File([KEY], 'clave.pem', { type: 'application/x-pem-file' }),
    )

    expect(await screen.findByText(/Eso es una clave privada/)).toBeInTheDocument()
  })

  it.each([
    'Primero generá la solicitud de certificado.',
    'El certificado no corresponde a la solicitud generada.',
    'El certificado no corresponde al CUIT de tu negocio.',
    'El certificado está vencido.',
  ])('a 422 renders its message verbatim: %s', async (message) => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    server.use(
      http.post(`${PATH}/certificate`, () => HttpResponse.json({ message }, { status: 422 })),
    )

    fill('Pegá el certificado', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('form', { name: 'Subir el certificado' })).toBeInTheDocument()
    expect(screen.getByLabelText('Pegá el certificado')).toHaveValue(CERT)
  })

  it('a 422 message with HTML is rendered as text, never as markup', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    const message = '<script>window.__pwned = 1</script><b>negrita</b>'
    server.use(
      http.post(`${PATH}/certificate`, () => HttpResponse.json({ message }, { status: 422 })),
    )

    fill('Pegá el certificado', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(message)
    expect(alert.querySelector('script, b')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('a 503 message is shown and the form stays usable', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    server.use(
      http.post(`${PATH}/certificate`, () =>
        HttpResponse.json({ message: 'ARCA no está disponible.' }, { status: 503 }),
      ),
    )

    fill('Pegá el certificado', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ARCA no está disponible.')
    expect(screen.getByRole('button', { name: 'Subir certificado' })).toBeEnabled()
  })

  it('on success shows the expiry and hides the wizard', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)

    fill('Pegá el certificado', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByText('Conectada')).toBeInTheDocument()
    expect(screen.getByText(/El certificado vence el 21\/10\/2028/)).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Subir el certificado' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Pasos para conectar ARCA' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a double submit sends the certificate once', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    let posts = 0
    server.use(
      http.post(`${PATH}/certificate`, async () => {
        posts += 1
        await delay(150)
        return HttpResponse.json({ message: 'Rechazado por la prueba.' }, { status: 422 })
      }),
    )

    fill('Pegá el certificado', CERT)
    await app.user.dblClick(screen.getByRole('button', { name: 'Subir certificado' }))

    await screen.findByText('Rechazado por la prueba.')
    expect(posts).toBe(1)
  })
})

describe('session expiry', () => {
  it.each([['generating the request', 'Generar solicitud', 'csr']])(
    'a 401 while %s sends the user to the login',
    async (_name, button, path) => {
      server.use(
        http.post(`${PATH}/${path}`, () =>
          HttpResponse.json({ error: 'Token expirado' }, { status: 401 }),
        ),
      )
      const { user } = renderApp('/organizacion')

      await user.click(await screen.findByRole('button', { name: button }))

      expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    },
  )

  it('a 401 while uploading the certificate sends the user to the login', async () => {
    const app = renderApp('/organizacion')
    await toUploadStep(app)
    server.use(
      http.post(`${PATH}/certificate`, () =>
        HttpResponse.json({ error: 'Token expirado' }, { status: 401 }),
      ),
    )

    fill('Pegá el certificado', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Subir certificado' }))

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('a 401 while loading the status sends the user to the login', async () => {
    server.use(
      http.get(PATH, () => HttpResponse.json({ error: 'Token expirado' }, { status: 401 })),
    )

    renderApp('/organizacion')

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('a 401 while deleting sends the user to the login', async () => {
    seedConfiguredCredential(organizationId)
    server.use(
      http.delete(PATH, () => HttpResponse.json({ error: 'Token expirado' }, { status: 401 })),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })
})

describe('connected state', () => {
  beforeEach(() => seedConfiguredCredential(organizationId))

  it('"Reemplazar" opens a fresh wizard on step 1 and "Cancelar" returns to the connected view', async () => {
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Reemplazar' }))
    expect(screen.getByRole('button', { name: 'Generar solicitud' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reemplazar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Generar solicitud' }))
    await screen.findByDisplayValue(/NUEVA/)

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Conectada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reemplazar' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Pasos para conectar ARCA' })).not.toBeInTheDocument()
  })

  it('"Eliminar" asks for confirmation, can be cancelled and only then calls the server', async () => {
    let deletes = 0
    server.use(
      http.delete(PATH, () => {
        deletes += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderApp('/organizacion')

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    expect(deletes).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(deletes).toBe(0)
    expect(screen.queryByRole('group', { name: 'Confirmar eliminación' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(deletes).toBe(1))
  })

  it.each([
    [
      '500 JSON',
      () => HttpResponse.json({ error: 'No se pudo borrar' }, { status: 500 }),
      'No se pudo borrar',
    ],
    [
      '503 message',
      () => HttpResponse.json({ message: 'Servicio caído' }, { status: 503 }),
      'Servicio caído',
    ],
    ['network', () => HttpResponse.error(), 'No se pudo conectar con el servidor'],
  ])(
    'a failed delete (%s) shows the error, keeps the credential and can be retried',
    async (_n, reply, text) => {
      let fail = true
      server.use(http.delete(PATH, () => (fail ? reply() : undefined)))
      const { user } = renderApp('/organizacion')

      await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
      await user.click(screen.getByRole('button', { name: 'Confirmar' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(text)
      expect(screen.getByText('Conectada')).toBeInTheDocument()
      fail = false
      await user.click(screen.getByRole('button', { name: 'Confirmar' }))
      expect(await screen.findByText(/Todavía no conectaste tu cuenta con ARCA/)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('cancelling the confirmation clears a previous delete error', async () => {
    server.use(http.delete(PATH, () => HttpResponse.json({ error: 'Falló' }, { status: 500 })))
    const { user } = renderApp('/organizacion')
    await user.click(await screen.findByRole('button', { name: 'Eliminar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('advanced path: "Ya tengo certificado y clave"', () => {
  async function openAdvanced(app: App) {
    await app.user.click(await screen.findByText('Opciones avanzadas'))
    return screen.getByRole('form', { name: 'Cargar certificado y clave' })
  }

  function captureSaves() {
    const bodies: unknown[] = []
    server.use(
      http.post(PATH, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ error: 'Rechazado por la prueba' }, { status: 422 })
      }),
    )
    return bodies
  }

  it('a missing key blocks the submit', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)
    const bodies = captureSaves()

    fill('O pegá el certificado', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))

    expect(await screen.findByText(/debe incluir PRIVATE KEY/)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('a missing certificate blocks the submit with the "pegá o subí" message', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)
    const bodies = captureSaves()

    fill('O pegá la clave privada', KEY)
    await app.user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))

    expect(await screen.findByText('Pegá o subí el certificado')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('a key pasted in the certificate box is rejected and never echoed', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)
    const bodies = captureSaves()

    fill('O pegá el certificado', KEY)
    fill('O pegá la clave privada', KEY)
    await app.user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))

    expect(await screen.findByText(/Eso es una clave privada/)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
    for (const text of alertsText()) expect(text).not.toContain('SUPERSECRETKEYBODY')
  })

  it('a certificate pasted in the key box is rejected', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)
    const bodies = captureSaves()

    fill('O pegá el certificado', CERT)
    fill('O pegá la clave privada', CERT)
    await app.user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))

    expect(await screen.findByText(/debe incluir PRIVATE KEY/)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('a key file over the size limit is refused', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)

    await app.user.upload(
      screen.getByLabelText(/Archivo de la clave/),
      new File([`${KEY}\n${'A'.repeat(1_100_000)}`], 'enorme.key'),
    )

    expect(await screen.findByText('El archivo es demasiado grande')).toBeInTheDocument()
    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
  })

  it('cancelling "Reemplazar" forgets what was typed in the advanced form', async () => {
    seedConfiguredCredential(organizationId)
    const app = renderApp('/organizacion')
    await app.user.click(await screen.findByRole('button', { name: 'Reemplazar' }))
    await openAdvanced(app)
    fill('O pegá el certificado', CERT)
    fill('O pegá la clave privada', KEY)

    await app.user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await app.user.click(screen.getByRole('button', { name: 'Reemplazar' }))
    await app.user.click(screen.getByText('Opciones avanzadas'))

    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
    expect(screen.getByLabelText('O pegá el certificado')).toHaveValue('')
  })

  it('after deleting the credential nothing typed before comes back', async () => {
    seedConfiguredCredential(organizationId)
    const app = renderApp('/organizacion')
    await app.user.click(await screen.findByRole('button', { name: 'Reemplazar' }))
    await openAdvanced(app)
    fill('O pegá la clave privada', KEY)
    await app.user.click(screen.getByRole('button', { name: 'Cancelar' }))

    await app.user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await app.user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await screen.findByText(/Todavía no conectaste tu cuenta con ARCA/)
    await app.user.click(screen.getByText('Opciones avanzadas'))

    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
  })

  it('a rejected submit clears the key but keeps the certificate, and shows the server message', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)
    captureSaves()

    fill('O pegá el certificado', CERT)
    fill('O pegá la clave privada', KEY)
    await app.user.click(screen.getByRole('button', { name: 'Conectar con ARCA' }))

    expect(await screen.findByText('Rechazado por la prueba')).toBeInTheDocument()
    expect(screen.getByLabelText('O pegá la clave privada')).toHaveValue('')
    for (const text of alertsText()) expect(text).not.toContain('SUPERSECRETKEYBODY')
  })

  it('the wizard certificate box does not receive what was typed in the advanced one', async () => {
    const app = renderApp('/organizacion')
    await openAdvanced(app)
    fill('O pegá el certificado', CERT)

    seedPendingCsr(organizationId)
    await app.queryClient.invalidateQueries()
    await app.user.click(await screen.findByRole('button', { name: 'Ya tengo el certificado' }))

    expect(screen.getByLabelText('Pegá el certificado')).toHaveValue('')
  })
})
