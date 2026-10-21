import type { CaeRequest, CaeResult, FiscalMessage } from "../fiscal-provider.js";
import { FiscalProviderError } from "../errors.js";
import {
    asNode,
    asText,
    escapeXml,
    extractFault,
    listOf,
    parseXml,
    postSoap,
    soapBody,
    SoapTransportError,
    type SoapTransport,
    type XmlNode,
} from "./soap.js";

/**
 * Armado y parseo de los mensajes WSFEv1. El orden y los nombres de los
 * elementos salen del WSDL oficial de homologacion (fixture
 * __fixtures__/wsfev1-homo.wsdl), no de los ejemplos del manual (que difieren,
 * ver docs-oficiales.md 2.9).
 */

export const WSFE_NS = "http://ar.gov.afip.dif.FEV1/";

export interface FeAuth {
    token: string;
    sign: string;
    cuit: string;
}

function envelope(inner: string): string {
    return (
        `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
        `<soap:Body>${inner}</soap:Body></soap:Envelope>`
    );
}

function authXml(auth: FeAuth): string {
    return `<Auth><Token>${escapeXml(auth.token)}</Token><Sign>${escapeXml(auth.sign)}</Sign><Cuit>${auth.cuit}</Cuit></Auth>`;
}

export function buildDummyEnvelope(): string {
    return envelope(`<FEDummy xmlns="${WSFE_NS}"/>`);
}

export function buildUltimoAutorizadoEnvelope(auth: FeAuth, pointOfSale: number, voucherType: number): string {
    return envelope(
        `<FECompUltimoAutorizado xmlns="${WSFE_NS}">${authXml(auth)}<PtoVta>${pointOfSale}</PtoVta><CbteTipo>${voucherType}</CbteTipo></FECompUltimoAutorizado>`,
    );
}

/** Tipos de comprobante clase C segun la validacion 10007 del Manual V4.8 (p.40). */
export const CLASS_C_VOUCHER_TYPES: ReadonlySet<number> = new Set([11, 12, 13, 15, 211, 212, 213]);

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;
const RATE_RE = /^\d{1,4}(\.\d{1,6})?$/;
const DATE_RE = /^\d{8}$/;

function toCents(value: string): number {
    const [int = "0", frac = ""] = value.split(".");
    return Number(int) * 100 + Number(frac.padEnd(2, "0"));
}

function invalid(message: string, field: string): FiscalProviderError {
    return new FiscalProviderError(422, "FISCAL_REQUEST_INVALID", message, { field });
}

/** Valida lo que este cliente se compromete a armar. No inventa reglas fiscales: solo lo que figura en el manual. */
export function assertSupportedRequest(req: CaeRequest): void {
    if (!/^\d{11}$/.test(req.cuit)) throw invalid("CUIT del emisor invalido (11 digitos)", "cuit");
    if (!/^\d{1,20}$/.test(req.docNumber)) throw invalid("Numero de documento del receptor invalido", "docNumber");
    if (!Number.isInteger(req.voucherNumber) || req.voucherNumber < 1) throw invalid("Numero de comprobante invalido", "voucherNumber");
    if (!DATE_RE.test(req.voucherDate)) throw invalid("voucherDate debe ser YYYYMMDD", "voucherDate");
    for (const field of ["netAmount", "ivaAmount", "totalAmount"] as const) {
        if (!AMOUNT_RE.test(req[field])) throw invalid(`${field} debe ser un decimal con hasta 2 decimales`, field);
    }
    if (!RATE_RE.test(req.exchangeRate)) throw invalid("exchangeRate invalido", "exchangeRate");
    if (!/^[A-Z]{3}$/.test(req.currency)) throw invalid("currency debe ser un codigo ARCA de 3 letras", "currency");
    if (req.currency === "PES" && Number(req.exchangeRate) !== 1) {
        throw invalid("Para PES la cotizacion debe ser 1 (Manual V4.8 p.30, validacion 10039)", "exchangeRate");
    }
    if (req.concept !== 1) {
        // CaeRequest no trae FchServDesde/FchServHasta/FchVtoPago, obligatorios para concepto 2 o 3 (Manual V4.8 p.27-28).
        throw new FiscalProviderError(422, "FISCAL_REQUEST_UNSUPPORTED", "Solo concepto 1 (productos): CaeRequest no incluye las fechas de servicio", {
            field: "concept",
        });
    }
    if (!CLASS_C_VOUCHER_TYPES.has(req.voucherType)) {
        // Para clases A/B hay que informar el array Iva con alicuotas; CaeRequest no las transporta.
        throw new FiscalProviderError(422, "FISCAL_REQUEST_UNSUPPORTED", "Solo comprobantes clase C: CaeRequest no incluye alicuotas de IVA", {
            field: "voucherType",
        });
    }
    // Clase C: ImpIVA debe ser 0 y no se informa el array Iva (Manual V4.8 p.29-31).
    if (toCents(req.ivaAmount) !== 0) throw invalid("En comprobantes clase C ivaAmount debe ser 0", "ivaAmount");
    if (toCents(req.totalAmount) !== toCents(req.netAmount) + toCents(req.ivaAmount)) {
        throw invalid("totalAmount debe ser netAmount + ivaAmount", "totalAmount");
    }
}

/** FECAESolicitar de un solo comprobante clase C, concepto 1. Orden de elementos: WSDL (FEDetRequest). */
export function buildCaeSolicitarEnvelope(auth: FeAuth, req: CaeRequest): string {
    const det =
        `<FECAEDetRequest>` +
        `<Concepto>${req.concept}</Concepto>` +
        `<DocTipo>${req.docType}</DocTipo>` +
        `<DocNro>${req.docNumber}</DocNro>` +
        `<CbteDesde>${req.voucherNumber}</CbteDesde>` +
        `<CbteHasta>${req.voucherNumber}</CbteHasta>` +
        `<CbteFch>${req.voucherDate}</CbteFch>` +
        `<ImpTotal>${req.totalAmount}</ImpTotal>` +
        `<ImpTotConc>0</ImpTotConc>` +
        `<ImpNeto>${req.netAmount}</ImpNeto>` +
        `<ImpOpEx>0</ImpOpEx>` +
        `<ImpTrib>0</ImpTrib>` +
        `<ImpIVA>${req.ivaAmount}</ImpIVA>` +
        `<MonId>${req.currency}</MonId>` +
        `<MonCotiz>${req.exchangeRate}</MonCotiz>` +
        `<CondicionIVAReceptorId>${req.receiverIvaConditionId}</CondicionIVAReceptorId>` +
        `</FECAEDetRequest>`;
    return envelope(
        `<FECAESolicitar xmlns="${WSFE_NS}">${authXml(auth)}<FeCAEReq>` +
            `<FeCabReq><CantReg>1</CantReg><PtoVta>${req.pointOfSale}</PtoVta><CbteTipo>${req.voucherType}</CbteTipo></FeCabReq>` +
            `<FeDetReq>${det}</FeDetReq></FeCAEReq></FECAESolicitar>`,
    );
}

// ---------------------------------------------------------------- respuestas

export interface WsfeMessages {
    errors: FiscalMessage[];
    events: FiscalMessage[];
}

export function readMessages(container: unknown, child: string): FiscalMessage[] {
    return listOf(container, child).map((m) => ({
        code: Number(asText(m["Code"]) ?? "0"),
        message: asText(m["Msg"]) ?? "",
    }));
}

/** Resultado de una llamada: o hay SoapFault, o hay el nodo <Op>Result. */
export type WsfeCall<T> =
    | { kind: "fault"; faultcode: string; faultstring: string; httpStatus: number }
    | { kind: "unparseable"; httpStatus: number; reason: string }
    | { kind: "ok"; result: T; httpStatus: number };

async function call(
    url: string,
    operation: string,
    body: string,
    transport: SoapTransport,
): Promise<WsfeCall<XmlNode>> {
    const { status, text } = await postSoap(url, `${WSFE_NS}${operation}`, body, transport);
    let doc: XmlNode;
    try {
        doc = parseXml(text);
    } catch (err) {
        return { kind: "unparseable", httpStatus: status, reason: err instanceof Error ? err.message : String(err) };
    }
    const fault = extractFault(doc);
    if (fault) return { kind: "fault", faultcode: fault.faultcode, faultstring: fault.faultstring, httpStatus: status };
    const response = asNode(soapBody(doc)?.[`${operation}Response`]);
    const result = asNode(response?.[`${operation}Result`]);
    if (!result) return { kind: "unparseable", httpStatus: status, reason: `Falta ${operation}Result en la respuesta` };
    return { kind: "ok", result, httpStatus: status };
}

export interface DummyStatus {
    appServer: string;
    dbServer: string;
    authServer: string;
}

export async function callDummy(url: string, transport: SoapTransport): Promise<WsfeCall<DummyStatus>> {
    const r = await call(url, "FEDummy", buildDummyEnvelope(), transport);
    if (r.kind !== "ok") return r;
    return {
        kind: "ok",
        httpStatus: r.httpStatus,
        result: {
            appServer: asText(r.result["AppServer"]) ?? "",
            dbServer: asText(r.result["DbServer"]) ?? "",
            authServer: asText(r.result["AuthServer"]) ?? "",
        },
    };
}

export interface LastVoucherResponse extends WsfeMessages {
    pointOfSale?: number;
    voucherType?: number;
    voucherNumber?: number;
}

export async function callUltimoAutorizado(
    url: string,
    auth: FeAuth,
    pointOfSale: number,
    voucherType: number,
    transport: SoapTransport,
): Promise<WsfeCall<LastVoucherResponse>> {
    const r = await call(url, "FECompUltimoAutorizado", buildUltimoAutorizadoEnvelope(auth, pointOfSale, voucherType), transport);
    if (r.kind !== "ok") return r;
    const nro = asText(r.result["CbteNro"]);
    const out: LastVoucherResponse = {
        errors: readMessages(r.result["Errors"], "Err"),
        events: readMessages(r.result["Events"], "Evt"),
    };
    if (nro !== undefined && /^\d+$/.test(nro)) out.voucherNumber = Number(nro);
    return { kind: "ok", httpStatus: r.httpStatus, result: out };
}

export async function callCaeSolicitar(
    url: string,
    auth: FeAuth,
    req: CaeRequest,
    transport: SoapTransport,
): Promise<WsfeCall<XmlNode>> {
    return call(url, "FECAESolicitar", buildCaeSolicitarEnvelope(auth, req), transport);
}

// ------------------------------------------------------------------- mapeo

/** Codigos de la tabla de errores de autenticacion del Manual V4.8 p.21: 600, 601, 602. */
export const AUTH_ERROR_CODES: ReadonlySet<number> = new Set([600, 601, 602]);
/** 500, 501 y 502 (Manual V4.8 p.21): errores internos del servicio. No permiten afirmar que no se proceso. */
export const INTERNAL_ERROR_CODES: ReadonlySet<number> = new Set([500, 501, 502]);

function indeterminate(reason: string, extra: Partial<Pick<CaeResult, "observations" | "errors">>, raw: unknown): CaeResult {
    return {
        outcome: "INDETERMINATE",
        observations: extra.observations ?? [],
        // code 0 = mensaje generado por este cliente, no de ARCA.
        errors: [...(extra.errors ?? []), { code: 0, message: reason }],
        simulated: false,
        raw,
    };
}

/**
 * Traduce FECAESolicitarResult a CaeResult. Regla general: ante cualquier cosa que
 * no permita afirmar con certeza aprobado o rechazado, INDETERMINATE (nunca se asume).
 *
 * - Resultado=A + CAE valido           => AUTHORIZED, o AUTHORIZED_WITH_OBSERVATIONS si hay Obs
 *   (Manual V4.8 p.25: "aprobado con observaciones, se le asigna el CAE").
 * - Resultado=R                        => REJECTED.
 * - Sin detalle, con Errors y cabecera R => REJECTED (ejemplo del Manual V4.8 p.84).
 * - P, vacio, otro valor, A sin CAE    => INDETERMINATE.
 */
export function mapCaeResult(result: XmlNode, req: CaeRequest): CaeResult {
    const raw = result;
    const topErrors = readMessages(result["Errors"], "Err");
    const events = readMessages(result["Events"], "Evt");
    const header = asNode(result["FeCabResp"]);
    const headerResult = asText(header?.["Resultado"]);
    const details = listOf(result["FeDetResp"], "FECAEDetResponse");

    if (details.length === 0) {
        if (headerResult === "R" && topErrors.length > 0) {
            return { outcome: "REJECTED", observations: events, errors: topErrors, simulated: false, raw };
        }
        return indeterminate("Respuesta sin detalle de comprobante", { errors: topErrors }, raw);
    }
    if (details.length > 1) {
        return indeterminate("La respuesta trae mas de un comprobante y se envio uno", { errors: topErrors }, raw);
    }

    const det = details[0] ?? {};
    const observations = readMessages(det["Observaciones"], "Obs");
    const resultado = asText(det["Resultado"]);
    const cae = asText(det["CAE"]) ?? "";
    const caeExpiration = asText(det["CAEFchVto"]) ?? "";

    if (asText(det["CbteDesde"]) !== String(req.voucherNumber)) {
        return indeterminate("El numero de comprobante de la respuesta no coincide con el enviado", { observations, errors: topErrors }, raw);
    }

    if (resultado === "R") {
        return { outcome: "REJECTED", observations, errors: topErrors, simulated: false, raw };
    }

    if (resultado === "A") {
        // CAE String(14), CAEFchVto String(8) yyyymmdd (Manual V4.8 p.38).
        if (!/^\d{14}$/.test(cae) || !/^\d{8}$/.test(caeExpiration) || topErrors.length > 0) {
            return indeterminate("Aprobado sin CAE valido o con errores simultaneos", { observations, errors: topErrors }, raw);
        }
        return {
            outcome: observations.length > 0 ? "AUTHORIZED_WITH_OBSERVATIONS" : "AUTHORIZED",
            cae,
            caeExpiration,
            observations,
            errors: [],
            simulated: false,
            raw,
        };
    }

    return indeterminate(`Resultado no concluyente: "${resultado ?? ""}"`, { observations, errors: topErrors }, raw);
}

/** Trae a un FiscalProviderError las fallas de infraestructura/autenticacion de una consulta. */
export function wsfeFailure(
    action: string,
    r: Exclude<WsfeCall<unknown>, { kind: "ok" }>,
): FiscalProviderError {
    if (r.kind === "fault") {
        return new FiscalProviderError(502, "WSFE_FAULT", `WSFEv1 devolvio un SoapFault en ${action}`, {
            faultcode: r.faultcode,
            faultstring: r.faultstring,
            httpStatus: r.httpStatus,
        });
    }
    return new FiscalProviderError(502, "WSFE_BAD_RESPONSE", `Respuesta ilegible de WSFEv1 en ${action}`, {
        reason: r.reason,
        httpStatus: r.httpStatus,
    });
}

export function transportFailure(action: string, err: SoapTransportError): FiscalProviderError {
    return new FiscalProviderError(err.kind === "timeout" ? 504 : 502, "WSFE_UNREACHABLE", `No se pudo contactar a WSFEv1 en ${action} (${err.kind})`, {
        reason: err.message,
    });
}
