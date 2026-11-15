import type { PrismaClient } from '../../generated/prisma/client.js'
import { aadFor } from './arca-credential.service.js'
import { decryptSecret, encryptSecret, parseEncryptionKey } from './secret-box.js'

export interface KeyRotationReport {
  /** Credenciales que se volvieron a cifrar con la clave nueva. */
  rotated: number
  /** Credenciales que ya estaban cifradas con la clave nueva (la rotación se puede repetir). */
  alreadyRotated: number
  /** Tickets de acceso del WSAA vueltos a cifrar (así no hace falta pedir otro: ARCA no lo entrega mientras el anterior vive). */
  ticketsRotated: number
  /** Tickets vencidos o que no se descifran con ninguna de las dos claves: se descartan, el siguiente pedido arma otro. */
  ticketsDiscarded: number
  /** Si fue una simulación: no se escribió nada. */
  dryRun: boolean
}

export interface KeyRotationInput {
  oldKeyHex: string | undefined
  newKeyHex: string | undefined
  /** Por defecto es una simulación: hay que pedir la escritura de forma explícita. */
  apply?: boolean
}

type RotationClient = Pick<PrismaClient, '$transaction'>

/**
 * Cambia la clave con la que está cifrada la clave privada de ARCA de cada organización.
 *
 * Todo o nada: se descifra y se vuelve a cifrar cada fila dentro de una transacción, y se comprueba que
 * el resultado se descifre con la clave nueva antes de guardarlo. Si una fila no se puede descifrar ni con
 * la clave vieja ni con la nueva, no se escribe nada. Se puede repetir sin riesgo: las filas que ya usan la
 * clave nueva se cuentan y se dejan como están.
 *
 * Nunca devuelve ni registra claves ni texto descifrado: solo cantidades.
 */
export async function rotateEncryptionKey(prisma: RotationClient, input: KeyRotationInput): Promise<KeyRotationReport> {
  const oldKey = parseEncryptionKey(input.oldKeyHex)
  const newKey = parseEncryptionKey(input.newKeyHex)
  if (oldKey.equals(newKey)) throw new Error('La clave nueva es igual a la vieja: no hay nada que rotar.')
  const dryRun = !input.apply

  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.arcaCredential.findMany({
        select: { id: true, organizationId: true, privateKeyEncrypted: true },
      })
      let rotated = 0
      let alreadyRotated = 0

      for (const row of rows) {
        const aad = aadFor(row.organizationId)
        let plain: string
        try {
          plain = decryptSecret(row.privateKeyEncrypted, oldKey, aad)
        } catch {
          try {
            decryptSecret(row.privateKeyEncrypted, newKey, aad)
            alreadyRotated++
            continue
          } catch {
            throw new Error(
              `La credencial de la organización ${row.organizationId} no se descifra ni con la clave vieja ni con la nueva. No se cambió nada.`,
            )
          }
        }
        const reencrypted = encryptSecret(plain, newKey, aad)
        if (decryptSecret(reencrypted, newKey, aad) !== plain) {
          throw new Error(`La verificación del nuevo cifrado falló para la organización ${row.organizationId}. No se cambió nada.`)
        }
        if (!dryRun) {
          await tx.arcaCredential.update({ where: { id: row.id }, data: { privateKeyEncrypted: reencrypted } })
        }
        rotated++
      }

      let ticketsRotated = 0
      let ticketsDiscarded = 0
      const tickets = await tx.arcaWsaaTicket.findMany({
        select: { id: true, tokenEncrypted: true, signEncrypted: true, expiresAt: true },
      })
      for (const ticket of tickets) {
        const aad = `arca-wsaa:${ticket.id}`
        const fresh = ticket.expiresAt.getTime() > Date.now()
        let token: string | undefined
        let sign: string | undefined
        if (fresh) {
          try {
            token = decryptSecret(ticket.tokenEncrypted, oldKey, aad)
            sign = decryptSecret(ticket.signEncrypted, oldKey, aad)
          } catch {
            try {
              decryptSecret(ticket.tokenEncrypted, newKey, aad)
              decryptSecret(ticket.signEncrypted, newKey, aad)
              continue // ya está con la clave nueva
            } catch {
              // no se puede leer con ninguna: se descarta
            }
          }
        }
        if (token === undefined || sign === undefined) {
          if (!dryRun) await tx.arcaWsaaTicket.delete({ where: { id: ticket.id } })
          ticketsDiscarded++
          continue
        }
        if (!dryRun) {
          await tx.arcaWsaaTicket.update({
            where: { id: ticket.id },
            data: { tokenEncrypted: encryptSecret(token, newKey, aad), signEncrypted: encryptSecret(sign, newKey, aad) },
          })
        }
        ticketsRotated++
      }
      return { rotated, alreadyRotated, ticketsRotated, ticketsDiscarded, dryRun }
    },
    { timeout: 60_000 },
  )
}
