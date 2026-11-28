import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { createContainer } from "../../src/bootstrap/container.js";
import { createPrismaClient } from "../../src/shared/infrastructure/database/prisma-client.js";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (!runtimeUrl || !adminUrl)
  throw new Error("Run npm run test:integration to create an isolated PostgreSQL instance.");
const runtime = createPrismaClient(runtimeUrl, 10);
const admin = createPrismaClient(adminUrl);
const headers = { Origin: "http://localhost:1800", "X-Requested-With": "MilktyWay" };
const password = "Branch-test-password-2026!";
let app: ReturnType<typeof createApp>;
let branchId: string;
let otherBranchId: string;
let managerId: string;
let posId: string;
let terminalId: string;
let otherTerminalId: string;

async function login(role: "ADMIN" | "MANAGER" | "POS") {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .set(headers)
    .send({ email: `br-${role.toLowerCase()}@example.test`, password })
    .expect(200);
  const token: unknown = response.body.data.accessToken;
  if (typeof token !== "string") throw new Error("Expected an access token.");
  return { ...headers, Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: runtimeUrl,
    ACCESS_TOKEN_SECRET: "c".repeat(64),
    OTP_HMAC_SECRET: "d".repeat(64),
    OTP_PROVIDER: "development",
  });
  const container = await createContainer(config, runtime);
  app = createApp({
    config,
    service: container.service,
    branchService: container.branchService,
    logger: pino({ enabled: false }),
    ready: async () => {},
  });
  const passwordHash = await container.passwords.hash(password);
  branchId = (await admin.branch.create({ data: { code: "BR-TEST-A", name: "Branch test A" } })).id;
  otherBranchId = (
    await admin.branch.create({ data: { code: "BR-TEST-B", name: "Branch test B" } })
  ).id;
  for (const [name, role] of [
    ["ADMIN", "ADMIN"],
    ["MANAGER", "BRANCH_MANAGER"],
    ["POS", "POS_STAFF"],
  ] as const) {
    const user = await admin.user.create({
      data: {
        employeeCode: `BR-${name}`,
        fullName: name,
        email: `br-${name.toLowerCase()}@example.test`,
        passwordHash,
        role,
      },
    });
    if (name === "MANAGER") managerId = user.id;
    if (name === "POS") posId = user.id;
  }
});

beforeEach(async () => {
  await admin.rateLimitBucket.deleteMany();
  await admin.cashShift.deleteMany({
    where: { terminal: { branchId: { in: [branchId, otherBranchId] } } },
  });
  await admin.staffAssignment.deleteMany({ where: { userId: { in: [managerId, posId] } } });
  await admin.posTerminal.deleteMany({ where: { branchId: { in: [branchId, otherBranchId] } } });
  await admin.deliveryZone.deleteMany({ where: { branchId } });
  await admin.branch.updateMany({
    where: { id: { in: [branchId, otherBranchId] } },
    data: { isActive: true },
  });
  terminalId = (await admin.posTerminal.create({ data: { branchId, code: "POS-01" } })).id;
  otherTerminalId = (await admin.posTerminal.create({ data: { branchId, code: "POS-02" } })).id;
  await admin.staffAssignment.createMany({
    data: [
      { userId: managerId, branchId },
      { userId: posId, branchId, terminalId },
    ],
  });
});

afterAll(async () => {
  await runtime.$disconnect();
  await admin.$disconnect();
});

describe("branch operations through HTTP and PostgreSQL", () => {
  it("lists active branches publicly and reserves inactive branches and writes for ADMIN", async () => {
    await admin.branch.update({ where: { id: otherBranchId }, data: { isActive: false } });
    const publicList = await request(app).get("/api/v1/branches?includeInactive=false").expect(200);
    expect(publicList.body.data.map((item: { id: string }) => item.id)).toContain(branchId);
    expect(publicList.body.data.map((item: { id: string }) => item.id)).not.toContain(
      otherBranchId,
    );
    await request(app).get("/api/v1/branches?includeInactive=true").expect(403);
    await request(app)
      .get("/api/v1/branches?includeInactive=true")
      .set(await login("MANAGER"))
      .expect(403);
    const privateList = await request(app)
      .get("/api/v1/branches?includeInactive=true")
      .set(await login("ADMIN"))
      .expect(200);
    expect(privateList.body.data.map((item: { id: string }) => item.id)).toContain(otherBranchId);
    await request(app)
      .post("/api/v1/branches")
      .set(headers)
      .send({ code: "NO-AUTH", name: "Unauthorized" })
      .expect(401);
    await request(app)
      .post("/api/v1/branches")
      .set(await login("POS"))
      .send({ code: "NO-POS", name: "Unauthorized" })
      .expect(403);
  });

  it("creates and patches branches without resetting omitted fields and rejects duplicate codes", async () => {
    const auth = await login("ADMIN");
    const created = await request(app)
      .post("/api/v1/branches")
      .set(auth)
      .send({
        code: " br-created ",
        name: "New branch",
        address: "123 Demo Street",
        acceptsOnline: false,
      })
      .expect(201);
    expect(created.body.data.code).toBe("BR-CREATED");
    const updated = await request(app)
      .patch(`/api/v1/branches/${created.body.data.id}`)
      .set(auth)
      .send({ name: "Renamed" })
      .expect(200);
    expect(updated.body.data.address).toBe("123 Demo Street");
    expect(updated.body.data.acceptsOnline).toBe(false);
    await request(app)
      .post("/api/v1/branches")
      .set(auth)
      .send({ code: "BR-CREATED", name: "Duplicate" })
      .expect(409);
    await request(app).patch(`/api/v1/branches/${branchId}`).set(auth).send({}).expect(422);
    await request(app)
      .patch(`/api/v1/branches/${branchId}`)
      .set(auth)
      .send({ maxPendingOnline: -1 })
      .expect(422);
  });

  it("replaces delivery zones, rejects duplicate areas, and hides disabled areas from public lists", async () => {
    const auth = await login("ADMIN");
    const url = `/api/v1/branches/${branchId}/delivery-zones`;
    await request(app)
      .put(url)
      .set(auth)
      .send({
        zones: [
          { areaCode: "WARD-1", name: "Ward 1", feeVnd: 15000 },
          { areaCode: "WARD-2", name: "Ward 2", isActive: false },
        ],
      })
      .expect(200);
    const list = await request(app).get("/api/v1/branches").expect(200);
    const branch = list.body.data.find((item: { id: string }) => item.id === branchId);
    expect(branch.deliveryZones).toHaveLength(1);
    await request(app)
      .put(url)
      .set(auth)
      .send({
        zones: [
          { areaCode: "DUP", name: "One" },
          { areaCode: "dup", name: "Two" },
        ],
      })
      .expect(422);
    expect(await admin.deliveryZone.count({ where: { branchId } })).toBe(2);
    await request(app).put(url).set(auth).send({ zones: [] }).expect(200);
    expect(await admin.deliveryZone.count({ where: { branchId } })).toBe(0);
  });

  it("limits POS creation to the assigned manager and terminal visibility to the POS assignment", async () => {
    const manager = await login("MANAGER");
    await request(app)
      .post("/api/v1/pos-terminals")
      .set(manager)
      .send({ branchId, code: "POS-03" })
      .expect(201);
    await request(app)
      .post("/api/v1/pos-terminals")
      .set(manager)
      .send({ branchId, code: "pos-03" })
      .expect(409);
    await request(app)
      .post("/api/v1/pos-terminals")
      .set(manager)
      .send({ branchId: otherBranchId, code: "POS-03" })
      .expect(403);
    const pos = await login("POS");
    const list = await request(app)
      .get(`/api/v1/pos-terminals?branchId=${branchId}`)
      .set(pos)
      .expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(terminalId);
    await request(app).get(`/api/v1/pos-terminals?branchId=${otherBranchId}`).set(pos).expect(403);
  });

  it("opens, lists, summarizes, and closes a shift using the authenticated staff identity", async () => {
    const manager = await login("MANAGER");
    const pos = await login("POS");
    const opened = await request(app)
      .post("/api/v1/cash-shifts/open")
      .set(manager)
      .send({ terminalId, openingCashVnd: 500000 })
      .expect(201);
    const id: string = opened.body.data.id;
    expect(opened.body.data.openedById).toBe(managerId);
    expect(opened.body.data.status).toBe("OPEN");
    await request(app)
      .patch(`/api/v1/branches/${branchId}`)
      .set(await login("ADMIN"))
      .send({ isActive: false })
      .expect(409);
    const list = await request(app)
      .get(`/api/v1/cash-shifts?branchId=${branchId}&status=OPEN`)
      .set(pos)
      .expect(200);
    expect(list.body.meta.total).toBe(1);
    await request(app).get(`/api/v1/cash-shifts/${id}/summary`).set(pos).expect(403);
    await request(app).get(`/api/v1/cash-shifts/${id}/summary`).set(manager).expect(200);
    const closed = await request(app)
      .post(`/api/v1/cash-shifts/${id}/close`)
      .set(pos)
      .send({ closingCashVnd: 750000, note: "End of demo shift" })
      .expect(200);
    expect(closed.body.data).toMatchObject({
      status: "CLOSED",
      closedById: posId,
      openingCashVnd: 500000,
      closingCashVnd: 750000,
    });
    await request(app)
      .post(`/api/v1/cash-shifts/${id}/close`)
      .set(pos)
      .send({ closingCashVnd: 750000 })
      .expect(409);
    await request(app)
      .post("/api/v1/cash-shifts/open")
      .set(manager)
      .send({ terminalId, openingCashVnd: 500000 })
      .expect(201);
  });

  it("prevents duplicate open shifts, cross-branch access, and closing another assigned terminal", async () => {
    const manager = await login("MANAGER");
    const open = () =>
      request(app)
        .post("/api/v1/cash-shifts/open")
        .set(manager)
        .send({ terminalId, openingCashVnd: 0 });
    const concurrent = await Promise.all([open(), open()]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await admin.cashShift.count({ where: { terminalId, closedAt: null } })).toBe(1);
    const other = await request(app)
      .post("/api/v1/cash-shifts/open")
      .set(manager)
      .send({ terminalId: otherTerminalId, openingCashVnd: 0 })
      .expect(201);
    const pos = await login("POS");
    await request(app)
      .post(`/api/v1/cash-shifts/${other.body.data.id}/close`)
      .set(pos)
      .send({ closingCashVnd: 0 })
      .expect(403);
    await request(app)
      .post("/api/v1/cash-shifts/open")
      .set(pos)
      .send({ terminalId, openingCashVnd: 0 })
      .expect(403);
    const foreign = await admin.posTerminal.create({
      data: { branchId: otherBranchId, code: "POS-FOREIGN" },
    });
    await request(app)
      .post("/api/v1/cash-shifts/open")
      .set(manager)
      .send({ terminalId: foreign.id, openingCashVnd: 0 })
      .expect(403);
    await admin.posTerminal.update({ where: { id: otherTerminalId }, data: { isActive: false } });
    await request(app)
      .post("/api/v1/cash-shifts/open")
      .set(manager)
      .send({ terminalId: otherTerminalId, openingCashVnd: 0 })
      .expect(409);
  });
});
