import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { validateBody } from "../../middlewares/validate.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./organizations.schemas.js";
import { create, getMine, updateMine } from "./organizations.controller.js";
import { arcaCredentialSchema } from "./arca-credential.schemas.js";
import * as arcaCredential from "./arca-credential.controller.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

// La organización es la del usuario del token: nunca se recibe un organizationId
organizationsRouter.post("/", validateBody(createOrganizationSchema), create);
organizationsRouter.get("/me", getMine);
organizationsRouter.patch("/me", validateBody(updateOrganizationSchema), updateMine);

// Credencial de ARCA de la organización: el certificado y la clave nunca vuelven en una respuesta
organizationsRouter.get("/me/arca-credential", arcaCredential.getStatus);
organizationsRouter.post("/me/arca-credential", validateBody(arcaCredentialSchema), arcaCredential.save);
organizationsRouter.delete("/me/arca-credential", arcaCredential.remove);