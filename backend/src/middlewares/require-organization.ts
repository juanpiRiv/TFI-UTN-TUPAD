import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/error.js";

export const requireOrganization: RequestHandler = async (req, _res, next) => {
    const organization = await prisma.organization.findUnique({
        where: { userId: req.userId! },
        select: { id: true, isActive: true },
    });

    if (!organization || !organization.isActive) {
        throw new AppError(403, "Completá los datos de tu organización para continuar", {
            code: "ORGANIZATION_REQUIRED",
        });
    }

    req.organizationId = organization.id;
    next();
};