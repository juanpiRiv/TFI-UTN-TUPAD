import type { Request, Response } from "express";
import { AppError } from "../../lib/error.js";
import * as activitiesService from "./activities.service.js";
import { activityIdParamSchema, listActivitiesQuerySchema } from "./activities.schemas.js";

function parseId(req: Request): number {
    const result = activityIdParamSchema.safeParse(req.params);
    if (!result.success) {
        throw new AppError(400, "Invalid activity id");
    }
    return result.data.id;
}

export async function list(req: Request, res: Response) {
    const query = listActivitiesQuerySchema.safeParse(req.query);
    if (!query.success) {
        throw new AppError(400, "Invalid query parameters");
    }
    res.json(await activitiesService.listActivities(req.userId!, query.data));
}

export async function getById(req: Request, res: Response) {
    res.json(await activitiesService.getActivity(req.userId!, parseId(req)));
}

export async function create(req: Request, res: Response) {
    const activity = await activitiesService.createActivity(req.userId!, req.body);
    res.status(201).json(activity);
}

export async function update(req: Request, res: Response) {
    res.json(await activitiesService.updateActivity(req.userId!, parseId(req), req.body));
}