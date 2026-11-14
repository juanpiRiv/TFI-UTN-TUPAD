/**
 * El proveedor fiscal no se pudo armar por un motivo que el usuario o quien administra el servidor puede
 * entender y corregir. Su mensaje es seguro para mostrarse: nunca incluye certificados, claves, rutas ni
 * detalles de la base. Cualquier otro error se muestra con un texto genérico y se registra en el servidor.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}
