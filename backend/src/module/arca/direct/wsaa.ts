import forge from "node-forge";
import { FiscalProviderError } from "../errors.js";
import {
    asNode,
    asText,
    escapeXml,
    extractFault,
    parseXml,
    postSoap,
    SoapTransportError,
    type SoapTransport,
} from "./soap.js";

/**
 * Cliente WSAA propio. Que hace este archivo (y que NO):
 * - arma el TRA (loginTicketRequest) segun Especificacion Tecnica WSAA 1.2.2, p.6-7;
 * - lo firma como CMS SignedData (nodetach, con el certificado incluido) usando node-forge;
 * - llama a loginCms por SOAP 1.1 con fetch;
 * - parsea el loginTicketResponse y cachea el TA hasta expirationTime.
 * No implementa criptografia, ASN.1 ni HTTP: eso es node-forge y fetch.
 */

export type ArcaDigest = "sha1" | "sha256";

/** Hora argentina fija (GMT-3, sin horario de verano): la doc pide GMT-3 (Manual WSAA FAQ 10.7). */
const AR_OFFSET_MS = -3 * 60 * 60 * 1000;

export function formatArcaDateTime(date: Date): string {
    return new Date(date.getTime() + AR_OFFSET_MS).toISOString().slice(0, 19) + "-03:00";
}

/** Interpreta un xsd:dateTime del WSAA; si no trae zona se asume GMT-3. */
export function parseArcaDateTime(value: string): Date {
    const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
    const date = new Date(hasZone ? value : `${value}-03:00`);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Fecha ilegible en la respuesta del WSAA: ${value}`);
    }
    return date;
}

export interface TraOptions {
    service: string;
    now: Date;
    /** Minutos hacia atras de generationTime (la doc recomienda restar algunos minutos). */
    skewMinutes?: number;
    /** Minutos de vigencia del requerimiento. */
    validityMinutes?: number;
}

/** Sin source ni destination (opcionales; Manual WSAA FAQ 10.5 recomienda omitirlos). */
export function buildTra(options: TraOptions): string {
    const skew = options.skewMinutes ?? 10;
    const validity = options.validityMinutes ?? 10;
    const generation = new Date(options.now.getTime() - skew * 60_000);
    const expiration = new Date(options.now.getTime() + validity * 60_000);
    // uniqueId: entero de 32 bits sin signo (Especificacion WSAA p.7). Segundos desde epoch.
    const uniqueId = Math.floor(options.now.getTime() / 1000) >>> 0;
    return (
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<loginTicketRequest version="1.0"><header>` +
        `<uniqueId>${uniqueId}</uniqueId>` +
        `<generationTime>${formatArcaDateTime(generation)}</generationTime>` +
        `<expirationTime>${formatArcaDateTime(expiration)}</expirationTime>` +
        `</header><service>${escapeXml(options.service)}</service></loginTicketRequest>`
    );
}

/** CMS SignedData (PKCS#7), DER en Base64, con el TRA embebido y el certificado adjunto. */
export function signTra(tra: string, certPem: string, keyPem: string, digest: ArcaDigest): string {
    let cert: forge.pki.Certificate;
    let key: forge.pki.PrivateKey;
    try {
        cert = forge.pki.certificateFromPem(certPem);
        key = forge.pki.privateKeyFromPem(keyPem);
    } catch (err) {
        throw new FiscalProviderError(500, "ARCA_CREDENTIALS_INVALID", "Certificado o clave privada ilegibles", {
            reason: err instanceof Error ? err.message : String(err),
        });
    }
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
        key: key as forge.pki.rsa.PrivateKey,
        certificate: cert,
        digestAlgorithm: digest === "sha1" ? forge.pki.oids["sha1"]! : forge.pki.oids["sha256"]!,
        authenticatedAttributes: [
            { type: forge.pki.oids["contentType"]!, value: forge.pki.oids["data"]! },
            { type: forge.pki.oids["messageDigest"]! },
            { type: forge.pki.oids["signingTime"]! },
        ],
    });
    p7.sign();
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return forge.util.encode64(der);
}

/** Envelope del ejemplo curl del Manual del Desarrollador WSAA, cap. 9.1 (p.29). */
export function buildLoginCmsEnvelope(cmsBase64: string): string {
    return (
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
        `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
    );
}

export interface AccessTicket {
    token: string;
    sign: string;
    generationTime: Date;
    expirationTime: Date;
}

/** Parsea la respuesta SOAP de loginCms. Lanza WsaaFault si es un SoapFault. */
export function parseLoginCmsResponse(xml: string): AccessTicket {
    const doc = parseXml(xml);
    const fault = extractFault(doc);
    if (fault) throw new WsaaFault(fault.faultcode, fault.faultstring);

    const envelope = asNode(doc["Envelope"]);
    const body = asNode(envelope?.["Body"]);
    const response = asNode(body?.["loginCmsResponse"]);
    const inner = asText(response?.["loginCmsReturn"]);
    if (!inner) throw new Error("Respuesta de loginCms sin loginCmsReturn");

    const ticketDoc = parseXml(inner);
    const ticket = asNode(ticketDoc["loginTicketResponse"]);
    const header = asNode(ticket?.["header"]);
    const credentials = asNode(ticket?.["credentials"]);
    const token = asText(credentials?.["token"]);
    const sign = asText(credentials?.["sign"]);
    const generation = asText(header?.["generationTime"]);
    const expiration = asText(header?.["expirationTime"]);
    if (!token || !sign || !generation || !expiration) {
        throw new Error("loginTicketResponse incompleto (falta token, sign o fechas)");
    }
    return {
        token,
        sign,
        generationTime: parseArcaDateTime(generation),
        expirationTime: parseArcaDateTime(expiration),
    };
}

/** SoapFault del WSAA: faultcode sin prefijo de namespace (ej. cms.bad, coe.alreadyAuthenticated). */
export class WsaaFault extends Error {
    readonly faultcode: string;
    readonly faultstring: string;

    constructor(faultcode: string, faultstring: string) {
        super(`WSAA: ${faultcode}: ${faultstring}`);
        this.name = "WsaaFault";
        this.faultcode = faultcode;
        this.faultstring = faultstring;
    }
}

/**
 * Regla de la Especificacion WSAA p.8: ante errores distintos de wsaa.* o wsn.unavailable
 * no se piden TA nuevos hasta corregir el problema; para el resto, no antes de 60 segundos.
 */
function isTransientFault(code: string): boolean {
    return code.startsWith("wsaa.") || code === "wsn.unavailable";
}

export interface WsaaClientOptions extends SoapTransport {
    endpoint: string;
    certPem: string;
    keyPem: string;
    service?: string;
    digest?: ArcaDigest;
    now?: () => Date;
    /** Margen antes de expirationTime en el que el TA ya se considera vencido. */
    expirySafetyMs?: number;
    /** Espera tras un fallo no transitorio antes de volver a pedir un TA. */
    failureCooldownMs?: number;
}

export class WsaaClient {
    private readonly opts: Required<Pick<WsaaClientOptions, "service" | "digest" | "expirySafetyMs" | "failureCooldownMs">> &
        WsaaClientOptions;
    private ticket: AccessTicket | undefined;
    private inFlight: Promise<AccessTicket> | undefined;
    private lastFailure: { at: number; error: FiscalProviderError } | undefined;

    constructor(options: WsaaClientOptions) {
        this.opts = {
            ...options,
            service: options.service ?? "wsfe",
            digest: options.digest ?? "sha256",
            expirySafetyMs: options.expirySafetyMs ?? 60_000,
            failureCooldownMs: options.failureCooldownMs ?? 60_000,
        };
    }

    private now(): Date {
        return this.opts.now ? this.opts.now() : new Date();
    }

    /** TA vigente de la cache en memoria, o uno nuevo. Pedidos concurrentes comparten una sola llamada. */
    async getTicket(): Promise<AccessTicket> {
        const current = this.ticket;
        if (current && this.now().getTime() < current.expirationTime.getTime() - this.opts.expirySafetyMs) {
            return current;
        }
        if (this.inFlight) return this.inFlight;

        if (this.lastFailure && this.now().getTime() - this.lastFailure.at < this.opts.failureCooldownMs) {
            throw this.lastFailure.error;
        }

        this.inFlight = this.login().finally(() => {
            this.inFlight = undefined;
        });
        return this.inFlight;
    }

    /** Descarta el TA (ej. WSFEv1 respondio 600 "no se corresponden token y firma"). */
    invalidate(): void {
        this.ticket = undefined;
    }

    private async login(): Promise<AccessTicket> {
        const now = this.now();
        const tra = buildTra({ service: this.opts.service, now });
        const cms = signTra(tra, this.opts.certPem, this.opts.keyPem, this.opts.digest);
        const envelope = buildLoginCmsEnvelope(cms);

        let status: number;
        let text: string;
        try {
            ({ status, text } = await postSoap(this.opts.endpoint, "urn:LoginCms", envelope, this.opts));
        } catch (err) {
            if (err instanceof SoapTransportError) {
                throw new FiscalProviderError(
                    err.kind === "timeout" ? 504 : 502,
                    "WSAA_UNREACHABLE",
                    `No se pudo contactar al WSAA (${err.kind})`,
                    { reason: err.message },
                );
            }
            throw err;
        }

        try {
            const ticket = parseLoginCmsResponse(text);
            if (ticket.expirationTime.getTime() <= this.now().getTime()) {
                throw new Error("El TA devuelto ya esta vencido");
            }
            this.ticket = ticket;
            this.lastFailure = undefined;
            return ticket;
        } catch (err) {
            if (err instanceof WsaaFault) {
                const error = new FiscalProviderError(502, "WSAA_FAULT", `WSAA rechazo el pedido de TA: ${err.faultcode}`, {
                    faultcode: err.faultcode,
                    faultstring: err.faultstring,
                    httpStatus: status,
                });
                if (!isTransientFault(err.faultcode)) {
                    this.lastFailure = { at: this.now().getTime(), error };
                }
                throw error;
            }
            throw new FiscalProviderError(502, "WSAA_BAD_RESPONSE", "Respuesta del WSAA ilegible", {
                httpStatus: status,
                reason: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
