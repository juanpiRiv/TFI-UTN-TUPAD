import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import {
  list,
  getById,
  create,
  update,
} from "./clients.controller.js";

export const clientsRouter = Router();

// Todas las rutas requieren autenticación
clientsRouter.use(requireAuth);

clientsRouter.get("/", list);
clientsRouter.get("/:id", getById);
clientsRouter.post("/", create);
clientsRouter.patch("/:id", update);
