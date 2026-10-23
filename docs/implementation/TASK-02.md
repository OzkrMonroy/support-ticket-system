# TASK-02 — API request validation

## Implementation and decisions

- Added Zod request schemas for login, refresh, logout, user creation, and the deactivation UUID parameter. Existing input-free endpoints are unchanged.
- Added a small `safeParse` middleware returning HTTP 400 with `{ message: "Validation failed.", errors: { field: "Readable message." } }`. Only the first issue per field is returned; submitted values and raw Zod issues are never included.
- Preserved the existing basic email format for user creation, name trimming, email trimming/lowercasing, permitted roles, nonblank passwords, and the 72-byte UTF-8 password limit. Login now validates email format but retains its existing nonblank password rule. Passwords and refresh tokens are not trimmed or transformed.
- UUID validation accepts the hexadecimal UUID representation supported by PostgreSQL without imposing a UUID version restriction.
- Authentication and administrator authorization run before protected request validation. Controllers retain business rules, duplicate-email handling, token rotation, and idempotent logout. Successful response bodies and meaningful non-validation status codes remain unchanged.
- No schema migration, environment parsing, new architectural layer, or setup command was required.

## Important files

- `backend/src/middleware/validate.middleware.js`: reusable body/params validation and field error formatting.
- `backend/src/schemas/auth.schema.js`: login and shared refresh/logout request schemas.
- `backend/src/schemas/user.schema.js`: user creation and UUID schemas.
- `backend/src/routes/auth.routes.js` and `user.routes.js`: validation placement.
- `backend/src/controllers/auth.controller.js` and `user.controller.js`: removed redundant request checks; business logic retained.
- `backend/package.json` and `package-lock.json`: Zod dependency.
- `backend/tests/login.test.js`, `refresh.test.js`, and `users.test.js`: field error expectations and malformed UUID coverage, alongside existing regression tests.

## Verification

- `npm install zod`: completed.
- Initial sandboxed `npm test` could not access local HTTP/PostgreSQL. Rerunning outside the sandbox passed all 27 tests (0 failures).
- The suite covers successful affected endpoints, missing/invalid fields, roles, ASCII and multibyte oversized passwords, authentication/authorization, duplicate email, deactivation, refresh rotation/concurrency, and idempotent logout.
- Separately executed HTTP checks against a temporary server: malformed login email returned 400 with `errors.email`; well-formed incorrect credentials returned 401; invalid user fields returned 400 with four field errors; duplicate user email returned 409; an administrator request with an invalid UUID returned 400 with `errors.id`; refresh rotated the token, rejected reuse, and logout returned 204 repeatedly and for an unknown token. Temporary user/session records were removed.

## Limitations

- Malformed JSON continues to return the existing `{ message: "Invalid JSON body." }` response because parsing fails before field validation.
- Validation checks request syntax; credential validity and database constraints remain controller responsibilities.
- Dependency installation reported three high-severity audit findings; dependency remediation is outside this task.
