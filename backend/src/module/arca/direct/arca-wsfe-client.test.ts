// Todos los tests de este archivo corren CONTRA SIMULACION LOCAL (servidor HTTP
// en 127.0.0.1 armado a partir del WSDL oficial). No prueban nada contra ARCA.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FiscalProviderError } from "../errors.js";
import type { CaeRequest } from "../fiscal-provider.js";
import { ArcaWsfeClient } from "./arca-wsfe-client.js";
import { buildCaeSolicitarEnvelope } from "./wsfe.js";
import { buildTra, signTra } from "./wsaa.js";
import { startSimServer, type CaeMode, type SimServer } from "./testing/sim-server.js";
import { createSelfSignedCredentials, type TestCredentials } from "./testing/test-certs.js";
import { WsdlSchema } from "./testing/wsdl-validator.js";

const label = "[simulacion local]";
const FAKE_CUIT = "20000000001";

function baseRequest(overrides: Partial<CaeRequest> = {}): CaeRequest {
    return {
        cuit: FAKE_CUIT,
        pointOfSale: 1,
        voucherType: 11,
        concept: 1,
        docType: 99,
        docNumber: "0",
        receiverIvaConditionId: 5,
        voucherNumber: 42,
        voucherDate: "20261019",
        netAmount: "1000.00",
        ivaAmount: "0.00",
        totalAmount: "1000.00",
        currency: "PES",
        exchangeRate: "1",
        idempotencyKey: "k-1",
        ...overrides,
    };
}

let creds: TestCredentials;
let sim: SimServer;

beforeAll(() => {
    creds = createSelfSignedCredentials(FAKE_CUIT);
}, 30_000);

beforeEach(async () => {
    sim = await startSimServer({ trustedFingerprints: new Set([creds.fingerprint]) });
});

afterEach(async () => {
    expect(sim.state.schemaViolations, "la peticion debe respetar el WSDL oficial").toEqual([]);
    await sim.close();
});

function makeClient(extra: Partial<ConstructorParameters<typeof ArcaWsfeClient>[0]> = {}): ArcaWsfeClient {
    return new ArcaWsfeClient({
        environment: "HOMOLOGACION",
        certPem: creds.certPem,
        keyPem: creds.keyPem,
        wsaaUrl: sim.wsaaUrl,
        wsfeUrl: sim.wsfeUrl,
        now: () => sim.state.now,
        timeoutMs: 3000,
        ...extra,
    });
}

describe(`TRA y firma CMS ${label}`, () => {
    it("arma un TRA conforme a la especificacion (sin source/destination, fechas con -03:00)", () => {
        const now = new Date("2026-10-19T15:00:00Z");
        const tra = buildTra({ service: "wsfe", now });
        expect(tra).toContain("<service>wsfe</service>");
        expect(tra).toContain("<generationTime>2026-10-19T11:50:00-03:00</generationTime>");
        expect(tra).toContain("<expirationTime>2026-10-19T12:10:00-03:00</expirationTime>");
        expect(tra).not.toContain("<source>");
        expect(tra).not.toContain("<destination>");
        const id = Number(/<uniqueId>(\d+)<\/uniqueId>/.exec(tra)?.[1]);
        expect(id).toBe(Math.floor(now.getTime() / 1000));
        expect(id).toBeLessThanOrEqual(4294967295);
    });

    const hasOpenssl = (() => {
        try {
            execFileSync("openssl", ["version"], { stdio: "ignore" });
            return true;
        } catch {
            return false;
        }
    })();

    it.skipIf(!hasOpenssl).each(["sha1", "sha256"] as const)(
        "el CMS (%s) lo verifica openssl y trae el TRA embebido",
        (digest) => {
            const dir = mkdtempSync(join(tmpdir(), "cms-"));
            try {
                const tra = buildTra({ service: "wsfe", now: new Date("2026-10-19T15:00:00Z") });
                const cms = signTra(tra, creds.certPem, creds.keyPem, digest);
                writeFileSync(join(dir, "in.der"), Buffer.from(cms, "base64"));
                const out = execFileSync(
                    "openssl",
                    ["cms", "-verify", "-inform", "DER", "-in", join(dir, "in.der"), "-noverify"],
                    { stdio: ["ignore", "pipe", "ignore"] },
                ).toString();
                expect(out).toBe(tra);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
    );

    it("rechaza credenciales ilegibles con FiscalProviderError", () => {
        expect(() => signTra("<x/>", "no-es-pem", "tampoco", "sha256")).toThrow(FiscalProviderError);
    });
});

describe(`validador contra el WSDL ${label}`, () => {
    it("acepta el envelope de FECAESolicitar y rechaza uno con elementos desordenados", () => {
        const wsdl = new WsdlSchema(new URL("./__fixtures__/wsfev1-homo.wsdl", import.meta.url).pathname);
        const good = buildCaeSolicitarEnvelope({ token: "t", sign: "s", cuit: FAKE_CUIT }, baseRequest());
        expect(wsdl.validateRequest(good).errors).toEqual([]);
        const disordered = good.replace("<ImpTotal>1000.00</ImpTotal><ImpTotConc>0</ImpTotConc>", "<ImpTotConc>0</ImpTotConc><ImpTotal>1000.00</ImpTotal>");
        expect(wsdl.validateRequest(disordered).errors.join("|")).toContain("fuera de orden");
        expect(wsdl.validateRequest(good.replace("<Cuit>", "<Cuit>x")).errors.join("|")).toContain("no es long");
    });
});

describe(`camino feliz ${label}`, () => {
    it("FEDummy", async () => {
        const r = await makeClient().healthCheck();
        expect(r).toEqual({ ok: true, detail: "AppServer=OK DbServer=OK AuthServer=OK" });
        expect(sim.state.wsaaRequests).toBe(0);
    });

    it("FECompUltimoAutorizado via WSAA con certificado confiable", async () => {
        const r = await makeClient().getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        expect(r).toEqual({ voucherNumber: 41 });
        expect(sim.state.logins).toBe(1);
    });

    it("FECAESolicitar autorizado devuelve CAE y vencimiento", async () => {
        const r = await makeClient().requestCae(baseRequest());
        expect(r.outcome).toBe("AUTHORIZED");
        expect(r.cae).toBe("73000000000001");
        expect(r.caeExpiration).toBe("20261029");
        expect(r.observations).toEqual([]);
        expect(r.errors).toEqual([]);
        expect(r.simulated).toBe(false);
        expect(sim.state.caeRequests).toHaveLength(1);
    });

    it("envia CondicionIVAReceptorId y comprobante clase C sin array Iva", async () => {
        await makeClient().requestCae(baseRequest());
        const det = (sim.state.caeRequests[0] as any).FeCAEReq.FeDetReq.FECAEDetRequest;
        expect(det.CondicionIVAReceptorId).toBe("5");
        expect(det.Iva).toBeUndefined();
        expect(det.ImpIVA).toBe("0.00");
        expect(det.CbteDesde).toBe("42");
        expect(det.CbteHasta).toBe("42");
    });
});

describe(`mapeo de resultados ${label}`, () => {
    const cases: Array<[CaeMode, string]> = [
        ["observations", "AUTHORIZED_WITH_OBSERVATIONS"],
        ["rejected", "REJECTED"],
        ["rejected-errors", "REJECTED"],
        ["partial", "INDETERMINATE"],
        ["approved-without-cae", "INDETERMINATE"],
        ["wrong-number", "INDETERMINATE"],
        ["internal-error", "INDETERMINATE"],
        ["garbage", "INDETERMINATE"],
        ["soap-fault", "INDETERMINATE"],
    ];
    it.each(cases)("modo %s => %s", async (mode, expected) => {
        sim.state.caeMode = mode;
        const r = await makeClient().requestCae(baseRequest());
        expect(r.outcome).toBe(expected);
        if (expected === "AUTHORIZED_WITH_OBSERVATIONS") {
            expect(r.cae).toBe("73000000000002");
            expect(r.observations).toEqual([{ code: 10063, message: "Observacion simulada" }]);
        }
        if (mode === "rejected") {
            expect(r.cae).toBeUndefined();
            expect(r.observations[0]?.code).toBe(10016);
        }
        if (mode === "rejected-errors") expect(r.errors).toEqual([{ code: 10015, message: "Rechazo simulado a nivel de solicitud" }]);
        if (expected === "INDETERMINATE") expect(r.cae).toBeUndefined();
    });

    it("timeout despues de enviar => INDETERMINATE (el comprobante pudo quedar registrado)", async () => {
        sim.state.caeMode = "timeout";
        sim.state.hangMs = 1500;
        const r = await makeClient({ timeoutMs: 150 }).requestCae(baseRequest());
        expect(r.outcome).toBe("INDETERMINATE");
        expect(r.errors[0]?.message).toContain("timeout");
        expect(sim.state.caeRequests).toHaveLength(1);
    });

    it("error de autenticacion de WSFEv1 (600) lanza FiscalProviderError y descarta el TA", async () => {
        const client = makeClient();
        await client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        sim.state.caeMode = "auth-error";
        await expect(client.requestCae(baseRequest())).rejects.toMatchObject({ code: "WSFE_AUTH_REJECTED" });
        sim.state.caeMode = "authorized";
        expect((await client.requestCae(baseRequest())).outcome).toBe("AUTHORIZED");
        expect(sim.state.logins).toBe(2);
    });
});

describe(`cache del TA ${label}`, () => {
    it("reutiliza el TA vigente entre llamadas", async () => {
        const client = makeClient();
        await client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        await client.requestCae(baseRequest());
        await client.requestCae(baseRequest({ voucherNumber: 43 }));
        expect(sim.state.logins).toBe(1);
    });

    it("llamadas concurrentes comparten un solo pedido de TA", async () => {
        const client = makeClient();
        await Promise.all([1, 2, 3].map(() => client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 })));
        expect(sim.state.wsaaRequests).toBe(1);
    });

    it("TA vencido: pide uno nuevo", async () => {
        const client = makeClient();
        await client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        sim.state.now = new Date(sim.state.now.getTime() + 13 * 3600 * 1000);
        await client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        expect(sim.state.logins).toBe(2);
    });

    it("no usa un TA a menos de un minuto de vencer", async () => {
        const client = makeClient();
        await client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        sim.state.now = new Date(sim.state.now.getTime() + 12 * 3600 * 1000 - 30_000);
        await client.getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
        expect(sim.state.logins).toBe(2);
    });
});

describe(`errores del WSAA ${label}`, () => {
    it("certificado no confiable: SoapFault cms.cert.untrusted y no reintenta durante 60 s", async () => {
        sim.state.trustedFingerprints.clear();
        const client = makeClient();
        const params = { cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 };
        await expect(client.getLastAuthorized(params)).rejects.toMatchObject({
            code: "WSAA_FAULT",
            details: { faultcode: "cms.cert.untrusted" },
        });
        await expect(client.getLastAuthorized(params)).rejects.toMatchObject({ code: "WSAA_FAULT" });
        expect(sim.state.wsaaRequests).toBe(1);
        sim.state.now = new Date(sim.state.now.getTime() + 61_000);
        await expect(client.getLastAuthorized(params)).rejects.toMatchObject({ code: "WSAA_FAULT" });
        expect(sim.state.wsaaRequests).toBe(2);
    });

    it("wsaa.unavailable es transitorio: no activa la espera", async () => {
        sim.state.wsaaFault = { code: "wsaa.unavailable", message: "WSAA momentaneamente fuera de servicio" };
        const client = makeClient();
        const params = { cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 };
        await expect(client.getLastAuthorized(params)).rejects.toMatchObject({ code: "WSAA_FAULT" });
        await expect(client.getLastAuthorized(params)).rejects.toMatchObject({ code: "WSAA_FAULT" });
        expect(sim.state.wsaaRequests).toBe(2);
    });

    it("coe.alreadyAuthenticated se informa con el codigo y sin reintentar enseguida", async () => {
        sim.state.wsaaFault = { code: "coe.alreadyAuthenticated", message: "ya existe un TA vigente" };
        const client = makeClient();
        await expect(client.requestCae(baseRequest())).rejects.toMatchObject({ details: { faultcode: "coe.alreadyAuthenticated" } });
        await expect(client.requestCae(baseRequest())).rejects.toMatchObject({ code: "WSAA_FAULT" });
        expect(sim.state.wsaaRequests).toBe(1);
        expect(sim.state.caeRequests).toHaveLength(0);
    });

    it("un fallo del WSAA nunca devuelve CaeResult: el comprobante no se envio", async () => {
        sim.state.trustedFingerprints.clear();
        await expect(makeClient().requestCae(baseRequest())).rejects.toBeInstanceOf(FiscalProviderError);
        expect(sim.state.caeRequests).toHaveLength(0);
    });
});

describe(`peticiones que el cliente no arma ${label}`, () => {
    const cases: Array<[string, Partial<CaeRequest>, string]> = [
        ["clase A (requiere alicuotas)", { voucherType: 1 }, "FISCAL_REQUEST_UNSUPPORTED"],
        ["concepto servicios (faltan fechas)", { concept: 2 }, "FISCAL_REQUEST_UNSUPPORTED"],
        ["total distinto de neto + IVA", { totalAmount: "999.00" }, "FISCAL_REQUEST_INVALID"],
        ["IVA distinto de cero en clase C", { ivaAmount: "10.00", totalAmount: "1010.00" }, "FISCAL_REQUEST_INVALID"],
        ["PES con cotizacion distinta de 1", { exchangeRate: "2" }, "FISCAL_REQUEST_INVALID"],
        ["fecha mal formada", { voucherDate: "2026-10-19" }, "FISCAL_REQUEST_INVALID"],
        ["importe con 3 decimales", { netAmount: "1000.001" }, "FISCAL_REQUEST_INVALID"],
        ["CUIT corto", { cuit: "123" }, "FISCAL_REQUEST_INVALID"],
    ];
    it.each(cases)("%s", async (_name, override, code) => {
        await expect(makeClient().requestCae(baseRequest(override))).rejects.toMatchObject({ code });
        expect(sim.state.wsaaRequests).toBe(0);
    });
});

describe(`servidor caido ${label}`, () => {
    it("healthCheck informa ok:false", async () => {
        const client = makeClient();
        await sim.close();
        const r = await client.healthCheck();
        expect(r.ok).toBe(false);
        sim = await startSimServer();
    });
});
