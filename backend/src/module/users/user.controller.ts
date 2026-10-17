import type { Request, Response } from "express";
import * as userService from "./user.service.js";

export async function updateMe(req: Request, res: Response) {
    const user = await userService.updateProfile(req.userId!, req.body);
    res.json(user);
}

export async function changeMyPassword(req: Request, res: Response) {
    await userService.changePassword(req.userId!, req.body);
    res.status(204).end();
}