# Database — PostgreSQL, Prisma, and Supabase

Status: proposed connection and database-management guidance for shared backend context. No Supabase project or credentials have been verified, no database has been created, and no SQL has been executed. Configuration snippets are examples to adapt during bootstrap.

## 1. Supabase's place in the architecture

```mermaid
flowchart LR
  FE[Both Frontends] --> API[Express API]
  API --> PRISMA[Prisma + PostgreSQL driver]
  PRISMA --> PG[(Supabase PostgreSQL)]
  CI[Migration job] -->|DIRECT_URL, migration role| PG
```

Initial recommendation: frontends access business data through Express. The backend uses Prisma to connect to PostgreSQL with a **database connection string**, not a Supabase REST URL or API key as its Prisma datasource.

Supabase also offers Auth, Storage, and Realtime. Using its database **does not require** those services. Add a separate media adapter if Storage is needed later. If Supabase Auth is selected, replace the identity adapter and explicitly decide ownership of credentials/sessions; do not maintain two parallel password systems.

Distinguish configuration values:

- `DATABASE_URL`: runtime SQL connection using a restricted application role.
- `DIRECT_URL`: Prisma CLI/migration connection using the required DDL privileges. The variable name is a convention; select its endpoint according to actual network access.
- Supabase project URL/publishable key/secret key: credentials for the corresponding SDK/Data API, not substitutes for a database password. A database-only architecture does not need those frontend keys to query business tables.

## 2. Choose the connection mode for the runtime

Supabase distinguishes direct connections, session pooling, and transaction pooling, with different IPv4/IPv6 capabilities. Copy the endpoint, username, and port from the project's **Connect** dialog rather than deriving a hostname from its region. [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Recommendations for MilktyWay:

- **Long-running Express process/container with suitable IPv6 connectivity:** prefer a direct connection.
- **IPv4-only development/deployment environment:** use the shared session pooler when the direct endpoint is unreachable.
- **Serverless/many short-lived instances:** consider transaction pooling after testing adapter compatibility and session-state limitations.
- **Migrations:** prefer direct connections. If direct connectivity is unavailable, verify session-pooler support for the CLI; transaction pooling is not the migration default.

Example URL shapes with placeholders only:

```dotenv
# Direct connections typically use a username without a project suffix.
DATABASE_URL="postgresql://app_runtime:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"

# Supply separate migration credentials only to migration jobs.
DIRECT_URL="postgresql://app_migrator:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
```

For shared pooling, custom-role usernames follow `ROLE.PROJECT_REF` according to project configuration. Session mode typically uses port `5432`; transaction mode typically uses `6543`. Changing the port alone does not establish that the endpoint and username are correct.

## 3. Connection pools and TLS

- Reuse one Prisma client/pool per process. Multiple replicas create multiple pools. Budget connections across replicas, jobs, and operational tools, leaving headroom within Supabase compute limits.
- Configure pool limits and timeouts through the **selected driver/adapter's API**. Do not assume legacy Prisma URL parameters configure newer driver-adapter pools.
- Start with a small pool and increase it based on measured waiting time and connection usage. No single pool size fits every Supabase plan.
- Enable TLS and validate certificates according to the project/driver configuration. The sample `sslmode=require` setting does not replace verifying how the driver handles certificate authorities and hostnames. Do not resolve production certificate errors by setting `rejectUnauthorized: false`.

Transaction pooling does not preserve session state between transactions. Check prepared-statement support against the pooler type/version and driver. Do not rely on persistent `SET` state to carry user identity. In particular, do not append `pgbouncer=true` indiscriminately: Prisma guidance distinguishes PgBouncer, Supavisor, and pooler versions. [Prisma 7 pooling guide](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/pgbouncer), [Supabase pooling](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).

If caller-aware RLS is added later, set context transaction-locally on the same connection and do not mix in the global client. That design needs pooler-specific tests, not just SQL policies.

## 4. Prisma 7 configuration example

**Version boundary:** this section uses Prisma 7, the `prisma-client` generator, and a PostgreSQL driver adapter. It is an illustrative baseline, not an upgrade instruction or a claim about the newest major. If another major is chosen, use its configuration, verify generated-client paths, and run a smoke test first.

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

`prisma.config.ts` for the CLI:

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
```

Separate CLI and runtime URLs according to the [Prisma 7 configuration reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference). Do not copy Prisma 6 datasource `directUrl` configuration and assume identical behavior in Prisma 7. CLI/build steps that load this configuration need the variables required by `env()`. Only supply migration secrets to jobs that need them; never embed them in frontend bundles or images.

`src/shared/infrastructure/database/prisma-client.ts` — minimal wiring example:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";

export function createPrismaClient(databaseUrl: string) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
```

The composition root/`server.ts` calls this factory **once** with the validated `DATABASE_URL`, then injects the client. Timeout, pool, and TLS CA settings are omitted because they depend on the chosen adapter/version and endpoint. Never use the migration URL for runtime requests merely because it connects successfully.

Keep `prisma`, `@prisma/client`, and `@prisma/adapter-pg` on compatible releases. Add the PostgreSQL driver and types required by the selected adapter/version. Generated code does not exist until `prisma generate` runs.

## 5. Schemas and database privileges

Initially use one consistent application schema, potentially `public` to minimize bootstrap configuration. Prisma migrations own application tables. Business migrations must not modify Supabase-managed schemas such as `auth` or `storage`.

Separate three credential purposes:

- **Runtime role:** database connection, schema usage, and required application-table DML privileges. No DDL, superuser privileges, `BYPASSRLS`, or schema/table ownership.
- **Migration role:** application-object creation/alteration in migration jobs, not API requests.
- **Administration:** Supabase/backup operational credentials, not application credentials.

When migrations create tables/sequences, ensure runtime grants/default privileges are configured for the **role that creates those objects**. Successful migrations can still leave the application unable to access new tables. Verify indexes, foreign keys, uniqueness, and append-only audit privileges with integration tests and actual database roles, not TypeScript descriptions alone.

If all business access goes through Express, prefer **disabling the Data API when no other feature needs it**, or restrict access through schema exposure and grants. Tables created through Prisma/SQL do not automatically have appropriate RLS. [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api).

## 6. RLS and Express authorization

Express/Prisma connects using a shared application database role. An application user's JWT **does not automatically become Supabase Auth context**, so `auth.uid()` does not automatically identify that user.

Recommended baseline: application policies and scoped repository queries enforce role, branch, warehouse, and ownership permissions. Frontends do not query business tables through the Data API. Add RLS as defense in depth after designing caller context explicitly.

If the Data API remains enabled for tables in exposed schemas, review grants and enable suitable RLS/policies for accessing roles. Do not add `USING (true)` simply to fix access errors. Policy enforcement depends on ownership and bypass privileges; privileged credentials may bypass RLS. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Do not enable RLS everywhere without runtime-role policies and expect Prisma access to remain unchanged. Design grants, RLS, roles, and context propagation together. Test with actual runtime credentials, not only a privileged SQL Editor session.

## 7. Migrations and environments

**Prisma migrations are the single owner of the application schema history.** Add SQL to migrations for check constraints, partial unique indexes, RLS, or grants that Prisma's schema cannot fully express. Do not maintain competing Prisma and Supabase migration histories for the same application tables.

Recommended workflow:

1. Develop against a separate PostgreSQL database on the target supported major. Configure a separate shadow database if database-creation privileges are restricted.
2. Modify the schema and run `prisma migrate dev --name ...` in development. Use `--create-only` when SQL needs review/editing before application.
3. Review SQL, constraints/indexes, grants, and data-loss risks. Commit schema and migrations together with the related code.
4. In CI, create a clean test database, apply migrations, generate the client, and run integration tests.
5. Run one `prisma migrate deploy` job for staging/production, then roll out the built application. For significant schema/code changes, use expand → migrate data → contract across deployments.
6. Prepare backups and a roll-forward plan before destructive changes. A database reset is not a production rollback strategy.

`migrate dev/reset` are development commands. `migrate deploy` applies existing migrations; it does not generate the client or detect every form of schema drift. [Prisma migration workflow](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production).

Do not use `db push` to change populated staging/production schemas. Do not leave Dashboard schema changes disconnected from source control; reconcile necessary SQL hotfixes into verified migration history.

## 8. Foundation data and authentication bootstrap

- Separate development, test, staging, and production databases. Never run tests or demo seeds against production URLs.
- Make demo seeds repeatable using business keys. Do not hardcode production passwords or real OTPs in source.
- Provision the initial ADMIN through a one-time script/administrative flow using environment-supplied secrets and proper hashing. Public registration must not accept `role: ADMIN`.
- Store timezone-aware timestamps normalized to UTC. Define business-day/shift interpretation separately for Vietnam time.
- Store VND as integers with an explicit range. If using database `BigInt`, map values to contract-defined JSON strings or enforce safe numeric limits; never serialize BigInt directly. Use Decimal with an agreed scale for fractional inventory quantities instead of arbitrary floating-point arithmetic.
- Normalize email/phone consistently before unique lookups. Application logic and database constraints jointly prevent duplicates under concurrency.

## 9. Connection acceptance checks

- The runtime connects to the selected endpoint from the actual deployment environment and validates TLS as configured.
- The runtime role can perform required reads/writes but cannot create/drop tables or access unrelated sensitive schemas.
- Migration jobs use separate credentials, and newly deployed tables/indexes/grants work correctly.
- Transaction rollback and concurrent refresh behavior are verified through the selected pooler.
- The Data API cannot access tables outside the intended policy; verify using real low-privilege roles.
- Logs do not disclose URLs/passwords, and health endpoints do not dump configuration.

Supabase credentials are not needed to review this architecture. They are needed later when configuring and verifying a real connection.
