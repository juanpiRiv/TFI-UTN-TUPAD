import { Router } from 'express';
import { requireAuth } from '../../middlewares/require-handler.js';
import { validateBody } from '../../middlewares/validate.js';
import { changePasswordSchema, updateProfileSchema } from './user.schemas.js';
import { changeMyPassword, updateMe } from './user.controller.js';

export const userRouter = Router();


userRouter.use(requireAuth);

userRouter.patch("/me", validateBody(updateProfileSchema), updateMe);
userRouter.patch("/me/password", validateBody(changePasswordSchema), changeMyPassword);