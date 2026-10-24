import type { CaeRequest, CaeResult, FiscalProvider, LastAuthorizedParams } from "../fiscal-provider.js";
import { FiscalProviderError } from "../errors.js";
import { SoapTransportError, type SoapTransport } from "./soap.js";
import { WsaaClient, type ArcaDigest } from "./wsaa.js";
import {
    assertSupportedRequest,
    AUTH_ERROR_CODES,
    callCaeSolicitar,
    callDummy,
    callUltimoAutorizado,
    INTERNAL_ERROR_CODES,
    mapCaeResult,
    readMessages,
    transportFailure,
    wsfeFailure,
    type FeAuth,
} from "./wsfe.js";
import { listOf, asText } from "./soap.js";

export type ArcaEnvironment = "HOMOLOGACION" | "PRODUCCION";

/**
 * URLs oficiales. WSAA: https://www.afip.gob.ar/ws/documentacion/wsaa.asp (consultada 2026-10-19).
 * WSFEv1: Manual del Desarrollador V4.8, p.22 (Direccion URL).
 */
export const ARCA_ENDPOINTS: Record<ArcaEnvironment, { wsaa: string; wsfe: string }> = {
    HOMOLOGACION: {
        wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
        wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
    },
    PRODUCCION: {
        wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
        wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    },
};

export interface ArcaWsfeClientOptions extends SoapTransport {
    environment: ArcaEnvironment;
    /** Certificado X.509 en PEM. */
    certPem: string;
    /** Clave privada RSA en PEM (sin cifrar). Nunca se loguea ni se serializa. */
    keyPem: string;
    wsaaUrl?: string;
    wsfeUrl?: string;
    digest?: ArcaDigest;
    now?: () => Date;
    failureCooldownMs?: number;
}

/**
 * Alternativa A: cliente directo WSAA + WSFEv1 sobre la documentacion oficial.
 * Un cliente por certificado (organizacion + ambiente): la cache del TA vive en la instancia.
 *
 * Contrato de errores:
 * - respuestas procesadas por ARCA (aprobado, observado, rechazado) => CaeResult;
 * - timeout, corte o respuesta ambigua DESPUES de enviar el comprobante => CaeResult INDETERMINATE;
 * - fallas ANTES de poder enviarlo (peticion invalida, credenciales, WSAA) => FiscalProviderError.
 */
export class ArcaWsfeClient implements FiscalProvider {
    readonly name = "arca-wsfe-directo";
    private readonly wsaa: WsaaClient;
    private readonly wsfeUrl: string;
    private readonly transport: SoapTransport;

    constructor(options: ArcaWsfeClientOptions) {
        const defaults = ARCA_ENDPOINTS[options.environment];
        this.wsfeUrl = options.wsfeUrl ?? defaults.wsfe;
        this.transport = {
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.onExchange ? { onExchange: options.onExchange } : {}),
        };
        this.wsaa = new WsaaClient({
            ...this.transport,
            endpoint: options.wsaaUrl ?? defaults.wsaa,
            certPem: options.certPem,
            keyPem: options.keyPem,
            service: "wsfe",
            ...(options.digest ? { digest: options.digest } : {}),
            ...(options.now ? { now: options.now } : {}),
            ...(options.failureCooldownMs !== undefined ? { failureCooldownMs: options.failureCooldownMs } : {}),
        });
    }

    /** FEDummy no requiere autenticacion (Manual V4.8 p.125). */
    async healthCheck(): Promise<{ ok: boolean; detail: string }> {
        try {
            const r = await callDummy(this.wsfeUrl, this.transport);
            if (r.kind !== "ok") {
                return { ok: false, detail: r.kind === "fault" ? `SoapFault ${r.faultcode}` : `Respuesta ilegible: ${r.reason}` };
            }
            const { appServer, dbServer, authServer } = r.result;
            const ok = appServer === "OK" && dbServer === "OK" && authServer === "OK";
            return { ok, detail: `AppServer=${appServer} DbServer=${dbServer} AuthServer=${authServer}` };
        } catch (err) {
            if (err instanceof SoapTransportError) return { ok: false, detail: `Sin respuesta (${err.kind}): ${err.message}` };
            throw err;
        }
    }

    private async auth(cuit: string): Promise<FeAuth> {
        if (!/^\d{11}$/.test(cuit)) {
            throw new FiscalProviderError(422, "FISCAL_REQUEST_INVALID", "CUIT invalido (11 digitos)", { field: "cuit" });
        }
        const ticket = await this.wsaa.getTicket();
        return { token: ticket.token, sign: ticket.sign, cuit };
    }

    async getLastAuthorized(params: LastAuthorizedParams): Promise<{ voucherNumber: number }> {
        const auth = await this.auth(params.cuit);
        let r;
        try {
            r = await callUltimoAutorizado(this.wsfeUrl, auth, params.pointOfSale, params.voucherType, this.transport);
        } catch (err) {
            if (err instanceof SoapTransportError) throw transportFailure("FECompUltimoAutorizado", err);
            throw err;
        }
        if (r.kind !== "ok") throw wsfeFailure("FECompUltimoAutorizado", r);
        if (r.result.errors.some((e) => AUTH_ERROR_CODES.has(e.code))) this.wsaa.invalidate();
        if (r.result.errors.length > 0 || r.result.voucherNumber === undefined) {
            throw new FiscalProviderError(502, "WSFE_ERROR", "WSFEv1 no devolvio el ultimo comprobante autorizado", {
                errors: r.result.errors,
            });
        }
        return { voucherNumber: r.result.voucherNumber };
    }

    async requestCae(request: CaeRequest): Promise<CaeResult> {
        assertSupportedRequest(request);
        const auth = await this.auth(request.cuit);

        let r;
        try {
            r = await callCaeSolicitar(this.wsfeUrl, auth, request, this.transport);
        } catch (err) {
            if (err instanceof SoapTransportError) {
                // El POST pudo haber llegado: no se sabe si ARCA registro el comprobante.
                return {
                    outcome: "INDETERMINATE",
                    observations: [],
                    errors: [{ code: 0, message: `Sin respuesta de WSFEv1 (${err.kind}): ${err.message}` }],
                    simulated: false,
                    raw: { transport: err.kind },
                };
            }
            throw err;
        }

        if (r.kind === "fault") {
            return {
                outcome: "INDETERMINATE",
                observations: [],
                errors: [{ code: 0, message: `SoapFault ${r.faultcode}: ${r.faultstring}` }],
                simulated: false,
                raw: { faultcode: r.faultcode, httpStatus: r.httpStatus },
            };
        }
        if (r.kind === "unparseable") {
            return {
                outcome: "INDETERMINATE",
                observations: [],
                errors: [{ code: 0, message: `Respuesta ilegible de WSFEv1: ${r.reason}` }],
                simulated: false,
                raw: { httpStatus: r.httpStatus },
            };
        }

        const errorCodes = listOf(r.result["Errors"], "Err").map((e) => Number(asText(e["Code"]) ?? "0"));
        const noDetail = listOf(r.result["FeDetResp"], "FECAEDetResponse").length === 0;
        if (noDetail && errorCodes.length > 0 && errorCodes.every((c) => AUTH_ERROR_CODES.has(c))) {
            // Fallo de autenticacion: el comprobante no se evaluo. Se descarta el TA y se informa.
            this.wsaa.invalidate();
            throw new FiscalProviderError(502, "WSFE_AUTH_REJECTED", "WSFEv1 rechazo token/firma/CUIT", {
                errors: errorCodes,
            });
        }
        if (errorCodes.some((c) => INTERNAL_ERROR_CODES.has(c))) {
            // 500/501/502: error interno del servicio; no se puede afirmar que el comprobante no quedo registrado.
            return {
                outcome: "INDETERMINATE",
                observations: [],
                errors: readMessages(r.result["Errors"], "Err"),
                simulated: false,
                raw: r.result,
            };
        }
        return mapCaeResult(r.result, request);
    }
}
