import type { Assignment, Customer, Session, SessionKind, Staff, StaffRole } from "../../domain/identity.js";

export interface OtpChallenge {
  id: string;
  phone: string;
  purpose: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface AssignmentInput {
  userId: string;
  branchId: string | null;
  warehouseId: string | null;
  terminalId: string | null;
}

export interface AuthRepository {
  findStaffByEmail(email: string, now: Date): Promise<Staff | null>;
  findStaffById(id: string, now: Date): Promise<Staff | null>;
  listStaff(input: { branchIds: string[] | null; page: number; pageSize: number; now: Date }): Promise<{ users: Staff[]; total: number }>;
  countActiveAdmins(): Promise<number>;
  updateAccess(id: string, change: { role?: StaffRole; status?: "ACTIVE" | "LOCKED" }): Promise<void>;
  endAssignments(userId: string, now: Date): Promise<void>;
  validateDestination(input: AssignmentInput): Promise<boolean>;
  replaceAssignment(input: AssignmentInput, now: Date): Promise<Assignment>;
  createSession(input: { id: string; kind: SessionKind; userId: string | null; customerId: string | null; csrfToken: string; expiresAt: Date; idleExpiresAt: Date }): Promise<Session>;
  findSession(id: string): Promise<Session | null>;
  findRefreshToken(hash: string): Promise<{ id: string; session: Session; consumedAt: Date | null } | null>;
  createRefreshToken(sessionId: string, hash: string): Promise<void>;
  consumeRefreshToken(id: string, now: Date): Promise<boolean>;
  touchSession(id: string, idleExpiresAt: Date): Promise<void>;
  revokeSession(id: string, now: Date): Promise<void>;
  revokeStaffSessions(userId: string, now: Date): Promise<void>;
  findCustomer(id: string): Promise<Customer | null>;
  verifyCustomerPhone(phone: string, now: Date): Promise<Customer>;
  enrollCustomer(id: string, fullName: string, now: Date): Promise<Customer>;
  updateCustomer(id: string, patch: { fullName?: string; email?: string | null }): Promise<Customer>;
  createOtp(input: OtpChallenge, now: Date): Promise<void>;
  findOtp(id: string): Promise<OtpChallenge | null>;
  failOtp(id: string): Promise<void>;
  consumeOtp(id: string, now: Date): Promise<boolean>;
  takeRateLimit(key: string, limit: number, windowSeconds: number, now: Date): Promise<boolean>;
  audit(input: { actorId: string; targetId: string; action: string; reason: string; details: Record<string, string | null> }): Promise<void>;
}

export interface AuthUnitOfWork {
  run<T>(work: (repository: AuthRepository) => Promise<T>): Promise<T>;
}
