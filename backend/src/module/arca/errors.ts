/**
 * El proveedor fiscal no se pudo armar por un motivo que el usuario o quien administra el servidor puede
 * entender y corregir. Su mensaje es seguro para mostrarse: nunca incluye certificados, claves, rutas ni
 * detalles de la base. Cualquier otro error se muestra con un texto genérico y se registra en el servidor.
 */
export class ProviderUnavailableError extends Error {
  /**
   * Lo que ve la persona que factura. `message` es el detalle para quien administra el servidor (variables de
   * entorno, configuración): va al registro, nunca a la API. Sin `userMessage`, se muestra un texto genérico.
   */
  readonly userMessage: string

  constructor(message: string, userMessage: string = GENERIC_USER_MESSAGE) {
    super(message)
    this.name = 'ProviderUnavailableError'
    this.userMessage = userMessage
  }
}

export const GENERIC_USER_MESSAGE = 'La facturación con ARCA no está disponible en este momento. Probá de nuevo más tarde.'
