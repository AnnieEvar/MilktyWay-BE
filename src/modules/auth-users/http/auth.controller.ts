import type { CookieOptions, Request, Response } from "express";
import type { Config } from "../../../config/env.js";
import { unauthorized } from "../../../shared/application/errors.js";
import type { AuthService } from "../application/auth.service.js";
import type { SessionCredentials } from "../application/ports/security.js";
import type { AuthContext, SessionKind } from "../domain/identity.js";
import * as schemas from "./auth.schema.js";
import { customerResponse, principalResponse, staffResponse } from "./auth.presenter.js";

export function createAuthController(service: AuthService, config: Config) {
  const cookieName = (kind: SessionKind) => `milktyway_${kind.toLowerCase()}_refresh`;
  const cookieOptions: CookieOptions = { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: config.COOKIE_SAME_SITE, path: "/api/v1/auth" };
  const context = (res: Response): AuthContext => { if (!res.locals.auth) throw unauthorized(); return res.locals.auth; };
  const cookie = (req: Request, kind: SessionKind): string => {
    const cookies: unknown = req.cookies;
    const value = cookies && typeof cookies === "object" ? Reflect.get(cookies, cookieName(kind)) : undefined;
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw unauthorized();
    return value;
  };
  const sendCredentials = (res: Response, value: SessionCredentials) => {
    res.cookie(cookieName(value.kind), value.refreshToken, { ...cookieOptions, expires: value.expiresAt });
    res.json({ data: { accessToken: value.accessToken, tokenType: "Bearer", expiresIn: value.expiresIn, csrfToken: value.csrfToken, sessionKind: value.kind } });
  };
  return {
    async authenticate(req: Request, res: Response) {
      const header = req.get("authorization");
      if (!header?.startsWith("Bearer ") || header.length > 4096) throw unauthorized();
      res.locals.auth = await service.authenticate(header.slice(7));
    },
    async login(req: Request, res: Response) { sendCredentials(res, await service.login(schemas.loginSchema.parse(req.body))); },
    async refresh(req: Request, res: Response) {
      const { kind } = schemas.refreshSchema.parse(req.body);
      sendCredentials(res, await service.refresh(cookie(req, kind), kind, req.get("x-csrf-token") ?? ""));
    },
    async csrf(req: Request, res: Response) {
      const { kind } = schemas.csrfQuerySchema.parse(req.query);
      res.json({ data: { csrfToken: await service.csrf(cookie(req, kind), kind) } });
    },
    async logout(_req: Request, res: Response) {
      const auth = context(res);
      await service.logout(auth);
      res.clearCookie(cookieName(auth.kind), cookieOptions);
      res.status(204).end();
    },
    async me(_req: Request, res: Response) { res.json({ data: principalResponse(await service.me(context(res))) }); },
    async users(req: Request, res: Response) {
      const query = schemas.listUsersSchema.parse(req.query);
      const { users, total } = await service.listUsers(context(res), query);
      res.json({ data: users.map(staffResponse), meta: { ...query, total } });
    },
    async access(req: Request, res: Response) {
      const userId = schemas.idSchema.parse(req.params.id);
      const patch = schemas.accessSchema.parse(req.body);
      res.json({ data: staffResponse(await service.updateAccess(context(res), { userId, reason: patch.reason, ...(patch.role !== undefined ? { role: patch.role } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) })) });
    },
    async assignment(req: Request, res: Response) { res.status(201).json({ data: await service.assignStaff(context(res), schemas.assignmentSchema.parse(req.body)) }); },
    async requestOtp(req: Request, res: Response) { res.status(202).json({ data: await service.requestOtp(schemas.otpRequestSchema.parse(req.body).phone) }); },
    async verifyOtp(req: Request, res: Response) { sendCredentials(res, await service.verifyOtp(schemas.otpVerifySchema.parse(req.body))); },
    async enroll(req: Request, res: Response) { const input = schemas.membershipSchema.parse(req.body); res.status(201).json({ data: customerResponse(await service.enroll(context(res), input.fullName)) }); },
    async profile(_req: Request, res: Response) { res.json({ data: customerResponse(await service.customerProfile(context(res))) }); },
    async updateProfile(req: Request, res: Response) {
      const patch = schemas.profileSchema.parse(req.body);
      res.json({ data: customerResponse(await service.updateProfile(context(res), { ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}), ...(patch.email !== undefined ? { email: patch.email } : {}) })) });
    },
  };
}
