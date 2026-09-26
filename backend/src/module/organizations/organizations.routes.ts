import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { requireOrganization } from "../../middlewares/require-organization.js";
import { validateBody } from "../../middlewares/validate.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./organizations.schemas.js";
import { create, getMine, updateMine } from "./organizations.controller.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.post("/", validateBody(createOrganizationSchema), create);
organizationsRouter.get("/me", requireOrganization, getMine);
organizationsRouter.patch("/me", requireOrganization, validateBody(updateOrganizationSchema), updateMine);