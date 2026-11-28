import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { unauthorized } from "../../../shared/application/errors.js";
import type { PasswordHasher, TokenGateway } from "../application/ports/security.js";

export async function createPasswordHasher(): Promise<PasswordHasher> {
  const hash = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  return {
    hash,
    dummyHash: await hash(randomBytes(32).toString("hex")),
    async verify(digest, password) {
      try { return await argon2.verify(digest, password); } catch { return false; }
    },
  };
}

export function createTokenGateway(config: { accessSecret: string; otpSecret: string; issuer: string }): TokenGateway {
  const key = new TextEncoder().encode(config.accessSecret);
  return {
    async sign(context, now, ttlSeconds) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      return new SignJWT({ sid: context.sessionId })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(context.subjectId)
        .setIssuer(config.issuer).setAudience(`milktyway:${context.kind.toLowerCase()}`)
        .setIssuedAt(issuedAt).setExpirationTime(issuedAt + ttlSeconds).sign(key);
    },
    async verify(token, now) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, key, {
          algorithms: ["HS256"], issuer: config.issuer, audience: ["milktyway:staff", "milktyway:customer"],
          currentDate: now, requiredClaims: ["sub", "sid", "iat", "exp"],
        });
        if (protectedHeader.typ !== "JWT" || typeof payload.sid !== "string" || !payload.sub ||
          !["milktyway:staff", "milktyway:customer"].includes(String(payload.aud))) throw unauthorized();
        return { sessionId: payload.sid, subjectId: payload.sub, kind: payload.aud === "milktyway:staff" ? "STAFF" : "CUSTOMER" };
      } catch { throw unauthorized(); }
    },
    randomToken: () => randomBytes(32).toString("base64url"),
    hashToken: (token) => createHash("sha256").update(token).digest("hex"),
    otpCode: () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
    hashOtp: (id, code) => createHmac("sha256", config.otpSecret).update(`${id}:${code}`).digest("hex"),
    equal(left, right) {
      const a = Buffer.from(left); const b = Buffer.from(right);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
