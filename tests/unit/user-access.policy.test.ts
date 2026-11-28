import { describe, expect, it } from "vitest";
import { assertAssignmentScope, assertCanManageStaff, managedBranchIds } from "../../src/modules/auth-users/domain/user-access.policy.js";
import { assertBranchPermission, assertCustomerOwnership, assertWarehousePermission, hasPermission } from "../../src/modules/auth-users/domain/permissions.js";
import { staffScopes, type Staff, type StaffRole } from "../../src/modules/auth-users/domain/identity.js";

function staff(id: string, role: StaffRole, branchId: string | null): Staff {
  return { id, role, email: `${id}@example.test`, fullName: id, employeeCode: id, passwordHash: "internal", status: "ACTIVE",
    assignments: branchId ? [{ id: `assignment-${id}`, branchId, warehouseId: null, terminalId: null, startedAt: new Date(0), endedAt: null }] : [] };
}

describe("staff access policies", () => {
  const manager = staff("manager", "BRANCH_MANAGER", "branch-one");
  it("allows managing subordinate staff in the assigned branch", () => { expect(() => assertCanManageStaff(manager, staff("pos", "POS_STAFF", "branch-one"))).not.toThrow(); });
  it("rejects cross-branch staff and manager self-modification", () => {
    expect(() => assertCanManageStaff(manager, staff("pos", "POS_STAFF", "branch-two"))).toThrow();
    expect(() => assertCanManageStaff(manager, manager)).toThrow();
  });
  it.each(["ADMIN", "BRANCH_MANAGER"] as const)("rejects granting %s", (role) => { expect(() => assertCanManageStaff(manager, staff("pos", "POS_STAFF", "branch-one"), role)).toThrow(); });
  it("rejects peer managers and unassigned target staff", () => {
    expect(() => assertCanManageStaff(manager, staff("peer", "BRANCH_MANAGER", "branch-one"))).toThrow();
    expect(() => assertCanManageStaff(manager, staff("unassigned", "POS_STAFF", null))).toThrow();
  });
  it("denies unassigned managers rather than treating null as chain-wide scope", () => { expect(() => managedBranchIds(staff("unassigned", "BRANCH_MANAGER", null))).toThrow(); });
  it("does not grant chain scope to warehouse staff", () => { expect(staffScopes(staff("warehouse", "INVENTORY_STAFF", null))).toEqual([]); });
  it("rejects cross-branch reassignment and warehouse/terminal mismatches", () => {
    const pos = staff("pos", "POS_STAFF", "branch-one");
    expect(() => assertAssignmentScope(manager, pos, { branchId: "branch-two", warehouseId: null, terminalId: null })).toThrow();
    expect(() => assertAssignmentScope(manager, pos, { branchId: "branch-one", warehouseId: "warehouse", terminalId: null })).toThrow();
  });
  it("enforces action and branch together, including ADMIN action restrictions", () => {
    expect(() => assertBranchPermission({ kind: "STAFF", user: manager }, "users.read", "branch-two")).toThrow();
    expect(() => assertBranchPermission({ kind: "STAFF", user: manager }, "users.read", "branch-one")).not.toThrow();
    expect(hasPermission({ kind: "STAFF", user: staff("admin", "ADMIN", null) }, "shifts.open")).toBe(false);
    expect(hasPermission({ kind: "STAFF", user: { ...manager, status: "LOCKED" } }, "users.read")).toBe(false);
  });
  it("requires assigned warehouse IDs", () => {
    const user = staff("warehouse", "INVENTORY_STAFF", null);
    user.assignments = [{ id: "a", branchId: null, terminalId: null, warehouseId: "central", startedAt: new Date(0), endedAt: null }];
    expect(() => assertWarehousePermission({ kind: "STAFF", user }, "inventory.receive", "central")).not.toThrow();
    expect(() => assertWarehousePermission({ kind: "STAFF", user }, "inventory.receive", "other")).toThrow();
  });
  it("customer ownership never accepts a staff principal", () => { expect(() => assertCustomerOwnership({ kind: "STAFF", user: manager }, "customer")).toThrow(); });
});
