import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidCuit } from "../../lib/cuit.js";
import { createOrganizationSchema, updateOrganizationSchema } from "./organizations.schemas.js";

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
        console.warn("PostgreSQL no disponible para tests de integración de organizaciones");
    }
}

/** Genera un CUIT válido y distinto en cada llamada. */
let cuitSeed = Date.now() % 100_000_000;
function nextCuit(): string {
    for (; ;) {
        cuitSeed = (cuitSeed + 7919) % 100_000_000;
        const base = `20${String(cuitSeed).padStart(8, "0")}`;
        for (let digit = 0; digit <= 9; digit++) {
            if (isValidCuit(`${base}${digit}`)) return `${base}${digit}`;
        }
    }
}

const validBody = () => ({
    cuit: nextCuit(),
    legalName: "Lucía Pérez",
    tradeName: "Estudio Lucía",
    commercialAddress: null,
    taxCondition: "MONOTRIBUTO",
    monotributoCategory: "b",
    activityStartDate: "2024-03-01",
    grossIncomeNumber: null,
    baseCurrency: "ARS",
});

describe("organizations schemas", () => {
    it("normaliza el CUIT con guiones y la categoría en minúscula", () => {
        const body = validBody();
        const withDashes = `${body.cuit.slice(0, 2)}-${body.cuit.slice(2, 10)}-${body.cuit.slice(10)}`;
        const result = createOrganizationSchema.parse({ ...body, cuit: withDashes });
        expect(result.cuit).toBe(body.cuit);
        expect(result.monotributoCategory).toBe("B");
        expect(result.activityStartDate).toEqual(new Date("2024-03-01T00:00:00.000Z"));
    });

    it("rechaza un CUIT con el dígito verificador mal y una moneda base vacía", () => {
        const body = validBody();
        const wrongDigit = `${body.cuit.slice(0, 10)}${(Number(body.cuit[10]) + 1) % 10}`;
        expect(createOrganizationSchema.safeParse({ ...body, cuit: wrongDigit }).success).toBe(false);
        expect(createOrganizationSchema.safeParse({ ...body, baseCurrency: "" }).success).toBe(false);
        expect(updateOrganizationSchema.safeParse({ baseCurrency: null }).success).toBe(false);
    });
});

describe.skipIf(!dbAvailable)("organizations (integration)", () => {
    const stamp = Date.now();
    const emails = [`org-a-${stamp}@test.com`, `org-b-${stamp}@test.com`];
    let tokenA: string;
    let tokenB: string;

    const as = (token: string) => ({ Authorization: `Bearer ${token}` });

    beforeAll(async () => {
        const [a, b] = await Promise.all(
            emails.map((email) => request(app).post("/api/auth/register").send({ email, password: "password-1" })),
        );
        tokenA = a!.body.token;
        tokenB = b!.body.token;
    });

    afterAll(async () => {
        const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
        const userIds = users.map((user: { id: number }) => user.id);
        const orgs = await prisma.organization.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
        const orgIds = orgs.map((org: { id: number }) => org.id);
        await prisma.transaction.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    });

    it("sin organización no puede cargar clientes ni movimientos (403)", async () => {
        expect((await request(app).get("/api/organizations/me").set(as(tokenA))).status).toBe(403);
        expect((await request(app).get("/api/clients").set(as(tokenA))).status).toBe(403);
        expect((await request(app).get("/api/transactions").set(as(tokenA))).status).toBe(403);
    });

    it("valida el alta y devuelve los errores por campo", async () => {
        const res = await request(app)
            .post("/api/organizations")
            .set(as(tokenA))
            .send({ ...validBody(), cuit: "20123456780", baseCurrency: undefined });
        expect(res.status).toBe(400);
        const fields = res.body.details.map((detail: { field: string }) => detail.field);
        expect(fields).toEqual(expect.arrayContaining(["cuit", "baseCurrency"]));
    });

    it("crea la organización con sus categorías por defecto", async () => {
        const body = validBody();
        const res = await request(app).post("/api/organizations").set(as(tokenA)).send(body);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ cuit: body.cuit, baseCurrency: "ARS", monotributoCategory: "B" });

        const categories = await prisma.category.findMany({ where: { organizationId: res.body.id } });
        expect(categories.map((category: { name: string }) => category.name)).toContain("Cobro de facturas");

        const me = await request(app).get("/api/auth/me").set(as(tokenA));
        expect(me.body.organization.id).toBe(res.body.id);
        expect((await request(app).get("/api/clients").set(as(tokenA))).status).toBe(200);
    });

    it("no deja crear una segunda organización ni repetir un CUIT", async () => {
        const again = await request(app).post("/api/organizations").set(as(tokenA)).send(validBody());
        expect(again.status).toBe(409);

        const mine = await request(app).get("/api/organizations/me").set(as(tokenA));
        const sameCuit = await request(app)
            .post("/api/organizations")
            .set(as(tokenB))
            .send({ ...validBody(), cuit: mine.body.cuit });
        expect(sameCuit.status).toBe(409);
    });

    it("edita solo los campos enviados y no acepta dejar la moneda base vacía", async () => {
        const before = await request(app).get("/api/organizations/me").set(as(tokenA));

        const res = await request(app)
            .patch("/api/organizations/me")
            .set(as(tokenA))
            .send({ tradeName: "Estudio Pérez" });
        expect(res.status).toBe(200);
        expect(res.body.tradeName).toBe("Estudio Pérez");
        expect(res.body.legalName).toBe(before.body.legalName);
        expect(res.body.baseCurrency).toBe("ARS");

        const empty = await request(app).patch("/api/organizations/me").set(as(tokenA)).send({ baseCurrency: "" });
        expect(empty.status).toBe(400);
    });

    it("no deja cambiar la moneda base si ya hay movimientos", async () => {
        const org = (await request(app).get("/api/organizations/me").set(as(tokenA))).body;
        const category = await prisma.category.findFirst({ where: { organizationId: org.id, type: "INCOME" } });
        await prisma.transaction.create({
            data: {
                organizationId: org.id,
                categoryId: category.id,
                type: "INCOME",
                amount: "100.00",
                currency: "ARS",
                transactionDate: new Date("2026-10-01T00:00:00.000Z"),
            },
        });

        const res = await request(app).patch("/api/organizations/me").set(as(tokenA)).send({ baseCurrency: "USD" });
        expect(res.status).toBe(409);
        expect(res.body.details[0].field).toBe("baseCurrency");
    });
});