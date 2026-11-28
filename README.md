# MilktyWay-BE

## Backend context

Read [doc/backend-standards/README.md](doc/backend-standards/README.md) and documents 01–04 before designing, implementing, or reviewing backend changes. They cover the layered monolith architecture, coding conventions, naming conventions, and Prisma/PostgreSQL/Supabase integration.

Earlier business analysis documents are in `doc/`. Personal notes and progress tracking belong in `doc/.me/`, which is ignored by Git.

## Branch module

The BR module supports branches, delivery zones, POS terminals, and basic cash-shift opening/closing. See [the BR API guide](doc/branch-api.md) for requests and permissions.

After configuring the development database, apply the committed migrations with `npm run db:deploy` and generate the client with `npm run db:generate`. Run `npm run dev` to start the API, or `npm run test:integration` to exercise AU and BR against a disposable local PostgreSQL instance.

## Image storage

Cloudflare R2 image-storage preparation is documented in [the R2 guide](doc/r2-image-storage.md). Storage is disabled by default; enabling it requires the R2 variables in `.env.example`. The composition root exposes an optional `imageStorage` adapter for future module upload endpoints.
