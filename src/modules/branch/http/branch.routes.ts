import { Router, type RequestHandler } from "express";
import type { Config } from "../../../config/env.js";
import { forbidden, unauthorized } from "../../../shared/application/errors.js";
import type { AuthService } from "../../auth-users/index.js";
import type { BranchService } from "../application/branch.service.js";
import { createBranchController } from "./branch.controller.js";

export function createBranchRouter(service: BranchService, auth: AuthService, config: Config) {
  const router = Router();
  const controller = createBranchController(service);
  const optionalAuth: RequestHandler = async (req, res, next) => {
    const header = req.get("authorization");
    if (header !== undefined) {
      if (!header.startsWith("Bearer ") || header.length > 4096) throw unauthorized();
      res.locals.auth = await auth.authenticate(header.slice(7));
    }
    next();
  };
  const protect: RequestHandler = async (req, res, next) => {
    if (!req.get("authorization")) throw unauthorized();
    await optionalAuth(req, res, next);
  };
  const browserBoundary: RequestHandler = (req, _res, next) => {
    const origin = req.get("origin");
    if (!origin || !config.origins.includes(origin) || req.get("x-requested-with") !== "MilktyWay")
      throw forbidden();
    next();
  };
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/branches", optionalAuth, controller.list);
  router.post("/branches", browserBoundary, protect, controller.create);
  router.patch("/branches/:id", browserBoundary, protect, controller.update);
  router.put("/branches/:id/delivery-zones", browserBoundary, protect, controller.deliveryZones);
  router.get("/pos-terminals", protect, controller.terminals);
  router.post("/pos-terminals", browserBoundary, protect, controller.createTerminal);
  router.get("/cash-shifts", protect, controller.shifts);
  router.post("/cash-shifts/open", browserBoundary, protect, controller.openShift);
  router.post("/cash-shifts/:id/close", browserBoundary, protect, controller.closeShift);
  router.get("/cash-shifts/:id/summary", protect, controller.summary);
  return router;
}
