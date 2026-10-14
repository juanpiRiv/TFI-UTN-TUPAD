import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import {
  createPaymentSchema,
  invoiceIdParamSchema,
} from "./payments.schemas.js";
import * as paymentsService from "./payments.service.js";

/**
 * POST /api/invoices/:invoiceId/payments
 * Registra un cobro contra una factura autorizada.
 * Genera exactamente un Payment y un Transaction de ingreso.
 * Retorna 201 Created.
 */
export async function createPayment(req: Request, res: Response) {
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

  const bodyResult = createPaymentSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const details = bodyResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Datos de pago inválidos", details);
  }

  const result = await paymentsService.registerPayment(
    req.userId,
    paramResult.data.invoiceId,
    bodyResult.data,
  );

  res.status(201).json(result);
}

/**
 * GET /api/invoices/:invoiceId/payments
 * Consulta los pagos, el saldo pendiente y el estado comercial de la factura.
 */
export async function listPayments(req: Request, res: Response) {
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

  const summary = await paymentsService.getInvoicePayments(
    req.userId,
    paramResult.data.invoiceId,
  );

  res.json(summary);
}

/**
 * GET /api/invoices
 * Lista todas las facturas de la organización con sus saldos y estados comerciales.
 */
export async function listInvoices(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const invoices = await paymentsService.listInvoices(req.userId);
  res.json(invoices);
}

