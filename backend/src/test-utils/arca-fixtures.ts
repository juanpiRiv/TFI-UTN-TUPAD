import { webcrypto } from "node:crypto";
import { Pkcs10CertificateRequest, X509CertificateGenerator } from "@peculiar/x509";

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const DAY = 86_400_000;

let caKeys: CryptoKeyPair | undefined;
const ca = async (): Promise<CryptoKeyPair> => {
  caKeys ??= (await webcrypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"])) as CryptoKeyPair;
  return caKeys;
};

export interface SignOptions {
  /** CUIT del sujeto. `null` = el certificado no trae CUIT. Sin indicar, se copia el sujeto del CSR (como hace ARCA). */
  cuit?: string | null;
  notBefore?: Date;
  notAfter?: Date;
}

/**
 * Firma un CSR con una CA descartable, como haría ARCA: el certificado lleva la clave pública del pedido.
 * Devuelve el certificado hoja y el de la CA (para armar cadenas).
 */
export async function signCsrWithCa(csrPem: string, opts: SignOptions = {}): Promise<{ certificate: string; caCertificate: string }> {
  const csr = new Pkcs10CertificateRequest(csrPem);
  const keys = await ca();
  const now = Date.now();
  const subject =
    opts.cuit === undefined
      ? csr.subject
      : opts.cuit === null
        ? [{ C: ["AR"] }, { CN: ["sin-cuit"] }]
        : [{ C: ["AR"] }, { CN: ["prueba"] }, { "2.5.4.5": [`CUIT ${opts.cuit}`] }];
  const certificate = await X509CertificateGenerator.create({
    serialNumber: "01",
    subject,
    issuer: "CN=CA de prueba",
    notBefore: opts.notBefore ?? new Date(now - 3_600_000),
    notAfter: opts.notAfter ?? new Date(now + 30 * DAY),
    signingAlgorithm: ALG,
    publicKey: csr.publicKey,
    signingKey: keys.privateKey,
  });
  const caCertificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: "02",
    name: "CN=CA de prueba",
    notBefore: new Date(now - 3_600_000),
    notAfter: new Date(now + 365 * DAY),
    signingAlgorithm: ALG,
    keys,
  });
  return { certificate: certificate.toString("pem"), caCertificate: caCertificate.toString("pem") };
}

export async function signCsr(csrPem: string, opts: SignOptions = {}): Promise<string> {
  return (await signCsrWithCa(csrPem, opts)).certificate;
}
