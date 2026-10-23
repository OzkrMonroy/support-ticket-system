# AGENTS.md — Support Ticket System

## Project context

This is a university final project: a technical support ticket management system.

The main objective is to deliver a functional application that satisfies the academic requirements within a limited development timeline.

**Prioritize simplicity, readability, and fast development over production-grade architecture.**

## Technology stack

- Frontend: Angular.
- Backend: Node.js with Express.
- Backend language: JavaScript with ECMAScript modules (`import` / `export`).
- Database: PostgreSQL.
- ORM: Prisma.
- Message broker: RabbitMQ.
- Version control: Git, with a single repository containing frontend, backend, documentation, and infrastructure.

Do not introduce TypeScript into the backend.

## General development rules

1. Implement only what the current task explicitly requests.
2. Prefer straightforward solutions over complex abstractions.
3. Do not introduce libraries, patterns, or additional architectural layers without a concrete need.
4. Keep functions and files small, readable, and easy to explain.
5. Follow the existing project structure and conventions.
6. Use English for filenames, variables, functions, classes, and code comments.
7. Avoid implementing speculative features or preparing infrastructure for requirements that have not been defined.
8. Do not refactor unrelated code.
9. Ask before making significant architectural decisions.

## Backend conventions

- Use `import` and `export`, not CommonJS.
- Configure `"type": "module"` in `package.json`.
- Use Express routes and controllers when appropriate.
- Access PostgreSQL through Prisma.
- Use `dotenv/config` and `process.env` for environment variables.
- Do not introduce Zod or another validation library solely for environment variables.
- Use services only when business logic justifies them.
- Avoid unnecessary repository patterns, factories, dependency injection containers, or complex error-handling frameworks.
- Use simple, consistent HTTP responses and status codes.

## Frontend conventions

- Use Angular standalone components.
- Use Reactive Forms for forms.
- Keep components focused on presentation and user interaction.
- Use Angular services for HTTP requests and shared application logic.
- Avoid unnecessary state-management libraries.
- Follow Angular's existing conventions and use built-in features where practical.

## Database conventions

- Define database models in Prisma.
- Use Prisma migrations to manage schema changes.
- Keep relationships and constraints understandable.
- Avoid unnecessary tables, fields, and indexes.
- Do not delete or reset existing database data without permission.

## Security essentials

- Never commit `.env` files containing real credentials.
- Include `.env.example` with placeholders and safe example values.
- Hash user passwords before storing them.
- Implement JWT authentication and role authorization when requested by the relevant task.
- Validate user input where necessary.
- Do not expose passwords, tokens, or sensitive configuration in API responses or logs.

## Testing

- Write tests for critical functionality and important business rules.
- Prefer a small number of meaningful tests over extensive testing infrastructure.
- Do not introduce complex mocks or test utilities without a clear benefit.
- Do not claim tests passed unless they were actually executed.

## Documentation

Maintain a clear `README.md` that explains:

- What the project does.
- Technologies used.
- Requirements for running the project.
- How to configure `.env`.
- How to start PostgreSQL, the backend, and the frontend.
- How to run Prisma migrations and seed scripts.
- How to execute available tests.

Write instructions for someone who is not familiar with the project's initial setup.

## Working with Codex

Before implementing a task:

1. Read this file and the task specification.
2. Inspect the existing project structure.
3. Present a brief implementation plan.
4. Identify any unnecessary complexity or unclear requirements.

During implementation:

1. Stay within the task's scope.
2. Prefer the simplest working implementation.
3. Do not add unrelated features.
4. Do not run destructive commands without permission.

After implementation:

1. Summarize what was implemented.
2. List created and modified files.
3. Report which tests or commands were executed.
4. Mention any known limitations or pending work.

Do not execute `git add`, `git commit`, or `git push` unless explicitly requested.

## Guiding principle

**Build what is needed now, in the simplest understandable way. Do not build for hypothetical future requirements.**

## Communication
Always communicate with me in Spanish.
Keep source code, filenames, identifiers, and technical documentation in English.

## Task Documentation

After completing each task or user story:

1. Create or update `docs/implementation/<TASK-ID>.md`
   (e.g., `TASK-01.md` or `HU-01.md`).
2. Briefly explain:
   - What was implemented.
   - Why the main technical decisions were made.
   - Which files are important and their purpose.
   - How the implementation was verified.
   - Any known limitations.
3. Update the corresponding README only when installation,
   configuration, or execution instructions change:
   - Backend changes: `backend/README.md`.
   - Frontend changes: `frontend/README.md`.
4. Do not create or update the root `README.md` unless explicitly requested.
5. Keep documentation concise, clear, and written in English.
6. Document only what was actually implemented. Do not invent
   functionality or test results.

## Git Commits

- Follow the Conventional Commits specification.
- Do not create commits without explicit user approval.
- Once a task is approved, create a commit when explicitly requested.
- Use a concise, descriptive commit message in English.
- Include only changes related to the approved task.
- Never push changes unless explicitly requested.