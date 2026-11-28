import type { Config } from "../config/env.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuthService } from "../modules/auth-users/index.js";
import {
  createPrismaAuthRepository,
  createPrismaAuthUnitOfWork,
} from "../modules/auth-users/infrastructure/prisma-auth.repository.js";
import {
  createPasswordHasher,
  createTokenGateway,
} from "../modules/auth-users/infrastructure/security.js";
import { createOtpGateway } from "../modules/auth-users/infrastructure/otp.gateway.js";
import type { OtpGateway } from "../modules/auth-users/application/ports/security.js";
import { createBranchService } from "../modules/branch/index.js";
import {
  createPrismaBranchRepository,
  createPrismaBranchUnitOfWork,
} from "../modules/branch/infrastructure/prisma-branch.repository.js";

export async function createContainer(
  config: Config,
  prisma: PrismaClient,
  overrides: { clock?: () => Date; otp?: OtpGateway } = {},
) {
  const passwords = await createPasswordHasher();
  const tokens = createTokenGateway({
    accessSecret: config.ACCESS_TOKEN_SECRET,
    otpSecret: config.OTP_HMAC_SECRET,
    issuer: config.JWT_ISSUER,
  });
  const repository = createPrismaAuthRepository(prisma);
  const unitOfWork = createPrismaAuthUnitOfWork(prisma);
  const service = createAuthService({
    repository,
    unitOfWork,
    passwords,
    tokens,
    otp: overrides.otp ?? createOtpGateway(config),
    clock: overrides.clock ?? (() => new Date()),
    settings: {
      accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
      sessionTtlSeconds: config.SESSION_TTL_SECONDS,
      rememberSessionTtlSeconds: config.REMEMBER_SESSION_TTL_SECONDS,
      idleTtlSeconds: config.SESSION_IDLE_TTL_SECONDS,
    },
  });
  const branchService = createBranchService({
    repository: createPrismaBranchRepository(prisma),
    unitOfWork: createPrismaBranchUnitOfWork(prisma),
    identity: service,
    clock: overrides.clock ?? (() => new Date()),
  });
  return { service, branchService, repository, unitOfWork, passwords, tokens };
}
