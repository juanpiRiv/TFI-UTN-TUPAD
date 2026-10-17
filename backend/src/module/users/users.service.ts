import argon2 from "argon2";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/error.js";
import type { ChangePasswordInput, UpdateProfileInput } from "./users.schemas.js";


const publicUserFields = {
    id: true,
    name: true,
    email: true,
    createdAt: true,
    updatedAt: true,
} as const;


async function findUserOrThrow(userId: number) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new AppError(404, "User not found");
    }
    return user;
}

export async function assertCurrentPassword(passwordHash: string, currentPassword: string | undefined) {
    const isValid = currentPassword ? await argon2.verify(passwordHash, currentPassword) : false;
    if (!isValid) {
        throw new AppError(400, "invalid Data", [
            { field: "currerntPassword", message: "Current password is incorrect" },
        ]);
    }
}


export async function updateProfile(userId: number, input: UpdateProfileInput) {
    const user = await findUserOrThrow(userId);
    const data: Prisma.UserUpdateInput = {};

    if (input.name !== undefined) {
        data.name = input.name;
    }

    if (input.email !== undefined && input.email !== user.email) {
        await assertCurrentPassword(user.passwordHash, input.currentParrword);

        const taken = await prisma.user.findUnique({
            where: { email: input.email },
            select: { id: true },
        });

        if (taken) {
            throw new AppError(409, "Email already register");
        }
        data.email = input.email;
    }
    return prisma.user.update({
        where: { id: userId },
        data,
        select: publicUserFields,
    })
}


export async function changePassword(userId: number, input: ChangePasswordInput) {
    const user = await findUserOrThrow(userId);
    await assertCurrentPassword(user.passwordHash, input.currentPassword);

    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}