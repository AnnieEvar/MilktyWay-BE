# BR API — Branches, POS Terminals, and Cash Shifts

Base URL: `/api/v1`. This is a basic implementation for the project demo. JSON responses use `{ "data": ... }`; lists also return `meta` with `page`, `pageSize`, and `total`. List defaults are page 1 and page size 20, with a maximum page size of 100.

Protected requests require `Authorization: Bearer ACCESS_TOKEN` from AU login. Every write also requires an allowlisted `Origin` and `X-Requested-With: MilktyWay`, matching the AU browser configuration. IDs are UUIDs. Codes are trimmed and converted to uppercase. All cash amounts are integer VND between 0 and 2,000,000,000.

## Branches

- `GET /branches`: public active branches and active delivery zones. Supports `page`, `pageSize`, and `includeInactive=false`. An authenticated ADMIN may pass `includeInactive=true` to see all branches and zones.
- `POST /branches`: ADMIN creates a branch. Required fields: `code`, `name`. Optional fields: `address` (default empty), `phone` (Vietnamese ten-digit number or null), `operatingHours` (free-text schedule), `isActive` (default true), `acceptsOnline` (default true), and `maxPendingOnline` (default 20, range 1–10,000).
- `PATCH /branches/{id}`: ADMIN updates any of those fields. Omitted fields keep their current values. An open cash shift prevents branch deactivation; close its shifts first.
- `PUT /branches/{id}/delivery-zones`: ADMIN replaces the entire zone list. Body: `{ "zones": [{ "name": "Ward 1", "areaCode": "WARD-1", "feeVnd": 15000, "isActive": true }] }`. `feeVnd` defaults to 0 and `isActive` to true. An empty list clears the zones. Area codes must be unique within a branch.

Example create request:

```json
{
  "code": "CN03",
  "name": "MilktyWay District 3",
  "address": "123 Demo Street",
  "operatingHours": "08:00–22:00",
  "acceptsOnline": true
}
```

`acceptsOnline` and `maxPendingOnline` store configuration for later ordering integration; this module does not accept or route orders.

## POS terminals

- `GET /pos-terminals?branchId=UUID`: ADMIN sees a branch's terminals; BRANCH_MANAGER sees assigned branches; POS_STAFF sees assigned terminals. Also supports `page` and `pageSize`.
- `POST /pos-terminals`: BRANCH_MANAGER creates a terminal in an assigned active branch. Body: `{ "branchId": "UUID", "code": "POS-01" }`. The code must be unique within that branch. Creation is manager-only, consistent with the existing AU permission map.

A POS assignment with a branch but no terminal restriction permits all terminals in that branch. AU staff assignments can narrow access to a specific terminal.

## Cash shifts

- `GET /cash-shifts?branchId=UUID`: ADMIN, assigned BRANCH_MANAGER, or assigned POS_STAFF. POS terminal restrictions apply to rows and totals. Supports `page`, `pageSize`, and optional `status=OPEN` or `status=CLOSED`.
- `POST /cash-shifts/open`: assigned BRANCH_MANAGER only. Body: `{ "terminalId": "UUID", "openingCashVnd": 500000 }`. The terminal and branch must be active. The database permits only one open shift per terminal.
- `POST /cash-shifts/{id}/close`: assigned BRANCH_MANAGER or POS_STAFF assigned to that terminal. Body: `{ "closingCashVnd": 750000, "note": "End of demo shift" }`. The note is optional. Already closed shifts return 409. A new shift can open after closure.
- `GET /cash-shifts/{id}/summary`: ADMIN or assigned BRANCH_MANAGER. Returns shift identifiers, OPEN/CLOSED status, opening/closing staff IDs, timestamps, recorded opening/closing cash, and the closing note.

The authenticated session supplies the opening/closing staff identity. Payloads cannot choose it. Opening and closing cash are recorded counts; they do not calculate sales or reconcile expected cash. Payment totals, unresolved-payment checks, inventory handover, and discrepancy approvals require later OR/PA/IN integration.

## Errors and setup

Common statuses: 401 for missing/invalid sessions, 403 for denied roles/scopes, 404 for missing resources, 409 for duplicate codes/open shifts or invalid state transitions, and 422 for invalid payloads. Errors use the existing `{ "error": { "code", "message", "requestId" } }` format.

The migration `202611280001_add_branch_operations` adds branch settings, delivery zones, cash shifts, and their constraints. Apply it to the development database with `npm run db:deploy`; run `npm run db:generate` after schema changes. Existing branch/terminal IDs and AU assignments remain valid. Provision migration-created tables to the runtime database role using the same grant strategy as AU.

`npm run test:integration` creates a disposable PostgreSQL database, applies migrations, grants a restricted runtime role, and exercises the AU/BR APIs. It does not migrate the configured application database.
