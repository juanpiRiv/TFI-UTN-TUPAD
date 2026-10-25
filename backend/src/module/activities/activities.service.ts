import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import { getUserOrganization } from "../../lib/organizations.js";
import type { CreateActivityInput, ListActivitiesQuery, UpdateActivityInput } from "./activities.schemas.js";


/** Saca las claves undefined: Prisma no las acepta con exactOptionalPropertyTypes. */
function definedOnly<T extends object>(input: T) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
    ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function conflict(field: string, message: string): never {
    throw new AppError(409, message, [{ field, message }]);
}

// Busca siempre dentro de la organización: si la actividad es de otra, responde 404
async function findActivityOrThrow(organizationId: number, id: number) {
    const activity = await prisma.activity.findFirst({ where: { id, organizationId } });
    if (!activity) {
        throw new AppError(404, "Activity not found");
    }
    return activity;
}

export async function listActivities(userId: number, query: ListActivitiesQuery) {
    const { id: organizationId } = await getUserOrganization(userId);
    return prisma.activity.findMany({
        where: { organizationId, ...(!query.includeInactive && { isActive: true }) },
        orderBy: [{ isPrimary: "desc" }, { description: "asc" }],
    });
}

export async function getActivity(userId: number, id: number) {
    const { id: organizationId } = await getUserOrganization(userId);
    return findActivityOrThrow(organizationId, id);
}

export async function createActivity(userId: number, input: CreateActivityInput) {
    const { id: organizationId } = await getUserOrganization(userId);

    return prisma.$transaction(async (tx) => {
        // La primera actividad activa es la principal aunque no lo pidan
        const activeCount = await tx.activity.count({ where: { organizationId, isActive: true } });
        const isPrimary = input.isPrimary === true || activeCount === 0;

        // Una sola principal por organización
        if (isPrimary) {
            await tx.activity.updateMany({
                where: { organizationId, isPrimary: true },
                data: { isPrimary: false },
            });
        }

        return tx.activity.create({
            data: {
                organizationId,
                description: input.description,
                kind: input.kind,
                arcaActivityCode: input.arcaActivityCode ?? null,
                isPrimary,
            },
        });
    });
}

export async function updateActivity(userId: number, id: number, input: UpdateActivityInput) {
    const { id: organizationId } = await getUserOrganization(userId);
    const current = await findActivityOrThrow(organizationId, id);

    const willBeActive = input.isActive ?? current.isActive;

    if (current.isPrimary && input.isPrimary === false) {
        conflict("isPrimary", "There must be a primary activity: mark another one as primary instead");
    }
    if (current.isPrimary && !willBeActive) {
        conflict("isActive", "The primary activity cannot be deactivated: choose another primary first");
    }
    if (input.isPrimary === true && !willBeActive) {
        conflict("isPrimary", "An inactive activity cannot be the primary one");
    }

    return prisma.$transaction(async (tx) => {
        if (input.isPrimary === true && !current.isPrimary) {
            await tx.activity.updateMany({
                where: { organizationId, isPrimary: true },
                data: { isPrimary: false },
            });
        }
        return tx.activity.update({ where: { id }, data: definedOnly(input) });
    });
}