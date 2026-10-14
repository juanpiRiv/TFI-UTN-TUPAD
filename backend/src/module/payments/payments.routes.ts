import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import * as paymentsController from "./payments.controller.js";

export const paymentsRouter = Router({ mergeParams: true });

// Todas las operaciones de facturación y pagos requieren usuario autenticado
paymentsRouter.use(requireAuth);

paymentsRouter.get("/", paymentsController.listInvoices);
paymentsRouter.get("/:invoiceId", paymentsController.listPayments);
paymentsRouter.get("/:invoiceId/payments", paymentsController.listPayments);
paymentsRouter.post("/:invoiceId/payments", paymentsController.createPayment);

