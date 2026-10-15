import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { invoiceIdParamSchema } from "./invoices.schemas.js";
import * as invoicesService from "./invoices.service.js";

/**
 * GET /api/invoices
 * Lista todas las facturas de la organización con sus saldos y estados comerciales.
 */
export async function listInvoices(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const invoices = await invoicesService.listInvoices(req.userId);
  res.json(invoices);
}

/**
 * GET /api/invoices/:invoiceId
 * Obtiene el detalle de una factura específica, con saldos y cobros asociados.
 */
export async function getInvoiceById(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const paramResult = invoiceIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    const details = paramResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Parámetros inválidos", details);
  }

  const invoice = await invoicesService.getInvoiceById(
    req.userId,
    paramResult.data.invoiceId,
  );

  res.json(invoice);
}
