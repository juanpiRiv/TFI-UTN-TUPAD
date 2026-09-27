import { Router } from "express";
import { validateBody } from "../../middlewares/validate.js";
import { requireAuth } from "../../middlewares/require-handler.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import { login, me, register } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", validateBody(registerSchema), register);
authRouter.post("/login", validateBody(loginSchema), login);
authRouter.get("/me", requireAuth, me);