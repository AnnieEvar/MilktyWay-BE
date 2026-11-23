import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";

export function createPrismaClient(databaseUrl: string, poolMax = 5) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: poolMax, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 }),
  });
}
