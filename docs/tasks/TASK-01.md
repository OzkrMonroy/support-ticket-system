# TASK-01 — Minimal Backend Setup

## Goal
Set up a simple, working backend foundation so development can proceed to the login user story. **Do not implement authentication yet.**

## Context
Read `AGENTS.md` at the repository root before starting. This is a university project: prioritize simple, readable code that is easy to explain. **Do not expand the scope.**

## Scope
1. Create `backend/` using Node.js, Express, and **JavaScript ESM** (`"type": "module"`). Do not use TypeScript.
2. Create `infrastructure/compose.yaml` containing **only PostgreSQL** for local development. RabbitMQ will be configured in a later task.
3. Set up Prisma **6.19.3** with PostgreSQL and the `prisma-client-js` generator.
4. Define only these models in `schema.prisma`:
   - `User`: UUID `id`, `name`, unique `email`, `passwordHash`, `role` (`ADMIN`, `CLIENT`, `TECHNICIAN`), `isActive` (default `true`), `createdAt`, `updatedAt`.
   - `RefreshSession`: UUID `id`, `userId` related to `User`, unique `tokenHash`, `expiresAt`, optional `revokedAt`, `createdAt`.
5. Create the initial Prisma migration.
6. Create a simple, idempotent seed script that creates the initial administrator using `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` from the environment. Hash the password; never store it in plaintext.
7. Create a minimal Express server with `GET /api/health` returning `{ "status": "ok" }`.
8. Use `dotenv/config` and `process.env` directly. Do not use Zod or build an environment-validation module.
9. Include `.env.example` with `PORT`, `DATABASE_URL`, `CORS_ORIGIN`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`. Keep `.env` out of Git.
10. Create a **clear, complete `README.md`** for someone setting up this project for the first time.

## Suggested Structure
```text
support-ticket-system/
├── AGENTS.md
├── README.md
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── scripts/
│   │   └── seed-admin.js
│   └── src/
│       └── server.js
└── infrastructure/
    └── compose.yaml
```
Add small files only when strictly necessary. Avoid unnecessary architectural layers.

## Required Scripts in `backend/package.json`
- `dev`: start Express for development.
- `start`: start Express.
- `prisma:generate`: generate Prisma Client.
- `prisma:deploy`: apply pending migrations.
- `prisma:seed`: create the initial administrator.

## README Requirements
Explain the following in order, using commands readers can copy and paste:
1. What the project does and which technologies it uses.
2. Prerequisites (Node.js, npm, Docker).
3. How to create `backend/.env` from `.env.example` and what each variable means. Clearly distinguish PostgreSQL credentials from application administrator credentials.
4. How to start PostgreSQL with Docker Compose from the repository root.
5. How to install dependencies, generate Prisma Client, apply migrations, and run the seed script.
6. How to start Express and verify `GET http://localhost:3000/api/health`.
7. How to connect through TablePlus using the configured credentials.
8. When each Prisma command needs to be run again.
9. Brief troubleshooting for common problems (occupied port, database not running, mismatched credentials).

## Constraints
- Do not implement login, JWT, refresh tokens, logout, CRUD operations, Angular, or RabbitMQ yet.
- Do not install Zod or libraries without a concrete use.
- Do not add repository patterns, factories, dependency injection containers, sophisticated error-handling frameworks, or extensive testing infrastructure.
- Do not create additional endpoints.
- Do not commit real secrets.
- Do not run `git add`, `git commit`, or `git push`.
- Ask before making any significant decision outside this scope.

## Acceptance Criteria
- PostgreSQL starts successfully through Docker Compose.
- Prisma Client generation and the initial migration both succeed.
- The seed creates an administrator with a hashed password and can be run repeatedly without creating duplicates.
- Express starts and `/api/health` responds with HTTP 200 and `{ "status": "ok" }`.
- The README allows someone to reproduce the setup from a clean checkout.

## Instructions for Codex
Before writing code, present a short plan (up to five steps). Then implement only this task. When finished, summarize the created files, commands executed, checks performed, and remaining work. **Never claim something works unless you verified it.**
