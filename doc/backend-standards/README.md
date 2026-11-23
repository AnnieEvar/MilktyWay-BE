# MilktyWay — Backend Foundation Proposal

Prepared: **23 November 2026**. Status: **proposed for team agreement before implementation**.

This documentation lives in `doc/backend-standards/` within the `MilktyWay-BE` repository. Documents 01–04 provide shared context for backend design, implementation, and review. This documentation change does not bootstrap the application, install packages, run migrations, or connect to a database.

Personal notes, plans, and progress tracking belong in `doc/.me/`, which is excluded from version control through `.gitignore`. Personal notes do not override shared decisions documented here.

## 1. Confirmed constraints

- The backend uses **Express.js + Prisma ORM**.
- The database may use **PostgreSQL hosted by Supabase**.
- The architecture should be a **monolith with explicit layers**.
- The next implementation priority is **authentication and authorization**; detailed Order/Payment state-machine design is deferred.
- Work stays on the existing branch.

TypeScript, dependency major versions, supporting libraries, token design, and Supabase configuration described here are **recommendations**, rather than previously approved team decisions.

## 2. Recommended direction

**Use a modular monolith organized by business capability, with HTTP, application, domain, and persistence responsibilities inside each module.** Deploy one Express application backed by one PostgreSQL database and one migration history. Do not turn the eight modules into independently deployed HTTP services at this stage.

- Preserve the eight contract modules: `auth-users`, `branch`, `catalog`, `inventory`, `order`, `payment`, `promotion`, and `reporting`.
- Prefer **TypeScript strict mode + ESM** for generated Prisma types and DTO checks. If the team keeps JavaScript, retain the architecture and naming rules, using ESM, ESLint, and JSDoc for public contracts.
- Prefer Express 5 for a new application. Use a supported Node.js LTS version consistently across development and CI; Node.js 24 is one candidate, subject to compatibility with the selected Prisma major. [Node.js releases](https://nodejs.org/en/about/previous-releases), [Prisma 7 requirements](https://www.prisma.io/docs/orm/v7/reference/system-requirements).
- Pin the Prisma major and commit the lockfile during bootstrap. **Database configuration examples in these documents use Prisma 7 APIs**; this does not claim that Prisma 7 is the newest major. Do not mix Prisma 6/7/8 configuration. If another major is selected, update the examples and verify adapter and migration behavior first.
- Initially use Supabase as PostgreSQL hosting. **Supabase Database and Supabase Auth are separate choices**; using the database does not select Supabase Auth as the identity provider.
- Use Prisma migrations as the application schema's source of truth. Separate runtime database privileges from migration privileges.
- Authenticate requests on the backend and authorize both the action and its data scope. Frontend permission checks control the interface, not server access.

## 3. Reading order

1. [Layered monolith architecture](01-backend-architecture.md): module boundaries, layer responsibilities, dependency rules, transactions, and the proposed directory structure.
2. [Coding conventions](02-coding-conventions.md): TypeScript/JavaScript, Express, Prisma, validation, errors, logging, tests, and review criteria.
3. [Naming conventions](03-naming-conventions.md): files, identifiers, DTOs, REST APIs, Prisma models, database objects, and the project glossary.
4. [PostgreSQL, Prisma, and Supabase](04-database-prisma-supabase.md): connection modes, version-specific configuration, migrations, database privileges, and RLS.

## 4. Inputs and references

Business inputs:

- The supplied `API_Contract_Tong_Quan_8_Modules_v2.md`, proposed on 18 November 2026, lists 90 APIs. It is a business input, not evidence that those APIs are implemented.
- Earlier documents in [doc](../), especially [API v0.1](../04_API_Contract.md) and [database v0.1](../03_DB_Du_lieu.md), contain legacy names such as `OWNER`, `CASHIER`, and CR/SY modules. Those names do not define the new standard.
- Authentication in the related frontend repositories (`Milkty-Way-FrontEnd/src/utils/auth.ts` and `MilktyWay-Customer-FE/src/customer/MockOtpStep.tsx`) is currently simulated in the browser and must be replaced during backend integration. These paths belong to the frontend repositories, not this repository.

Primary technical references:

- [Node.js Best Practices — component boundaries](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/breakintcomponents.md) and [layering within components](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/createlayers.md): organizational guidance, not a requirement to copy an entire starter or every library recommendation.
- [The Express + Prisma example maintained by Prisma](https://github.com/prisma/prisma-examples/tree/latest/orm/express): ORM/HTTP integration guidance. A getting-started example does not replace MilktyWay's authorization or operational design.
- Official Express, Prisma, Supabase, and OWASP documentation is linked alongside the relevant topics.

The four responsibilities and MilktyWay-specific policies are **a project-specific proposal**. They are neither an Express-mandated directory structure nor a direct copy of the references above.

## 5. Decisions to finalize before implementation

- JavaScript or TypeScript; exact Node.js, Express, Prisma, and Supabase PostgreSQL versions.
- A long-running Express process/container or serverless deployment, including IPv6 availability.
- Supabase Database only, or an explicit decision to add Auth/Storage.
- Deployment domains for both frontends and the API, which determine cookie, CORS, and CSRF configuration.
- The real OTP delivery provider and an explicitly enabled development/test adapter.
- Staff provisioning: start with internal provisioning. Any new account-creation or password-change/reset endpoints must be added to the API contract. The current AU contract does not cover all registration and password-recovery screens in the frontend prototype.

These decisions do not prevent agreement on architecture and conventions. Finalize them before configuring the runtime or enabling real authentication.
