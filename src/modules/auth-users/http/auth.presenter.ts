import { staffScopes, type Customer, type Principal, type Staff } from "../domain/identity.js";
import { permissionsFor } from "../domain/permissions.js";

export function staffResponse(user: Staff) {
  return {
    id: user.id, employeeCode: user.employeeCode, email: user.email, fullName: user.fullName,
    role: user.role, status: user.status, scopes: staffScopes(user),
    assignments: user.assignments.map((assignment) => ({ id: assignment.id, branchId: assignment.branchId, warehouseId: assignment.warehouseId, terminalId: assignment.terminalId, startedAt: assignment.startedAt })),
  };
}

export function customerResponse(customer: Customer) {
  return { id: customer.id, phone: customer.phone, fullName: customer.fullName, email: customer.email,
    verifiedAt: customer.verifiedAt, joinedAt: customer.joinedAt, membershipStatus: customer.joinedAt ? "ACTIVE" : "NONE" };
}

export function principalResponse(principal: Principal) {
  return principal.kind === "STAFF"
    ? { kind: "STAFF", ...staffResponse(principal.user), permissions: permissionsFor(principal) }
    : { kind: "CUSTOMER", role: "CUSTOMER", ...customerResponse(principal.customer), scopes: [{ kind: "SELF", customerId: principal.customer.id }] };
}
