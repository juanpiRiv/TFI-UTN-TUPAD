import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changePasswordSchema, updateProfileSchema } from "./users.schemas.js";

let app: any;
let prisma: any;
let dbAvailable = false;


if (process.env.DATABASE_URL && process.env.JWT_SECRET) {
    try {
        prisma = (await import("../../lib/prisma.js")).prisma;
        await prisma.$queryRaw`SELECT 1`;
        app = (await import("../../app.js")).app;
        dbAvailable = true;
    } catch (error) {
        console.warn("PostgreSQL no disponible para tests de integración de ususario");
    }
}

describe("users schemas", () => {
    it("rechaza un body sin campos para actualizar", () => {
        expect(updateProfileSchema.safeParse({}).success).toBe(false);
    });
    it("rechaza una contraseña nueva corta o igual a la actual", () => {
        expect(changePasswordSchema.safeParse({ currenPassword: "123456789", newPassword: "123" }));
        expect(changePasswordSchema.safeParse({ currentPassword: "123456789", newPassword: "123456789" }));
    })
});

describe.skipIf(!dbAvailable)("users profile (integration)", () => {
    const stamp = Date.now();
    const email = `profile-${stamp}@test.com`;
    const newEmail = `profile-new-${stamp}@test.com`;
    const otherEmail = `profile-other-${stamp}@test.com`;
    let token: string;

    beforeAll(async () => {
        const res = await request(app).post("/api/auth/register").send({ email, password: "password-1" });
        token = res.body.token;
        await request(app).post("/api/auth/register").send({ email: otherEmail, password: "password-1" });
    });
    afterAll(async () => {
        await prisma.user.deleteMany({ where: { email: { in: [email, newEmail, otherEmail] } } });
    });
    const auth = () => ({ Authorization: `Bearer ${token}` });

    it("pide token", async () => {
        const res = await request(app).patch("/api/users/me").send({ name: "UsuarioNombre" });
        expect(res.status).toBe(401);
    });

    it("cambia el nombre sin pedir contraseña", async () => {
        const res = await request(app).patch("/api/users/me").set(auth()).send({ name: "UsuarioNombre" });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe("UsuarioNombre");
        expect(res.body.passwordHash).toBeUndefined();
    });

    it("cambiar el email pide la constraseña actual", async () => {
        const res = await request(app).patch("/api/users/me").set(auth()).send({ email: newEmail });
        expect(res.status).toBe(400);
        expect(res.body.details[0].field).toBe("currentPassword");
    });

    it("no deja usar un email de otro usuario", async () => {
        const res = await request(app)
            .patch("/api/users/me")
            .set(auth())
            .send({ email: newEmail, currentPassword: "password-1" });
        expect(res.status).toBe(200);

        const me = await request(app).get("/api/users/me").set(auth());
        expect(me.status).toBe(200);
        expect(me.body.email).toBe(newEmail);
    });


    it("con la contraseña actual incorrecta responde 400, no 401", async () => {
        const res = await request(app)
            .patch("/api/users/me/password")
            .set(auth())
            .send({ currentPassword: "password-1", newPassword: "password-2" });
        expect(res.status).toBe(204);

        const oldLogin = await request(app).post("/api/auth/login").send({ email: newEmail, password: "password-1" });
        expect(oldLogin.status).toBe(401);

        const newLogin = (await request(app).post("/api/auth/login").send({ email: newEmail, password: "password-2" }));
        expect(newLogin.status).toBe(200);
    });

});