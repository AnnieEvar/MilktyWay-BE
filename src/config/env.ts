import { z } from "zod";

const boolean = z.enum(["true", "false"]).transform((v) => v === "true");
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .regex(/^postgres(ql)?:\/\//),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  CORS_ORIGINS: z.string().default("http://localhost:1800,http://localhost:5173"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  OTP_HMAC_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("milktyway-api"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(604800),
  REMEMBER_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(2592000),
  SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().min(300).default(86400),
  COOKIE_SECURE: boolean.default(false),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
  OTP_PROVIDER: z.enum(["development", "webhook"]),
  OTP_MAILBOX_DIR: z.string().default(".data/otp"),
  OTP_WEBHOOK_URL: z.string().default(""),
  OTP_WEBHOOK_TOKEN: z.string().default(""),
  R2_ENABLED: boolean.default(false),
  R2_ENDPOINT: z.string().trim().default(""),
  R2_BUCKET: z.string().trim().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_PUBLIC_BASE_URL: z.string().trim().default(""),
  R2_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(5 * 1024 * 1024),
});

export function loadConfig(environment: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration fields: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  const config = parsed.data;
  const origins = config.CORS_ORIGINS.split(",").map((origin) => origin.trim());
  if (
    !origins.length ||
    origins.some((origin) => {
      try {
        return new URL(origin).origin !== origin;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("CORS_ORIGINS must contain explicit origins without paths or wildcards.");
  }
  if (
    config.ACCESS_TOKEN_SECRET === config.OTP_HMAC_SECRET ||
    /replace-with|CHANGE_ME/i.test(config.ACCESS_TOKEN_SECRET + config.OTP_HMAC_SECRET)
  )
    throw new Error("Configure independent random authentication secrets.");
  if (config.COOKIE_SAME_SITE === "none" && !config.COOKIE_SECURE)
    throw new Error("SameSite=None requires secure cookies.");
  if (
    config.NODE_ENV === "production" &&
    (!config.COOKIE_SECURE ||
      config.OTP_PROVIDER !== "webhook" ||
      origins.some((o) => !o.startsWith("https://")))
  )
    throw new Error("Production requires HTTPS origins/cookies and real OTP delivery.");
  if (
    config.OTP_PROVIDER === "webhook" &&
    (!config.OTP_WEBHOOK_URL.startsWith("https://") || config.OTP_WEBHOOK_TOKEN.length < 16)
  )
    throw new Error("OTP webhook requires a trusted HTTPS URL and an authorization token.");
  if (config.R2_ENABLED) {
    const required = [
      "R2_ENDPOINT",
      "R2_BUCKET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_PUBLIC_BASE_URL",
    ] as const;
    const missing = required.filter(
      (field) => !config[field].trim() || /CHANGE_ME|replace-with|YOUR_/i.test(config[field]),
    );
    if (missing.length)
      throw new Error(
        `R2 configuration is missing or contains placeholders: ${missing.join(", ")}`,
      );
    try {
      const endpoint = new URL(config.R2_ENDPOINT);
      const publicUrl = new URL(config.R2_PUBLIC_BASE_URL);
      if (
        endpoint.protocol !== "https:" ||
        !endpoint.hostname.endsWith(".r2.cloudflarestorage.com") ||
        endpoint.pathname !== "/" ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.username ||
        endpoint.password ||
        publicUrl.protocol !== "https:" ||
        publicUrl.hostname.endsWith(".r2.cloudflarestorage.com") ||
        publicUrl.search ||
        publicUrl.hash ||
        publicUrl.username ||
        publicUrl.password
      ) {
        throw new Error("Invalid R2 URL.");
      }
    } catch {
      throw new Error(
        "R2 requires an HTTPS S3 endpoint and an HTTPS public base URL without credentials, query strings, or fragments.",
      );
    }
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.R2_BUCKET))
      throw new Error("R2_BUCKET must be a valid bucket name.");
  }
  return { ...config, origins };
}

export type Config = ReturnType<typeof loadConfig>;
