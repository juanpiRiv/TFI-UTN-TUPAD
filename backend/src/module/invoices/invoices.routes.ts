import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import * as invoicesController from "./invoices.controller.js";

export const invoicesRouter = Router();

// Todas las operaciones de facturación requieren usuario autenticado
invoicesRouter.use(requireAuth);

invoicesRouter.get("/", invoicesController.listInvoices);
invoicesRouter.post("/", invoicesController.createInvoice);
invoicesRouter.get("/:invoiceId", invoicesController.getInvoiceById);
