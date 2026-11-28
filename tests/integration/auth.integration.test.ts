import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import request, { type Response } from "supertest";
import pino from "pino";
import { z } from "zod";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { createContainer } from "../../src/bootstrap/container.js";
import { createPrismaClient } from "../../src/shared/infrastructure/database/prisma-client.js";
import { createAuthService } from "../../src/modules/auth-users/application/auth.service.js";
import { createPrismaAuthRepository } from "../../src/modules/auth-users/infrastructure/prisma-auth.repository.js";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (!runtimeUrl || !adminUrl) throw new Error("Run npm run test:integration to create an isolated PostgreSQL instance.");
const runtime = createPrismaClient(runtimeUrl, 10);
const admin = createPrismaClient(adminUrl);
const origin = "http://localhost:1800";
const headers = { Origin: origin, "X-Requested-With": "MilktyWay" };
const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: runtimeUrl, ACCESS_TOKEN_SECRET: "a".repeat(64), OTP_HMAC_SECRET: "b".repeat(64), OTP_PROVIDER: "development" });
let now = new Date();
const mailbox = new Map<string, { code: string; phone: string }>();
let container: Awaited<ReturnType<typeof createContainer>>;
let app: ReturnType<typeof createApp>;
const credentialsSchema = z.object({ data: z.object({ accessToken: z.string(), csrfToken: z.string(), sessionKind: z.enum(["STAFF", "CUSTOMER"]) }) });
function credentials(response: Response) {
  const data = credentialsSchema.parse(response.body).data;
  const cookies: unknown = response.headers["set-cookie"];
  if (!Array.isArray(cookies) || typeof cookies[0] !== "string") throw new Error("Expected refresh cookie.");
  return { ...data, cookie: cookies[0].split(";")[0] ?? "" };
}
async function login(email = "admin@example.test") {
  const response = await request(app).post("/api/v1/auth/login").set(headers).send({ email, password: "Test-password-2026!" }).expect(200);
  return credentials(response);
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
async function user(email: string) {
  const record = await admin.user.findUniqueOrThrow({ where: { email } });
  return record;
}
async function otpSession(phone = "0900000001") {
  const challenge = await request(app).post("/api/v1/customers/otp/request").set(headers).send({ phone }).expect(202);
  const id: unknown = challenge.body.data.challengeId;
  if (typeof id !== "string") throw new Error("Expected challenge ID.");
  const message = mailbox.get(id);
  if (!message) throw new Error("Expected OTP delivery.");
  const response = await request(app).post("/api/v1/customers/otp/verify").set(headers).send({ challengeId: id, code: message.code }).expect(200);
  return { ...credentials(response), challengeId: id, code: message.code };
}

beforeAll(async () => {
  container = await createContainer(config, runtime, { clock: () => now, otp: { deliver: async (input) => { mailbox.set(input.challengeId, input); } } });
  app = createApp({ config, service: container.service, logger: pino({ enabled: false }), ready: async () => { await runtime.$queryRaw`SELECT 1`; } });
});
beforeEach(async () => {
  now = new Date(); mailbox.clear();
  await admin.refreshToken.deleteMany(); await admin.authSession.deleteMany();
  await admin.otpChallenge.deleteMany(); await admin.rateLimitBucket.deleteMany();
  await admin.staffAssignment.deleteMany();
  const branchOne = await admin.branch.findUniqueOrThrow({ where: { code: "CN01" } });
  const branchTwo = await admin.branch.findUniqueOrThrow({ where: { code: "CN02" } });
  const warehouse = await admin.warehouse.findUniqueOrThrow({ where: { code: "CENTRAL" } });
  const roles = { ADMIN: "ADMIN", ADMIN2: "ADMIN", MANAGER1: "BRANCH_MANAGER", MANAGER2: "BRANCH_MANAGER", POS1: "POS_STAFF", POS2: "POS_STAFF", WAREHOUSE: "INVENTORY_STAFF" } as const;
  for (const code of Object.keys(roles) as (keyof typeof roles)[]) {
    const staff = await admin.user.update({ where: { employeeCode: code }, data: { role: roles[code], status: "ACTIVE" } });
    const branchId = ["MANAGER1", "POS1"].includes(code) ? branchOne.id : ["MANAGER2", "POS2"].includes(code) ? branchTwo.id : null;
    if (branchId || code === "WAREHOUSE") await admin.staffAssignment.create({ data: { userId: staff.id, branchId, warehouseId: code === "WAREHOUSE" ? warehouse.id : null, startedAt: now } });
  }
});
afterAll(async () => { await runtime.$disconnect(); await admin.$disconnect(); });

describe("HTTP authentication against PostgreSQL", () => {
  it("requires bearer authentication, returns canonical scoped identity, and never exposes credentials", async () => {
    await request(app).get("/api/v1/auth/me").expect(401);
    await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer forged-admin-session").expect(401);
    const auth = await login("manager1@example.test");
    const response = await request(app).get("/api/v1/auth/me").set(bearer(auth.accessToken)).expect(200);
    expect(response.body.data.role).toBe("BRANCH_MANAGER");
    expect(response.body.data.scopes).toEqual([{ kind: "BRANCH", branchIds: [process.env.TEST_BRANCH_ONE] }]);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|csrfToken|tokenHash/);
    expect(response.headers["cache-control"]).toBe("no-store");
    const stored = await admin.refreshToken.findFirstOrThrow();
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenHash).not.toBe(auth.cookie.split("=")[1]);
  });
  it("normalizes email and rejects injected fields, invalid credentials, malformed JSON, and untrusted origins", async () => {
    await request(app).post("/api/v1/auth/login").set(headers).send({ email: " ADMIN@EXAMPLE.TEST ", password: "Test-password-2026!" }).expect(200);
    await request(app).post("/api/v1/auth/login").set(headers).send({ email: "admin@example.test", password: "wrong" }).expect(401);
    await request(app).post("/api/v1/auth/login").set(headers).send({ email: "admin@example.test", password: "Test-password-2026!", role: "ADMIN" }).expect(422);
    await request(app).post("/api/v1/auth/login").send({}).expect(403);
    await request(app).post("/api/v1/auth/login").set({ ...headers, Origin: "https://evil.example" }).send({}).expect(403);
    await request(app).post("/api/v1/auth/login").set(headers).set("Content-Type", "application/json").send('{"email":').expect(400);
    const response = await request(app).post("/api/v1/auth/login").set(headers).send({ password: "secret-value" }).expect(422);
    expect(JSON.stringify(response.body)).not.toContain("secret-value");
  });
  it("rotates refresh cookies, supports CSRF bootstrap, rejects missing CSRF, and commits replay revocation", async () => {
    const auth = await login();
    await request(app).post("/api/v1/auth/refresh").set(headers).set("Cookie", auth.cookie).send({ kind: "STAFF" }).expect(403);
    const csrf = await request(app).get("/api/v1/auth/csrf?kind=STAFF").set(headers).set("Cookie", auth.cookie).expect(200);
    expect(csrf.body.data.csrfToken).toBe(auth.csrfToken);
    const rotated = credentials(await request(app).post("/api/v1/auth/refresh").set(headers).set("Cookie", auth.cookie).set("X-CSRF-Token", auth.csrfToken).send({ kind: "STAFF" }).expect(200));
    expect(rotated.cookie).not.toBe(auth.cookie);
    await request(app).post("/api/v1/auth/refresh").set(headers).set("Cookie", auth.cookie).set("X-CSRF-Token", auth.csrfToken).send({ kind: "STAFF" }).expect(401);
    await request(app).get("/api/v1/auth/me").set(bearer(rotated.accessToken)).expect(401);
    expect((await admin.authSession.findFirstOrThrow()).revokedAt).not.toBeNull();
  });
  it("allows at most one concurrent refresh and revokes the replayed family", async () => {
    const auth = await login();
    const refresh = () => request(app).post("/api/v1/auth/refresh").set(headers).set("Cookie", auth.cookie).set("X-CSRF-Token", auth.csrfToken).send({ kind: "STAFF" });
    const responses = await Promise.all([refresh(), refresh()]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 401]);
    expect((await admin.authSession.findFirstOrThrow()).revokedAt).not.toBeNull();
  });
  it("logs out on the server, expires access/session credentials, and isolates staff/customer cookies", async () => {
    const auth = await login();
    const customer = await otpSession();
    expect(customer.cookie).toMatch(/^milktyway_customer_refresh=/);
    expect(auth.cookie).toMatch(/^milktyway_staff_refresh=/);
    await request(app).post("/api/v1/auth/logout").set(headers).set(bearer(auth.accessToken)).send({}).expect(204);
    await request(app).get("/api/v1/auth/me").set(bearer(auth.accessToken)).expect(401);
    await request(app).get("/api/v1/auth/me").set(bearer(customer.accessToken)).expect(200);
    now = new Date(now.getTime() + 901_000);
    await request(app).get("/api/v1/auth/me").set(bearer(customer.accessToken)).expect(401);
  });
  it("enforces persistent credential rate limits", async () => {
    for (let i = 0; i < 10; i += 1) await request(app).post("/api/v1/auth/login").set(headers).send({ email: "missing@example.test", password: "wrong" }).expect(401);
    const response = await request(app).post("/api/v1/auth/login").set(headers).send({ email: "missing@example.test", password: "wrong" }).expect(429);
    expect(response.headers["retry-after"]).toBeDefined();
    expect(await admin.rateLimitBucket.count()).toBeGreaterThan(0);
  });
});

describe("authorization and atomic staff management", () => {
  it("filters both user rows and totals by the manager's branch and denies POS/warehouse user administration", async () => {
    const manager = await login("manager1@example.test");
    const response = await request(app).get("/api/v1/users?pageSize=1").set(bearer(manager.accessToken)).expect(200);
    expect(response.body.meta.total).toBe(1); expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].email).toBe("pos1@example.test");
    for (const email of ["pos1@example.test", "warehouse@example.test"]) {
      const auth = await login(email);
      await request(app).get("/api/v1/users").set(bearer(auth.accessToken)).expect(403);
    }
  });
  it("rejects cross-branch writes, peer management, self-elevation, and granting ADMIN", async () => {
    const manager = await login("manager1@example.test");
    const pos = await user("pos1@example.test"); const other = await user("pos2@example.test"); const self = await user("manager1@example.test"); const peer = await user("manager2@example.test");
    const patch = (id: string, data: object) => request(app).patch(`/api/v1/users/${id}/access`).set(headers).set(bearer(manager.accessToken)).send({ reason: "Policy regression test", ...data });
    expect((await patch(other.id, { status: "LOCKED" })).status).toBe(404);
    expect((await patch(self.id, { role: "ADMIN" })).status).toBe(403);
    expect((await patch(peer.id, { status: "LOCKED" })).status).toBe(403);
    expect((await patch(pos.id, { role: "ADMIN" })).status).toBe(403);
    await request(app).post("/api/v1/staff-assignments").set(headers).set(bearer(manager.accessToken)).send({ userId: pos.id, branchId: process.env.TEST_BRANCH_TWO, reason: "Cross-branch attempt" }).expect(403);
  });
  it("atomically locks accounts, revokes active sessions, writes audit, and forbids subsequent login", async () => {
    const manager = await login("manager1@example.test"); const targetAuth = await login("pos1@example.test"); const target = await user("pos1@example.test");
    await request(app).patch(`/api/v1/users/${target.id}/access`).set(headers).set(bearer(manager.accessToken)).send({ status: "LOCKED", reason: "Account locked for testing" }).expect(200);
    await request(app).get("/api/v1/auth/me").set(bearer(targetAuth.accessToken)).expect(401);
    await request(app).post("/api/v1/auth/login").set(headers).send({ email: target.email, password: "Test-password-2026!" }).expect(401);
    expect(await admin.auditLog.count({ where: { targetId: target.id, action: "USER_ACCESS_UPDATED" } })).toBeGreaterThan(0);
  });
  it("preserves assignment history and revokes sessions on same-branch reassignment", async () => {
    const manager = await login("manager1@example.test"); const auth = await login("pos1@example.test"); const target = await user("pos1@example.test");
    await request(app).post("/api/v1/staff-assignments").set(headers).set(bearer(manager.accessToken)).send({ userId: target.id, branchId: process.env.TEST_BRANCH_ONE, reason: "Assignment renewal test" }).expect(201);
    expect(await admin.staffAssignment.count({ where: { userId: target.id } })).toBe(2);
    expect(await admin.staffAssignment.count({ where: { userId: target.id, endedAt: null } })).toBe(1);
    await request(app).get("/api/v1/auth/me").set(bearer(auth.accessToken)).expect(401);
  });
  it("removes inherited scopes on role change and rejects invalid destination relationships", async () => {
    const auth = await login(); const target = await user("pos1@example.test");
    await request(app).patch(`/api/v1/users/${target.id}/access`).set(headers).set(bearer(auth.accessToken)).send({ role: "INVENTORY_STAFF", reason: "Change operational role" }).expect(200);
    expect(await admin.staffAssignment.count({ where: { userId: target.id, endedAt: null } })).toBe(0);
    await request(app).post("/api/v1/staff-assignments").set(headers).set(bearer(auth.accessToken)).send({ userId: target.id, branchId: process.env.TEST_BRANCH_TWO, warehouseId: process.env.TEST_BRANCH_WAREHOUSE, reason: "Mismatched warehouse test" }).expect(422);
  });
  it("rolls user/session changes back when audit persistence fails", async () => {
    const managerAuth = await login("manager1@example.test"); const posAuth = await login("pos1@example.test"); const target = await user("pos1@example.test");
    const context = await container.service.authenticate(managerAuth.accessToken);
    const service = createAuthService({ repository: container.repository, passwords: container.passwords, tokens: container.tokens,
      settings: { accessTtlSeconds: 900, sessionTtlSeconds: 604800, rememberSessionTtlSeconds: 2592000, idleTtlSeconds: 86400 }, clock: () => now, otp: { deliver: async () => undefined },
      unitOfWork: { run: (work) => runtime.$transaction(async (tx) => {
        const repo = createPrismaAuthRepository(tx);
        return work({ ...repo, audit: async () => { throw new Error("Injected audit write failure"); } });
      }, { isolationLevel: "Serializable" }) },
    });
    await expect(service.updateAccess(context, { userId: target.id, status: "LOCKED", reason: "Atomic rollback test" })).rejects.toThrow();
    expect((await user(target.email)).status).toBe("ACTIVE");
    await request(app).get("/api/v1/auth/me").set(bearer(posAuth.accessToken)).expect(200);
  });
  it("uses database constraints and restricted runtime privileges", async () => {
    await expect(runtime.$executeRawUnsafe("CREATE TABLE unauthorized_table (id integer)")).rejects.toThrow();
    await expect(runtime.$executeRawUnsafe("UPDATE audit_logs SET reason = 'tampered'")).rejects.toThrow();
    const target = await user("pos1@example.test");
    await expect(admin.staffAssignment.create({ data: { userId: target.id, branchId: process.env.TEST_BRANCH_ONE ?? randomUUID() } })).rejects.toThrow();
    await expect(admin.authSession.create({ data: { kind: "STAFF", csrfToken: "invalid", expiresAt: now, idleExpiresAt: now } })).rejects.toThrow();
  });
});

describe("customer OTP and membership", () => {
  it("enforces one-time OTP, session-kind separation, and verified membership enrollment", async () => {
    const auth = await otpSession();
    await request(app).post("/api/v1/customers/otp/verify").set(headers).send({ challengeId: auth.challengeId, code: auth.code }).expect(401);
    await request(app).get("/api/v1/customers/me").set(bearer(auth.accessToken)).expect(403);
    await request(app).get("/api/v1/users").set(bearer(auth.accessToken)).expect(403);
    await request(app).post("/api/v1/customers/membership").set(headers).set(bearer(auth.accessToken)).send({ fullName: "Member One", consent: false }).expect(422);
    const enrolled = await request(app).post("/api/v1/customers/membership").set(headers).set(bearer(auth.accessToken)).send({ fullName: "Member One", consent: true }).expect(201);
    const repeated = await request(app).post("/api/v1/customers/membership").set(headers).set(bearer(auth.accessToken)).send({ fullName: "Changed name", consent: true }).expect(201);
    expect(repeated.body.data.id).toBe(enrolled.body.data.id); expect(repeated.body.data.fullName).toBe("Member One");
    await request(app).post("/api/v1/auth/refresh").set(headers).set("Cookie", auth.cookie).set("X-CSRF-Token", auth.csrfToken).send({ kind: "STAFF" }).expect(401);
  });
  it("rejects expired OTPs and locks a challenge after five incorrect attempts", async () => {
    const response = await request(app).post("/api/v1/customers/otp/request").set(headers).send({ phone: "0900000020" }).expect(202);
    const id = String(response.body.data.challengeId); const code = mailbox.get(id)?.code;
    for (let i = 0; i < 5; i += 1) await request(app).post("/api/v1/customers/otp/verify").set(headers).send({ challengeId: id, code: code === "000000" ? "111111" : "000000" }).expect(401);
    await request(app).post("/api/v1/customers/otp/verify").set(headers).send({ challengeId: id, code }).expect(401);
    expect((await admin.otpChallenge.findUniqueOrThrow({ where: { id } })).attempts).toBe(5);
    const next = await request(app).post("/api/v1/customers/otp/request").set(headers).send({ phone: "0900000021" }).expect(202);
    now = new Date(now.getTime() + 301_000);
    await request(app).post("/api/v1/customers/otp/verify").set(headers).send({ challengeId: next.body.data.challengeId, code: mailbox.get(String(next.body.data.challengeId))?.code }).expect(401);
  });
  it("lets customers update only their own profile and rejects identity/points escalation", async () => {
    const a = await otpSession("0900000030"); const b = await otpSession("0900000031");
    for (const [auth, fullName] of [[a, "Customer A"], [b, "Customer B"]] as const) await request(app).post("/api/v1/customers/membership").set(headers).set(bearer(auth.accessToken)).send({ fullName, consent: true }).expect(201);
    await request(app).patch("/api/v1/customers/me").set(headers).set(bearer(a.accessToken)).send({ fullName: "Updated A", email: "A@EXAMPLE.TEST" }).expect(200);
    const profileB = await request(app).get("/api/v1/customers/me").set(bearer(b.accessToken)).expect(200);
    expect(profileB.body.data.fullName).toBe("Customer B");
    for (const patch of [{ customerId: profileB.body.data.id, fullName: "Hacked" }, { phone: "0900000099" }, { points: 9999 }, { membershipStatus: "ACTIVE" }]) await request(app).patch("/api/v1/customers/me").set(headers).set(bearer(a.accessToken)).send(patch).expect(422);
  });
  it("never exposes OTPs in HTTP responses and rate-limits repeated delivery", async () => {
    const response = await request(app).post("/api/v1/customers/otp/request").set(headers).send({ phone: "0900000040" }).expect(202);
    expect(Object.keys(response.body.data).sort()).toEqual(["challengeId", "expiresIn"]);
    await request(app).post("/api/v1/customers/otp/request").set(headers).send({ phone: "0900000040" }).expect(429);
  });
});
