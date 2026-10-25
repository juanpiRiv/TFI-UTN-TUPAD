import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import { dashboardSummaryQuerySchema } from "./dashboard.schemas.js";
import * as dashboardService from "./dashboard.service.js";

/**
 * GET /api/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Retorna el resumen del período (ingresos, egresos, neto, cantidad y por categoría).
 */
export async function getSummary(req: Request, res: Response) {
  if (!req.userId) {
    throw new AppError(401, "Unauthorized");
  }

  const queryResult = dashboardSummaryQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const details = queryResult.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "Invalid query parameters", details);
  }

  const summary = await dashboardService.getDashboardSummary(
    req.userId,
    queryResult.data,
  );

  res.json(summary);
}
