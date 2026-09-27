import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js';
import { AppError } from "../../lib/error.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

const publicUserFields = { id: true, email: true, createdAt: true } as const;

function signToken(userId: number): string {
    return jwt.sign({}, env.JWT_SECRET, {
        subject: String(userId),
        expiresIn: "1d",
    });
}

export async function register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
        throw new AppError(409, "Email already register");
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const user = await prisma.user.create({
        data: { email: input.email, passwordHash },
        select: publicUserFields,
    });

    return { user, token: signToken(user.id) }
}


export async function login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const isValid = user ? await argon2.verify(user.passwordHash, input.password) : false;

    if (!user || !isValid) {
        throw new AppError(401, "Email or password wrong");
    }

    return {
        user: { id: user.id, email: user.email, createdAt: user.createdAt },
        token: signToken(user.id),
    }
}


export async function getMe(userId: number) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { ...publicUserFields, organization: true },
    });
    if (!user) {
        throw new AppError(404, "User not found");
    }
    return user;
}