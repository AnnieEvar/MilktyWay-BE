import pino from "pino";

export function createLogger() {
  return pino({ redact: ["authorization", "cookie", "password", "code", "refreshToken", "databaseUrl"] });
}
