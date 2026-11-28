import { AppError, forbidden, notFound } from "../../../shared/application/errors.js";
import type { AuthContext } from "../../../shared/application/auth-context.js";
import { assertBranchPermission, hasPermission, type Principal } from "../../auth-users/index.js";
import {
  visibleTerminalIds,
  type BranchInput,
  type DeliveryZoneInput,
  type PageInput,
} from "../domain/branch.js";
import type { BranchRepository, BranchUnitOfWork } from "./ports/branch.repository.js";

export function createBranchService(deps: {
  repository: BranchRepository;
  unitOfWork: BranchUnitOfWork;
  identity: { me(context: AuthContext): Promise<Principal> };
  clock: () => Date;
}) {
  const { repository, unitOfWork, identity, clock } = deps;
  async function administrator(context: AuthContext) {
    const principal = await identity.me(context);
    if (!hasPermission(principal, "branches.manage")) throw forbidden();
    return principal;
  }
  async function activeBranch(repo: BranchRepository, id: string) {
    const branch = await repo.findBranch(id);
    if (!branch) throw notFound();
    if (!branch.isActive) throw new AppError(409, "BR_BRANCH_INACTIVE", "The branch is inactive.");
    return branch;
  }

  return {
    async listBranches(
      context: AuthContext | undefined,
      input: PageInput & { includeInactive: boolean },
    ) {
      if (input.includeInactive) {
        if (!context) throw forbidden();
        await administrator(context);
      }
      return unitOfWork.run((repo) => repo.listBranches(input));
    },
    async createBranch(context: AuthContext, input: BranchInput) {
      await administrator(context);
      return unitOfWork.run((repo) => repo.createBranch(input));
    },
    async updateBranch(context: AuthContext, id: string, input: Partial<BranchInput>) {
      await administrator(context);
      return unitOfWork.run(async (repo) => {
        if (!(await repo.findBranch(id))) throw notFound();
        if (input.isActive === false && (await repo.hasOpenShift(id))) {
          throw new AppError(
            409,
            "BR_OPEN_SHIFT_EXISTS",
            "Close the branch's open shifts before deactivating it.",
          );
        }
        return repo.updateBranch(id, input);
      });
    },
    async replaceDeliveryZones(context: AuthContext, branchId: string, zones: DeliveryZoneInput[]) {
      await administrator(context);
      return unitOfWork.run(async (repo) => {
        if (!(await repo.findBranch(branchId))) throw notFound();
        return repo.replaceDeliveryZones(branchId, zones);
      });
    },
    async listTerminals(context: AuthContext, input: PageInput & { branchId: string }) {
      const principal = await identity.me(context);
      const terminalIds = visibleTerminalIds(principal, input.branchId);
      return unitOfWork.run(async (repo) => {
        if (!(await repo.findBranch(input.branchId))) throw notFound();
        return repo.listTerminals({ ...input, terminalIds });
      });
    },
    async createTerminal(context: AuthContext, input: { branchId: string; code: string }) {
      const principal = await identity.me(context);
      assertBranchPermission(principal, "terminals.create", input.branchId);
      return unitOfWork.run(async (repo) => {
        await activeBranch(repo, input.branchId);
        return repo.createTerminal(input);
      });
    },
    async listShifts(
      context: AuthContext,
      input: PageInput & { branchId: string; status?: "OPEN" | "CLOSED" },
    ) {
      const principal = await identity.me(context);
      const terminalIds = visibleTerminalIds(principal, input.branchId);
      return unitOfWork.run((repo) => repo.listShifts({ ...input, terminalIds }));
    },
    async openShift(context: AuthContext, input: { terminalId: string; openingCashVnd: number }) {
      const principal = await identity.me(context);
      if (!hasPermission(principal, "shifts.open") || principal.kind !== "STAFF") throw forbidden();
      return unitOfWork.run(async (repo) => {
        const terminal = await repo.findTerminal(input.terminalId);
        if (!terminal) throw notFound();
        assertBranchPermission(principal, "shifts.open", terminal.branchId);
        if (!terminal.isActive || !terminal.branchIsActive) {
          throw new AppError(
            409,
            "BR_TERMINAL_INACTIVE",
            "The terminal and its branch must be active.",
          );
        }
        return repo.openShift({ ...input, openedById: principal.user.id, openedAt: clock() });
      });
    },
    async closeShift(
      context: AuthContext,
      id: string,
      input: { closingCashVnd: number; note: string | null },
    ) {
      const principal = await identity.me(context);
      if (!hasPermission(principal, "shifts.close") || principal.kind !== "STAFF")
        throw forbidden();
      return unitOfWork.run(async (repo) => {
        const shift = await repo.findShift(id);
        if (!shift) throw notFound();
        assertBranchPermission(principal, "shifts.close", shift.branchId);
        const terminalIds = visibleTerminalIds(principal, shift.branchId);
        if (terminalIds && !terminalIds.includes(shift.terminalId)) throw forbidden();
        if (shift.closedAt)
          throw new AppError(409, "BR_SHIFT_CLOSED", "The shift is already closed.");
        return repo.closeShift(id, { ...input, closedById: principal.user.id, closedAt: clock() });
      });
    },
    async shiftSummary(context: AuthContext, id: string) {
      const principal = await identity.me(context);
      if (!hasPermission(principal, "shifts.summary")) throw forbidden();
      const shift = await repository.findShift(id);
      if (!shift) throw notFound();
      assertBranchPermission(principal, "shifts.summary", shift.branchId);
      return shift;
    },
  };
}

export type BranchService = ReturnType<typeof createBranchService>;
