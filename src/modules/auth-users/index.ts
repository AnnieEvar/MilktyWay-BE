export { createAuthRouter } from "./http/auth.routes.js";
export { createAuthService, type AuthService } from "./application/auth.service.js";
export type { AuthContext, DataScope, StaffRole, Principal } from "./domain/identity.js";
export {
  hasPermission,
  assertBranchPermission,
  assertWarehousePermission,
  assertCustomerOwnership,
} from "./domain/permissions.js";
export type { Permission } from "./domain/permissions.js";
