# TASK-02 — Standardize API Validation and Error Responses

## Goal
Use Zod to validate incoming API requests and return clear, consistent errors that the Angular frontend can display. Refactor only the existing endpoints. Keep the implementation small and easy to explain.

## Context and constraints
- Follow the root `AGENTS.md` and inspect the actual backend code before editing.
- Backend: JavaScript ESM, Express, Prisma. Do not introduce TypeScript.
- Use Zod **only for request validation**, not for environment variables.
- Preserve existing authentication, authorization, JWT generation, refresh-token rotation, and idempotent logout (`204 No Content`).
- Do not introduce custom error-class hierarchies, repositories, validation frameworks beyond Zod, or unrelated refactors.
- Preserve existing business rules, including password constraints and bcrypt's 72-byte UTF-8 limit. Do not invent new password requirements.

## Implementation scope

1. Install `zod` in `backend/`.
2. Add a small reusable validation middleware (for example `src/middlewares/validate.middleware.js`) that validates a specified request source (`body` or `params`) using `safeParse`.
3. Add focused Zod schemas (for example `src/schemas/auth.schema.js` and `src/schemas/user.schema.js`) for the existing request inputs:
   - `POST /api/auth/login`: email and password.
   - `POST /api/auth/refresh`: refresh token.
   - `POST /api/auth/logout`: refresh token.
   - `POST /api/users`: name, email, password, and permitted role.
   - `PATCH /api/users/:id/deactivate`: user ID path parameter (UUID, consistent with Prisma).
   - Do not add schemas to endpoints with no request inputs, such as `GET /api/users` and `GET /api/users/me`.
4. Remove redundant manual request-shape checks from controllers, but keep business validations and authorization checks where they belong.
5. Standardize request validation failures as HTTP `400`:

   ```json
   {
     "message": "Validation failed.",
     "errors": {
       "email": "Invalid email address.",
       "password": "Password is required."
     }
   }
   ```

   - `errors` maps field names to one concise, readable English message per field.
   - Use stable field names suitable for Angular forms; for path parameters, use the parameter name (for example `id`).
   - Do not return raw Zod issue objects, stack traces, submitted passwords, or tokens.
   - If multiple issues concern the same field, use the first meaningful message.
6. Keep non-validation error responses simple: `{ "message": "..." }`. Preserve the existing meaningful status codes (`401`, `403`, `404`, `409`, `500`) and avoid changing successful response bodies.
7. If there are inconsistent error messages within the affected endpoints, make them concise and understandable without changing their meaning or exposing whether sensitive credentials exist.

## Acceptance criteria
- Valid requests behave exactly as before, including response status and body.
- Invalid request fields return `400` with `message` and field-specific `errors`.
- Invalid UUID path parameters return a readable `400` response rather than an unexpected server error.
- Invalid login credentials still return `401` with a generic message, not field-validation details.
- Duplicate user email still returns `409` with a clear message.
- Unauthorized and forbidden requests retain `401` and `403` respectively.
- Logout with a syntactically valid but unknown/revoked refresh token still returns `204` (idempotent behavior).
- Refresh-token rotation still prevents reusing an old token.
- No sensitive values or internal stack traces appear in API errors.
- No Zod-based environment-variable parsing is introduced.

## Verification
Run existing tests and add or update only the tests necessary to cover:
- One successful request for each affected endpoint (or preserve existing equivalent tests).
- Invalid/missing fields, including an invalid email, role, and UUID.
- Password constraints already required by the application.
- Authentication and authorization error codes.
- Refresh rotation and logout behavior remain unchanged.

Manually verify at least:
1. `POST /api/auth/login` with a malformed email → `400` with `errors.email`.
2. `POST /api/auth/login` with well-formed but incorrect credentials → `401`.
3. `POST /api/users` with invalid fields → `400` with field-specific errors.
4. `POST /api/users` with an existing email → `409`.
5. `PATCH /api/users/not-a-uuid/deactivate` with admin authorization → `400` with `errors.id`.
6. Existing refresh and logout flows still work as before.

## Documentation and delivery
- Create `docs/implementation/TASK-02.md` following `AGENTS.md`: what changed, why, important files, verification performed, and known limitations.
- Update `backend/README.md` only if setup or execution instructions change. Do not create a root README.
- Report the modified files and actual test results in **Spanish**; keep code and documentation in **English**.
- Do not commit or push. Wait for explicit approval.
