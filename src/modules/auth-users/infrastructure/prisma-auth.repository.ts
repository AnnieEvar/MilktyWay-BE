import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { AppError, notFound } from "../../../shared/application/errors.js";
import type { AuthRepository, AuthUnitOfWork, AssignmentInput } from "../application/ports/auth.repository.js";

type Database = PrismaClient | Prisma.TransactionClient;

export function createPrismaAuthRepository(db: Database): AuthRepository {
  const activeAssignments = (now: Date): Prisma.StaffAssignmentWhereInput => ({
    startedAt: { lte: now }, endedAt: null,
    AND: [
      { OR: [{ branchId: null }, { branch: { isActive: true } }] },
      { OR: [{ warehouseId: null }, { warehouse: { isActive: true } }] },
      { OR: [{ terminalId: null }, { terminal: { isActive: true } }] },
    ],
  });
  return {
    findStaffByEmail: (email, now) => db.user.findUnique({ where: { email }, include: { assignments: { where: activeAssignments(now) } } }),
    findStaffById: (id, now) => db.user.findUnique({ where: { id }, include: { assignments: { where: activeAssignments(now) } } }),
    async listStaff({ branchIds, page, pageSize, now }) {
      const where: Prisma.UserWhereInput = branchIds === null ? {} : {
        role: { in: ["POS_STAFF", "INVENTORY_STAFF"] },
        assignments: { some: { ...activeAssignments(now), branchId: { in: branchIds } } },
      };
      const users = await db.user.findMany({ where, include: { assignments: { where: activeAssignments(now) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
      return { users, total: await db.user.count({ where }) };
    },
    countActiveAdmins: () => db.user.count({ where: { role: "ADMIN", status: "ACTIVE" } }),
    async updateAccess(id, change) { await db.user.update({ where: { id }, data: change }); },
    async endAssignments(userId, now) { await db.staffAssignment.updateMany({ where: { userId, endedAt: null }, data: { endedAt: now } }); },
    async validateDestination(input: AssignmentInput) {
      if (input.branchId && !(await db.branch.findFirst({ where: { id: input.branchId, isActive: true } }))) return false;
      if (input.warehouseId && !(await db.warehouse.findFirst({ where: { id: input.warehouseId, branchId: input.branchId, isActive: true } }))) return false;
      if (input.terminalId && !(await db.posTerminal.findFirst({ where: { id: input.terminalId, branchId: input.branchId ?? "", isActive: true } }))) return false;
      return true;
    },
    async replaceAssignment(input, now) {
      await db.staffAssignment.updateMany({ where: { userId: input.userId, endedAt: null }, data: { endedAt: now } });
      return db.staffAssignment.create({ data: { userId: input.userId, branchId: input.branchId, warehouseId: input.warehouseId, terminalId: input.terminalId, startedAt: now } });
    },
    createSession: (input) => db.authSession.create({ data: input }),
    findSession: (id) => db.authSession.findUnique({ where: { id } }),
    async findRefreshToken(tokenHash) {
      const record = await db.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } });
      return record ? { id: record.id, consumedAt: record.consumedAt, session: record.session } : null;
    },
    async createRefreshToken(sessionId, tokenHash) { await db.refreshToken.create({ data: { sessionId, tokenHash } }); },
    async consumeRefreshToken(id, now) { return (await db.refreshToken.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now } })).count === 1; },
    async touchSession(id, idleExpiresAt) { await db.authSession.update({ where: { id }, data: { idleExpiresAt } }); },
    async revokeSession(id, now) { await db.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } }); },
    async revokeStaffSessions(userId, now) { await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }); },
    findCustomer: (id) => db.customer.findUnique({ where: { id } }),
    verifyCustomerPhone: (phone, now) => db.customer.upsert({ where: { phone }, create: { phone, verifiedAt: now }, update: { verifiedAt: now } }),
    enrollCustomer: (id, fullName, now) => db.customer.update({ where: { id }, data: { fullName, joinedAt: now, consentAt: now } }),
    updateCustomer: (id, patch) => db.customer.update({ where: { id }, data: patch }),
    async createOtp(input, now) {
      await db.otpChallenge.updateMany({ where: { phone: input.phone, consumedAt: null }, data: { consumedAt: now } });
      await db.otpChallenge.create({ data: { ...input, createdAt: now } });
    },
    findOtp: (id) => db.otpChallenge.findUnique({ where: { id } }),
    async failOtp(id) { await db.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } }); },
    async consumeOtp(id, now) { return (await db.otpChallenge.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } }, data: { consumedAt: now } })).count === 1; },
    async takeRateLimit(key, limit, windowSeconds, now) {
      const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
      const rows = await db.$queryRaw<{ count: number }[]>`
        INSERT INTO rate_limit_buckets (key, count, expires_at) VALUES (${key}, 1, ${expiresAt})
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limit_buckets.expires_at <= ${now} THEN 1 ELSE rate_limit_buckets.count + 1 END,
          expires_at = CASE WHEN rate_limit_buckets.expires_at <= ${now} THEN ${expiresAt} ELSE rate_limit_buckets.expires_at END
        RETURNING count`;
      return (rows[0]?.count ?? limit + 1) <= limit;
    },
    async audit(input) { await db.auditLog.create({ data: input }); },
  };
}

export function createPrismaAuthUnitOfWork(prisma: PrismaClient): AuthUnitOfWork {
  return {
    async run<T>(work: (repo: AuthRepository) => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await prisma.$transaction((tx) => work(createPrismaAuthRepository(tx)), { isolationLevel: "Serializable", maxWait: 5000, timeout: 10_000 });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2034" && attempt < 3) continue;
            if (error.code === "P2034") throw new AppError(409, "CONCURRENT_UPDATE", "Concurrent update. Retry the request.");
            if (error.code === "P2002") throw new AppError(409, "RESOURCE_CONFLICT", "A conflicting record already exists.");
            if (error.code === "P2025") throw notFound();
          }
          throw error;
        }
      }
    },
  };
}
