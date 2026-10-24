import {
  ArcaAuthenticationError,
  ArcaConfigurationError,
  ArcaInputError,
  ArcaInvalidSoapResponseError,
  ArcaServiceError,
  ArcaSoapFaultError,
  ArcaTransportError,
  type ArcaFiscalIssue,
  type WsfeAuthorizationOutcome,
} from 'facturas'
import type { CaeResult, FiscalMessage } from '../fiscal-provider.js'
import { ArcaSdkError, ArcaSdkInputError } from './errors.js'

/**
 * Codigo usado cuando el SDK no entrega un codigo numerico de ARCA (por ejemplo, un SOAP Fault
 * de WSAA o una clasificacion propia del SDK). Cero no es un codigo de ARCA.
 */
export const NO_ARCA_CODE = 0

function toMessage(issue: ArcaFiscalIssue): FiscalMessage {
  const parsed = issue.code === undefined ? Number.NaN : Number.parseInt(issue.code, 10)
  return { code: Number.isInteger(parsed) ? parsed : NO_ARCA_CODE, message: issue.message }
}

/**
 * Traduce la union de resultados del SDK a CaeResult.
 *
 * - authorized + observaciones            -> AUTHORIZED_WITH_OBSERVATIONS. Manual WSFEv1 V4.8, PDF p.25:
 *   si no supera validaciones no excluyentes "el comprobante es aprobado con observaciones, se le asigna el CAE".
 * - rejected                              -> REJECTED. Las Obs del detalle son el motivo del rechazo
 *   (ejemplo del manual, PDF p.82: Resultado R con Observaciones 10030 y 10016), por eso van en errors.
 * - indeterminate                         -> INDETERMINATE. El SDK no puede probar aprobacion ni rechazo.
 */
export function mapAuthorizationOutcome(outcome: WsfeAuthorizationOutcome): CaeResult {
  const observations = outcome.observations.map(toMessage)
  const errors = outcome.errors.map(toMessage)

  if (outcome.kind === 'authorized') {
    const result: CaeResult = {
      outcome: observations.length > 0 ? 'AUTHORIZED_WITH_OBSERVATIONS' : 'AUTHORIZED',
      cae: outcome.cae,
      observations,
      errors,
      simulated: false,
      raw: outcome,
    }
    if (outcome.caeExpiry !== undefined) result.caeExpiration = outcome.caeExpiry
    return result
  }

  if (outcome.kind === 'rejected') {
    return {
      outcome: 'REJECTED',
      observations: [],
      errors: [...errors, ...observations],
      simulated: false,
      raw: outcome,
    }
  }

  // indeterminate: nunca se informa CAE aunque el SDK haya visto uno en una respuesta contradictoria.
  const reasonDetail =
    outcome.authentication?.providerCode !== undefined
      ? ` (codigo de autenticacion ${String(outcome.authentication.providerCode)})`
      : ''
  const withoutDetail = errors.length === 0 && observations.length === 0
  const marker: FiscalMessage = {
    code: NO_ARCA_CODE,
    message:
      `Resultado indeterminado segun el SDK: ${outcome.reason}${reasonDetail}.` +
      (withoutDetail ? ' wsfe.issue() no expone el codigo ni el texto del fallo (por ejemplo, el faultCode de WSAA).' : ''),
  }
  return {
    outcome: 'INDETERMINATE',
    observations,
    errors: [marker, ...errors],
    simulated: false,
    raw: outcome,
  }
}

/** Convierte cualquier excepcion del SDK en un ArcaSdkError propio (sin filtrar clases de la libreria). */
export function wrapSdkError(error: unknown): ArcaSdkError {
  if (error instanceof ArcaSdkError) return error
  if (error instanceof ArcaInputError) {
    const field = (error as { field?: string }).field
    return new ArcaSdkInputError(error.message, field === undefined ? { cause: error } : { field, cause: error })
  }
  if (error instanceof ArcaAuthenticationError) {
    return new ArcaSdkError('authentication', error.message, { cause: error })
  }
  if (error instanceof ArcaSoapFaultError) {
    return new ArcaSdkError('soap_fault', error.message, {
      ...(error.faultCode === undefined ? {} : { faultCode: error.faultCode }),
      cause: error,
    })
  }
  if (error instanceof ArcaTransportError) {
    return new ArcaSdkError('transport', error.message, { cause: error })
  }
  if (error instanceof ArcaInvalidSoapResponseError) {
    return new ArcaSdkError('invalid_response', error.message, { cause: error })
  }
  if (error instanceof ArcaServiceError) {
    const code = (error as { serviceCode?: string | number }).serviceCode
    return new ArcaSdkError('service', error.message, {
      ...(code === undefined ? {} : { providerCode: String(code) }),
      cause: error,
    })
  }
  if (error instanceof ArcaConfigurationError) {
    return new ArcaSdkError('configuration', error.message, { cause: error })
  }
  return new ArcaSdkError('unknown', error instanceof Error ? error.message : String(error), { cause: error })
}
