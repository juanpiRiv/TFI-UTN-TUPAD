import { prisma } from "./prisma.js";

type AuditEvent = {
    action: string;
    userId?: number;
    organizationId?: number;
    entity?: string;
    entityId?: number;
    metadata?: Record<string, string | number | boolean | null>;
    ipAddress?: string;
};

export async function recordAudit(event: AuditEvent): Promise<void> {
    try {
        await prisma.auditLog.create({ data: event });
    } catch (error) {
        console.error("No se pudo registrar el evento de auditoría", error);
    }
}