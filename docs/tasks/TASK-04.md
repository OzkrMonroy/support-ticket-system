# TASK-04 — Improve Inactive Account Login Feedback

## Objective

Make the login response distinguish a deactivated account **only after the supplied password has been verified**, without revealing account status to someone who merely knows an email address.

## Context

The current `POST /api/auth/login` returns `401` with `{"message":"Invalid credentials."}` for invalid credentials and inactive users. Users with valid credentials for a deactivated account need a clearer explanation.

## Scope

1. Inspect `AGENTS.md`, the current authentication controller/routes, existing tests, and the relevant implementation documentation before editing.
2. Keep the existing login request and successful response unchanged.
3. For a nonexistent email or incorrect password (including an incorrect password for an inactive account), return HTTP `401` with:
   ```json
   { "message": "Invalid credentials." }
   ```
4. For an **inactive account with a correct password**, return HTTP `403` with:
   ```json
   { "message": "Your account has been deactivated. Contact an administrator." }
   ```
5. Verify the password **before** disclosing the inactive status. Do not issue tokens or create refresh sessions when login is rejected.
6. Preserve all other authentication behavior, including request validation, active-user login, refresh, logout, and existing role checks. Keep the implementation straightforward; no new libraries or abstractions.

## Tests and acceptance criteria

- Active account + correct password: existing successful login behavior is unchanged.
- Active account + incorrect password: `401` with the generic message.
- Inactive account + correct password: `403` with the deactivation message, no tokens/session created.
- Inactive account + incorrect password: `401` with the generic message; do not reveal inactive status.
- Unknown email: `401` with the generic message.
- Existing authentication tests continue to pass. Report actual test commands and results; do not claim unexecuted checks.

## Documentation and boundaries

- Create or update `docs/implementation/TASK-04.md` with changes, rationale, important files, verification, and limitations.
- Update `backend/README.md` only if its documented API behavior needs correction. Update `docs/ARCHITECTURE.md` only if the current authentication description becomes inaccurate.
- Keep `docs/ROADMAP.md` accurate, but **do not mark TASK-04 Completed until the user explicitly approves it**.
- Do not modify unrelated endpoints, frontend code, database schema, dependencies, or infrastructure.
- Do not create a Git commit or push changes without an explicit request.
