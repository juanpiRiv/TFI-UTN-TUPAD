import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

export interface TestCredentials {
    certPem: string;
    keyPem: string;
    /** SHA-256 hex del DER del certificado. */
    fingerprint: string;
}

/**
 * Certificado AUTOFIRMADO de prueba con CUIT inventado. Solo para tests y para
 * ver el rechazo real del WSAA. No lo emite ninguna autoridad reconocida por ARCA.
 */
export function createSelfSignedCredentials(cuit = "20000000001", commonName = "tfi-spike-prueba"): TestCredentials {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(pubPem);
    cert.serialNumber = "01" + forge.util.bytesToHex(forge.random.getBytesSync(8));
    const now = new Date();
    cert.validity.notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
    cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
    const attrs = [
        { name: "countryName", value: "AR" },
        { name: "organizationName", value: "Prueba TFI" },
        { name: "commonName", value: commonName },
        { name: "serialNumber", value: `CUIT ${cuit}` },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());

    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const md = forge.md.sha256.create();
    md.update(der);
    return { certPem: forge.pki.certificateToPem(cert), keyPem, fingerprint: md.digest().toHex() };
}
