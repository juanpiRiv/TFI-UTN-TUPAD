import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { getUsdExchangeRateQuerySchema } from "./exchange-rates.schemas.js";
import * as exchangeRatesService from "./exchange-rates.service.js";

/**
 * GET /api/exchange-rates/usd?date=YYYY-MM-DD
 * Retorna la cotización de gestión para USD a ARS en la fecha indicada.
 */
export async function getUsdRate(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const queryResult = getUsdExchangeRateQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const details = queryResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid query parameters", details);
  }

  const rate = await exchangeRatesService.getUsdExchangeRate(queryResult.data.date);
  res.json(rate);
}
