import { LinkPrecedence } from "@prisma/client";

// ─── Request / Response DTOs ─────────────────────────────────────────────────

export interface IdentifyRequest {
    email?: string;
    phoneNumber?: string;
}

export interface ConsolidatedContact {
    primaryContactId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
}

export interface IdentifyResponse {
    contact: ConsolidatedContact;
}

// ─── Internal domain type ────────────────────────────────────────────────────

export interface ContactRecord {
    id: number;
    phoneNumber: string | null;
    email: string | null;
    linkedId: number | null;
    linkPrecedence: LinkPrecedence;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

// ─── Error shape ─────────────────────────────────────────────────────────────

export interface ApiError {
    status: number;
    message: string;
}
