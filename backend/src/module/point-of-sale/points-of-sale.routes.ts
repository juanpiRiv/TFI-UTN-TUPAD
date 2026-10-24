import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { validateBody } from "../../middlewares/validate.js";
import { createPointOfSaleSchema, updatePointOfSaleSchema } from "./points-of-sale.schemas.js";
import { create, getById, list, update } from "./points-of-sale.controller.js";

export const pointsOfSaleRouter = Router();

pointsOfSaleRouter.use(requireAuth);

pointsOfSaleRouter.get("/", list);
pointsOfSaleRouter.post("/", validateBody(createPointOfSaleSchema), create);
pointsOfSaleRouter.get("/:id", getById);
pointsOfSaleRouter.patch("/:id", validateBody(updatePointOfSaleSchema), update);