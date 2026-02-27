import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { ContactRecord } from "../types";

// Re-export the singleton so service layer can import it for $transaction
export { prisma };

// ─── Find contacts by email or phoneNumber ──────────────────────────────────
export async function findContactsByEmailOrPhone(
    email?: string,
    phoneNumber?: string,
    tx?: Prisma.TransactionClient
): Promise<ContactRecord[]> {
    const client = tx ?? prisma;
    const orConditions: Prisma.ContactWhereInput[] = [];

    if (email) orConditions.push({ email, deletedAt: null });
    if (phoneNumber) orConditions.push({ phoneNumber, deletedAt: null });

    if (orConditions.length === 0) return [];

    return client.contact.findMany({
        where: { OR: orConditions },
        orderBy: { createdAt: "asc" },
    }) as Promise<ContactRecord[]>;
}

// ─── Find all contacts in a cluster (by primary id or linkedId) ─────────────
export async function findContactCluster(
    primaryIds: number[],
    tx?: Prisma.TransactionClient
): Promise<ContactRecord[]> {
    const client = tx ?? prisma;

    return client.contact.findMany({
        where: {
            deletedAt: null,
            OR: [
                { id: { in: primaryIds } },
                { linkedId: { in: primaryIds } },
            ],
        },
        orderBy: { createdAt: "asc" },
    }) as Promise<ContactRecord[]>;
}

// ─── Create a new primary contact ────────────────────────────────────────────
export async function createPrimaryContact(
    email?: string,
    phoneNumber?: string,
    tx?: Prisma.TransactionClient
): Promise<ContactRecord> {
    const client = tx ?? prisma;

    return client.contact.create({
        data: {
            email: email ?? null,
            phoneNumber: phoneNumber ?? null,
            linkPrecedence: "primary",
        },
    }) as Promise<ContactRecord>;
}

// ─── Create a new secondary contact ─────────────────────────────────────────
export async function createSecondaryContact(
    linkedId: number,
    email?: string,
    phoneNumber?: string,
    tx?: Prisma.TransactionClient
): Promise<ContactRecord> {
    const client = tx ?? prisma;

    return client.contact.create({
        data: {
            email: email ?? null,
            phoneNumber: phoneNumber ?? null,
            linkedId,
            linkPrecedence: "secondary",
        },
    }) as Promise<ContactRecord>;
}

// ─── Update contacts: demote a primary to secondary ──────────────────────────
export async function demotePrimaryToSecondary(
    contactIds: number[],
    newLinkedId: number,
    tx?: Prisma.TransactionClient
): Promise<void> {
    const client = tx ?? prisma;

    await client.contact.updateMany({
        where: { id: { in: contactIds } },
        data: {
            linkPrecedence: "secondary",
            linkedId: newLinkedId,
        },
    });
}

// ─── Update linkedId for contacts that point to a demoted primary ───────────
export async function relinkSecondaries(
    oldPrimaryId: number,
    newPrimaryId: number,
    tx?: Prisma.TransactionClient
): Promise<void> {
    const client = tx ?? prisma;

    await client.contact.updateMany({
        where: { linkedId: oldPrimaryId, deletedAt: null },
        data: { linkedId: newPrimaryId },
    });
}
