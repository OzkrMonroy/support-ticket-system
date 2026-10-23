# Support Ticket System

University project for managing technical support tickets. The backend uses Node.js, Express, JavaScript ESM, PostgreSQL 17, and Prisma 6.19.3. It provides a health endpoint and user login with a short-lived access JWT. Ticket operations, Angular, and RabbitMQ are pending later tasks.

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

## Start PostgreSQL

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

Keep this terminal in `backend/`. Generate Prisma Client, apply the included migration, and create the initial administrator in this order:

```sh
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
```

The migration creates `User`, `RefreshSession`, and the role enum. The seed creates an active `ADMIN` with a bcrypt password hash. Repeating the seed leaves the existing administrator unchanged, including the password. It fails if the configured email belongs to another role. HU-02 reuses the existing schema without a new migration.

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

## User login

Send `POST http://localhost:3000/api/auth/login` with `Content-Type: application/json` and a body containing string fields `email` and `password`. Use the administrator credentials configured when the seed first created the user, or another existing active user.

```json
{"email":"admin@example.com","password":"replace-with-your-local-password"}
```

A successful response is HTTP 200 with `accessToken`, `refreshToken`, and `user` (`id`, `name`, `email`, `role`). The signed JWT contains `id`, `role`, and issue/expiration timestamps; it expires after 15 minutes. Missing or invalid fields and malformed JSON return 400. Unknown users, wrong passwords, and inactive users all return 401 with `{"message":"Invalid credentials."}`. Unexpected backend failures return a generic 500 response.

Passwords, password hashes, and the signing secret are never returned. Treat both tokens as private credentials. Administrator-only user creation is available as described below. Frontend screens are not implemented.

## Create users as administrator

Send `POST http://localhost:3000/api/users` with `Content-Type: application/json` and `Authorization: Bearer <accessToken>`, using an administrator access token returned by login.

```json
{"name":"Example User","email":"user@example.com","password":"ExamplePassword123!","role":"CLIENT"}
```

Only `CLIENT` and `TECHNICIAN` roles are accepted. Name, email, password, and role must be nonempty strings; email must have a basic email format and passwords must not exceed 72 UTF-8 bytes. Names are trimmed; emails are trimmed and lowercased. Passwords are hashed with bcrypt (cost 12).

Success returns HTTP 201 with `id`, `name`, `email`, `role`, and `isActive` (default `true`). Invalid input returns 400, missing/invalid/expired access tokens return 401, authenticated non-administrators receive 403, and duplicate normalized emails return 409. Unexpected database failures return a generic 500 response. New users can log in using their normalized email and original password. Administrator creation remains in the seed script.

Authorization uses the signed access token's role until token expiration; it does not query current account status or role on each request.

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

After logout, exchanging that refresh token at `/api/auth/refresh` returns 401. Already issued access JWTs remain valid until they expire (15 minutes); access-token blacklisting, logout on all devices, and automatic session cleanup are not implemented. If a refresh token has already rotated, use its current replacement to log out the current session.

## Connect with TablePlus

Create a PostgreSQL connection with host `localhost`, port from `POSTGRES_PORT`, user from `POSTGRES_USER`, password from `POSTGRES_PASSWORD`, and database from `POSTGRES_DB`. With unchanged example values, these are port `5432`, user `support_user`, password `local_password`, and database `support_tickets`. SSL is not required for this local container. Application administrator credentials do not belong in this connection.

## When to repeat Prisma commands

- `npm run prisma:generate`: after installing dependencies or changing the Prisma schema, to refresh Prisma Client.
- `npm run prisma:deploy`: on initial setup and after pulling new committed migrations. It applies pending migrations and does not create migration files.
- `npm run prisma:seed`: once after migration to create the administrator; safe to repeat, but it does not reset an existing administrator's credentials.
- For a future intentional schema change, run `npx prisma migrate dev --name descriptive_name` from `backend/`, inspect and retain the generated migration, then regenerate Prisma Client. Do not reset an existing database to resolve migration errors without reviewing the data impact.

## Checks

Integration tests use Node's built-in test runner to verify health, the administrator seed, login, refresh rotation, logout, and administrator-only user creation. Start PostgreSQL, apply migrations, and configure `ADMIN_*` first. Tests use the configured database and leave the seeded administrator in place. The password in `.env` must match the seeded administrator. HTTP tests temporarily use ports `32101`, `32102`, `32103`, and `32104` and supply their own signing secrets. Login and refresh fixtures use unique emails; their users and sessions are removed after the test. The administrator login test removes only the session it creates.

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

Implementation details are recorded in [TASK-01 notes](../docs/implementation/TASK-01.md), [HU-01 notes](../docs/implementation/HU-01.md), [HU-02 notes](../docs/implementation/HU-02.md), and [HU-03 notes](../docs/implementation/HU-03.md).
