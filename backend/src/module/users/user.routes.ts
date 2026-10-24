import { Router } from 'express';
import { requireAuth } from '../../middlewares/require-handler.js';
import { validateBody } from '../../middlewares/validate.js';
import { changePasswordSchema, updateProfileSchema } from './users.schemas.js';
import { changeMyPassword, updateMe } from './users.controller.js';

export const userRouter = Router();


userRouter.use(requireAuth);

userRouter.patch("/me", validateBody(updateProfileSchema), updateMe);
userRouter.patch("/me/password", validateBody(changePasswordSchema), changeMyPassword);