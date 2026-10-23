# TASK-03 — Project Documentation and Roadmap

## Objective

Create concise, accurate project documentation so a new developer or Codex session can understand the application, its current state, technical structure, and remaining work without relying on chat history.

This is a **documentation-only task**. Do not change application code, dependencies, database schema, or infrastructure.

## Sources and precedence

Before writing, inspect:

1. `AGENTS.md` for the team's established stack, conventions, and development constraints.
2. The actual repository structure, implemented source code, and `backend/prisma/schema.prisma` (including migrations).
3. Approved task specifications in `docs/tasks/` and implementation records in `docs/implementation/`.
4. `docs/requirements/project-requirements.pdf` for academic requirements **applicable to the selected project only**.

**Important context:** The university PDF presents multiple project proposals. The team has already chosen the **Technical Support Ticket Management System** and made its own technical decisions. Do not treat the PDF as authority to select a different project, replace the existing technology stack, or redesign implemented functionality.

Use the PDF to identify the academic requirements relevant to the selected ticket system. Use `AGENTS.md`, the actual code, and approved implementation records as the authority for existing technical decisions and completed work. Task specifications describe agreed scope but do not, by themselves, prove completion.

If an applicable academic requirement is not yet covered, record it as pending or proposed in the roadmap; do not implement it. If an academic requirement conflicts with an existing decision, document the discrepancy and report it to the user rather than silently changing the implementation. Do not invent requirements or import features from other proposals.

If the PDF is missing or unreadable, report that limitation and mark any unverified future scope as provisional. Clearly distinguish **implemented**, **specified**, and **proposed** work.

## Deliverables

### 1. `docs/PROJECT.md`

Include:
- A short description of the support ticket system and its academic purpose.
- Main user roles: `ADMIN`, `CLIENT`, and `TECHNICIAN`.
- Key expected capabilities, clearly distinguishing planned from implemented functionality.
- Technology stack and top-level repository layout.
- Links to `ROADMAP.md`, `ARCHITECTURE.md`, and relevant README files.

### 2. `docs/ROADMAP.md`

Include:
- A compact overview of epics, each with a purpose and status.
- User stories grouped under their epic, with IDs, short descriptions, and statuses.
- A separate section for technical tasks such as TASK-01 and TASK-02.
- Links to existing task specifications and implementation notes when available.
- A brief indication of the next planned work.

Use these statuses consistently: `Completed`, `In progress`, `Pending`, or `Proposed`.

The user has confirmed that EP-01 (Authentication and Authorization), HU-01 through HU-06, TASK-01, and TASK-02 were approved. Verify the repository documentation supports these records. Do not mark any other work completed without evidence and user approval.

For later epics, derive applicable academic scope from `docs/requirements/project-requirements.pdf` and reconcile it with the team’s existing decisions and specifications. Label unapproved or unverified epic breakdowns as `Proposed`; do not present them as approved. Do not create individual story specification files for future work in this task.

### 3. `docs/ARCHITECTURE.md`

Include:
- A concise overview of the current architecture, separating existing components from planned ones (such as Angular or RabbitMQ if not yet implemented).
- A simple Mermaid flowchart of the main components and their interactions.
- A simple Mermaid ER diagram based **strictly** on the current `backend/prisma/schema.prisma` (currently expected to include `User` and `RefreshSession`; verify first).
- A short explanation of backend folders and authentication/session flow, based on the actual code.
- A statement that `backend/prisma/schema.prisma` is the source of truth for database models.

Avoid detailed diagrams for features not yet implemented. Keep Mermaid source editable in Markdown; no image exports are required.

## Documentation rules

- Write all documentation in English.
- Keep it concise and readable; avoid repeating full implementation details already covered by `docs/implementation/`.
- Use relative Markdown links where useful.
- Do not create a root `README.md`.
- Do not change `backend/README.md` or `frontend/README.md` unless necessary to correct a direct inconsistency introduced by these documents.
- Do not add documentation frameworks, generators, or new dependencies.
- Do not change task or user-story statuses to `Completed` merely because Codex implemented something; completion requires user approval.

## Acceptance criteria

- [ ] All three Markdown files exist in `docs/`.
- [ ] A newcomer can understand the purpose, roles, technology stack, and current progress.
- [ ] Roadmap separates approved completed work from proposed future work.
- [ ] Architecture and ER diagrams reflect the actual repository and Prisma schema.
- [ ] Relative links point to existing files where possible.
- [ ] No application code, dependencies, schema, or infrastructure changed.
- [ ] No root README was created.

## Verification and delivery

1. Review the generated documents against the inspected sources.
2. Check Markdown links and Mermaid syntax where practical.
3. Report the files created, any assumptions, missing or unreadable requirements documents, and any academic-versus-technical conflicts.
4. Provide a brief summary in Spanish, as required by `AGENTS.md`.
5. Do **not** create a Git commit or push changes.

After the user reviews and approves TASK-03, update `docs/ROADMAP.md` to mark TASK-03 completed and create a Conventional Commit only when explicitly requested.
