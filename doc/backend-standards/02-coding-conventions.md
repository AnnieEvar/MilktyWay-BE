# Coding Conventions — Express + Prisma

Status: proposed for backend bootstrap and shared repository context. Read alongside the [architecture](01-backend-architecture.md) and [naming conventions](03-naming-conventions.md).

## 1. Language, formatting, and tools

- Prefer TypeScript with `strict: true`; consider `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` from the start.
- Use ESM consistently. Do not mix `require` and `import` in application source.
- For `tsc` output executed directly by Node.js, use `module: NodeNext`, `moduleResolution: NodeNext`, and `.js` extensions on relative imports in TypeScript source. Document different settings if using a bundler; do not copy bundler configuration into a plain Node.js runtime.
- Treat external HTTP/environment/JSON data as `unknown` and validate it. A cast such as `as SomeDto` is not validation. Do not hide data errors with `any` or non-null assertions.
- Prefer named exports. Use default exports only when required by a framework/configuration or a documented exception.
- Prettier baseline: two spaces, semicolons, double quotes, trailing commas, and a line width of 100. Let tooling handle formatting.
- Use ESLint + typescript-eslint for imports, promises, unused symbols, and restricted cross-layer imports. Let Prettier handle formatting without conflicting lint rules.
- Commit the lockfile and use `npm ci` in CI. Avoid multiple loggers, validators, or test runners for the same purpose.

TypeScript's `strict` option checks types; it does not validate runtime input. [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html).

If the team retains JavaScript, use `.js`, ESM, JSDoc for public contracts, the same linting conventions, and runtime validation. Agree on this before the first implementation to avoid maintaining parallel styles.

## 2. Functions, dependencies, and file size

- Give each function one clear purpose. Split independent business flows rather than imposing an arbitrary line limit.
- Use early returns for invalid cases and avoid deeply nested conditions.
- Default to `const`; keep intentional mutation local.
- Use an input object for several parameters or multiple booleans. Avoid calls such as `updateUser(id, true, false, true)`.
- Inject clocks, token generators, hashers, and repositories through factories. Domain/services must not fetch global singletons.
- Do not introduce shared utilities for similar-looking code with different business meanings.
- Comments explain intent, invariants, and trade-offs. Avoid comments that merely repeat code, and remove commented-out dead code.

An input type should communicate intent:

```ts
type UpdateUserAccessInput = {
  userId: string;
  role?: StaffRole;
  status?: "ACTIVE" | "LOCKED";
  reason: string;
};
```

Never treat a payload's `branchId`, `role`, or `actorId` as proof of the caller's authority. Obtain the actor from the authenticated session. The role above is **the proposed role for the target user**, which requires a separate policy check.

## 3. Routers, middleware, and controllers

General middleware order: request ID/logging → proxy/CORS/security configuration → body limits → route middleware → not-found handling → error handling. Protected routes authenticate and perform preliminary action checks before business operations. Validate input and enforce resource policies before accessing protected data. Login/OTP rate limiting also applies before a principal exists.

- Controllers handle HTTP coordination and should remain small; they do not query Prisma directly.
- Validate params, query strings, and bodies with dedicated schemas, for example Zod. Pass parsed DTOs into services; never spread `req.body` directly into database writes.
- Sensitive-operation schemas reject unknown fields such as `isAdmin`, `passwordHash`, or a `customerId` that the caller may not change.
- Do not use `Boolean(query.active)`: the string `"false"` becomes `true`. Parse booleans, numbers, and enums explicitly.
- Do not mutate `req.query` to store parsed values. Keep a local DTO or use typed `res.locals`.
- Send each response once. Do not call `next()` after sending a successful response.
- Register the four-argument error middleware after routes. If headers are already sent, delegate the error to the next handler.

Express 5 forwards rejections from returned async handlers/middleware to error handling. Callbacks, timers, and promises that are neither awaited nor returned still need explicit handling. Do not add an Express 4 wrapper merely out of habit. [Express 5 error handling](https://expressjs.com/en/5x/guide/error-handling/).

## 4. Validation and errors

The three validation boundaries serve different purposes:

1. **HTTP schema:** shape, length, format, enums, and pagination.
2. **Domain/application:** permissions, account state, scope, and invariants.
3. **Database:** unique constraints, foreign keys, check constraints, and atomic behavior under concurrency.

Proposed HTTP conventions:

- `200`: successful read/update; `201`: resource created; `204`: success without a response body.
- `400`: malformed syntax, unreadable JSON, or invalid protocol parameters.
- `401`: missing, invalid, or expired authentication/session.
- `403`: authenticated but not authorized for the action.
- `404`: resource does not exist or is outside the caller's visible resource set. Apply consistently to limit enumeration.
- `409`: uniqueness, state, or concurrent-operation conflict.
- `422`: parseable payload that violates the published input schema/conditions.
- `429`: rate limit exceeded; `500`: unexpected failure.

Do not represent errors as `200` with `{ success: false }`. Keep `code` stable for frontend handling; `message` may be localized. The following format is proposed and must be reflected in OpenAPI when DTOs are finalized:

```json
{
  "error": {
    "code": "AUTH_FORBIDDEN",
    "message": "You are not authorized to perform this action.",
    "requestId": "2d93aa44-b268-4414-8b38-b6918d4e7c79"
  }
}
```

Validation details contain field paths and reasons, not submitted passwords, OTPs, or tokens. Internal errors must not expose stack traces, SQL, database hosts, or raw Prisma error objects.

## 5. Response DTOs and pagination

- Use response allowlists and select required fields in repositories. Do not merely remove `passwordHash` and return every other database field.
- Do not expose `Prisma.UserGetPayload` as the default public API contract. Separate DTOs/presenters prevent database changes from accidentally changing API responses.
- Use a consistent envelope for ordinary JSON. Document file downloads and `204` responses as exceptions.

```json
{
  "data": [{ "id": "NV-POS-01", "fullName": "POS Staff", "role": "POS_STAFF" }],
  "meta": { "page": 1, "pageSize": 20, "total": 1 }
}
```

The sample ID comes from the frontend prototype. It does not mean display codes will be stored as UUID primary keys. Normalize identifiers according to the [naming conventions](03-naming-conventions.md).

- Initial proposal: page 1, page size 20, maximum page size 100. Allowlist sort fields and use a stable `id` tie-breaker.
- Apply branch/ownership scope within the database query before pagination/counting, rather than fetching all rows and filtering in JavaScript.
- Use cursor pagination for large or rapidly changing datasets and publish the corresponding contract.

## 6. Prisma and persistence

- Reuse one client/pool per process. Do not instantiate `PrismaClient` in controllers or repositories for each request.
- Inject the database client from the composition root. Transaction-bound repositories must use their bound `tx`.
- Make repository methods purposeful: `findActiveStaffByEmail`, `findVisibleUsers`, and `consumeRefreshToken`. Services should not pass arbitrary Prisma query objects through ports.
- Distinguish `null` from `undefined` according to PATCH semantics: an absent value is not necessarily a request to clear a field. Role/status cannot be set to `null` unless explicitly allowed.
- Never accidentally remove a branch restriction with `{ branchId: undefined }`. Represent scope explicitly as `CHAIN`, `BRANCH`, `WAREHOUSE`, or `SELF`; deny access when a valid scope cannot be resolved.
- Prefer Prisma APIs and parameterized queries. Keep raw SQL in repositories and never concatenate user input into SQL.
- Constraints must protect invariants under concurrency. Checking for existence before inserting does not prevent duplicates by itself.
- Do not retry validation or authorization failures. Bound transaction-conflict retries and keep external side effects outside retryable work.
- Generate migrations from development environments, not production. Follow the [database guide](04-database-prisma-supabase.md).

## 7. Logging, secrets, and configuration

- Use one structured JSON logger, for example Pino. Common fields include `requestId`, `event`, an optional `actorId`, `durationMs`, and `statusCode`.
- Redact `authorization`, `cookie`, `set-cookie`, passwords, OTPs, refresh tokens, and database URLs. Do not log complete authentication request bodies.
- Separate business audit records from technical logs: actor, target, before/after values, branch, reason, and timestamp. Never audit credentials.
- Ignore local `.env` files. `.env.example` contains placeholders only. Never use `VITE_*` for backend secrets.
- Read/validate environment variables in `config/env.ts`, rather than scattering `process.env` reads across the application. Pass typed configuration to adapters.
- Use an exact CORS origin allowlist; credentials cannot be combined with origin `*`. CORS does not replace authorization.
- Configure `trust proxy` for the real deployment topology. Enabling it indiscriminately can allow spoofed client addresses and incorrect rate-limit/cookie behavior.

Configure headers, input limits, cookies, and dependency hygiene for the actual application. [Express production security](https://expressjs.com/en/advanced/best-practice-security/) is guidance, not proof that installing middleware makes the application secure.

## 8. Testing and review criteria

Select one test runner, for example Vitest, and Supertest for HTTP tests. Domain unit tests should not require Express or a database. Repository/transaction integration tests use a separate PostgreSQL database; SQLite is not a substitute for PostgreSQL behavior.

Use behavior-oriented names such as `rejects when manager assigns ADMIN to branch staff`. Keep Arrange/Act/Assert clear, use minimal per-test fixtures, and inject the clock to test expiry without real-time waiting.

Authentication acceptance checks must include:

- Invalid credentials, locked accounts, invalid token issuer/audience/algorithm, and expiry.
- Logout, account locking, and role changes invalidating existing sessions.
- Refresh rotation, replay, and concurrent requests not consuming the same token twice.
- Rejection of cross-branch management, self-escalation, ADMIN assignment by a manager, and peer-manager modification.
- Customer A being unable to read/update customer B's profile by changing an ID or phone number.
- Full user/session/audit rollback if any access-update step fails.
- Consistent scope across list/count/export queries and credential-free responses.

The proposed CI sequence is format check → lint → typecheck → Prisma validate/generate → unit/integration tests → build. These are planned checks, not scripts already implemented in the backend. Review migration SQL, indexes, public errors, and data scope as well; coverage percentage alone does not establish correctness.

Use English commit messages with meaningful scopes, for example `feat(au): ...`, `fix(au): ...`, `docs(be): ...`, and `test(au): ...`.
