import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
} from "./transactions.schemas.js";
import * as transactionsService from "./transactions.service.js";

/**
 * POST /api/transactions
 * Registra un nuevo movimiento manual (ingreso o egreso). Retorna 201 Created.
 */
export async function create(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const bodyResult = createTransactionSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const details = bodyResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid data", details);
  }

  const transaction = await transactionsService.createTransaction(
    req.userId,
    bodyResult.data,
  );

  res.status(201).json(transaction);
}

/**
 * GET /api/transactions
 * Lista los movimientos no anulados con filtros opcionales.
 */
export async function list(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const queryResult = listTransactionsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const details = queryResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid query parameters", details);
  }

  const transactions = await transactionsService.listTransactions(
    req.userId,
    queryResult.data,
  );

  res.json(transactions);
}
