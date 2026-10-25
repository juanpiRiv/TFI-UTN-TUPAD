import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { createInvoiceSchema, invoiceIdParamSchema } from "./invoices.schemas.js";
import * as invoicesService from "./invoices.service.js";
import { authorizeInvoice } from "./invoice-authorization.js";
import { env } from "../../config/env.js";
import { createFiscalProvider, parseArcaProviderKind } from "../arca/provider-factory.js";

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

/**
 * POST /api/invoices
 * Crea una factura en borrador con sus ítems. El total lo calcula el backend.
 */
export async function createInvoice(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const parsed = createInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Datos de factura inválidos", details);
  }

  const invoice = await invoicesService.createInvoice(req.userId, parsed.data);
  res.status(201).json(invoice);
}

/**
 * POST /api/invoices/:invoiceId/authorize
 * Botón "Facturar": pide el CAE al proveedor fiscal configurado (ARCA_PROVIDER).
 * 200 con el resultado (autorizada o rechazada); 202 si ARCA no respondió y la factura queda pendiente.
 */
export async function authorize(req: Request, res: Response) {
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

  const result = await authorizeInvoice(req.userId, paramResult.data.invoiceId, () =>
    createFiscalProvider(parseArcaProviderKind(env.ARCA_PROVIDER), { mode: env.ARCA_MODE }),
  );
  res.status(result.fiscal.outcome === "INDETERMINATE" ? 202 : 200).json(result);
}
