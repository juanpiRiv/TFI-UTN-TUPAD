import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { validateBody } from "../../middlewares/validate.js";

import { create, getById, list, update } from "./activities.controller.js";
import { createActivitySchema, updateActivitySchema } from "./activities.schemas.js";

export const activitiesRouter = Router();

activitiesRouter.use(requireAuth);

activitiesRouter.get("/", list);
activitiesRouter.post("/", validateBody(createActivitySchema), create);
activitiesRouter.get("/:id", getById);
activitiesRouter.patch("/:id", validateBody(updateActivitySchema), update);