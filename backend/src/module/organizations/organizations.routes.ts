import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { validateBody } from "../../middlewares/validate.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./organizations.schemas.js";
import { create, getMine, updateMine } from "./organizations.controller.js";
import { arcaCertificateSchema, arcaCredentialSchema } from "./arca-credential.schemas.js";
import * as arcaCredential from "./arca-credential.controller.js";
import * as arcaDelegation from "./arca-delegation.controller.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

// La organización es la del usuario del token: nunca se recibe un organizationId
organizationsRouter.post("/", validateBody(createOrganizationSchema), create);
organizationsRouter.get("/me", getMine);
organizationsRouter.patch("/me", validateBody(updateOrganizationSchema), updateMine);

// Credencial de ARCA de la organización: el certificado y la clave nunca vuelven en una respuesta
organizationsRouter.get("/me/arca-credential", arcaCredential.getStatus);
organizationsRouter.post("/me/arca-credential", validateBody(arcaCredentialSchema), arcaCredential.save);
organizationsRouter.post("/me/arca-credential/csr", arcaCredential.createCsr);
organizationsRouter.post("/me/arca-credential/certificate", validateBody(arcaCertificateSchema), arcaCredential.attachCertificate);
organizationsRouter.delete("/me/arca-credential", arcaCredential.remove);

// Delegación del servicio de facturación a la plataforma (modo delegado): no se envía ningún secreto
organizationsRouter.get("/me/arca-delegation", arcaDelegation.getStatus);
organizationsRouter.post("/me/arca-delegation/verify", arcaDelegation.verify);
organizationsRouter.delete("/me/arca-delegation", arcaDelegation.remove);
