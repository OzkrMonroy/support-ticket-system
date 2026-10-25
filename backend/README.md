# Support Ticket System

University project for managing technical support tickets. The backend uses Node.js, Express, JavaScript ESM, PostgreSQL 17, and Prisma 6.19.3. It provides a health endpoint, login with short-lived access JWTs, refresh-token rotation, logout, administrator account management, own-profile retrieval, and ticket creation/listing/details and role-based updates. Ticket soft deletion is implemented; RabbitMQ automatic assignment is implemented under HU-11; Angular remains pending.

## Prerequisites

- Node.js 24 LTS (recommended) and npm; `backend/package.json` declares Node.js `>=20.19`.
- Docker with Docker Compose (start Docker Desktop before continuing).
- Optional: TablePlus to inspect PostgreSQL.

Paths and Compose commands below assume the repository root unless a step says otherwise.

## Environment configuration

```sh
cp backend/.env.example backend/.env
```

Edit `backend/.env` before starting. The example values are for local development only. Never commit this file.

Generate a signing secret with the following command, then copy its output into `JWT_SECRET` in `backend/.env`. Keep it private and use a different value for each environment. The backend refuses to start if it is missing or blank.

```sh
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
```

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port, default `3000`. |
| `JWT_SECRET` | Private random signing secret for HS256 access JWTs; tokens expire after 15 minutes. |
| `REFRESH_TOKEN_EXPIRES_DAYS` | Refresh session lifetime in whole days, default `7`; accepted range `1`–`36500`. Invalid values prevent startup. |
| `CORS_ORIGIN` | Allowed frontend origin, initially `http://localhost:4200`. |
| `DATABASE_URL` | Prisma connection URL. Its username, password, database, and host port must match the PostgreSQL settings below. URL-encode special characters in the URL password. |
| `POSTGRES_USER` | PostgreSQL account created when its data volume is initialized. |
| `POSTGRES_PASSWORD` | Password for that PostgreSQL account. |
| `POSTGRES_DB` | Database created on first initialization. |
| `POSTGRES_PORT` | Local port exposed by Docker, default `5432`. |
| `ADMIN_NAME` | Initial application administrator's name. |
| `ADMIN_EMAIL` | Initial application administrator's unique email. |
| `ADMIN_PASSWORD` | Application password, hashed by the seed; maximum 72 UTF-8 bytes. Replace the example value. |

The PostgreSQL credentials connect tools and Prisma to the database. The `ADMIN_*` values create an application user; they do not grant database access.

## Start PostgreSQL and RabbitMQ

```sh
docker compose --env-file backend/.env -f infrastructure/compose.yaml up -d --wait
```

PostgreSQL data persists in a named Docker volume. To stop the database while keeping its data:

```sh
docker compose --env-file backend/.env -f infrastructure/compose.yaml stop
```

## Install and initialize the backend

From the repository root, install the dependencies locked in `backend/package-lock.json`:

```sh
cd backend
npm ci
```

Keep this terminal in `backend/`. Generate Prisma Client, apply the included migrations, and create the initial administrator in this order:

```sh
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
```

The migrations create `User`, `RefreshSession`, `Ticket`, and the role, ticket priority, and ticket status enums. The seed creates an active `ADMIN` with a bcrypt password hash. Repeating the seed leaves the existing administrator unchanged, including the password. It fails if the configured email belongs to another role. HU-02 reuses the existing schema without a new migration.

## Start and check Express

From `backend/`:

```sh
npm run dev
```

For a normal start without automatic reload, use `npm start`. In a second terminal:

```sh
curl -i http://localhost:3000/api/health
```

Expected: HTTP `200` with `{"status":"ok"}`. If `PORT` changes, use that port in the URL. This endpoint checks the HTTP server only; it does not check database availability.

## API access and validation

Protected endpoints require `Authorization: Bearer <accessToken>`. Authentication verifies the HS256 JWT and its expiration, then queries the database on every protected request. Missing or inactive accounts receive 401. Authorization uses the account's current database role; authenticated non-administrators receive 403 on administrator-only endpoints. Database authentication failures return a generic 500 response. Deactivation blocks login, refresh, and protected endpoints even with a previously issued access token.

Zod validates request fields and UUID parameters. Validation failures return HTTP 400 with one message per field, for example:

```json
{"message":"Validation failed.","errors":{"email":"Invalid email address."}}
```

Malformed JSON returns 400 with `{"message":"Invalid JSON body."}` before field validation. Other errors use a simple `message` response. On protected user routes, authentication and administrator authorization precede field validation.

## User login

Send `POST http://localhost:3000/api/auth/login` with `Content-Type: application/json` and a body containing string fields `email` and `password`. Use the administrator credentials configured when the seed first created the user, or another existing active user. Email must have a basic valid format and is looked up exactly as supplied (no trimming or lowercasing at login); the password must contain a non-whitespace character and is not transformed.

```json
{"email":"admin@example.com","password":"replace-with-your-local-password"}
```

A successful response is HTTP 200 with `accessToken`, `refreshToken`, and `user` (`id`, `name`, `email`, `role`). The signed JWT contains `id`, `role`, and issue/expiration timestamps; it expires after 15 minutes. Missing or invalid fields and malformed JSON return 400. Unknown users and wrong passwords (including for inactive accounts) return 401 with `{"message":"Invalid credentials."}`. Only after verifying the password, an inactive account returns 403 with `{"message":"Your account has been deactivated. Contact an administrator."}`. Rejected logins return no tokens and create no refresh sessions. Unexpected backend failures return a generic 500 response.

Passwords, password hashes, and the signing secret are never returned. Treat both tokens as private credentials. Administrator-only user creation is available as described below. Frontend screens are not implemented.

## Create users as administrator

Send `POST http://localhost:3000/api/users` with `Content-Type: application/json` and `Authorization: Bearer <accessToken>`, using an administrator access token returned by login.

```json
{"name":"Example User","email":"user@example.com","password":"ExamplePassword123!","role":"CLIENT"}
```

Only `CLIENT` and `TECHNICIAN` roles are accepted. Name, email, password, and role must be nonempty strings; email must have a basic email format and passwords must not exceed 72 UTF-8 bytes. Names are trimmed; emails are trimmed and lowercased. Passwords are hashed with bcrypt (cost 12).

Success returns HTTP 201 with `id`, `name`, `email`, `role`, and `isActive` (default `true`). Invalid input returns 400, missing/invalid/expired access tokens return 401, authenticated non-administrators receive 403, and duplicate normalized emails return 409. Unexpected database failures return a generic 500 response. New users can log in using their normalized email and original password. Administrator creation remains in the seed script.

## List users as administrator

Send `GET http://localhost:3000/api/users` with an administrator Bearer access token. Success returns HTTP 200 with an array of users containing only `id`, `name`, `email`, `role`, and `isActive`, ordered by creation date ascending and then ID. Password hashes and sessions are excluded. No pagination, filtering, or search is implemented.

## Deactivate users as administrator

Send `PATCH http://localhost:3000/api/users/<id>/deactivate` with an administrator Bearer access token; no request body is required. Success returns HTTP 200 with `id`, `name`, `email`, `role`, and `isActive: false`. Repeated deactivation succeeds and preserves the record.

Self-deactivation returns 403, an unknown valid UUID returns 404, and a malformed UUID returns 400 with `errors.id`. Missing/invalid authentication returns 401 and non-administrators receive 403 before UUID validation. Unexpected database failures return a generic 500 response. Deactivation prevents login, refresh, and protected access; it does not delete the user or session records. Reactivation, editing, and deletion are not implemented.

## View own profile

Send `GET http://localhost:3000/api/users/me` with a Bearer access token for any active `ADMIN`, `CLIENT`, or `TECHNICIAN`. Success returns HTTP 200 with only `id`, `name`, `email`, and `role`, read from the current database record. The identity comes from authentication; query parameters cannot select another user. Missing/invalid/expired tokens or missing/inactive accounts return 401; unexpected database failures return a generic 500 response.

## Create support tickets

Send `POST http://localhost:3000/api/tickets` with `Content-Type: application/json` and a Bearer access token for an active CLIENT or ADMIN.

```json
{"title":"Cannot access email","description":"The email application rejects my credentials.","priority":"HIGH"}
```

Title and description are trimmed, required, and limited to 200 and 5000 characters respectively. Priority must be `LOW`, `MEDIUM`, or `HIGH`. Additional fields are rejected with 400 using the existing `message`/`errors` envelope; unknown-field errors have an empty `errors` object because the shared validator reports only field paths. Do not send IDs, status, assignment, or timestamps.

Success returns 201 with persisted scalar fields: `id`, `title`, `description`, `priority`, `status`, `createdById`, `assignedToId`, `createdAt`, and `updatedAt`, plus `deletedAt` (initially `null`). The creator comes from authentication, status defaults to `OPEN`, and assignment is `null`. User records are not included. Missing/invalid/expired authentication and inactive accounts receive 401; TECHNICIAN receives 403 before field validation. Unexpected database errors return a generic 500 response. Assignment is queued asynchronously after creation; notifications are not implemented.

## Update support tickets

Send `PATCH http://localhost:3000/api/tickets/<id>` with a Bearer access token for an active account and a partial JSON body, for example `{"title":"Updated title","priority":"HIGH"}` or `{"status":"IN_PROGRESS"}`.

Only `title`, `description`, `priority`, and `status` are accepted; at least one field is required. Text uses the creation constraints and trimming. Unknown/system-managed fields, invalid values, and malformed UUIDs return the existing 400 validation envelope. Authentication failures return 401. Missing or invisible tickets return the same 404 as detail reads; forbidden actions on visible tickets return 403.

| Role | Content changes | Status changes |
| --- | --- | --- |
| CLIENT | Own OPEN tickets only | Own RESOLVED ticket to CLOSED; status only |
| TECHNICIAN | None | Assigned tickets only: OPEN to IN_PROGRESS, IN_PROGRESS to RESOLVED |
| ADMIN | Any ticket except CLOSED | OPEN to IN_PROGRESS, IN_PROGRESS to RESOLVED, RESOLVED to CLOSED; direct close from OPEN or IN_PROGRESS |

CLOSED is terminal. Same-status requests are forbidden. Mixed requests must satisfy all rules against the persisted starting status; rejected requests apply no changes. Assignment and creator/creation timestamp remain unchanged; Prisma manages `updatedAt`. Success returns 200 using the same safe representation as detail reads. No assignment endpoint is available. HU-09 is user-approved.

## List and view support tickets

Send `GET http://localhost:3000/api/tickets` or `GET http://localhost:3000/api/tickets/<id>` with a Bearer access token for an active account. ADMIN sees all tickets, CLIENT sees only tickets they created, and TECHNICIAN sees only tickets assigned to them. Unassigned tickets are not visible to technicians. Permissions use the current database role.

The list returns 200 with an array (possibly empty), ordered by `createdAt` descending and then `id` descending. Detail returns 200 for a visible ticket. Both endpoints return all persisted ticket scalar fields plus `createdBy` and `assignedTo`; related users contain only `id`, `name`, `email`, and `role`. An absent assignee is `null`. The POST response remains scalar-only.

Missing and inaccessible detail IDs both return 404 with `{"message":"Ticket not found."}`. Malformed UUIDs return 400 with `message: "Validation failed."` and `errors.id`. Missing/invalid/expired authentication or missing/inactive accounts return 401 before UUID validation. Unexpected database failures return a generic 500 message. No pagination, search, status/priority filters, or assignment endpoints are provided.

## Delete support tickets

Send `DELETE http://localhost:3000/api/tickets/<id>` with a Bearer access token; no body is required. CLIENT may delete own OPEN tickets; ADMIN may delete any visible ticket regardless of status. TECHNICIAN cannot delete tickets. Success returns 204 with no body, sets `deletedAt`, preserves the row and status, and updates `updatedAt` through Prisma.

Deleted tickets are excluded from all lists and return 404 on detail, update, and repeated deletion for every role. Missing/invisible tickets also return 404. Forbidden deletion of a visible ticket returns 403. Invalid UUIDs use the existing 400 validation envelope; missing/invalid authentication and inactive accounts return 401. There is no restore or trash endpoint. Apply the included migration and regenerate Prisma Client using the setup commands above.

## Refresh access tokens

Send `POST http://localhost:3000/api/auth/refresh` with `Content-Type: application/json`:

```json
{"refreshToken":"replace-with-the-token-returned-by-login"}
```

A valid request returns HTTP 200 with `accessToken` and a replacement `refreshToken`. Use the replacement for the next renewal: each refresh token can be consumed only once, including when requests arrive simultaneously. The server revokes the old session and creates its replacement in one database transaction.

Refresh tokens are opaque random values generated by Node.js crypto. Only SHA-256 hashes are stored in `RefreshSession`. Each replacement receives a new lifetime of `REFRESH_TOKEN_EXPIRES_DAYS` days, defaulting to seven. Existing sessions retain their original expiration if this setting changes. Access JWTs still expire after 15 minutes; renewal does not invalidate previously issued access JWTs.

Missing, empty, or non-string refresh tokens and malformed JSON return 400. Unknown, expired, revoked, reused tokens and inactive users all return 401 with `{"message":"Invalid refresh token."}`. Unexpected failures return a generic 500 response. Expired and revoked sessions remain in the database; automatic cleanup is not implemented.

To check manually, log in, exchange the returned refresh token, and verify that repeating it returns 401 while using the replacement succeeds. An empty JSON object should return 400; an unknown string token should return 401.

## User logout

Send `POST http://localhost:3000/api/auth/logout` with `Content-Type: application/json`:

```json
{"refreshToken":"replace-with-your-current-refresh-token"}
```

A valid, already revoked, or unknown token returns HTTP 204 with no response body. Missing, empty, or non-string tokens return 400. Database failures return a generic 500 response. Logout revokes only the matching session and does not change its existing revocation timestamp on repeated requests. Other sessions for the same user remain usable.

After logout, exchanging that refresh token at `/api/auth/refresh` returns 401. For otherwise active accounts, already issued access JWTs remain valid until they expire (15 minutes); access-token blacklisting, logout on all devices, and automatic session cleanup are not implemented. If a refresh token has already rotated, use its current replacement to log out the current session.

## Connect with TablePlus

Create a PostgreSQL connection with host `localhost`, port from `POSTGRES_PORT`, user from `POSTGRES_USER`, password from `POSTGRES_PASSWORD`, and database from `POSTGRES_DB`. With unchanged example values, these are port `5432`, user `support_user`, password `local_password`, and database `support_tickets`. SSL is not required for this local container. Application administrator credentials do not belong in this connection.

## When to repeat Prisma commands

- `npm run prisma:generate`: after installing dependencies or changing the Prisma schema, to refresh Prisma Client.
- `npm run prisma:deploy`: on initial setup and after pulling new committed migrations. It applies pending migrations and does not create migration files.
- `npm run prisma:seed`: once after migration to create the administrator; safe to repeat, but it does not reset an existing administrator's credentials.
- For a future intentional schema change, run `npx prisma migrate dev --name descriptive_name` from `backend/`, inspect and retain the generated migration, then regenerate Prisma Client. Do not reset an existing database to resolve migration errors without reviewing the data impact.

## Checks

Integration tests use Node's built-in test runner to verify health, the administrator seed, login, refresh rotation, logout, administrator-only user creation/listing/deactivation, current-account authorization, own-profile retrieval, ticket creation, role-based ticket listing/details, ticket update permissions/workflow, soft deletion, and field validation. Start PostgreSQL and RabbitMQ, configure `RABBITMQ_URL`, leave the assignment worker stopped during tests, apply migrations, and configure `ADMIN_*` first. Tests use the configured database and leave the seeded administrator in place. The password in `.env` must match the seeded administrator. HTTP tests temporarily use ports `32101`, `32102`, `32103`, `32104`, `32105`, `32106`, `32107`, and `32108` and supply their own signing secrets. Login and refresh fixtures use unique emails; their users and sessions are removed after the test. Ticket tests remove only their own tickets and user fixtures. The administrator login test removes only the session it creates.

From `backend/`:

```sh
npx prisma validate
npx prisma migrate status
npm test
```

Use TablePlus to confirm one administrator row for the configured email, role `ADMIN`, and a hashed `passwordHash`, then verify the health endpoint with the curl command above. Do not share password hashes or credentials in screenshots or logs.

## Troubleshooting

- **Port occupied:** change `PORT` for Express or `POSTGRES_PORT` for PostgreSQL. When changing the database port, update `DATABASE_URL` too and rerun Compose.
- **Database unavailable:** ensure Docker Desktop is running, start Compose, and inspect the service with `docker compose --env-file backend/.env -f infrastructure/compose.yaml ps` from the repository root.
- **Invalid database credentials:** verify `DATABASE_URL` matches the PostgreSQL settings. Changing `POSTGRES_*` does not update an already initialized volume's accounts. Restore the original credentials or deliberately update the account through PostgreSQL; do not delete the volume to troubleshoot existing data.
- **Missing tables or Prisma Client:** run `npm run prisma:generate` and `npm run prisma:deploy` from `backend/`.
- **Seed configuration missing:** run the seed from `backend/` and check all three `ADMIN_*` variables in its `.env`.

Implementation details are recorded in [TASK-01 notes](../docs/implementation/TASK-01.md), [HU-01 notes](../docs/implementation/HU-01.md), [HU-02 notes](../docs/implementation/HU-02.md), [HU-03 notes](../docs/implementation/HU-03.md), [HU-04 notes](../docs/implementation/HU-04.md), [HU-05 notes](../docs/implementation/HU-05.md), [HU-06 notes](../docs/implementation/HU-06.md), and [TASK-02 notes](../docs/implementation/TASK-02.md). See also the [project overview](../docs/PROJECT.md), [roadmap](../docs/ROADMAP.md), and [architecture](../docs/ARCHITECTURE.md).

## Automatic assignment (HU-11)

Add the RabbitMQ settings from `.env.example` to your local `.env`:

| Variable | Purpose |
| --- | --- |
| `RABBITMQ_URL` | Required API/worker AMQP URL; example `amqp://support_user:local_broker_password@localhost:5672`. URL-encode credentials. |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | Compose broker account; defaults match the local example URL. Replace together. |
| `RABBITMQ_PORT` | Local AMQP port; default `5672`. Update the URL if changed. |
| `RABBITMQ_MANAGEMENT_PORT` | Local management UI port; default `15672`. |

The Compose startup command above starts both services and preserves their named volumes. The management UI is at `http://localhost:15672`; use the broker account. Ports are bound to loopback. Changing credentials does not change an existing broker volume's account.

From `backend/`, run the API (`npm start`) and, in a second terminal:

```sh
npm run worker:assignment
```

Run one worker for the local demonstration. Each creation publishes `{ticketId}` to durable classic queue `ticket-assignment`, using persistent messages, publisher confirms and priorities LOW=1, MEDIUM=2, HIGH=3. POST waits for the broker confirmation, not assignment, and preserves its 201 scalar response. The worker reads current database data, selects the active TECHNICIAN with the fewest non-deleted OPEN/IN_PROGRESS assignments, and breaks ties by ID ascending. Assignment preserves OPEN. Missing, deleted, non-OPEN or already-assigned tickets are skipped; no technicians is acknowledged without retry. Existing GET routes expose the resulting safe assignee fields and technician visibility.

Manual acknowledgements follow successful assignment/no-op. Unexpected processing errors (including malformed messages) are logged and rejected with `requeue=false`: one attempt per delivery, no automatic application retry or dead-letter queue. Rejected messages are discarded. After fixing the cause, an administrator can republish an existing ticket:

```sh
npm run assignment:publish -- <ticket-uuid>
```

If creation succeeds in PostgreSQL but publishing fails or confirmation times out, POST returns 503 with `ticketId` and an explicit message that the ticket exists. Do not repeat POST; recover with the command above. Logs contain the ticket ID, never broker credentials. An uncertain confirmation can produce duplicates; conditional assignment makes them harmless. A process crash between database commit and publish remains a recovery gap without an outbox; inspect unassigned tickets and republish manually. No new API or schema is added.

Priority applies only to messages still queued, not work already delivered. `prefetch(1)` limits outstanding work; multiple workers have no strict global ordering and can observe the same workload snapshot for different tickets. Conditional writes prevent overwriting the same ticket's assignment. Connection loss can redeliver unacknowledged work; the worker exits on disconnect and must be restarted. No reconnect loop is implemented. HU-13 will extend failure handling/status visibility.

Tests include isolated real-broker priority/publisher checks, real PostgreSQL assignment with rolled-back fixtures, API publication failure on port `32109`, and focused policy/acknowledgement tests. Unit tests alone: `node --test tests/assignment.test.js`. Keep the worker stopped for the full suite so existing creation assertions remain deterministic. Full tests can leave assignment messages for deleted fixtures; later consumption safely skips them.

Manual end-to-end check: start the worker with an active technician present, create a ticket as CLIENT, then GET its detail as the creator and assigned technician. Verify OPEN and the assignee. Stop the worker, enqueue LOW/MEDIUM/HIGH tickets, then restart it to observe queued priority order. Do not claim ordering across concurrent consumers.
