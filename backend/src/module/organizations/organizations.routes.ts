import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { create, getMe, updateMe } from "./organizations.controller.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.post("/", create);
organizationsRouter.get("/me", getMe);
organizationsRouter.patch("/me", updateMe);
