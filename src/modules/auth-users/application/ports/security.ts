import type { AuthContext, SessionKind } from "../../domain/identity.js";

export interface TokenGateway {
  sign(context: AuthContext, now: Date, ttlSeconds: number): Promise<string>;
  verify(token: string, now: Date): Promise<AuthContext>;
  randomToken(): string;
  hashToken(token: string): string;
  otpCode(): string;
  hashOtp(id: string, code: string): string;
  equal(left: string, right: string): boolean;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  dummyHash: string;
}

export interface OtpGateway {
  deliver(input: { challengeId: string; phone: string; code: string; expiresAt: Date }): Promise<void>;
}

export interface AuthSettings {
  accessTtlSeconds: number;
  sessionTtlSeconds: number;
  rememberSessionTtlSeconds: number;
  idleTtlSeconds: number;
}

export interface SessionCredentials {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  csrfToken: string;
  expiresAt: Date;
  kind: SessionKind;
}
