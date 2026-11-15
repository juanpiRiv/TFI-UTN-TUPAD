/**
 * Rota ARCA_ENCRYPTION_KEY: vuelve a cifrar con una clave nueva las claves privadas de ARCA guardadas.
 *
 * Uso (desde backend/):
 *   ARCA_OLD_ENCRYPTION_KEY=<hex vieja> ARCA_NEW_ENCRYPTION_KEY=<hex nueva> pnpm arca:rotate-key           # simulación
 *   ARCA_OLD_ENCRYPTION_KEY=<hex vieja> ARCA_NEW_ENCRYPTION_KEY=<hex nueva> pnpm arca:rotate-key --apply   # escribe
 *
 * Las claves se pasan por variables de entorno (no por argumentos) para que no queden en el historial del shell
 * ni en la lista de procesos. Generar una nueva: openssl rand -hex 32
 *
 * Orden recomendado en producción:
 *   1. Backup de la base.   2. Simulación.   3. --apply.
 *   4. Cambiar ARCA_ENCRYPTION_KEY en el servidor por la nueva y reiniciar.
 * Entre el paso 3 y el 4 el servidor viejo no puede descifrar: hacerlo en una ventana corta.
 *
 * Imprime solo cantidades. Nunca claves ni contenido descifrado.
 */
import { prisma } from '../src/lib/prisma.js'
import { rotateEncryptionKey } from '../src/module/arca/key-rotation.js'

const apply = process.argv.includes('--apply')

try {
  const report = await rotateEncryptionKey(prisma, {
    oldKeyHex: process.env.ARCA_OLD_ENCRYPTION_KEY,
    newKeyHex: process.env.ARCA_NEW_ENCRYPTION_KEY,
    apply,
  })
  const mode = report.dryRun ? 'SIMULACIÓN (no se escribió nada)' : 'APLICADO'
  console.log(`${mode}: ${report.rotated} credencial(es) vueltas a cifrar, ${report.alreadyRotated} ya estaban con la clave nueva.`)
  console.log(`Tickets de acceso: ${report.ticketsRotated} vueltos a cifrar, ${report.ticketsDiscarded} descartados (vencidos o ilegibles).`)
  if (report.dryRun) console.log('Para escribir los cambios, repetir con --apply.')
  else console.log('Ahora cambiar ARCA_ENCRYPTION_KEY en el servidor por la clave nueva y reiniciar.')
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : 'falló la rotación'}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
