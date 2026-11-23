import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const execute = promisify(execFile);
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); reject(new Error("Cannot allocate test port.")); return; }
    server.close(() => resolve(address.port));
  });
});
const password = randomBytes(24).toString("hex");
const runtimePassword = randomBytes(24).toString("hex");
const dataRoot = path.resolve(".data");
const databaseDir = path.resolve(dataRoot, `test-postgres-${randomUUID()}`);
// The embedded server removes this directory on shutdown; constrain it before starting.
if (!databaseDir.startsWith(dataRoot + path.sep)) throw new Error("Unsafe test database path.");
const postgres = new EmbeddedPostgres({ databaseDir, user: "postgres", password, port, persistent: false,
  authMethod: "scram-sha-256", postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => undefined, onError: () => undefined });
let started = false;
try {
  await postgres.initialise();
  await postgres.start();
  started = true;
  const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  const result = await execute(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DIRECT_URL: adminUrl }, windowsHide: true,
  });
  console.log(result.stdout.replaceAll(password, "[redacted]"));
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    await client.query(`CREATE ROLE auth_runtime LOGIN PASSWORD '${runtimePassword}'`);
    await client.query("GRANT CONNECT ON DATABASE postgres TO auth_runtime; GRANT USAGE ON SCHEMA public TO auth_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO auth_runtime");
    await client.query("REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM auth_runtime");
    // Fixture creation is restricted to this disposable test database.
    const { createPrismaClient } = await import("../src/shared/infrastructure/database/prisma-client.js");
    const { createPasswordHasher } = await import("../src/modules/auth-users/infrastructure/security.js");
    const prisma = createPrismaClient(adminUrl);
    try {
      const passwords = await createPasswordHasher();
      const passwordHash = await passwords.hash("Test-password-2026!");
      const branchOne = await prisma.branch.create({ data: { code: "CN01", name: "Test branch one" } });
      const branchTwo = await prisma.branch.create({ data: { code: "CN02", name: "Test branch two" } });
      const warehouse = await prisma.warehouse.create({ data: { code: "CENTRAL", name: "Central warehouse" } });
      const branchWarehouse = await prisma.warehouse.create({ data: { code: "WH-CN01", name: "Branch warehouse", branchId: branchOne.id } });
      for (const [code, role, email, branchId, warehouseId] of [
        ["ADMIN", "ADMIN", "admin@example.test", null, null],
        ["ADMIN2", "ADMIN", "admin2@example.test", null, null],
        ["MANAGER1", "BRANCH_MANAGER", "manager1@example.test", branchOne.id, null],
        ["MANAGER2", "BRANCH_MANAGER", "manager2@example.test", branchTwo.id, null],
        ["POS1", "POS_STAFF", "pos1@example.test", branchOne.id, null],
        ["POS2", "POS_STAFF", "pos2@example.test", branchTwo.id, null],
        ["WAREHOUSE", "INVENTORY_STAFF", "warehouse@example.test", null, warehouse.id],
      ] as const) {
        await prisma.user.create({ data: { employeeCode: code, role, email, fullName: code, passwordHash,
          ...(branchId || warehouseId ? { assignments: { create: { branchId, warehouseId } } } : {}) } });
      }
      process.env.TEST_BRANCH_ONE = branchOne.id;
      process.env.TEST_BRANCH_TWO = branchTwo.id;
      process.env.TEST_BRANCH_WAREHOUSE = branchWarehouse.id;
    } finally { await prisma.$disconnect(); }
  } finally { await client.end(); }
  const test = await execute(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts"], {
    env: { ...process.env, TEST_DATABASE_URL: `postgresql://auth_runtime:${runtimePassword}@127.0.0.1:${port}/postgres`, TEST_ADMIN_DATABASE_URL: adminUrl },
    windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  console.log(test.stdout);
  if (test.stderr) console.error(test.stderr.replaceAll(password, "[redacted]").replaceAll(runtimePassword, "[redacted]"));
} catch (error) {
  if (error && typeof error === "object" && "stdout" in error) console.error(String(error.stdout).replaceAll(password, "[redacted]").replaceAll(runtimePassword, "[redacted]"));
  if (error && typeof error === "object" && "stderr" in error) console.error(String(error.stderr).replaceAll(password, "[redacted]").replaceAll(runtimePassword, "[redacted]"));
  console.error(error instanceof Error ? error.message.replaceAll(password, "[redacted]").replaceAll(runtimePassword, "[redacted]") : "Integration tests failed.");
  process.exitCode = 1;
} finally {
  if (started) await postgres.stop();
}
