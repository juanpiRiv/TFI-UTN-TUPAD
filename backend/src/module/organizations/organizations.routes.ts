import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { validateBody } from "../../middlewares/validate.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./organizations.schemas.js";
import { create, getMine, updateMine } from "./organizations.controller.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

// La organización es la del usuario del token: nunca se recibe un organizationId
organizationsRouter.post("/", validateBody(createOrganizationSchema), create);
organizationsRouter.get("/me", getMine);
organizationsRouter.patch("/me", validateBody(updateOrganizationSchema), updateMine);