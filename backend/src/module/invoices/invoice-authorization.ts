import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { buildCaeRequest } from "../arca/cae-request.js";
import type { CaeResult, FiscalProvider } from "../arca/fiscal-provider.js";
import { ArcaSimulatedClient } from "../arca/simulated/arca-simulated-client.js";
import { getInvoiceById } from "./invoices.service.js";

const FACTURA_C_CODE = 11;
// El paso de numerar y autorizar espera a ARCA: necesita más tiempo que una transacción común (docs/02, paso 2).
const AUTHORIZE_TRANSACTION = { timeout: 30_000, maxWait: 5_000 } as const;

const toDate = (yyyymmdd: string) =>
  new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00.000Z`);

/**
 * Autoriza una factura en borrador con el proveedor fiscal, siguiendo docs/02-atomicidad-concurrencia.md:
 * 1) reserva (DRAFT -> PENDING, con la fila bloqueada) y 2) numera y pide el CAE de a una por punto de venta.
 * Si ARCA no responde, la factura queda PENDING (no se reintenta a ciegas). La reconciliación es posterior.
 */
export async function authorizeInvoice(
  userId: number,
  invoiceId: number,
  createProvider: () => FiscalProvider,
) {
  const org = await prisma.organization.findUnique({ where: { userId }, select: { id: true, cuit: true } });
  if (!org) throw new AppError(403, "Organization required");

  // Antes de tocar nada: si el proveedor no se puede armar, la factura queda como estaba.
  let provider: FiscalProvider;
  try {
    provider = createProvider();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "error desconocido";
    throw new AppError(503, `El proveedor fiscal no está disponible: ${reason}`);
  }

  // Paso 1: reservar. Si ya no es borrador (doble clic, otra pestaña) responde 409 sin llamar a ARCA.
  const reserved = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: number; status: string }[]>`
      SELECT id, status FROM invoices WHERE id = ${invoiceId} AND organization_id = ${org.id} FOR UPDATE`;
    const current = rows[0];
    if (!current) throw new AppError(404, "Factura no encontrada");
    if (current.status !== "DRAFT") {
      throw new AppError(409, `Solo se puede facturar un borrador (estado actual: ${current.status})`);
    }
    return tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "PENDING" },
      include: { pointOfSale: true },
    });
  });

  // Paso 2: numerar y autorizar, de a una por punto de venta y tipo de comprobante.
  let result: CaeResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${reserved.pointOfSaleId}, ${FACTURA_C_CODE})`;

      const lastInDb = await tx.invoice.aggregate({
        _max: { voucherNumber: true },
        where: { pointOfSaleId: reserved.pointOfSaleId, voucherType: reserved.voucherType, status: "AUTHORIZED" },
      });
      const lastLocal = lastInDb._max.voucherNumber ?? 0;
      const sequence = { cuit: org.cuit, pointOfSale: reserved.pointOfSale.number, voucherType: FACTURA_C_CODE };
      if (provider instanceof ArcaSimulatedClient) provider.seedLastAuthorized(sequence, lastLocal);

      const last = await provider.getLastAuthorized(sequence);
      const voucherNumber = Math.max(last.voucherNumber, lastLocal) + 1;
      const outcome = await provider.requestCae(
        buildCaeRequest({
          cuit: org.cuit,
          pointOfSaleNumber: reserved.pointOfSale.number,
          voucherNumber,
          invoice: reserved,
        }),
      );

      const arcaResponse = {
        provider: provider.name,
        simulated: outcome.simulated,
        outcome: outcome.outcome,
        observations: outcome.observations.map(({ code, message }) => ({ code, message })),
        errors: outcome.errors.map(({ code, message }) => ({ code, message })),
      };

      if (outcome.outcome === "AUTHORIZED" || outcome.outcome === "AUTHORIZED_WITH_OBSERVATIONS") {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "AUTHORIZED",
            voucherNumber,
            cae: outcome.cae ?? null,
            caeExpiration: outcome.caeExpiration ? toDate(outcome.caeExpiration) : null,
            authorizedAt: new Date(),
            arcaResponse,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            userId,
            action: "invoice.authorized",
            entity: "Invoice",
            entityId: invoiceId,
            metadata: { voucherNumber, cae: outcome.cae, simulated: outcome.simulated },
          },
        });
      } else if (outcome.outcome === "REJECTED") {
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: "REJECTED", arcaResponse } });
        await tx.auditLog.create({
          data: {
            organizationId: org.id,
            userId,
            action: "invoice.rejected",
            entity: "Invoice",
            entityId: invoiceId,
            metadata: { errors: arcaResponse.errors, simulated: outcome.simulated },
          },
        });
      }
      // INDETERMINATE: no sabemos si ARCA lo registró. Queda PENDING para reconciliar, sin reintentar a ciegas.
      return outcome;
    }, AUTHORIZE_TRANSACTION);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // La factura queda PENDING: puede que ARCA haya contestado y falló nuestra base.
    throw new AppError(502, "No se pudo completar la autorización con ARCA. La factura quedó pendiente.");
  }

  const invoice = await getInvoiceById(userId, invoiceId);
  return {
    invoice,
    fiscal: {
      outcome: result.outcome,
      simulated: result.simulated,
      observations: result.observations,
      errors: result.errors,
    },
  };
}
