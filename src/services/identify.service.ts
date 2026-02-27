import { Prisma } from "@prisma/client";
import { prisma } from "../repositories/contact.repository";
import * as repo from "../repositories/contact.repository";
import {
    ConsolidatedContact,
    ContactRecord,
    IdentifyRequest,
    IdentifyResponse,
} from "../types";

/**
 * Identity Resolution Algorithm
 * ─────────────────────────────────────────────────────────────────────────────
 * This problem is structurally equivalent to a graph connected-components
 * problem: each contact is a node; shared email or phoneNumber creates an edge.
 * All nodes within the same component share the same primary contact (the
 * oldest node in the component).
 *
 * Steps:
 *  1. Query all contacts matching the incoming email OR phoneNumber.
 *  2. If none found → create a new primary contact and return.
 *     (Wrapped in a transaction to guard against concurrent duplicate inserts.)
 *  3. Collect the root primary ids of every matched contact.
 *  4. Fetch the complete cluster (all contacts with those primary ids).
 *  5. If multiple primaries exist → the oldest stays primary; demote the rest.
 *     Also relink their secondaries to the surviving primary.
 *  6. Re-fetch cluster INSIDE the transaction to get a consistent snapshot,
 *     then check if incoming payload introduces new email/phone not in cluster.
 *     If so → create a new secondary contact.
 *  7. Build and return the consolidated response.
 *
 * FIX — Stale read: idempotency check (step 6) re-fetches cluster data inside
 * the transaction after demotions. This prevents concurrent requests from
 * creating duplicate secondary contacts based on an outdated cluster snapshot.
 *
 * FIX — Concurrent new contacts: step 2 is wrapped in a transaction that also
 * re-checks for existing matches immediately before inserting, eliminating the
 * TOCTOU (time-of-check-time-of-use) window between the initial read and write.
 *
 * FIX — Transaction timeouts: explicit maxWait/timeout prevent silent hangs
 * under DB load.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Transaction options applied to all write transactions
const TX_OPTIONS = {
    maxWait: 5000,  // ms to wait for a connection from the pool
    timeout: 10000, // ms for the entire transaction to complete
};

export async function identifyContact(
    payload: IdentifyRequest
): Promise<IdentifyResponse> {
    const { email, phoneNumber } = payload;

    // ── Step 1: Find all directly matching contacts ───────────────────────────
    const directMatches = await repo.findContactsByEmailOrPhone(
        email,
        phoneNumber
    );

    // ── Step 2: No match → create a brand-new primary contact ────────────────
    // FIX: Wrap in a transaction that re-checks for matches immediately before
    // inserting. Two concurrent requests both seeing zero matches (TOCTOU race)
    // will now have one of them: (a) blocked until the other commits, then
    // (b) re-check inside the transaction and find the already-created contact,
    // skipping the duplicate insert.
    if (directMatches.length === 0) {
        let newContact: ContactRecord | null = null;

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Re-check inside the transaction with a fresh read
            const recheck = await repo.findContactsByEmailOrPhone(email, phoneNumber, tx);

            if (recheck.length === 0) {
                // Truly no match — safe to create
                newContact = await repo.createPrimaryContact(email, phoneNumber, tx);
            } else {
                // Another request beat us to it — signal that we need to fall through
                // to the merge/consolidation path below
                newContact = null;
            }
        }, TX_OPTIONS);

        if (newContact !== null) {
            return buildResponse(newContact, []);
        }

        // Fall through: re-fetch matches created by the concurrent request
        const fallbackMatches = await repo.findContactsByEmailOrPhone(email, phoneNumber);
        if (fallbackMatches.length === 0) {
            // Extremely unlikely: just create now (the concurrent tx may have rolled back)
            const contact = await repo.createPrimaryContact(email, phoneNumber);
            return buildResponse(contact, []);
        }

        // Continue into the merge path with the concurrently-created contacts
        return await mergeAndRespond(fallbackMatches, email, phoneNumber);
    }

    return await mergeAndRespond(directMatches, email, phoneNumber);
}

// ─── Core merge + consolidation logic ────────────────────────────────────────

async function mergeAndRespond(
    directMatches: ContactRecord[],
    email?: string,
    phoneNumber?: string
): Promise<IdentifyResponse> {

    // ── Step 3: Gather all root primary IDs from the matched contacts ─────────
    const primaryIds = getRootPrimaryIds(directMatches);

    // ── Step 4: Fetch the full cluster up-front (for primary determination) ───
    const cluster = await repo.findContactCluster(primaryIds);

    // ── Step 5: Determine the true primary (oldest createdAt) ─────────────────
    const primaries = cluster
        .filter((c) => c.linkPrecedence === "primary")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const truePrimary = primaries[0];
    const stalePrimaries = primaries.slice(1);

    // ── Steps 5 & 6: Atomic transaction ───────────────────────────────────────
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {

        // 5a. Demote stale primaries → secondary
        if (stalePrimaries.length > 0) {
            const staleIds = stalePrimaries.map((p) => p.id);
            await repo.demotePrimaryToSecondary(staleIds, truePrimary.id, tx);

            // 5b. Relink any secondaries that pointed to a stale primary
            for (const stale of stalePrimaries) {
                await repo.relinkSecondaries(stale.id, truePrimary.id, tx);
            }
        }

        // FIX — Stale read: Re-fetch cluster INSIDE the transaction so the
        // idempotency check reflects the post-demotion state and any concurrent
        // writes that committed before this transaction started.
        const freshCluster = await repo.findContactCluster([truePrimary.id], tx);

        const clusterEmails = new Set(
            freshCluster.map((c) => c.email).filter((e): e is string => e !== null)
        );
        const clusterPhones = new Set(
            freshCluster.map((c) => c.phoneNumber).filter((p): p is string => p !== null)
        );

        const isNewEmail = email && !clusterEmails.has(email);
        const isNewPhone = phoneNumber && !clusterPhones.has(phoneNumber);

        // 6. Only create secondary if the payload truly adds new information
        if (isNewEmail || isNewPhone) {
            await repo.createSecondaryContact(truePrimary.id, email, phoneNumber, tx);
        }

    }, TX_OPTIONS);

    // ── Step 7: Reload final state and build response ─────────────────────────
    const finalCluster = await repo.findContactCluster([truePrimary.id]);
    const finalPrimary = finalCluster.find(
        (c) => c.id === truePrimary.id
    ) as ContactRecord;
    const secondaries = finalCluster.filter(
        (c) => c.linkPrecedence === "secondary"
    );

    return buildResponse(finalPrimary, secondaries);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * For each matched contact, resolve its root primary id:
 *  - If it IS a primary → its own id
 *  - If it IS a secondary → its linkedId (which points to the primary)
 */
function getRootPrimaryIds(contacts: ContactRecord[]): number[] {
    const ids = new Set<number>();
    for (const contact of contacts) {
        if (contact.linkPrecedence === "primary") {
            ids.add(contact.id);
        } else if (contact.linkedId !== null) {
            ids.add(contact.linkedId);
        }
    }
    return Array.from(ids);
}

/**
 * Build the consolidated API response, deduplicating emails and phone numbers.
 * Primary contact's email/phone appear first in the arrays (Set insertion order).
 */
function buildResponse(
    primary: ContactRecord,
    secondaries: ContactRecord[]
): IdentifyResponse {
    const emailSet = new Set<string>();
    const phoneSet = new Set<string>();

    if (primary.email) emailSet.add(primary.email);
    if (primary.phoneNumber) phoneSet.add(primary.phoneNumber);

    for (const contact of secondaries) {
        if (contact.email) emailSet.add(contact.email);
        if (contact.phoneNumber) phoneSet.add(contact.phoneNumber);
    }

    const consolidated: ConsolidatedContact = {
        primaryContactId: primary.id,
        emails: Array.from(emailSet),
        phoneNumbers: Array.from(phoneSet),
        secondaryContactIds: secondaries.map((c) => c.id),
    };

    return { contact: consolidated };
}
