import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generate/validate/build must not require a production migration credential.
  datasource: { url: process.env.DIRECT_URL ?? "postgresql://localhost:5432/milktyway" },
});
