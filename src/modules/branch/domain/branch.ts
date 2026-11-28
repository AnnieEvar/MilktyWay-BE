import { forbidden } from "../../../shared/application/errors.js";
import type { Principal } from "../../auth-users/index.js";

export interface DeliveryZoneInput {
  name: string;
  areaCode: string;
  feeVnd: number;
  isActive: boolean;
}

export interface BranchInput {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  operatingHours: string;
  isActive: boolean;
  acceptsOnline: boolean;
  maxPendingOnline: number;
}

export interface Branch extends BranchInput {
  id: string;
  deliveryZones: (DeliveryZoneInput & { id: string; branchId: string })[];
}

export interface PosTerminal {
  id: string;
  branchId: string;
  code: string;
  isActive: boolean;
}

export interface CashShift {
  id: string;
  terminalId: string;
  branchId: string;
  terminalCode: string;
  openedById: string;
  closedById: string | null;
  openedAt: Date;
  closedAt: Date | null;
  openingCashVnd: number;
  closingCashVnd: number | null;
  note: string | null;
}

export interface PageInput {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

// A branch-level POS assignment permits every terminal in that branch.
export function visibleTerminalIds(principal: Principal, branchId: string): string[] | null {
  if (principal.kind !== "STAFF" || principal.user.status !== "ACTIVE") throw forbidden();
  if (principal.user.role === "ADMIN") return null;
  if (!["BRANCH_MANAGER", "POS_STAFF"].includes(principal.user.role)) throw forbidden();
  const assignments = principal.user.assignments.filter((item) => item.branchId === branchId);
  if (!assignments.length) throw forbidden();
  if (principal.user.role === "BRANCH_MANAGER" || assignments.some((item) => !item.terminalId))
    return null;
  return assignments.flatMap((item) => (item.terminalId ? [item.terminalId] : []));
}
