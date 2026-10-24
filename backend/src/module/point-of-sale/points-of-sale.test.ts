import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidCuit } from "../../lib/cuit.js";
import { createPointOfSaleSchema, updatePointOfSaleSchema } from "./points-of-sale.schemas.js";

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
        console.warn("⚠️ PostgreSQL no disponible para tests de integración de puntos de venta");
    }
}

let cuitSeed = (Date.now() + 9191) % 100_000_000;
function nextCuit(): string {
    for (; ;) {
        cuitSeed = (cuitSeed + 7919) % 100_000_000;
        const base = `23${String(cuitSeed).padStart(8, "0")}`;
        for (let digit = 0; digit <= 9; digit++) {
            if (isValidCuit(`${base}${digit}`)) return `${base}${digit}`;
        }
    }
}

describe("points of sale schemas", () => {
    it("exige un número entero entre 1 y 99999", () => {
        expect(createPointOfSaleSchema.safeParse({}).success).toBe(false);
        expect(createPointOfSaleSchema.safeParse({ number: 0 }).success).toBe(false);
        expect(createPointOfSaleSchema.safeParse({ number: 100000 }).success).toBe(false);
        expect(createPointOfSaleSchema.safeParse({ number: 2.5 }).success).toBe(false);
        expect(createPointOfSaleSchema.parse({ number: "3" }).number).toBe(3);
    });

    it("no acepta un PATCH vacío ni el carácter nulo en el domicilio", () => {
        expect(updatePointOfSaleSchema.safeParse({}).success).toBe(false);
        expect(updatePointOfSaleSchema.safeParse({ address: "a\u0000b" }).success).toBe(false);
        expect(updatePointOfSaleSchema.parse({ address: "" }).address).toBeNull();
    });
});

// No asume una lista vacía al empezar: el alta de la organización puede crear el punto de venta N° 1 (#156)
describe.skipIf(!dbAvailable)("points of sale (integration)", () => {
    const stamp = Date.now();
    const emails = [`pos-a-${stamp}@test.com`, `pos-b-${stamp}@test.com`];
    const tokens: string[] = [];
    const as = (token: string) => ({ Authorization: `Bearer ${token}` });
    const api = (index: number) => ({
        list: (query = "") => request(app).get(`/api/points-of-sale${query}`).set(as(tokens[index]!)),
        create: (body: object) => request(app).post("/api/points-of-sale").set(as(tokens[index]!)).send(body),
        get: (id: number) => request(app).get(`/api/points-of-sale/${id}`).set(as(tokens[index]!)),
        update: (id: number, body: object) =>
            request(app).patch(`/api/points-of-sale/${id}`).set(as(tokens[index]!)).send(body),
    });

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
        await prisma.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.pointOfSale.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    });

    it("sin organización responde 403", async () => {
        const res = await request(app).post("/api/auth/register").send({ email: `pos-none-${stamp}@test.com`, password: "password-1" });
        const list = await request(app).get("/api/points-of-sale").set(as(res.body.token));
        expect(list.status).toBe(403);
        await prisma.user.delete({ where: { id: res.body.user.id } });
    });

    it("crea puntos de venta y los lista ordenados por número", async () => {
        const third = await api(0).create({ number: 3, address: "Av. Siempreviva 742" });
        expect(third.status).toBe(201);
        expect(third.body).toMatchObject({ number: 3, address: "Av. Siempreviva 742", billingMethod: "CAE", isActive: true });

        const second = await api(0).create({ number: 2 });
        expect(second.status).toBe(201);

        const list = await api(0).list();
        expect(list.status).toBe(200);
        const numbers = list.body.map((pos: { number: number }) => pos.number);
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        expect(numbers).toEqual(expect.arrayContaining([2, 3]));

        const audit = await prisma.auditLog.findFirst({
            where: { action: "point_of_sale.created", entityId: third.body.id },
        });
        expect(audit).not.toBeNull();
    });

    it("no deja repetir el número en la misma organización, pero sí en otra", async () => {
        const repeated = await api(0).create({ number: 3 });
        expect(repeated.status).toBe(409);
        expect(repeated.body.details[0].field).toBe("number");

        const otherOrg = await api(1).create({ number: 3 });
        expect(otherOrg.status).toBe(201);
    });

    it("valida el número al crear", async () => {
        const res = await api(0).create({ number: 0 });
        expect(res.status).toBe(400);
        expect(res.body.details[0].field).toBe("number");
    });

    it("edita el domicilio y el número, sin chocar con otro", async () => {
        const two = (await api(0).list()).body.find((pos: { number: number }) => pos.number === 2);

        const moved = await api(0).update(two.id, { number: 5, address: "Calle Falsa 123" });
        expect(moved.status).toBe(200);
        expect(moved.body).toMatchObject({ number: 5, address: "Calle Falsa 123" });

        const clash = await api(0).update(two.id, { number: 3 });
        expect(clash.status).toBe(409);
        expect(clash.body.details[0].field).toBe("number");
    });

    it("no deja cambiar el número si el punto de venta ya tiene facturas", async () => {
        const three = (await api(0).list()).body.find((pos: { number: number }) => pos.number === 3);
        await prisma.invoice.create({
            data: {
                organizationId: three.organizationId,
                pointOfSaleId: three.id,
                voucherType: "FACTURA_C",
                concept: "SERVICIOS",
                issueDate: new Date("2026-10-01T00:00:00.000Z"),
                totalAmount: "1000.00",
            },
        });

        const res = await api(0).update(three.id, { number: 30 });
        expect(res.status).toBe(409);
        expect(res.body.details[0].field).toBe("number");

        const address = await api(0).update(three.id, { address: "Nuevo domicilio" });
        expect(address.status).toBe(200);
    });

    it("da de baja puntos de venta pero siempre deja al menos uno activo", async () => {
        const active = (await api(0).list()).body;
        const [last, ...others] = active;
        for (const pos of others) {
            expect((await api(0).update(pos.id, { isActive: false })).status).toBe(200);
        }

        const blocked = await api(0).update(last.id, { isActive: false });
        expect(blocked.status).toBe(409);
        expect(blocked.body.details[0].field).toBe("isActive");

        expect((await api(0).list()).body).toHaveLength(1);
        expect((await api(0).list("?includeInactive=true")).body).toHaveLength(active.length);
    });

    it("aísla los puntos de venta entre organizaciones", async () => {
        const [mine] = (await api(0).list()).body;
        expect((await api(1).get(mine.id)).status).toBe(404);
        expect((await api(1).update(mine.id, { address: "x" })).status).toBe(404);
        expect((await api(0).get(mine.id)).status).toBe(200);
    });
});