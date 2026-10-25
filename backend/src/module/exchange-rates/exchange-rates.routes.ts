import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { getUsdRate } from "./exchange-rates.controller.js";

export const exchangeRatesRouter = Router();

// Todas las rutas requieren autenticación
exchangeRatesRouter.use(requireAuth);

exchangeRatesRouter.get("/usd", getUsdRate);
