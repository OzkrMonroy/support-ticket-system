# Support Ticket System

University project for managing technical support tickets. This first task provides a minimal backend foundation using Node.js, Express, JavaScript ESM, PostgreSQL, and Prisma 6.19.3. Authentication, ticket operations, Angular, and RabbitMQ are pending later tasks.

## Prerequisites

- Node.js 24 LTS (recommended) and npm; `backend/package.json` declares Node.js `>=20.19`.
- Docker with Docker Compose (start Docker Desktop before continuing).
- Optional: TablePlus to inspect PostgreSQL.

Run the following commands from the repository root unless a step says otherwise.

## Environment configuration

```sh
cp backend/.env.example backend/.env
```

Edit `backend/.env` before starting. The example values are for local development only. Never commit this file.

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port, default `3000`. |
| `CORS_ORIGIN` | Allowed frontend origin, initially `http://localhost:4200`. |
| `DATABASE_URL` | Prisma connection URL. Its username, password, database, and host port must match the PostgreSQL settings below. URL-encode special characters in the URL password. |
| `POSTGRES_USER` | PostgreSQL account created when its data volume is initialized. |
| `POSTGRES_PASSWORD` | Password for that PostgreSQL account. |
| `POSTGRES_DB` | Database created on first initialization. |
| `POSTGRES_PORT` | Local port exposed by Docker, default `5432`. |
| `ADMIN_NAME` | Initial application administrator's name. |
| `ADMIN_EMAIL` | Initial application administrator's unique email. |
| `ADMIN_PASSWORD` | Application password, hashed by the seed; maximum 72 UTF-8 bytes. Replace the example value. |

The PostgreSQL credentials connect tools and Prisma to the database. The `ADMIN_*` values create an application user; they do not grant database access. The application does not yet implement login.

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
npm i
```

Keep this terminal in `backend/`. Generate Prisma Client, apply the included migration, and create the initial administrator in this order:

```sh
npm run prisma:generate
npm run prisma:deploy
npm run prisma:seed
```

The migration creates `User`, `RefreshSession`, and the role enum. The seed creates an active `ADMIN` with a bcrypt password hash. Repeating the seed leaves the existing administrator unchanged, including the password. It fails if the configured email belongs to another role. No authentication endpoints or refresh-token behavior are implemented yet.

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

## Connect with TablePlus

Create a PostgreSQL connection with host `localhost`, port from `POSTGRES_PORT`, user from `POSTGRES_USER`, password from `POSTGRES_PASSWORD`, and database from `POSTGRES_DB`. With unchanged example values, these are port `5432`, user `support_user`, password `local_password`, and database `support_tickets`. SSL is not required for this local container. Application administrator credentials do not belong in this connection.

## When to repeat Prisma commands

- `npm run prisma:generate`: after installing dependencies or changing the Prisma schema, to refresh Prisma Client.
- `npm run prisma:deploy`: on initial setup and after pulling new committed migrations. It applies pending migrations and does not create migration files.
- `npm run prisma:seed`: once after migration to create the administrator; safe to repeat, but it does not reset an existing administrator's credentials.
- For a future intentional schema change, run `npx prisma migrate dev --name descriptive_name` from `backend/`, inspect and retain the generated migration, then regenerate Prisma Client. Do not reset an existing database to resolve migration errors without reviewing the data impact.

## Checks

Two integration tests use Node's built-in test runner to verify the health endpoint and the administrator's password hash and seed idempotency. Start PostgreSQL, apply migrations, and configure `ADMIN_*` first. Tests use the configured database and leave the seeded administrator in place. The password in `.env` must match the seeded administrator; the HTTP test temporarily uses port `32101`.

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

Implementation decisions, important files, verification results, and limitations are recorded in [TASK-01 implementation notes](docs/implementation/TASK-01.md).
