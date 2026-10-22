import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import * as dashboardController from "./dashboard.controller.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", dashboardController.getSummary);
