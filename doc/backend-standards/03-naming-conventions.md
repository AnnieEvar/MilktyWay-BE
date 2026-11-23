# Naming Conventions — Code, API, and Database

Status: proposed shared backend context. Existing API contract v2 URLs take precedence over cosmetic renaming. Read alongside the [coding conventions](02-coding-conventions.md).

## 1. General principles

- Use English technical names that express business meaning. Keep shared engineering documentation in English; user-facing messages may be localized.
- Use one term consistently across DTOs, services, and the database. New backend code should not alternate between `store`, `shop`, and `branch` for the same concept.
- Avoid `data1`, `obj`, `temp`, `handleEverything`, or `commonService` when a meaningful business name exists.
- Familiar abbreviations such as `id`, `api`, `dto`, `otp`, `jwt`, and `url` are acceptable. Avoid inventing shortened application identifiers such as `usr`, `br`, or `qty` without a reason.
- Use full module names. Codes such as `AU`, `BR`, and `CA` support contract traceability rather than replacing descriptive variable names.

## 2. Directories and files

- Use **kebab-case** for directories/files: `auth-users/`, `user-access.policy.ts`, and `staff-assignment.repository.ts`.
- Use responsibility suffixes: `.routes.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, `.policy.ts`, `.presenter.ts`, and `.gateway.ts`.
- Prefix adapters with their technology when useful: `prisma-user.repository.ts`, `jwt-token.gateway.ts`, and `sms-otp.gateway.ts`.
- Name ports by their purpose: `user.repository.ts` and `password-hasher.ts`, rather than `IUserRepository.ts`.
- Name tests after the unit or behavior: `user-access.policy.test.ts`, `auth.integration.test.ts`, and `staff-login.e2e.test.ts`.
- Use `index.ts` for a module's public entry point, not a barrel in every small directory.
- Keep standard tool configuration names: `prisma.config.ts`, `tsconfig.json`, and `eslint.config.js`.

Files supporting one capability might be:

```text
http/users.controller.ts
http/users.schema.ts
application/users.service.ts
application/ports/user.repository.ts
domain/user-access.policy.ts
infrastructure/prisma-user.repository.ts
```

## 3. Variables, functions, and types

- Variables/functions/properties: `camelCase`, such as `refreshTokenHash`, `assignedBranchIds`, and `updateUserAccess`.
- Types/interfaces/classes: `PascalCase`, such as `AuthContext`, `UserRepository`, and `StaffAssignment`.
- Fixed configuration constants: `SCREAMING_SNAKE_CASE`, such as `MAX_OTP_ATTEMPTS`. Ordinary local values remain camelCase.
- Booleans use `is`, `has`, `can`, or `should`: `isLocked`, `hasActiveAssignment`, and `canManageUser`.
- Collections are plural (`users`, `assignments`); individual values are singular (`user`, `assignment`).
- Do not add `Async` by default; the `Promise` return type communicates asynchronous behavior.
- Include units where ambiguity is possible: `accessTokenTtlSeconds`, `timeoutMs`, and `amountVnd`.
- Keep acronym casing consistent: `userId`, `otpCode`, `databaseUrl`, `JwtClaims`, and `OtpChallenge`; do not mix `userID` with `userId`.

Distinguish function contracts:

- `findById` may return `null`.
- `getByIdOrThrow` raises a defined error when absent. Avoid giving `get` conflicting meanings in the same repository.
- `is...`/`can...` return booleans without side effects.
- `assert...` returns void on success and throws on violation.
- `create...` creates a new record/object.
- `update...` changes data; `revoke...` invalidates a session; `consume...` uses a one-time resource.
- `parse...` validates/converts external input; `to...Response` maps public DTOs.

Do not use `validateUser()` to mean password verification, role checks, status checks, and membership validation. Prefer explicit names such as `verifyPassword`, `assertActiveStaff`, and `assertCanManageUserAccess`.

## 4. DTOs, schemas, and error codes

- Name HTTP DTOs after actions: `LoginStaffRequest`, `LoginStaffResponse`, and `UpdateUserAccessRequest`.
- Application inputs use `LoginStaffInput` and `UpdateUserAccessInput`; pass `AuthContext` separately.
- Runtime schemas use `loginStaffSchema` and `updateUserAccessSchema`. Avoid confusing names distinguished only by casing.
- Use uppercase error codes with stable prefixes: `AUTH_INVALID_CREDENTIALS`, `AUTH_SESSION_REVOKED`, `AUTH_FORBIDDEN`, and `AU_ROLE_ESCALATION_FORBIDDEN`.
- Error classes end in `Error`: `ForbiddenError` and `ConflictError`. Frontends branch on `code`; people read `message`.

Use `AUTH_*` for shared authentication/session errors and `AU_*` for identity-management rules. Login messages must not disclose sensitive distinctions such as whether an email exists.

## 5. REST and JSON

- Base path: `/api/v1`. Use plural, kebab-case resources: `/users`, `/staff-assignments`, and `/cash-shifts`.
- Express route definitions may use `:id`; OpenAPI uses `{id}` as specified in the contract.
- Preserve agreed action URLs such as `/auth/login`, `/auth/refresh`, and `/orders/{id}/confirm`. Do not rename all endpoints merely to enforce a different REST style.
- JSON request/response fields use camelCase: `fullName`, `branchId`, `expiresAt`, and `pageSize`.
- Query parameters use camelCase, for example `?branchId=...&pageSize=20`. Allowlist sortable fields.
- Return timestamps as ISO 8601 UTC, for example `2026-11-23T14:00:00.000Z`; the UI converts them to Vietnam time. Date-only fields use `YYYY-MM-DD` and must not masquerade as timestamps.
- Canonical role/status values are uppercase. Localized UI labels do not belong in enums or error codes.

Do not change `/customers/...` to `/members/...` merely because there is no standalone Customer module. URLs name resources; ownership of the business capability may belong to AU, OR, or PM.

## 6. Prisma models and PostgreSQL

Recommended mapping: **singular PascalCase Prisma models with camelCase fields; plural snake_case SQL tables with snake_case columns**. Prisma separates these names through `@map` and `@@map`. [Prisma database mapping](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/database-mapping).

The following is a reduced naming example, not the complete authentication schema or an approved migration:

```prisma
enum StaffRole {
  ADMIN
  BRANCH_MANAGER
  POS_STAFF
  INVENTORY_STAFF

  @@map("staff_role")
}

model User {
  id           String    @id @default(uuid()) @map("user_id") @db.Uuid
  employeeCode String    @unique @map("employee_code")
  email        String    @unique
  fullName     String    @map("full_name")
  passwordHash String    @map("password_hash")
  role         StaffRole
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("users")
}
```

The complete schema must include status, relations, constraints, indexes, and tests. Physical names such as `user_id` preserve traceability to earlier database documents while code accesses `user.id`.

- Use business-specific physical primary keys such as `user_id`, `session_id`, and `assignment_id`. Foreign keys use the referenced primary key's name.
- Prisma relation fields use `user`, `branch`, and `assignments`; scalar foreign-key fields use `userId` and `branchId`.
- Prefer UUIDs for internal/public identifiers. Business codes such as `NV-POS-01` and `CN01` belong in `employeeCode`/`branchCode`. Do not interchange codes and IDs in routes.
- Do not convert UUIDs to numbers or infer ownership from sequence numbers. Hard-to-guess IDs do not replace authorization.
- Follow Prisma/PostgreSQL constraint naming: `users_email_key`, `staff_assignments_user_id_branch_id_idx`, and `staff_assignments_user_id_fkey`. Respect database name-length limits; customize only when clearer.
- Migration names describe actions: `add_staff_sessions` and `add_assignment_scope_index`. Retain Prisma's generated timestamp prefix and never edit applied migrations.
- Use `createdAt`, `updatedAt`, `revokedAt`, and `expiresAt` for timestamps; `startedAt`/`endedAt` describe assignment validity. Avoid a generic `date` field when a precise name is available.

## 7. MilktyWay glossary

- `User` / `Staff`: staff accounts exposed through `/users`. Distinguish the account from personnel profiles and assignments; do not add a duplicate `staff` table without a separate requirement.
- `Customer`: customer identity. `membershipStatus` indicates enrollment; `MEMBER` is an eligibility condition, not an additional sixth authorization role.
- `Branch`: a sales location. `Warehouse`: a central or assigned inventory location. A central-warehouse assignment does not imply chain-wide access.
- `PosTerminal`: a POS device/counter. `CashShift`: a selling shift associated with a branch/terminal. Avoid bare `shift` when it could mean an ingredient-delivery shift.
- `Product`: a menu item. `ProductVariant`: a size/variant. `OptionGroup`/`OptionValue`: sugar, ice, and topping choices.
- `Recipe`: a recipe. `InventoryItem`: an ingredient, prepared item, or packaging item. `StockLot`: a stock lot.
- `StockSupply`: central-to-branch ingredient supply. Do not name the new flow `StockTransfer` if that implies horizontal transfers between branches.
- `Order`: an order. `Payment`: a payment transaction. `Refund`: a refund transaction.
- `Promotion`: a campaign. `LoyaltyPolicy`: points/tier policy. `PointTransaction`: a points-ledger entry. Point redemption remains out of scope.

Canonical roles are `ADMIN`, `BRANCH_MANAGER`, `POS_STAFF`, `INVENTORY_STAFF`, and `CUSTOMER`. `StaffRole` includes only the four staff roles; customer principals use `CUSTOMER` with a separate membership state.

Map current frontend aliases at the integration adapter: `owner → ADMIN`, `manager → BRANCH_MANAGER`, `cashier → POS_STAFF`, and `warehouse → INVENTORY_STAFF`. Do not send legacy aliases as canonical API roles or persist them in the new database. The prototype's `barista` personnel label is not a login role in contract v2.
