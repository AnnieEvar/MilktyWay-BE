import { forbidden } from "../../../shared/application/errors.js";
import type { Principal, StaffRole } from "./identity.js";

const permissions = {
  "users.read": ["ADMIN", "BRANCH_MANAGER"],
  "users.updateAccess": ["ADMIN", "BRANCH_MANAGER"],
  "staffAssignments.create": ["ADMIN", "BRANCH_MANAGER"],
  "branches.manage": ["ADMIN"],
  "terminals.create": ["BRANCH_MANAGER"],
  "shifts.open": ["BRANCH_MANAGER"],
  "shifts.close": ["POS_STAFF", "BRANCH_MANAGER"],
  "shifts.summary": ["ADMIN", "BRANCH_MANAGER"],
  "catalog.manage": ["ADMIN"],
  "catalog.branchAvailability": ["ADMIN", "BRANCH_MANAGER"],
  "inventory.read": ["ADMIN", "BRANCH_MANAGER", "INVENTORY_STAFF"],
  "inventory.manageItems": ["ADMIN", "BRANCH_MANAGER"],
  "inventory.receive": ["INVENTORY_STAFF"],
  "inventory.approveCount": ["ADMIN", "BRANCH_MANAGER"],
  "inventory.reportShortage": ["POS_STAFF", "INVENTORY_STAFF"],
  "orders.pos": ["POS_STAFF"],
  "orders.read": ["ADMIN", "BRANCH_MANAGER", "POS_STAFF"],
  "orders.kitchen": ["BRANCH_MANAGER", "POS_STAFF"],
  "payments.verify": ["BRANCH_MANAGER"],
  "payments.refund": ["ADMIN", "BRANCH_MANAGER"],
  "promotions.manage": ["ADMIN"],
  "reports.read": ["ADMIN", "BRANCH_MANAGER"],
  "reports.inventory": ["ADMIN", "BRANCH_MANAGER", "INVENTORY_STAFF"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof permissions;

export function hasPermission(principal: Principal, permission: Permission): boolean {
  const roles: readonly StaffRole[] = permissions[permission];
  return principal.kind === "STAFF" && principal.user.status === "ACTIVE" && roles.includes(principal.user.role);
}

export function permissionsFor(principal: Principal): Permission[] {
  return (Object.keys(permissions) as Permission[]).filter((permission) => hasPermission(principal, permission));
}

export function assertBranchPermission(principal: Principal, permission: Permission, branchId: string): void {
  if (!branchId || !hasPermission(principal, permission) || principal.kind !== "STAFF") throw forbidden();
  if (principal.user.role === "ADMIN") return;
  if (!principal.user.assignments.some((assignment) => assignment.branchId === branchId)) throw forbidden();
}

export function assertWarehousePermission(principal: Principal, permission: Permission, warehouseId: string): void {
  if (!warehouseId || !hasPermission(principal, permission) || principal.kind !== "STAFF") throw forbidden();
  if (principal.user.role === "ADMIN") return;
  if (!principal.user.assignments.some((assignment) => assignment.warehouseId === warehouseId)) throw forbidden();
}

export function assertCustomerOwnership(principal: Principal, customerId: string): void {
  if (!customerId || principal.kind !== "CUSTOMER" || principal.customer.id !== customerId) throw forbidden();
}
