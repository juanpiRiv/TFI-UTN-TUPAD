/**
 * Corrida REAL contra homologacion, sin certificado valido. Uso:
 *   NODE_USE_ENV_PROXY=1 pnpm --filter backend exec tsx src/module/arca/direct/spike-real.ts <carpeta-de-salida>
 *
 * - FEDummy (no requiere autenticacion).
 * - WSAA con un certificado AUTOFIRMADO de prueba y CUIT inventado: se espera rechazo.
 * - WSFEv1 con token/sign inventados, para ver la forma real del error de autenticacion.
 * Guarda cada peticion/respuesta cruda con fecha. El certificado y la clave de prueba
 * se generan en memoria y no se escriben a disco.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArcaWsfeClient } from "./arca-wsfe-client.js";
import { postSoap, type SoapExchange } from "./soap.js";
import { buildCaeSolicitarEnvelope, buildUltimoAutorizadoEnvelope, WSFE_NS } from "./wsfe.js";
import { createSelfSignedCredentials } from "./testing/test-certs.js";

const outArg = process.argv[2];
if (!outArg) throw new Error("Falta la carpeta de salida");
const outDir: string = outArg;
mkdirSync(outDir, { recursive: true });

const FAKE_CUIT = "20000000001";

function save(name: string, command: string, exchanges: SoapExchange[], note = ""): void {
    const body = [
        `Capturado: ${new Date().toISOString()}`,
        `Comando: ${command}`,
        note ? `Nota: ${note}` : "",
        ...exchanges.map(
            (e, i) =>
                [
                    ``,
                    `===== intercambio ${i + 1} (${e.at}) =====`,
                    `POST ${e.url}`,
                    `SOAPAction: ${e.soapAction}`,
                    `Content-Type: text/xml;charset=UTF-8`,
                    ``,
                    e.requestBody,
                    ``,
                    e.error ? `--- ERROR DE TRANSPORTE ---\n${e.error}` : `--- RESPUESTA HTTP ${e.status} ---\n${e.responseBody}`,
                ].join("\n"),
        ),
    ].join("\n");
    writeFileSync(join(outDir, name), body + "\n");
    console.log(`guardado ${name}`);
}

async function main(): Promise<void> {
    // 1. FEDummy real
    const dummyEx: SoapExchange[] = [];
    const creds = createSelfSignedCredentials(FAKE_CUIT);
    const mk = (digest: "sha1" | "sha256", ex: SoapExchange[]) =>
        new ArcaWsfeClient({
            environment: "HOMOLOGACION",
            certPem: creds.certPem,
            keyPem: creds.keyPem,
            digest,
            onExchange: (e) => ex.push(e),
            timeoutMs: 40_000,
        });
    const health = await mk("sha256", dummyEx).healthCheck();
    save("A-fedummy.txt", "ArcaWsfeClient.healthCheck() -> POST wswhomo.afip.gov.ar FEDummy", dummyEx, `Resultado del cliente: ${JSON.stringify(health)}`);

    // 2. WSAA con certificado autofirmado: sha256 y sha1
    for (const digest of ["sha256", "sha1"] as const) {
        const ex: SoapExchange[] = [];
        let outcome = "";
        try {
            await mk(digest, ex).getLastAuthorized({ cuit: FAKE_CUIT, pointOfSale: 1, voucherType: 11 });
            outcome = "inesperado: el WSAA entrego un TA";
        } catch (err) {
            const e = err as { code?: string; details?: unknown };
            outcome = `FiscalProviderError ${e.code} ${JSON.stringify(e.details)}`;
        }
        save(
            `A-wsaa-autofirmado-${digest}.txt`,
            `ArcaWsfeClient(digest=${digest}).getLastAuthorized(...) -> loginCms con certificado autofirmado de prueba, CUIT ${FAKE_CUIT}`,
            ex,
            `Resultado del cliente: ${outcome}`,
        );
    }

    // 3. WSFEv1 con token/sign inventados
    const fakeAuth = { token: "TOKEN-INVENTADO", sign: "SIGN-INVENTADO", cuit: FAKE_CUIT };
    const url = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";
    const authEx: SoapExchange[] = [];
    const t = { onExchange: (e: SoapExchange) => authEx.push(e), timeoutMs: 40_000 };
    await postSoap(url, `${WSFE_NS}FECompUltimoAutorizado`, buildUltimoAutorizadoEnvelope(fakeAuth, 1, 11), t);
    await postSoap(
        url,
        `${WSFE_NS}FECAESolicitar`,
        buildCaeSolicitarEnvelope(fakeAuth, {
            cuit: FAKE_CUIT,
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
            idempotencyKey: "spike",
        }),
        t,
    );
    save("A-wsfe-token-inventado.txt", "POST FECompUltimoAutorizado y FECAESolicitar con Token/Sign inventados", authEx, "Sirve para ver la forma real del error de autenticacion de WSFEv1. Los valores de codigos NO se asumen: leer la respuesta.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
