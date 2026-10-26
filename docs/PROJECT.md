# Support Ticket System

A university final project for managing technical support tickets for the fictional company Galacticos S.A. The goal is a functional web application with a separate SPA and REST backend, secure authentication, and asynchronous processing.

## Roles and capabilities

| Role | Implemented | Planned business capabilities (proposed) |
| --- | --- | --- |
| `ADMIN` | Login, refresh, logout, own profile; create CLIENT/TECHNICIAN accounts, list users, deactivate other users | Ticket oversight; exact permissions require approval |
| `CLIENT` | Login, refresh, logout, own profile | Submit and follow support tickets; exact permissions require approval |
| `TECHNICIAN` | Login, refresh, logout, own profile | Work on assigned tickets; exact permissions require approval |

The backend also implements a health endpoint, active-account checks, password hashing, request validation, and persistent refresh sessions. EP-01 (HU-01 through HU-06), TASK-01, and TASK-02 are approved. Their specifications and implementation records are linked in the [roadmap](ROADMAP.md).

Ticket creation is implemented for active CLIENT and ADMIN accounts under the approved HU-07 scope. Ticket listing and details are implemented under the approved HU-08 scope, with ADMIN/all, CLIENT/created, and TECHNICIAN/assigned visibility. Ticket updates and status transitions are implemented under the approved HU-09 scope. Ticket soft deletion is implemented under the tested and approved HU-10 scope. EP-02 (backend ticket CRUD) is completed and user-approved. RabbitMQ priority-based automatic assignment is implemented under the tested and user-approved HU-11. HU-12 Gmail SMTP notifications are tested and user-approved; HU-13 durable job tracking, retries and recovery are tested and user-approved, completing EP-03; the Angular interface remains unimplemented. The academic baseline requires at least two asynchronous jobs, retries/failure handling, validated SPA forms, navigation, action feedback, and visible job status. The ticket board is an optional idea in the requirements, not an approved feature.

## Technology and repository

- Existing: Node.js/Express, JavaScript ESM, PostgreSQL 17, Prisma 6.19.3, JWT access tokens, opaque refresh tokens, bcryptjs, Zod request validation, dotenv, CORS, Nodemailer Gmail SMTP, and Node's built-in test runner.
- Established choices awaiting implementation: Angular (standalone components, Reactive Forms). RabbitMQ and a separate assignment worker now exist; no frontend exists yet.
- Git monorepo; prioritize simple, readable solutions within the academic timeline.

| Path | Contents |
| --- | --- |
| `backend/` | Express API, Prisma schema/migration, administrator seed, integration tests, setup README |
| `infrastructure/` | Docker Compose for PostgreSQL and RabbitMQ |
| `docs/tasks/` | Existing task and story specifications |
| `docs/implementation/` | Historical implementation and verification records |
| `docs/requirements/` | University requirements PDF |
| `AGENTS.md` | Team conventions and constraints |

A `frontend/` directory has not been created.

## Academic scope and open decisions

The [university requirements](requirements/project-requirements.pdf), pages 1-4, define the common requirements and deliverables; page 5, proposal 3, describes the selected ticket project. Other proposals are outside scope. Suggested alternative technologies do not replace the team's Angular/PostgreSQL/RabbitMQ choices.

The PDF requires registration and a registration demo. Existing approved scope provides administrator-created accounts and excludes public registration. Whether this satisfies the academic registration requirement needs clarification; no public registration is implemented or approved.

Delivery is October 31, 2026, in person, with a presentation of at most 10 minutes. Required final artifacts include an architecture document (maximum 10 pages), technical manual, user manual, role/responsibility evidence, and a working demonstration. These repository documents are a development baseline, not the complete academic submission.

See the [roadmap](ROADMAP.md) for approved progress and proposed work, [architecture](ARCHITECTURE.md) for the current structure, and [backend README](../backend/README.md) for setup and execution. There is no frontend README yet.
