import { Router } from "express";
import { requireAuth } from "../../middlewares/require-handler.js";
import { list, create, update } from "./categories.controller.js";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get("/", list);
categoriesRouter.post("/", create);
categoriesRouter.patch("/:id", update);
