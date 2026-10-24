# TASK-04 — Improve Inactive Account Login Feedback

Status: Completed; explicitly tested and approved by the user.

## Changes and rationale

Login now verifies the bcrypt password before checking active status. Unknown emails and incorrect passwords, including passwords for inactive accounts, retain HTTP 401 with `{"message":"Invalid credentials."}`. An inactive account with a correct password receives HTTP 403 with `{"message":"Your account has been deactivated. Contact an administrator."}`.

Both rejection paths return before token issuance and refresh-session creation. Successful login, request validation, refresh, logout, and role checks remain unchanged. The existing controller and dependencies are sufficient; no new abstraction or schema change was needed.

## Important files

- `backend/src/controllers/auth.controller.js`: password verification followed by the inactive-account response.
- `backend/tests/login.test.js`: exact rejection responses, inactive incorrect-password coverage, and unchanged refresh-session counts after rejected logins; existing active-role success checks retained.
- `backend/tests/users.test.js`: updated the post-deactivation login expectation while retaining refresh and protected-route rejection checks.
- `backend/README.md`: corrected the documented login response behavior.
- `docs/ARCHITECTURE.md`: corrected the login verification sequence and rejection behavior.
- `docs/ROADMAP.md`: records TASK-04 as Completed following user approval.

## Verification

- Reviewed authentication controller, routes, middleware, validation schema, login/refresh/logout and user-management tests, and HU-01, HU-02, and HU-05 implementation records.
- `npm test --prefix backend`: the initial sandbox attempt failed because local PostgreSQL and HTTP connections were unavailable (`EPERM` on HTTP connections).
- Repeated `npm test --prefix backend` outside the sandbox: **35 passed, 0 failed**. This includes login acceptance cases, validation, refresh rotation, logout, role checks, deactivation, health/seed, and ticket regression tests.
- `git diff --check`: passed.

Tests used the configured PostgreSQL database and existing fixture cleanup. No database reset or dependency change was performed. The user subsequently approved TASK-04 and requested the commit `fix(auth): clarify login errors for deactivated accounts`. No push was requested.

## Limitations

This task changes only login feedback. Inactive accounts still receive generic 401 responses for refresh and protected routes. No frontend changes or manual UI verification were performed.
