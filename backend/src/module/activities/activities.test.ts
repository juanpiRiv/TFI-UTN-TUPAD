import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidCuit } from "../../lib/cuit.js";
import { createActivitySchema, updateActivitySchema } from "./activities.schemas.js";


let app: any;
let prisma: any;
let dbAvailable = false;

if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
    try {
        prisma = (await import("../../lib/prisma.js")).prisma;
        await prisma.$queryRaw`SELECT 1`;
        app = (await import("../../app.js")).app;
        dbAvailable = true;
    } catch {
        console.warn("⚠️ PostgreSQL no disponible para tests de integración de actividades");
    }
}

let cuitSeed = (Date.now() + 4242) % 100_000_000;
function nextCuit(): string {
    for (; ;) {
        cuitSeed = (cuitSeed + 7919) % 100_000_000;
        const base = `27${String(cuitSeed).padStart(8, "0")}`;
        for (let digit = 0; digit <= 9; digit++) {
            if (isValidCuit(`${base}${digit}`)) return `${base}${digit}`;
        }
    }
}

describe("activities schemas", () => {
    it("acepta productos, servicios o ambas, y nada más", () => {
        for (const kind of ["GOODS", "SERVICES", "BOTH"]) {
            expect(createActivitySchema.safeParse({ description: "Venta", kind }).success).toBe(true);
        }
        expect(createActivitySchema.safeParse({ description: "Venta", kind: "OTHER" }).success).toBe(false);
    });

    it("valida el código de ARCA de 6 dígitos y deja vacío como null", () => {
        expect(createActivitySchema.parse({ description: "x", kind: "GOODS", arcaActivityCode: "" }).arcaActivityCode).toBeNull();
        expect(createActivitySchema.safeParse({ description: "x", kind: "GOODS", arcaActivityCode: "6201" }).success).toBe(false);
        expect(updateActivitySchema.safeParse({ arcaActivityCode: "620100" }).success).toBe(true);
    });
});

describe.skipIf(!dbAvailable)("activities (integration)", () => {
    const stamp = Date.now();
    const emails = [`act-a-${stamp}@test.com`, `act-b-${stamp}@test.com`];
    const tokens: string[] = [];
    const as = (token: string) => ({ Authorization: `Bearer ${token}` });

    beforeAll(async () => {
        for (const email of emails) {
            const res = await request(app).post("/api/auth/register").send({ email, password: "password-1" });
            tokens.push(res.body.token);
            await request(app)
                .post("/api/organizations")
                .set(as(res.body.token))
                .send({ cuit: nextCuit(), legalName: email, taxCondition: "MONOTRIBUTO", baseCurrency: "ARS" });
        }
    });

    afterAll(async () => {
        const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
        const userIds = users.map((user: { id: number }) => user.id);
        const orgs = await prisma.organization.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
        const orgIds = orgs.map((org: { id: number }) => org.id);
        await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.activity.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    });

    it("crea varias actividades y la primera queda como principal", async () => {
        const first = await request(app)
            .post("/api/activities")
            .set(as(tokens[0]!))
            .send({ description: "Desarrollo de software", kind: "SERVICES", arcaActivityCode: "620100" });
        expect(first.status).toBe(201);
        expect(first.body.isPrimary).toBe(true);

        const second = await request(app)
            .post("/api/activities")
            .set(as(tokens[0]!))
            .send({ description: "Venta de equipos y soporte", kind: "BOTH" });
        expect(second.status).toBe(201);
        expect(second.body.isPrimary).toBe(false);
        expect(second.body.kind).toBe("BOTH");

        const list = await request(app).get("/api/activities").set(as(tokens[0]!));
        expect(list.status).toBe(200);
        expect(list.body.map((a: { description: string }) => a.description)).toEqual([
            "Desarrollo de software",
            "Venta de equipos y soporte",
        ]);
    });

    it("edita una actividad y cambia cuál es la principal", async () => {
        const [, second] = (await request(app).get("/api/activities").set(as(tokens[0]!))).body;

        const edited = await request(app)
            .patch(`/api/activities/${second.id}`)
            .set(as(tokens[0]!))
            .send({ description: "Venta de equipos", kind: "GOODS", isPrimary: true });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ description: "Venta de equipos", kind: "GOODS", isPrimary: true });

        const primaries = (await request(app).get("/api/activities").set(as(tokens[0]!))).body.filter(
            (a: { isPrimary: boolean }) => a.isPrimary,
        );
        expect(primaries).toHaveLength(1);
        expect(primaries[0].id).toBe(second.id);
    });

    it("no deja dar de baja la principal, pero sí las otras", async () => {
        const [primary, other] = (await request(app).get("/api/activities").set(as(tokens[0]!))).body;

        const blocked = await request(app).patch(`/api/activities/${primary.id}`).set(as(tokens[0]!)).send({ isActive: false });
        expect(blocked.status).toBe(409);
        expect(blocked.body.details[0].field).toBe("isActive");

        const ok = await request(app).patch(`/api/activities/${other.id}`).set(as(tokens[0]!)).send({ isActive: false });
        expect(ok.status).toBe(200);

        const active = await request(app).get("/api/activities").set(as(tokens[0]!));
        expect(active.body).toHaveLength(1);
        const all = await request(app).get("/api/activities?includeInactive=true").set(as(tokens[0]!));
        expect(all.body).toHaveLength(2);
    });

    it("aísla las actividades entre organizaciones", async () => {
        const [mine] = (await request(app).get("/api/activities").set(as(tokens[0]!))).body;

        expect((await request(app).get("/api/activities").set(as(tokens[1]!))).body).toEqual([]);
        expect((await request(app).get(`/api/activities/${mine.id}`).set(as(tokens[1]!))).status).toBe(404);
        const patch = await request(app).patch(`/api/activities/${mine.id}`).set(as(tokens[1]!)).send({ description: "x" });
        expect(patch.status).toBe(404);
    });
});