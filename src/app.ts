import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import type { Logger } from "pino";
import type { Config } from "./config/env.js";
import { createAuthRouter, type AuthService } from "./modules/auth-users/index.js";
import { AppError } from "./shared/application/errors.js";

export function createApp(deps: { config: Config; service: AuthService; logger: Logger; ready: () => Promise<void> }) {
  const { config, service, logger, ready } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use((req, res, next) => {
    const start = performance.now();
    res.locals.requestId = randomUUID();
    res.set("X-Request-Id", res.locals.requestId);
    res.on("finish", () => logger.info({ event: "http_request", requestId: res.locals.requestId, method: req.method, path: req.path, statusCode: res.statusCode, durationMs: Math.round(performance.now() - start) }));
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: config.origins, credentials: true, allowedHeaders: ["Authorization", "Content-Type", "X-CSRF-Token", "X-Requested-With"], exposedHeaders: ["X-Request-Id"] }));
  app.use(express.json({ limit: "16kb", strict: true }));
  app.use(cookieParser());
  app.get("/health/live", (_req, res) => { res.json({ status: "ok" }); });
  app.get("/health/ready", async (_req, res) => {
    try { await ready(); res.json({ status: "ready" }); }
    catch { res.status(503).json({ status: "unavailable" }); }
  });
  app.use("/api/v1", createAuthRouter(service, config));
  app.use((_req, _res, next) => next(new AppError(404, "ROUTE_NOT_FOUND", "Route not found.")));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    let appError: AppError;
    if (error instanceof AppError) appError = error;
    else if (error instanceof ZodError) appError = new AppError(422, "VALIDATION_ERROR", "Request validation failed.");
    else if (error instanceof SyntaxError && "body" in error) appError = new AppError(400, "INVALID_JSON", "Malformed JSON request.");
    else if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") appError = new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    else {
      appError = new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
      logger.error({ event: "request_failed", requestId: res.locals.requestId, errorType: error instanceof Error ? error.name : "unknown" });
    }
    if (appError.status === 429) res.set("Retry-After", "60");
    res.set("Cache-Control", "no-store").status(appError.status).json({ error: { code: appError.code, message: appError.message, requestId: res.locals.requestId } });
  };
  app.use(errorHandler);
  return app;
}
