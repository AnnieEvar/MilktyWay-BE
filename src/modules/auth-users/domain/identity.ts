export const staffRoles = ["ADMIN", "BRANCH_MANAGER", "POS_STAFF", "INVENTORY_STAFF"] as const;
export type StaffRole = (typeof staffRoles)[number];
export type SessionKind = "STAFF" | "CUSTOMER";

export interface Assignment {
  id: string;
  branchId: string | null;
  warehouseId: string | null;
  terminalId: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

export interface Staff {
  id: string;
  employeeCode: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: StaffRole;
  status: "ACTIVE" | "LOCKED";
  assignments: Assignment[];
}

export interface Customer {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  verifiedAt: Date;
  joinedAt: Date | null;
  consentAt: Date | null;
}

export interface Session {
  id: string;
  kind: SessionKind;
  userId: string | null;
  customerId: string | null;
  csrfToken: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  revokedAt: Date | null;
}

export type Principal =
  | { kind: "STAFF"; user: Staff }
  | { kind: "CUSTOMER"; customer: Customer };

export type { AuthContext } from "../../../shared/application/auth-context.js";

export type DataScope =
  | { kind: "CHAIN" }
  | { kind: "BRANCH"; branchIds: string[] }
  | { kind: "WAREHOUSE"; warehouseIds: string[] }
  | { kind: "SELF"; customerId: string };

export function staffScopes(user: Staff): DataScope[] {
  if (user.role === "ADMIN") return [{ kind: "CHAIN" }];
  const branchIds = [...new Set(user.assignments.flatMap((a) => (a.branchId ? [a.branchId] : [])))];
  const warehouseIds = [...new Set(user.assignments.flatMap((a) => (a.warehouseId ? [a.warehouseId] : [])))];
  return [
    ...(branchIds.length ? [{ kind: "BRANCH" as const, branchIds }] : []),
    ...(warehouseIds.length ? [{ kind: "WAREHOUSE" as const, warehouseIds }] : []),
  ];
}
