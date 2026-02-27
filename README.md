# Bitespeed Identity Reconciliation

A production-ready REST API that reconciles customer identities based on shared email or phone number, built with **Node.js**, **TypeScript**, **Express**, **Prisma**, and **PostgreSQL**.

---

## Architecture

```
src/
├── server.ts                    # Entry point (DB connect + listen)
├── app.ts                       # Express app (middleware registration)
├── routes/
│   └── identify.route.ts        # POST /identify
├── controllers/
│   └── identify.controller.ts   # Request/response handling
├── services/
│   └── identify.service.ts      # Core reconciliation algorithm
├── repositories/
│   └── contact.repository.ts    # Prisma DB queries
├── middleware/
│   ├── validate.ts              # Zod request validation
│   └── errorHandler.ts         # Global error handler
└── types/
    └── index.ts                 # Shared TypeScript types
```

---

## Reconciliation Algorithm

> This problem is structurally equivalent to a **graph connected-components** problem:
> each contact is a node; a shared email or phoneNumber creates an edge between nodes.
> All nodes within the same component share one primary contact — the oldest node.

### Step-by-step

```
1. Query contacts WHERE email = ? OR phoneNumber = ? AND deletedAt IS NULL
2. If none found → create new primary contact → return response
3. Resolve root primary IDs:
     - if contact IS primary  → use its own id
     - if contact IS secondary → use its linkedId
4. Fetch full cluster: WHERE id IN (primaryIds) OR linkedId IN (primaryIds)
5. Find the oldest contact (by createdAt) → this is the true primary
6. If multiple primaries exist (atomic transaction):
     a. Demote newer primaries → set linkPrecedence=secondary, linkedId=truePrimary.id
     b. Relink their secondaries → update linkedId to truePrimary.id
7. If new email/phone not present in cluster (atomic transaction):
     → Create new secondary contact linked to truePrimary.id
8. Reload final cluster → build + return consolidated response
```

All mutations in steps 6 and 7 run inside a single **`prisma.$transaction()`** to guarantee atomicity.

---

## Local Setup

### Prerequisites
- Node.js ≥ 18
- PostgreSQL running locally (or a cloud DB URL)

### Steps

```bash
# 1. Clone and install dependencies
git clone <your-repo-url>
cd bitespeed-identity-reconciliation
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set DATABASE_URL to your PostgreSQL connection string

# 3. Generate Prisma client and run migrations
npx prisma migrate dev --name init
npx prisma generate

# 4. Start the development server
npm run dev
```

Server starts at `http://localhost:3000`

### Verify it's running

```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"..."}
```

---

## Production Build

```bash
npm run build       # Compile TypeScript → dist/
npm run start       # Run compiled output
```

---

## Deploy on Render

### 1. Create a PostgreSQL Database on Render
- Dashboard → **New** → **PostgreSQL**
- Copy the **External Connection String**

### 2. Create a Web Service on Render
- Dashboard → **New** → **Web Service**
- Connect your GitHub repo
- Configure:

| Field | Value |
|---|---|
| **Environment** | `Node` |
| **Build Command** | `npm install && npx prisma generate && npx prisma migrate deploy && npm run build` |
| **Start Command** | `npm run start` |

### 3. Set Environment Variables (Render Dashboard → Environment)

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Render PostgreSQL External URL |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

### 4. Deploy
Push to your connected branch. Render auto-deploys.

---

## API Reference

### `POST /identify`

Accepts at least one of `email` or `phoneNumber`.

**Request**
```json
{
  "email": "user@example.com",
  "phoneNumber": "1234567890"
}
```

**Response `200 OK`**
```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["user@example.com"],
    "phoneNumbers": ["1234567890"],
    "secondaryContactIds": []
  }
}
```

**Error `400`** — when neither field is provided
```json
{
  "error": "Validation failed",
  "details": [{ "field": "body", "message": "At least one of 'email' or 'phoneNumber' must be provided" }]
}
```

---

## Postman Test Cases

### Case 1 — New customer (no match → primary created)
```json
POST /identify
{ "email": "lorraine@hillvalley.edu", "phoneNumber": "123456" }
```
**Expected:** `primaryContactId: 1`, no secondaries.

---

### Case 2 — Existing email, new phone → secondary created automatically
```json
POST /identify
{ "email": "lorraine@hillvalley.edu", "phoneNumber": "999999" }
```
**Expected:** Same `primaryContactId`, new entry in `secondaryContactIds`, both phones in `phoneNumbers`.

---

### Case 3 — Two separate primaries merged via one request
```bash
# Step A: create contact A (email only)
POST /identify  →  { "email": "a@test.com" }

# Step B: create contact B (phone only)
POST /identify  →  { "phoneNumber": "111111" }

# Step C: link them — one request carries both
POST /identify  →  { "email": "a@test.com", "phoneNumber": "111111" }
```
**Expected:** Oldest contact (A) stays primary. Contact B becomes secondary. Both emails/phones consolidated.

---

### Case 4 — Exact duplicate (idempotent — no new row)
```json
POST /identify
{ "email": "lorraine@hillvalley.edu", "phoneNumber": "123456" }
```
Called twice with identical payload.
**Expected:** Same response both times. No duplicate rows created.

---

### Case 5 — Validation error (empty body)
```json
POST /identify
{}
```
**Expected:** `400 Bad Request` with descriptive error.

---

## Edge Cases Handled

| Scenario | Behavior |
|---|---|
| No email, no phone | 400 validation error |
| Exact same email + phone already in cluster | Idempotent — no new row created |
| Email exists, phone is new | New secondary contact created |
| Phone exists, email is new | New secondary contact created |
| Two primary contacts linked by a new request | Older stays primary; newer demoted atomically |
| Secondary's linkedId pointed to a demoted primary | Relinked to the surviving true primary |
| Soft-deleted contacts (`deletedAt IS NOT NULL`) | Ignored in all queries |
| Duplicate emails/phones in response | Deduplicated via `Set` |
| Primary contact's email/phone | Always first in the `emails`/`phoneNumbers` arrays |

---

## Database Schema

```prisma
model Contact {
  id             Int            @id @default(autoincrement())
  phoneNumber    String?
  email          String?
  linkedId       Int?
  linkPrecedence LinkPrecedence @default(primary)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  deletedAt      DateTime?

  @@index([email])         // fast lookup by email
  @@index([phoneNumber])   // fast lookup by phone
  @@index([linkedId])      // fast cluster traversal
}

enum LinkPrecedence {
  primary
  secondary
}
```

> **Why indexes?** The `/identify` endpoint queries by `email` and `phoneNumber` on every request. Without indexes, PostgreSQL performs a full table scan — unacceptable at any meaningful scale.
