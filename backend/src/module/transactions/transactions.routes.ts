import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import * as transactionsController from "./transactions.controller.js";

export const transactionsRouter = Router();

// Todas las rutas de transacciones requieren usuario autenticado
transactionsRouter.use(requireAuth);

transactionsRouter.get("/", transactionsController.list);
transactionsRouter.post("/", transactionsController.create);
