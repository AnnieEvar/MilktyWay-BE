import { z } from "zod";

const boolean = z.enum(["true", "false"]).transform((v) => v === "true");
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().regex(/^postgres(ql)?:\/\//),
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
});

export function loadConfig(environment: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid configuration fields: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  const config = parsed.data;
  const origins = config.CORS_ORIGINS.split(",").map((origin) => origin.trim());
  if (!origins.length || origins.some((origin) => { try { return new URL(origin).origin !== origin; } catch { return true; } })) {
    throw new Error("CORS_ORIGINS must contain explicit origins without paths or wildcards.");
  }
  if (config.ACCESS_TOKEN_SECRET === config.OTP_HMAC_SECRET || /replace-with|CHANGE_ME/i.test(config.ACCESS_TOKEN_SECRET + config.OTP_HMAC_SECRET)) throw new Error("Configure independent random authentication secrets.");
  if (config.COOKIE_SAME_SITE === "none" && !config.COOKIE_SECURE) throw new Error("SameSite=None requires secure cookies.");
  if (config.NODE_ENV === "production" && (!config.COOKIE_SECURE || config.OTP_PROVIDER !== "webhook" || origins.some((o) => !o.startsWith("https://")))) throw new Error("Production requires HTTPS origins/cookies and real OTP delivery.");
  if (config.OTP_PROVIDER === "webhook" && (!config.OTP_WEBHOOK_URL.startsWith("https://") || config.OTP_WEBHOOK_TOKEN.length < 16)) throw new Error("OTP webhook requires a trusted HTTPS URL and an authorization token.");
  return { ...config, origins };
}

export type Config = ReturnType<typeof loadConfig>;
