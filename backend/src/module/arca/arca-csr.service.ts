import { webcrypto } from 'node:crypto'
import { Pkcs10CertificateRequestGenerator } from '@peculiar/x509'

// La librería no conoce el nombre serialNumber: se indica por su OID (2.5.4.5).
const SERIAL_NUMBER_OID = '2.5.4.5'

/** Pedido de certificado listo para pegar en ARCA, más la clave privada que le corresponde. */
export interface GeneratedCsr {
  csr: string
  privateKeyPem: string
}

const toPem = (label: string, der: ArrayBuffer): string => {
  const base64 = Buffer.from(der).toString('base64')
  return `-----BEGIN ${label}-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----`
}

/**
 * Deja la razón social en algo que el DN de ARCA acepta sin sorpresas: sin tildes ni símbolos que
 * separen o escapen atributos (`,` `+` `=` `"` `\` `<` `>` `#` `;`), en una sola línea y con un tope de 64 caracteres.
 */
export function sanitizeOrganizationName(legalName: string): string {
  const cleaned = legalName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9 .&'()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim()
  return cleaned || 'Contribuyente'
}

/**
 * Alias del certificado: solo letras y números, porque WSASS rechaza otros caracteres en el nombre simbólico.
 */
export const aliasFor = (cuit: string): string => `tfi${cuit.replace(/\D/g, '')}`

/**
 * Genera una clave RSA de 2048 bits y el CSR que ARCA espera: C=AR, O=<razón social>, CN=<alias> y
 * serialNumber="CUIT <cuit>". Todo en JavaScript (sin depender de un binario `openssl` en el servidor).
 */
export async function generateCsr(input: { legalName: string; cuit: string }): Promise<GeneratedCsr> {
  const keys = (await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair

  const request = await Pkcs10CertificateRequestGenerator.create({
    name: [
      { C: ['AR'] },
      { O: [sanitizeOrganizationName(input.legalName)] },
      { CN: [aliasFor(input.cuit)] },
      { [SERIAL_NUMBER_OID]: [`CUIT ${input.cuit}`] },
    ],
    keys,
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  })
  const privateKeyDer = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)
  return { csr: request.toString('pem').trim(), privateKeyPem: toPem('PRIVATE KEY', privateKeyDer) }
}
