export type ArcaSdkErrorKind =
  | 'input' // validacion local: no se envio nada a ARCA
  | 'authentication' // rechazo de credenciales o del Ticket de Acceso
  | 'transport' // red, timeout, HTTP sin XML
  | 'soap_fault' // SOAP Fault (incluye los de WSAA)
  | 'invalid_response' // respuesta no interpretable
  | 'service' // error del servicio en operaciones no fiscales
  | 'configuration'
  | 'unknown'

/** Error propio del adaptador: el dominio no importa ninguna clase de la libreria. */
export class ArcaSdkError extends Error {
  readonly kind: ArcaSdkErrorKind
  readonly faultCode?: string
  readonly providerCode?: string

  constructor(
    kind: ArcaSdkErrorKind,
    message: string,
    extra: { faultCode?: string; providerCode?: string; cause?: unknown } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause })
    this.name = 'ArcaSdkError'
    this.kind = kind
    if (extra.faultCode !== undefined) this.faultCode = extra.faultCode
    if (extra.providerCode !== undefined) this.providerCode = extra.providerCode
  }
}

/** El CaeRequest no pasa la validacion del adaptador. Nunca se llamo a ARCA. */
export class ArcaSdkInputError extends ArcaSdkError {
  readonly field?: string

  constructor(message: string, extra: { field?: string; cause?: unknown } = {}) {
    super('input', message, extra.cause === undefined ? {} : { cause: extra.cause })
    this.name = 'ArcaSdkInputError'
    if (extra.field !== undefined) this.field = extra.field
  }
}
