import { XMLParser } from "fast-xml-parser";

/** Registro de un intercambio HTTP. Solo para diagnostico; quien lo guarde debe sanear. */
export interface SoapExchange {
    url: string;
    soapAction: string;
    requestBody: string;
    status?: number;
    responseBody?: string;
    at: string;
    error?: string;
}

export interface SoapTransport {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    onExchange?: (exchange: SoapExchange) => void;
}

export type SoapTransportFailureKind = "timeout" | "network";

/** El POST no llego a tener respuesta HTTP (timeout, DNS, TLS, corte). */
export class SoapTransportError extends Error {
    readonly kind: SoapTransportFailureKind;

    constructor(kind: SoapTransportFailureKind, message: string) {
        super(message);
        this.name = "SoapTransportError";
        this.kind = kind;
    }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export async function postSoap(
    url: string,
    soapAction: string,
    body: string,
    transport: SoapTransport,
): Promise<{ status: number; text: string }> {
    const doFetch = transport.fetchImpl ?? fetch;
    const exchange: SoapExchange = { url, soapAction, requestBody: body, at: new Date().toISOString() };
    try {
        const res = await doFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "text/xml;charset=UTF-8",
                SOAPAction: soapAction,
            },
            body,
            signal: AbortSignal.timeout(transport.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        const text = await res.text();
        exchange.status = res.status;
        exchange.responseBody = text;
        transport.onExchange?.(exchange);
        return { status: res.status, text };
    } catch (err) {
        const name = err instanceof Error ? err.name : "";
        const kind: SoapTransportFailureKind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
        const message = err instanceof Error ? err.message : String(err);
        exchange.error = `${name}: ${message}`;
        transport.onExchange?.(exchange);
        throw new SoapTransportError(kind, message);
    }
}

const ARRAY_TAGS = new Set(["Err", "Obs", "Evt", "FECAEDetResponse", "AlicIva"]);

const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => ARRAY_TAGS.has(name),
});

export type XmlNode = Record<string, unknown>;

export function parseXml(text: string): XmlNode {
    const parsed: unknown = parser.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("XML vacio o ilegible");
    }
    return parsed as XmlNode;
}

export function asNode(value: unknown): XmlNode | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

export function asText(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** Devuelve los hijos repetidos de un contenedor tipo ArrayOfX (puede venir "" si esta vacio). */
export function listOf(container: unknown, childName: string): XmlNode[] {
    const node = asNode(container);
    if (!node) return [];
    const children = node[childName];
    if (children === undefined) return [];
    const arr = Array.isArray(children) ? children : [children];
    return arr.map((c) => asNode(c) ?? {});
}

export interface SoapFault {
    faultcode: string;
    faultstring: string;
}

/** Busca Envelope/Body/Fault. El codigo se devuelve sin el prefijo de namespace (ns1:cms.bad => cms.bad). */
export function extractFault(doc: XmlNode): SoapFault | undefined {
    const envelope = asNode(doc["Envelope"]);
    const body = asNode(envelope?.["Body"]);
    const fault = asNode(body?.["Fault"]);
    if (!fault) return undefined;
    const rawCode = asText(fault["faultcode"]) ?? asText(fault["Code"]) ?? "";
    const code = rawCode.includes(":") ? rawCode.slice(rawCode.indexOf(":") + 1) : rawCode;
    const text = asText(fault["faultstring"]) ?? "";
    return { faultcode: code, faultstring: text };
}

export function soapBody(doc: XmlNode): XmlNode | undefined {
    const envelope = asNode(doc["Envelope"]);
    return asNode(envelope?.["Body"]);
}

export function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
