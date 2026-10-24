// Reproduce OFFLINE respuestas REALES de homologacion capturadas el 2026-10-19
// (ver __fixtures__/real-*.xml). El resto del circuito (WSAA con TA) es simulacion local.
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ArcaWsfeClient } from "./arca-wsfe-client.js";
import { parseLoginCmsResponse, WsaaFault } from "./wsaa.js";
import { startSimServer, type SimServer } from "./testing/sim-server.js";
import { createSelfSignedCredentials, type TestCredentials } from "./testing/test-certs.js";

const real = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

let creds: TestCredentials;
let sim: SimServer;

beforeAll(() => {
    creds = createSelfSignedCredentials();
}, 30_000);
beforeEach(async () => {
    sim = await startSimServer({ trustedFingerprints: new Set([creds.fingerprint]) });
});
afterEach(async () => {
    await sim.close();
});

function clientWithRealWsfe(fixture: string): ArcaWsfeClient {
    return new ArcaWsfeClient({
        environment: "HOMOLOGACION",
        certPem: creds.certPem,
        keyPem: creds.keyPem,
        wsaaUrl: sim.wsaaUrl,
        wsfeUrl: "https://wsfe.real.invalid/wsfev1/service.asmx",
        now: () => sim.state.now,
        fetchImpl: (url, init) =>
            String(url).includes("wsfe.real.invalid")
                ? Promise.resolve(new Response(real(fixture), { status: 200, headers: { "Content-Type": "text/xml" } }))
                : fetch(url, init),
    });
}

describe("respuestas reales capturadas de homologacion (2026-10-19)", () => {
    it("FEDummy real => ok", async () => {
        const r = await clientWithRealWsfe("real-fedummy.xml").healthCheck();
        expect(r).toEqual({ ok: true, detail: "AppServer=OK DbServer=OK AuthServer=OK" });
    });

    it("SoapFault real cms.cert.untrusted del WSAA se parsea con su codigo", () => {
        const body = real("real-wsaa-cert-untrusted.xml");
        try {
            parseLoginCmsResponse(body);
            expect.unreachable();
        } catch (err) {
            expect(err).toBeInstanceOf(WsaaFault);
            expect((err as WsaaFault).faultcode).toBe("cms.cert.untrusted");
            expect((err as WsaaFault).faultstring).toBe("Certificado no emitido por AC de confianza");
        }
    });

    it("error 600 real de FECAESolicitar (sin FeCabResp) => FiscalProviderError, no rechazo", async () => {
        await expect(
            clientWithRealWsfe("real-wsfe-cae-auth-600.xml").requestCae({
                cuit: "20000000001",
                pointOfSale: 1,
                voucherType: 11,
                concept: 1,
                docType: 99,
                docNumber: "0",
                receiverIvaConditionId: 5,
                voucherNumber: 1,
                voucherDate: "20261019",
                netAmount: "1000.00",
                ivaAmount: "0.00",
                totalAmount: "1000.00",
                currency: "PES",
                exchangeRate: "1",
                idempotencyKey: "k",
            }),
        ).rejects.toMatchObject({ code: "WSFE_AUTH_REJECTED" });
    });

    it("error 600 real de FECompUltimoAutorizado => FiscalProviderError", async () => {
        await expect(
            clientWithRealWsfe("real-wsfe-ultimo-auth-600.xml").getLastAuthorized({ cuit: "20000000001", pointOfSale: 1, voucherType: 11 }),
        ).rejects.toMatchObject({ code: "WSFE_ERROR" });
    });
});
