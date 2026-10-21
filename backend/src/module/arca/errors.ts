import { AppError } from "../../lib/error.js";

/**
 * Falla anterior al envio del comprobante (configuracion, certificado, WSAA,
 * red al pedir el ticket) o peticion que el cliente se niega a armar.
 * Las respuestas de negocio de ARCA (rechazo, observaciones) NO se lanzan:
 * vuelven en CaeResult.
 */
export class FiscalProviderError extends AppError {
    readonly code: string;

    constructor(statusCode: number, code: string, message: string, details?: unknown) {
        super(statusCode, message, details);
        this.name = "FiscalProviderError";
        this.code = code;
    }
}
