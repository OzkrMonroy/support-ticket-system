# TASK-01 — Implementation Notes

## What was implemented

- A JavaScript ESM backend with Express and CORS configuration.
- `GET /api/health`, returning HTTP 200 and `{"status":"ok"}`.
- PostgreSQL 17 for local development through Docker Compose, with a persistent volume and readiness health check.
- Prisma CLI and Client pinned to version `6.19.3`, using the `prisma-client-js` generator.
- The `User` and `RefreshSession` models, the `ADMIN`, `CLIENT`, and `TECHNICIAN` roles, and an initial SQL migration.
- An environment-configured administrator seed that hashes passwords and preserves existing administrators on repeated runs.
- Environment examples, setup instructions, and two integration tests.

## Technical decisions

The server stays in one small file because this task has only one endpoint. It uses `dotenv/config` and `process.env` directly; no configuration layer or validation library is needed.

Prisma defines the database relationships and constraints, while the included migration makes setup reproducible. UUID identifiers, unique email and token hashes, and the user/session foreign key follow the task specification. `RefreshSession` is a database model only; token handling is not implemented.

Compose runs only PostgreSQL. Its named volume preserves data between starts, and `--wait` uses the health check to wait for database readiness. The explicit `--env-file backend/.env` option lets Compose and the backend share the local configuration.

The seed uses bcrypt with a cost of 12. It rejects passwords longer than 72 UTF-8 bytes to avoid bcrypt truncation. Repeated execution leaves an existing administrator unchanged; an email belonging to another role causes an error. PostgreSQL credentials and application administrator credentials serve separate purposes.

Tests use Node's built-in test runner and the configured PostgreSQL database, avoiding additional testing libraries or mocks.

## Important files

| File | Purpose |
| --- | --- |
| `README.md` | Setup, environment variables, commands, TablePlus connection, and troubleshooting. |
| `.gitignore` | Excludes local environment files, dependencies, and macOS metadata. |
| `backend/package.json` | Dependencies, ESM configuration, and npm scripts. |
| `backend/package-lock.json` | Locked dependency versions for `npm ci`. |
| `backend/.env.example` | Safe local configuration examples. |
| `backend/src/server.js` | Express startup, CORS, and health endpoint. |
| `backend/prisma/schema.prisma` | Database models, roles, and Prisma generator configuration. |
| `backend/prisma/migrations/20261022000000_init/migration.sql` | Initial database schema. |
| `backend/prisma/migrations/migration_lock.toml` | PostgreSQL migration provider declaration. |
| `backend/scripts/seed-admin.js` | Initial administrator creation and password hashing. |
| `backend/tests/setup.test.js` | Seed and HTTP integration checks. |
| `infrastructure/compose.yaml` | Local PostgreSQL service, volume, port, and health check. |

## Verification performed

During the implementation session, the following commands were executed successfully:

- Dependency installation with `npm install`, with both Prisma packages fixed to `6.19.3`.
- `docker compose --env-file backend/.env -f infrastructure/compose.yaml up -d --wait`: PostgreSQL reached healthy status.
- `npm run prisma:generate`: generated Prisma Client `6.19.3`.
- `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`: generated the initial SQL migration.
- `npx prisma format` and `npx prisma validate`: formatted and validated the schema.
- `npm run prisma:deploy`: applied the initial migration.
- `npm run prisma:seed`: created the initial administrator.
- `npx prisma migrate status`: reported the database schema up to date.
- `npm test`: both integration tests passed. They checked the administrator role, active status, bcrypt password verification, unchanged record after reseeding, unique administrator email, and HTTP 200 with the expected health response.
- `git diff --check`: reported no whitespace errors in tracked changes.

These are results from the implementation session, not a new test run for this documentation update. The HTTP test used port `32101`; a manual curl check on port `3000` and a TablePlus connection were not performed. A clean-checkout setup using `npm ci` was documented but not separately exercised.

## Known limitations

- Authentication, JWTs, refresh-token operations, logout, ticket CRUD, Angular, and RabbitMQ remain outside TASK-01.
- The health endpoint checks the HTTP server only, not PostgreSQL connectivity.
- Integration tests require a running, migrated database and matching `ADMIN_*` configuration. They leave the seeded administrator in place and require port `32101` to be free.
- Rerunning the seed does not update an existing administrator's name or password.
- Changing `POSTGRES_*` values does not change accounts in an existing PostgreSQL volume.
- Local example credentials must be replaced before use outside local development.
- `npm audit --json` reported three high-severity findings in the Prisma dependency chain through `deepmerge-ts`. npm proposed Prisma `7.10.1` as the fix; Prisma remains at the task-required `6.19.3`. No forced dependency upgrade was applied.
