import { PrismaClient } from "@prisma/client";

/**
 * Singleton PrismaClient
 * ─────────────────────────────────────────────────────────────────────────────
 * A single PrismaClient instance maintains one connection pool. Instantiating
 * multiple clients (e.g. once per module) fragments the pool and can exhaust
 * PostgreSQL's connection limit (default 100) — especially critical on
 * Render's free tier.
 *
 * In development, hot-reload creates new module instances on every file save.
 * The `global.__prisma` trick prevents a new pool from being created on each
 * reload by reusing the instance already stored on the global object.
 * ─────────────────────────────────────────────────────────────────────────────
 */

declare global {
    // eslint-disable-next-line no-var
    var __prisma: PrismaClient | undefined;
}

const prisma: PrismaClient =
    global.__prisma ??
    new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "warn", "error"]
                : ["error"],
    });

if (process.env.NODE_ENV !== "production") {
    global.__prisma = prisma;
}

export default prisma;
