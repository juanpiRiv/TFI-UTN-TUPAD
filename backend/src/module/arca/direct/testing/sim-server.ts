import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import forge from "node-forge";
import { asNode, asText, escapeXml, parseXml, soapBody, type XmlNode } from "../soap.js";
import { formatArcaDateTime, parseArcaDateTime } from "../wsaa.js";
import { WsdlSchema } from "./wsdl-validator.js";

/**
 * SIMULACION LOCAL de WSAA y WSFEv1. No es ARCA y no prueba nada sobre ARCA:
 * solo comprueba que el cliente arma peticiones conformes al WSDL oficial
 * (nombres, orden, obligatorios) y que maneja cada tipo de respuesta.
 * Las respuestas se escribieron a mano siguiendo los tipos del WSDL.
 */

const fixture = (name: string): string => fileURLToPath(new URL(`../__fixtures__/${name}`, import.meta.url));

export type CaeMode =
    | "authorized"
    | "observations"
    | "rejected"
    | "rejected-errors"
    | "partial"
    | "approved-without-cae"
    | "wrong-number"
    | "auth-error"
    | "internal-error"
    | "garbage"
    | "soap-fault"
    | "timeout";

export interface SimState {
    /** Hora de la simulacion (permite vencer el TA sin esperar). */
    now: Date;
    /** Huellas SHA-256 de certificados que el WSAA simulado considera de confianza. */
    trustedFingerprints: Set<string>;
    ticketTtlMs: number;
    wsaaFault?: { code: string; message: string };
    lastVoucher: number;
    caeMode: CaeMode;
    /** Peticiones que no pasaron la validacion contra el WSDL. */
    schemaViolations: string[];
    logins: number;
    wsaaRequests: number;
    wsfeCalls: string[];
    caeRequests: XmlNode[];
    /** Token -> vencimiento de los TA emitidos. */
    issued: Map<string, Date>;
    /** Cuando CaeMode sea timeout, cuanto demora la respuesta. */
    hangMs: number;
}

export interface SimServer {
    wsaaUrl: string;
    wsfeUrl: string;
    state: SimState;
    close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function reply(res: ServerResponse, status: number, body: string): void {
    res.writeHead(status, { "Content-Type": "text/xml;charset=utf-8" });
    res.end(body);
}

const wsfeEnvelope = (inner: string): string =>
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

const NS = "http://ar.gov.afip.dif.FEV1/";

function soapFault(code: string, message: string): string {
    return (
        `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault>` +
        `<faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:${code}</faultcode><faultstring>${escapeXml(message)}</faultstring>` +
        `</soapenv:Fault></soapenv:Body></soapenv:Envelope>`
    );
}

/** Verifica el CMS como lo haria un WSAA: firma sobre los atributos autenticados, digest del contenido, TRA conforme. */
function checkCms(cmsBase64: string, state: SimState): { tra: string } | { fault: { code: string; message: string } } {
    let msg: any;
    try {
        const der = forge.util.decode64(cmsBase64);
        msg = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der));
    } catch {
        return { fault: { code: "cms.bad", message: "El CMS no es valido" } };
    }
    const cert: forge.pki.Certificate | undefined = msg.certificates?.[0];
    if (!cert) return { fault: { code: "cms.cert.notFound", message: "No se ha encontrado certificado de firma en el CMS" } };

    const capture = msg.rawCapture;
    const content: string = capture.content?.value?.[0]?.value ?? capture.content?.value ?? "";
    const oid = forge.asn1.derToOid(capture.digestAlgorithm);
    const mdFactory = oid === forge.pki.oids["sha1"] ? forge.md.sha1 : oid === forge.pki.oids["sha256"] ? forge.md.sha256 : undefined;
    if (!mdFactory) return { fault: { code: "cms.sign.invalid", message: "Firma invalida o algoritmo no soportado" } };

    const contentDigest = mdFactory.create();
    contentDigest.update(content);
    const attrs: forge.asn1.Asn1[] = capture.authenticatedAttributes ?? [];
    let messageDigestOk = false;
    for (const attr of attrs) {
        const parts = attr.value as forge.asn1.Asn1[];
        if (forge.asn1.derToOid(parts[0]!.value as string) === forge.pki.oids["messageDigest"]) {
            const set = parts[1]!.value as forge.asn1.Asn1[];
            messageDigestOk = (set[0]!.value as string) === contentDigest.digest().getBytes();
        }
    }
    const setOfAttrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
    const attrsDigest = mdFactory.create();
    attrsDigest.update(forge.asn1.toDer(setOfAttrs).getBytes());
    let signatureOk = false;
    try {
        signatureOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(attrsDigest.digest().getBytes(), capture.signature);
    } catch {
        signatureOk = false;
    }
    if (!messageDigestOk || !signatureOk) return { fault: { code: "cms.sign.invalid", message: "Firma invalida o algoritmo no soportado" } };

    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fp = forge.md.sha256.create();
    fp.update(der);
    if (cert.validity.notAfter.getTime() < state.now.getTime()) {
        return { fault: { code: "cms.cert.expired", message: "Certificado expirado" } };
    }
    if (!state.trustedFingerprints.has(fp.digest().toHex())) {
        return { fault: { code: "cms.cert.untrusted", message: "Certificado no emitido por AC de confianza" } };
    }
    return { tra: content };
}

function checkTra(tra: string, state: SimState): { service: string } | { fault: { code: string; message: string } } {
    let doc: XmlNode;
    try {
        doc = parseXml(tra);
    } catch {
        return { fault: { code: "xml.bad", message: "No se ha podido interpretar el XML contra el SCHEMA" } };
    }
    const root = asNode(doc["loginTicketRequest"]);
    const header = asNode(root?.["header"]);
    const service = asText(root?.["service"]);
    const uniqueId = asText(header?.["uniqueId"]);
    const gen = asText(header?.["generationTime"]);
    const exp = asText(header?.["expirationTime"]);
    const keys = Object.keys(header ?? {});
    const orderOk = keys.join(",") === "uniqueId,generationTime,expirationTime";
    if (!root || !header || !service || !uniqueId || !gen || !exp || !orderOk || !/^\d{1,10}$/.test(uniqueId) || Number(uniqueId) > 4294967295) {
        return { fault: { code: "xml.bad", message: "No se ha podido interpretar el XML contra el SCHEMA" } };
    }
    if (service.length < 3 || service.length > 32) return { fault: { code: "xml.bad", message: "No se ha podido interpretar el XML contra el SCHEMA" } };
    const genAt = parseArcaDateTime(gen).getTime();
    const expAt = parseArcaDateTime(exp).getTime();
    const day = 24 * 3600 * 1000;
    if (genAt > state.now.getTime() || state.now.getTime() - genAt > day) {
        return { fault: { code: "xml.generationTime.invalid", message: "Tiempo de generacion posterior a la hora actual o con mas de 24 horas de antiguedad" } };
    }
    if (expAt < state.now.getTime()) return { fault: { code: "xml.expirationTime.expired", message: "Tiempo de expiracion inferior a la hora actual" } };
    if (expAt - state.now.getTime() > day) return { fault: { code: "xml.expirationTime.invalid", message: "Tiempo de expiracion superior a 24 horas" } };
    return { service };
}

function handleWsaa(body: string, state: SimState): { status: number; xml: string } {
    state.wsaaRequests += 1;
    const doc = parseXml(body);
    const login = asNode(soapBody(doc)?.["loginCms"]);
    const in0 = asText(login?.["in0"]);
    if (!in0) return { status: 500, xml: soapFault("cms.bad", "El CMS no es valido") };
    if (state.wsaaFault) return { status: 500, xml: soapFault(state.wsaaFault.code, state.wsaaFault.message) };

    const cms = checkCms(in0, state);
    if ("fault" in cms) return { status: 500, xml: soapFault(cms.fault.code, cms.fault.message) };
    const tra = checkTra(cms.tra, state);
    if ("fault" in tra) return { status: 500, xml: soapFault(tra.fault.code, tra.fault.message) };

    state.logins += 1;
    const token = `TOKEN-SIMULADO-${state.logins}`;
    const sign = `SIGN-SIMULADO-${state.logins}`;
    const expiration = new Date(state.now.getTime() + state.ticketTtlMs);
    state.issued.set(token, expiration);
    const ticket =
        `<?xml version="1.0" encoding="UTF-8"?><loginTicketResponse version="1"><header><source>cn=wsaahomo-simulado</source><destination>cn=simulado</destination>` +
        `<uniqueId>${state.logins}</uniqueId><generationTime>${formatArcaDateTime(state.now)}</generationTime>` +
        `<expirationTime>${formatArcaDateTime(expiration)}</expirationTime></header><credentials><token>${token}</token><sign>${sign}</sign></credentials></loginTicketResponse>`;
    return {
        status: 200,
        xml: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${escapeXml(ticket)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`,
    };
}

function errs(list: Array<[number, string]>): string {
    return `<Errors>${list.map(([c, m]) => `<Err><Code>${c}</Code><Msg>${escapeXml(m)}</Msg></Err>`).join("")}</Errors>`;
}

function obs(list: Array<[number, string]>): string {
    return `<Observaciones>${list.map(([c, m]) => `<Obs><Code>${c}</Code><Msg>${escapeXml(m)}</Msg></Obs>`).join("")}</Observaciones>`;
}

function checkAuth(op: XmlNode, state: SimState): boolean {
    const auth = asNode(op["Auth"]);
    const token = asText(auth?.["Token"]);
    const expiry = token ? state.issued.get(token) : undefined;
    return !!expiry && expiry.getTime() > state.now.getTime() && asText(auth?.["Sign"])?.startsWith("SIGN-SIMULADO") === true;
}

const AUTH_MSG = "No se corresponden token y firma. Usuario no autorizado a realizar esta operación";

function caeResponse(op: XmlNode, state: SimState): { status: number; xml: string; hang?: boolean } {
    const req = asNode(asNode(op["FeCAEReq"]));
    const cab = asNode(req?.["FeCabReq"]) ?? {};
    const det = asNode(asNode(req?.["FeDetReq"])?.["FECAEDetRequest"]) ?? {};
    const number = Number(asText(det["CbteDesde"]) ?? "0");
    const cabResp = (result: string): string =>
        `<FeCabResp><Cuit>${asText(asNode(op["Auth"])?.["Cuit"]) ?? ""}</Cuit><PtoVta>${asText(cab["PtoVta"])}</PtoVta><CbteTipo>${asText(cab["CbteTipo"])}</CbteTipo><FchProceso>20261019120000</FchProceso><CantReg>1</CantReg><Resultado>${result}</Resultado><Reproceso>N</Reproceso></FeCabResp>`;
    const detail = (result: string, extra: string, cae: string, vto: string, numberOverride?: number): string =>
        `<FeDetResp><FECAEDetResponse><Concepto>${asText(det["Concepto"])}</Concepto><DocTipo>${asText(det["DocTipo"])}</DocTipo><DocNro>${asText(det["DocNro"])}</DocNro>` +
        `<CbteDesde>${numberOverride ?? number}</CbteDesde><CbteHasta>${numberOverride ?? number}</CbteHasta><CbteFch>${asText(det["CbteFch"])}</CbteFch><Resultado>${result}</Resultado>${extra}` +
        `${cae ? `<CAE>${cae}</CAE>` : ""}${vto ? `<CAEFchVto>${vto}</CAEFchVto>` : ""}</FECAEDetResponse></FeDetResp>`;
    const wrap = (inner: string): string =>
        wsfeEnvelope(`<FECAESolicitarResponse xmlns="${NS}"><FECAESolicitarResult>${inner}</FECAESolicitarResult></FECAESolicitarResponse>`);

    switch (state.caeMode) {
        case "authorized":
            state.lastVoucher = number;
            return { status: 200, xml: wrap(cabResp("A") + detail("A", "", "73000000000001", "20261029")) };
        case "observations":
            state.lastVoucher = number;
            return { status: 200, xml: wrap(cabResp("A") + detail("A", obs([[10063, "Observacion simulada"]]), "73000000000002", "20261029")) };
        case "rejected":
            return { status: 200, xml: wrap(cabResp("R") + detail("R", obs([[10016, "Rechazo simulado por comprobante"]]), "", "")) };
        case "rejected-errors":
            return { status: 200, xml: wrap(cabResp("R") + errs([[10015, "Rechazo simulado a nivel de solicitud"]])) };
        case "partial":
            return { status: 200, xml: wrap(cabResp("P") + detail("P", "", "", "")) };
        case "approved-without-cae":
            return { status: 200, xml: wrap(cabResp("A") + detail("A", "", "", "")) };
        case "wrong-number":
            return { status: 200, xml: wrap(cabResp("A") + detail("A", "", "73000000000003", "20261029", number + 7)) };
        case "auth-error":
            return { status: 200, xml: wrap(errs([[600, AUTH_MSG]])) };
        case "internal-error":
            return { status: 200, xml: wrap(errs([[500, "Error interno de aplicacion"]])) };
        case "garbage":
            return { status: 200, xml: "<html>no es soap</html>" };
        case "soap-fault":
            return { status: 500, xml: soapFault("Server", "Server was unable to process request (simulado)") };
        case "timeout":
            return { status: 200, xml: wrap(cabResp("A") + detail("A", "", "73000000000004", "20261029")), hang: true };
    }
}

function handleWsfe(body: string, state: SimState): { status: number; xml: string; hang?: boolean } {
    const check = schema.validateRequest(body);
    if (check.errors.length > 0 || !check.operation) {
        state.schemaViolations.push(...check.errors);
        return { status: 500, xml: soapFault("soap:Client", `Peticion no conforme al WSDL: ${check.errors.join("; ")}`) };
    }
    state.wsfeCalls.push(check.operation);
    const op = asNode(soapBody(parseXml(body))?.[check.operation]) ?? {};

    if (check.operation === "FEDummy") {
        return {
            status: 200,
            xml: wsfeEnvelope(`<FEDummyResponse xmlns="${NS}"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>`),
        };
    }
    if (!checkAuth(op, state)) {
        const inner = check.operation === "FECompUltimoAutorizado"
            ? `<FECompUltimoAutorizadoResponse xmlns="${NS}"><FECompUltimoAutorizadoResult><PtoVta>0</PtoVta><CbteTipo>0</CbteTipo><CbteNro>0</CbteNro>${errs([[600, AUTH_MSG]])}</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`
            : `<FECAESolicitarResponse xmlns="${NS}"><FECAESolicitarResult>${errs([[600, AUTH_MSG]])}</FECAESolicitarResult></FECAESolicitarResponse>`;
        return { status: 200, xml: wsfeEnvelope(inner) };
    }
    if (check.operation === "FECompUltimoAutorizado") {
        return {
            status: 200,
            xml: wsfeEnvelope(
                `<FECompUltimoAutorizadoResponse xmlns="${NS}"><FECompUltimoAutorizadoResult><PtoVta>${asText(op["PtoVta"])}</PtoVta><CbteTipo>${asText(op["CbteTipo"])}</CbteTipo><CbteNro>${state.lastVoucher}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`,
            ),
        };
    }
    if (check.operation === "FECAESolicitar") {
        state.caeRequests.push(op);
        return caeResponse(op, state);
    }
    return { status: 500, xml: soapFault("soap:Client", "Operacion no simulada") };
}

const schema = new WsdlSchema(fixture("wsfev1-homo.wsdl"));

export async function startSimServer(overrides: Partial<SimState> = {}): Promise<SimServer> {
    const state: SimState = {
        now: new Date("2026-10-19T15:00:00Z"),
        trustedFingerprints: new Set(),
        ticketTtlMs: 12 * 3600 * 1000,
        lastVoucher: 41,
        caeMode: "authorized",
        schemaViolations: [],
        logins: 0,
        wsaaRequests: 0,
        wsfeCalls: [],
        caeRequests: [],
        issued: new Map(),
        hangMs: 1500,
        ...overrides,
    };

    const server: Server = createServer((req, res) => {
        void (async () => {
            try {
                const body = await readBody(req);
                if (req.url?.startsWith("/wsaa")) {
                    const r = handleWsaa(body, state);
                    return reply(res, r.status, r.xml);
                }
                const r = handleWsfe(body, state);
                if (r.hang) {
                    // Simula un servidor que recibe el comprobante y tarda en contestar.
                    setTimeout(() => reply(res, r.status, r.xml), state.hangMs);
                    return;
                }
                reply(res, r.status, r.xml);
            } catch (err) {
                reply(res, 500, soapFault("Server", String(err)));
            }
        })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return {
        wsaaUrl: `http://127.0.0.1:${port}/wsaa/services/LoginCms`,
        wsfeUrl: `http://127.0.0.1:${port}/wsfev1/service.asmx`,
        state,
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}
