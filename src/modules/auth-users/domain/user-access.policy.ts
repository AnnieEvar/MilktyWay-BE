import { forbidden, notFound } from "../../../shared/application/errors.js";
import type { Staff, StaffRole } from "./identity.js";

const subordinateRoles: readonly StaffRole[] = ["POS_STAFF", "INVENTORY_STAFF"];

export function managedBranchIds(actor: Staff): string[] | null {
  if (actor.role === "ADMIN") return null;
  if (actor.role !== "BRANCH_MANAGER") throw forbidden();
  const ids = actor.assignments.flatMap((a) => (a.branchId ? [a.branchId] : []));
  if (!ids.length) throw forbidden();
  return [...new Set(ids)];
}

export function assertCanManageStaff(actor: Staff, target: Staff, proposedRole = target.role): void {
  const branches = managedBranchIds(actor);
  if (actor.id === target.id) throw forbidden();
  if (branches === null) return;
  if (!subordinateRoles.includes(target.role) || !subordinateRoles.includes(proposedRole)) {
    throw forbidden();
  }
  if (
    !target.assignments.length ||
    target.assignments.some((a) => !a.branchId || !branches.includes(a.branchId))
  ) {
    throw notFound();
  }
}

export function assertAssignmentScope(
  actor: Staff,
  target: Staff,
  destination: { branchId: string | null; warehouseId: string | null; terminalId: string | null },
): void {
  assertCanManageStaff(actor, target);
  const branches = managedBranchIds(actor);
  if (branches && (!destination.branchId || !branches.includes(destination.branchId))) {
    throw forbidden();
  }
  if (target.role === "ADMIN") throw forbidden();
  if (target.role === "INVENTORY_STAFF") {
    if (!destination.warehouseId || destination.terminalId) throw forbidden();
  } else if (!destination.branchId || destination.warehouseId) {
    throw forbidden();
  }
  if (target.role !== "POS_STAFF" && destination.terminalId) throw forbidden();
}
