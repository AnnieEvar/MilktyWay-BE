import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createPasswordHasher, createTokenGateway } from "../../src/modules/auth-users/infrastructure/security.js";
import { loadConfig } from "../../src/config/env.js";

const accessSecret = "a".repeat(64);
const tokens = createTokenGateway({ accessSecret, otpSecret: "b".repeat(64), issuer: "test-api" });
describe("token and credential adapters", () => {
  it("verifies signed claims and rejects expiry, tampering, and invalid issuer/audience/algorithm", async () => {
    const now = new Date(); const context = { sessionId: randomUUID(), subjectId: randomUUID(), kind: "STAFF" as const };
    const token = await tokens.sign(context, now, 60);
    expect(await tokens.verify(token, now)).toEqual(context);
    await expect(tokens.verify(token, new Date(now.getTime() + 61_000))).rejects.toThrow();
    const parts = token.split("."); parts[1] = Buffer.from(JSON.stringify({ sub: randomUUID() })).toString("base64url");
    await expect(tokens.verify(parts.join("."), now)).rejects.toThrow();
    for (const [issuer, audience, alg] of [["wrong", "milktyway:staff", "HS256"], ["test-api", "wrong", "HS256"], ["test-api", "milktyway:staff", "HS384"]]) {
      const invalid = await new SignJWT({ sid: context.sessionId }).setSubject(context.subjectId).setProtectedHeader({ alg: alg ?? "HS256", typ: "JWT" }).setIssuer(issuer ?? "wrong").setAudience(audience ?? "wrong").setIssuedAt().setExpirationTime("1m").sign(new TextEncoder().encode(accessSecret));
      await expect(tokens.verify(invalid, now)).rejects.toThrow();
    }
  });
  it("hashes passwords with Argon2id and binds OTP digests to their challenge", async () => {
    const hasher = await createPasswordHasher(); const hash = await hasher.hash("A-real-password-123!");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await hasher.verify(hash, "A-real-password-123!")).toBe(true);
    expect(await hasher.verify(hash, "wrong")).toBe(false);
    expect(tokens.hashOtp("one", "123456")).not.toBe(tokens.hashOtp("two", "123456"));
  });
  it("rejects unsafe production configuration and placeholder secrets", () => {
    const environment = { DATABASE_URL: "postgresql://localhost/test", ACCESS_TOKEN_SECRET: accessSecret, OTP_HMAC_SECRET: "b".repeat(64), OTP_PROVIDER: "development" };
    expect(() => loadConfig(environment)).not.toThrow();
    expect(() => loadConfig({ ...environment, NODE_ENV: "production" })).toThrow();
    expect(() => loadConfig({ ...environment, COOKIE_SAME_SITE: "none", COOKIE_SECURE: "false" })).toThrow();
    expect(() => loadConfig({ ...environment, CORS_ORIGINS: "*" })).toThrow();
  });
});
