import { Router, type RequestHandler } from "express";
import type { Config } from "../../../config/env.js";
import { forbidden } from "../../../shared/application/errors.js";
import type { AuthService } from "../application/auth.service.js";
import { createAuthController } from "./auth.controller.js";

export function createAuthRouter(service: AuthService, config: Config) {
  const router = Router();
  const controller = createAuthController(service, config);
  const protect: RequestHandler = async (req, res, next) => { await controller.authenticate(req, res); next(); };
  // Requiring an allowlisted Origin plus a non-simple header protects session bootstrap
  // and login from cross-site form submissions. Refresh additionally checks its session token.
  const browserBoundary: RequestHandler = (req, _res, next) => {
    const origin = req.get("origin");
    if (!origin || !config.origins.includes(origin) || req.get("x-requested-with") !== "MilktyWay") throw forbidden();
    next();
  };
  const publicLimit: RequestHandler = async (req, _res, next) => {
    await service.limit(`http:${req.ip ?? "unknown"}:${req.path}`, 30, 60);
    next();
  };
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.post("/auth/login", browserBoundary, publicLimit, controller.login);
  router.post("/auth/refresh", browserBoundary, publicLimit, controller.refresh);
  router.get("/auth/csrf", browserBoundary, publicLimit, controller.csrf);
  router.post("/auth/logout", browserBoundary, protect, controller.logout);
  router.get("/auth/me", protect, controller.me);
  router.get("/users", protect, controller.users);
  router.patch("/users/:id/access", browserBoundary, protect, controller.access);
  router.post("/staff-assignments", browserBoundary, protect, controller.assignment);
  router.post("/customers/otp/request", browserBoundary, publicLimit, controller.requestOtp);
  router.post("/customers/otp/verify", browserBoundary, publicLimit, controller.verifyOtp);
  router.post("/customers/membership", browserBoundary, protect, controller.enroll);
  router.get("/customers/me", protect, controller.profile);
  router.patch("/customers/me", browserBoundary, protect, controller.updateProfile);
  return router;
}
