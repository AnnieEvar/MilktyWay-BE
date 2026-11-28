import { randomUUID } from "node:crypto";
import { AppError, forbidden, notFound, unauthorized } from "../../../shared/application/errors.js";
import { assertAssignmentScope, assertCanManageStaff, managedBranchIds } from "../domain/user-access.policy.js";
import type { AuthContext, Customer, Principal, Session, SessionKind, Staff, StaffRole } from "../domain/identity.js";
import type { AssignmentInput, AuthRepository, AuthUnitOfWork } from "./ports/auth.repository.js";
import type { AuthSettings, OtpGateway, PasswordHasher, SessionCredentials, TokenGateway } from "./ports/security.js";

export function createAuthService(dependencies: {
  repository: AuthRepository;
  unitOfWork: AuthUnitOfWork;
  passwords: PasswordHasher;
  tokens: TokenGateway;
  otp: OtpGateway;
  settings: AuthSettings;
  clock: () => Date;
}) {
  const { repository, unitOfWork, passwords, tokens, otp, settings, clock } = dependencies;
  const after = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000);

  async function limit(key: string, maximum: number, seconds: number) {
    if (!(await repository.takeRateLimit(tokens.hashToken(key), maximum, seconds, clock()))) {
      throw new AppError(429, "AUTH_RATE_LIMITED", "Too many requests. Try again later.");
    }
  }

  async function livePrincipal(repo: AuthRepository, session: Session, now: Date): Promise<Principal> {
    if (session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now) throw unauthorized();
    if (session.kind === "STAFF" && session.userId) {
      const user = await repo.findStaffById(session.userId, now);
      if (user?.status !== "ACTIVE") throw unauthorized();
      return { kind: "STAFF", user };
    }
    if (session.kind === "CUSTOMER" && session.customerId) {
      const customer = await repo.findCustomer(session.customerId);
      if (customer) return { kind: "CUSTOMER", customer };
    }
    throw unauthorized();
  }

  async function resolve(repo: AuthRepository, context: AuthContext, now: Date) {
    const session = await repo.findSession(context.sessionId);
    if (!session || session.kind !== context.kind || (session.userId ?? session.customerId) !== context.subjectId) {
      throw unauthorized();
    }
    return { session, principal: await livePrincipal(repo, session, now) };
  }

  async function staffActor(repo: AuthRepository, context: AuthContext, now: Date): Promise<Staff> {
    const { principal } = await resolve(repo, context, now);
    if (principal.kind !== "STAFF") throw forbidden();
    return principal.user;
  }

  async function member(repo: AuthRepository, context: AuthContext, now: Date, requireMembership = true): Promise<Customer> {
    const { principal } = await resolve(repo, context, now);
    if (principal.kind !== "CUSTOMER") throw forbidden();
    if (requireMembership && !principal.customer.joinedAt) {
      throw new AppError(403, "AU_MEMBERSHIP_REQUIRED", "Active membership is required.");
    }
    return principal.customer;
  }

  async function credentials(repo: AuthRepository, session: Session, now: Date): Promise<SessionCredentials> {
    const subjectId = session.userId ?? session.customerId;
    if (!subjectId) throw unauthorized();
    const refreshToken = tokens.randomToken();
    await repo.createRefreshToken(session.id, tokens.hashToken(refreshToken));
    return {
      accessToken: await tokens.sign({ sessionId: session.id, subjectId, kind: session.kind }, now, settings.accessTtlSeconds),
      expiresIn: settings.accessTtlSeconds,
      refreshToken,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      kind: session.kind,
    };
  }

  async function newSession(repo: AuthRepository, input: { kind: SessionKind; subjectId: string; remember: boolean }, now: Date) {
    const expiresAt = after(now, input.remember ? settings.rememberSessionTtlSeconds : settings.sessionTtlSeconds);
    const session = await repo.createSession({
      id: randomUUID(), kind: input.kind,
      userId: input.kind === "STAFF" ? input.subjectId : null,
      customerId: input.kind === "CUSTOMER" ? input.subjectId : null,
      csrfToken: tokens.randomToken(), expiresAt,
      idleExpiresAt: new Date(Math.min(expiresAt.getTime(), after(now, settings.idleTtlSeconds).getTime())),
    });
    return credentials(repo, session, now);
  }

  return {
    limit,
    async login(input: { email: string; password: string; remember: boolean }) {
      await limit(`login:${input.email}`, 10, 900);
      const candidate = await repository.findStaffByEmail(input.email, clock());
      const valid = await passwords.verify(candidate?.passwordHash ?? passwords.dummyHash, input.password);
      if (!valid || candidate?.status !== "ACTIVE") {
        throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password.");
      }
      return unitOfWork.run(async (repo) => {
        const user = await repo.findStaffById(candidate.id, clock());
        if (user?.status !== "ACTIVE" || user.passwordHash !== candidate.passwordHash) throw unauthorized();
        return newSession(repo, { kind: "STAFF", subjectId: user.id, remember: input.remember }, clock());
      });
    },
    async authenticate(accessToken: string): Promise<AuthContext> {
      const context = await tokens.verify(accessToken, clock());
      await resolve(repository, context, clock());
      return context;
    },
    async me(context: AuthContext) {
      return (await resolve(repository, context, clock())).principal;
    },
    async csrf(refreshToken: string, kind: SessionKind) {
      const record = await repository.findRefreshToken(tokens.hashToken(refreshToken));
      if (!record || record.consumedAt || record.session.kind !== kind) throw unauthorized();
      await livePrincipal(repository, record.session, clock());
      return record.session.csrfToken;
    },
    async refresh(refreshToken: string, kind: SessionKind, csrfToken: string) {
      const result = await unitOfWork.run(async (repo) => {
        const record = await repo.findRefreshToken(tokens.hashToken(refreshToken));
        if (!record || record.session.kind !== kind) throw unauthorized();
        if (!tokens.equal(record.session.csrfToken, csrfToken)) throw forbidden();
        const now = clock();
        await livePrincipal(repo, record.session, now);
        if (record.consumedAt || !(await repo.consumeRefreshToken(record.id, now))) {
          // Return an outcome so revocation commits before the HTTP error is raised.
          await repo.revokeSession(record.session.id, now);
          return null;
        }
        await repo.touchSession(record.session.id, new Date(Math.min(record.session.expiresAt.getTime(), after(now, settings.idleTtlSeconds).getTime())));
        return credentials(repo, record.session, now);
      });
      if (!result) throw new AppError(401, "AUTH_REFRESH_REPLAY", "Session revoked. Sign in again.");
      return result;
    },
    async logout(context: AuthContext) {
      await unitOfWork.run(async (repo) => {
        await resolve(repo, context, clock());
        await repo.revokeSession(context.sessionId, clock());
      });
    },
    async listUsers(context: AuthContext, input: { page: number; pageSize: number }) {
      return unitOfWork.run(async (repo) => {
        const now = clock();
        const actor = await staffActor(repo, context, now);
        return repo.listStaff({ ...input, branchIds: managedBranchIds(actor), now });
      });
    },
    async updateAccess(context: AuthContext, input: { userId: string; role?: StaffRole; status?: "ACTIVE" | "LOCKED"; reason: string }) {
      return unitOfWork.run(async (repo) => {
        const now = clock();
        const actor = await staffActor(repo, context, now);
        const target = await repo.findStaffById(input.userId, now);
        if (!target) throw notFound();
        assertCanManageStaff(actor, target, input.role);
        if (target.role === "ADMIN" && target.status === "ACTIVE" && (input.role && input.role !== "ADMIN" || input.status === "LOCKED") && await repo.countActiveAdmins() <= 1) {
          throw new AppError(409, "AU_LAST_ADMIN", "The last active administrator cannot be removed.");
        }
        const nextRole = input.role ?? target.role;
        // A role transition must not reinterpret an old warehouse/terminal assignment.
        if (nextRole !== target.role) await repo.endAssignments(target.id, now);
        await repo.updateAccess(target.id, {
          ...(input.role ? { role: input.role } : {}), ...(input.status ? { status: input.status } : {}),
        });
        await repo.revokeStaffSessions(target.id, now);
        await repo.audit({ actorId: actor.id, targetId: target.id, action: "USER_ACCESS_UPDATED", reason: input.reason,
          details: { previousRole: target.role, role: nextRole, previousStatus: target.status, status: input.status ?? target.status } });
        const updated = await repo.findStaffById(target.id, now);
        if (!updated) throw notFound();
        return updated;
      });
    },
    async assignStaff(context: AuthContext, input: AssignmentInput & { reason: string }) {
      return unitOfWork.run(async (repo) => {
        const now = clock();
        const actor = await staffActor(repo, context, now);
        const target = await repo.findStaffById(input.userId, now);
        if (!target) throw notFound();
        assertAssignmentScope(actor, target, input);
        if (!(await repo.validateDestination(input))) throw new AppError(422, "AU_INVALID_ASSIGNMENT", "Assignment locations must be active and belong to the same branch.");
        const assignment = await repo.replaceAssignment(input, now);
        await repo.revokeStaffSessions(target.id, now);
        await repo.audit({ actorId: actor.id, targetId: target.id, action: "STAFF_ASSIGNED", reason: input.reason,
          details: { branchId: input.branchId, warehouseId: input.warehouseId, terminalId: input.terminalId } });
        return assignment;
      });
    },
    async requestOtp(phone: string) {
      await limit(`otp-send-cooldown:${phone}`, 1, 60);
      await limit(`otp-send-hour:${phone}`, 5, 3600);
      const now = clock();
      const id = randomUUID();
      const code = tokens.otpCode();
      const expiresAt = after(now, 300);
      await unitOfWork.run((repo) => repo.createOtp({ id, phone, purpose: "CUSTOMER_LOGIN", codeHash: tokens.hashOtp(id, code), attempts: 0, expiresAt, consumedAt: null }, now));
      try { await otp.deliver({ challengeId: id, phone, code, expiresAt }); }
      catch {
        await unitOfWork.run((repo) => repo.consumeOtp(id, clock()));
        throw new AppError(503, "AUTH_OTP_DELIVERY_FAILED", "OTP delivery is unavailable. Try again later.");
      }
      return { challengeId: id, expiresIn: 300 };
    },
    async verifyOtp(input: { challengeId: string; code: string; remember: boolean }) {
      const result = await unitOfWork.run(async (repo) => {
        const challenge = await repo.findOtp(input.challengeId);
        const now = clock();
        if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= 5 || challenge.purpose !== "CUSTOMER_LOGIN") return null;
        if (!tokens.equal(challenge.codeHash, tokens.hashOtp(challenge.id, input.code))) {
          await repo.failOtp(challenge.id);
          return null;
        }
        if (!(await repo.consumeOtp(challenge.id, now))) return null;
        const customer = await repo.verifyCustomerPhone(challenge.phone, now);
        return newSession(repo, { kind: "CUSTOMER", subjectId: customer.id, remember: input.remember }, now);
      });
      if (!result) throw new AppError(401, "AUTH_INVALID_OTP", "Invalid or expired verification code.");
      return result;
    },
    async enroll(context: AuthContext, fullName: string) {
      return unitOfWork.run(async (repo) => {
        const now = clock();
        const customer = await member(repo, context, now, false);
        return customer.joinedAt ? customer : repo.enrollCustomer(customer.id, fullName, now);
      });
    },
    async customerProfile(context: AuthContext) { return member(repository, context, clock()); },
    async updateProfile(context: AuthContext, patch: { fullName?: string; email?: string | null }) {
      return unitOfWork.run(async (repo) => {
        const customer = await member(repo, context, clock());
        return repo.updateCustomer(customer.id, patch);
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
