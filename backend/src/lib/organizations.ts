import { prisma } from "./prisma.js";
import { AppError } from "./error.js";


// Devuelve la organización del usuario logueado
// Si todavía no la creó responde 403.
export async function getUserOrganization(userId: number) {
    const organization = await prisma.organization.findUnique({
        where: { userId },
        select: { id: true, baseCurrency: true },
    });

    if (!organization) {
        throw new AppError(403, "Organization required");
    }

    return organization;
}