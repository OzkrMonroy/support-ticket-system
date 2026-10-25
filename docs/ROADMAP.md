# Roadmap

## Status and evidence

Statuses: `Completed` = explicitly approved and supported by repository records; `In progress` = work underway or awaiting approval; `Pending` = agreed work not yet delivered; `Proposed` = unapproved scope or breakdown.

TASK-03 confirms prior approval of EP-01, HU-01 through HU-06, TASK-01, and TASK-02. Their source code and implementation records support delivery. Historical verification results belong to those records; they were not rerun for this documentation task. HU-07 through HU-12 were subsequently tested and explicitly approved by the user. Remaining future IDs and story boundaries below are proposals, not approved specifications.

## Epics

| ID | Purpose | Status |
| --- | --- | --- |
| EP-01 | Authentication, authorization, and basic account administration (backend scope) | Completed |
| EP-02 | Complete ticket CRUD and define ticket access/workflow | Completed |
| EP-03 | Process at least two asynchronous jobs with RabbitMQ | Proposed |
| EP-04 | Build the Angular SPA and integrate API/job feedback | Proposed |
| EP-05 | Finish academic documentation, security review, and integrated demonstration | Proposed |

### EP-01: Authentication and Authorization

| Story | Description | Status | Evidence |
| --- | --- | --- | --- |
| [HU-01](tasks/HU-01.md) | Active-user login | Completed | [Implementation](implementation/HU-01.md) |
| [HU-02](tasks/HU-02.md) | Rotate refresh tokens and renew access | Completed | [Implementation](implementation/HU-02.md) |
| [HU-03](tasks/HU-03.md) | Revoke a refresh session on logout | Completed | [Implementation](implementation/HU-03.md) |
| [HU-04](tasks/HU-04.md) | Administrator creates client/technician accounts | Completed | [Implementation](implementation/HU-04.md) |
| [HU-05](tasks/HU-05.md) | Administrator lists/deactivates users; enforce active status | Completed | [Implementation](implementation/HU-05.md) |
| [HU-06](tasks/HU-06.md) | View own current profile | Completed | [Implementation](implementation/HU-06.md) |

Completion applies to the approved backend stories; Angular authentication screens remain proposed under EP-04. Registration compliance remains unresolved below.

### EP-02: Ticket Management

| Story | Description | Status | Evidence |
| --- | --- | --- | --- |
| [HU-07](tasks/HU-07.md) | Create support tickets | Completed | [Implementation](implementation/HU-07.md) |
| [HU-08](tasks/HU-08.md) | List tickets and view details with role-based visibility | Completed | [Implementation](implementation/HU-08.md) |
| [HU-09](tasks/HU-09.md) | Update tickets with role and state rules | Completed | [Implementation](implementation/HU-09.md) |
| [HU-10](tasks/HU-10.md) | Soft delete tickets | Completed | [Implementation](implementation/HU-10.md) |

Basis: full CRUD of the chosen entity (PDF pages 1-2); clients, tickets, and technicians (page 5). HU-07 defines the approved creation fields and permissions; HU-08 defines approved read visibility. HU-09 specifies update permissions and transitions; its implementation is user-approved. HU-10 specifies soft deletion; its implementation is tested and user-approved. EP-02 is complete with HU-07 through HU-10 approved. A status board is an optional proposal, not part of the approved baseline.

### EP-03: Asynchronous Processing

| Story | Description | Status | Evidence |
| --- | --- | --- | --- |
| [HU-11](tasks/HU-11.md) | Automatically assign tickets according to priority | Completed | [Implementation](implementation/HU-11.md) |
| [HU-12](tasks/HU-12.md) | Asynchronous Gmail SMTP ticket notifications | Completed | [Implementation](implementation/HU-12.md) |
| HU-13 | Expose job status and demonstrate retries and failure handling | Proposed | — |

Basis: the two ticket-specific job ideas on PDF page 5 and queue/frontend/rubric requirements on pages 1-2. RabbitMQ is the team's chosen broker. HU-11 implements a separate assignment worker, least-load selection, native queue priorities, and bounded rejection; it is tested and user-approved. HU-12 notification delivery is tested and user-approved. Generalized retries and job-state storage/API remain future scope.

### EP-04: Angular SPA

| Story | Description | Status | Evidence |
| --- | --- | --- | --- |
| HU-14 | Integrate login, refresh/logout, profile, and role-aware navigation | Proposed | — |
| HU-15 | Provide validated ticket CRUD forms/views and action feedback | Proposed | — |
| HU-16 | Display asynchronous job status and results | Proposed | — |
| HU-17 | Provide administrator account-management screens | Proposed | — |

Use standalone components, Reactive Forms, and HTTP services per AGENTS.md. Academic SPA requirements are on PDF pages 1-2; precise screens and token handling require specification. Account-management screens are proposed integration of existing backend capabilities.

### EP-05: Academic Delivery

| Story | Description | Status | Evidence |
| --- | --- | --- | --- |
| HU-18 | Complete architecture submission, technical/user manuals, and screenshots | Proposed | — |
| HU-19 | Document actual team responsibilities/collaboration and rehearse integrated demo | Proposed | — |
| HU-20 | Review security middleware and validate end-to-end academic acceptance | Proposed | — |

PDF pages 2-4 require security middleware, collaboration evidence, a maximum 10-page architecture document (including cover/team/course/date, ER/auth/queue flows and security), installation/API/worker documentation, a user manual, and a maximum 10-minute presentation. Team member names and assignments are not recorded; do not invent them. Delivery: October 31, 2026, in person.

## Technical tasks

| Task | Description | Status | Evidence |
| --- | --- | --- | --- |
| [TASK-01](tasks/TASK-01.md) | Backend foundation, PostgreSQL, Prisma migration, administrator seed | Completed | [Implementation](implementation/TASK-01.md) |
| [TASK-02](tasks/TASK-02.md) | Zod request validation and consistent field errors | Completed | [Implementation](implementation/TASK-02.md) |
| [TASK-03](tasks/TASK-03.md) | Project overview, roadmap, current architecture | Completed | [Implementation](implementation/TASK-03.md); user-approved finalization |
| [TASK-04](tasks/TASK-04.md) | Disclose inactive login status only after password verification | Completed | [Implementation](implementation/TASK-04.md); user-approved |

## Gaps and next work

1. Clarify registration compliance: the PDF requires registration/demo, but approved HU-04 provides administrator-created accounts and excludes public registration. Keep EP-01 approved; record any additional agreed scope separately.
2. Specify generalized job visibility/retries and Angular integration. EP-02 (HU-07 through HU-10) is tested and approved; HU-11 and HU-12 are also tested and approved; subsequent proposed IDs are not approved tasks.
3. Plan final manuals, security review, collaboration evidence, and demonstration against the [PDF](requirements/project-requirements.pdf).

No conflict was found between the selected stack and the PDF's suggested alternatives. Existing CORS, password hashing, JWT checks, and request validation cover part of basic security; Helmet or an equivalent security-header policy is not present and requires review.
