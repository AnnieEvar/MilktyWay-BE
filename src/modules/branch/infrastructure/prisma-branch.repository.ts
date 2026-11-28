import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import { AppError, notFound } from "../../../shared/application/errors.js";
import type { BranchRepository, BranchUnitOfWork } from "../application/ports/branch.repository.js";
import type { CashShift } from "../domain/branch.js";

type Database = PrismaClient | Prisma.TransactionClient;
const terminalProjection = { branchId: true, code: true } as const;
type ShiftRecord = Prisma.CashShiftGetPayload<{
  include: { terminal: { select: typeof terminalProjection } };
}>;

function toShift(record: ShiftRecord): CashShift {
  return {
    id: record.id,
    terminalId: record.terminalId,
    branchId: record.terminal.branchId,
    terminalCode: record.terminal.code,
    openedById: record.openedById,
    closedById: record.closedById,
    openedAt: record.openedAt,
    closedAt: record.closedAt,
    openingCashVnd: record.openingCashVnd,
    closingCashVnd: record.closingCashVnd,
    note: record.note,
  };
}

export function createPrismaBranchRepository(db: Database): BranchRepository {
  return {
    async listBranches({ page, pageSize, includeInactive }) {
      const where = includeInactive ? {} : { isActive: true };
      const items = await db.branch.findMany({
        where,
        include: {
          deliveryZones: {
            where: includeInactive ? {} : { isActive: true },
            orderBy: { areaCode: "asc" },
          },
        },
        orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items, total: await db.branch.count({ where }) };
    },
    findBranch: (id) => db.branch.findUnique({ where: { id }, include: { deliveryZones: true } }),
    createBranch: (input) => db.branch.create({ data: input, include: { deliveryZones: true } }),
    updateBranch: (id, input) =>
      db.branch.update({ where: { id }, data: input, include: { deliveryZones: true } }),
    async replaceDeliveryZones(branchId, zones) {
      await db.deliveryZone.deleteMany({ where: { branchId } });
      if (zones.length)
        await db.deliveryZone.createMany({ data: zones.map((zone) => ({ ...zone, branchId })) });
      return db.branch.findUniqueOrThrow({
        where: { id: branchId },
        include: { deliveryZones: { orderBy: { areaCode: "asc" } } },
      });
    },
    async listTerminals({ page, pageSize, branchId, terminalIds }) {
      const where = { branchId, ...(terminalIds ? { id: { in: terminalIds } } : {}) };
      const items = await db.posTerminal.findMany({
        where,
        orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items, total: await db.posTerminal.count({ where }) };
    },
    async findTerminal(id) {
      const terminal = await db.posTerminal.findUnique({
        where: { id },
        include: { branch: { select: { isActive: true } } },
      });
      return terminal
        ? {
            id: terminal.id,
            branchId: terminal.branchId,
            code: terminal.code,
            isActive: terminal.isActive,
            branchIsActive: terminal.branch.isActive,
          }
        : null;
    },
    createTerminal: (input) => db.posTerminal.create({ data: input }),
    async hasOpenShift(branchId) {
      return (await db.cashShift.count({ where: { terminal: { branchId }, closedAt: null } })) > 0;
    },
    async listShifts({ page, pageSize, branchId, terminalIds, status }) {
      const where: Prisma.CashShiftWhereInput = {
        terminal: { branchId },
        ...(terminalIds ? { terminalId: { in: terminalIds } } : {}),
        ...(status === "OPEN"
          ? { closedAt: null }
          : status === "CLOSED"
            ? { closedAt: { not: null } }
            : {}),
      };
      const records = await db.cashShift.findMany({
        where,
        include: { terminal: { select: terminalProjection } },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items: records.map(toShift), total: await db.cashShift.count({ where }) };
    },
    async findShift(id) {
      const shift = await db.cashShift.findUnique({
        where: { id },
        include: { terminal: { select: terminalProjection } },
      });
      return shift ? toShift(shift) : null;
    },
    async openShift(input) {
      return toShift(
        await db.cashShift.create({
          data: input,
          include: { terminal: { select: terminalProjection } },
        }),
      );
    },
    async closeShift(id, input) {
      const result = await db.cashShift.updateMany({ where: { id, closedAt: null }, data: input });
      if (!result.count) throw new AppError(409, "BR_SHIFT_CLOSED", "The shift is already closed.");
      return toShift(
        await db.cashShift.findUniqueOrThrow({
          where: { id },
          include: { terminal: { select: terminalProjection } },
        }),
      );
    },
  };
}

export function createPrismaBranchUnitOfWork(prisma: PrismaClient): BranchUnitOfWork {
  return {
    async run(work) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await prisma.$transaction((tx) => work(createPrismaBranchRepository(tx)), {
            isolationLevel: "Serializable",
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2034" && attempt < 3) continue;
            if (error.code === "P2034")
              throw new AppError(
                409,
                "BR_CONCURRENT_UPDATE",
                "Concurrent update. Retry the request.",
              );
            if (error.code === "P2002")
              throw new AppError(
                409,
                "BR_RESOURCE_CONFLICT",
                "The code is already in use or the terminal already has an open shift.",
              );
            if (error.code === "P2003")
              throw new AppError(422, "BR_INVALID_REFERENCE", "A referenced resource is invalid.");
            if (error.code === "P2025") throw notFound();
          }
          throw error;
        }
      }
    },
  };
}
