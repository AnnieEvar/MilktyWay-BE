import type { Request, Response } from "express";
import { unauthorized } from "../../../shared/application/errors.js";
import type { AuthContext } from "../../../shared/application/auth-context.js";
import type { BranchService } from "../application/branch.service.js";
import type { CashShift, Page, PageInput } from "../domain/branch.js";
import * as schemas from "./branch.schema.js";

const shiftResponse = (shift: CashShift) => ({
  ...shift,
  status: shift.closedAt ? "CLOSED" : "OPEN",
});
function sendPage<T>(res: Response, result: Page<T>, input: PageInput) {
  res.json({
    data: result.items,
    meta: { page: input.page, pageSize: input.pageSize, total: result.total },
  });
}
const context = (res: Response): AuthContext => {
  if (!res.locals.auth) throw unauthorized();
  return res.locals.auth;
};

export function createBranchController(service: BranchService) {
  return {
    async list(req: Request, res: Response) {
      const input = schemas.branchListSchema.parse(req.query);
      sendPage(res, await service.listBranches(res.locals.auth, input), input);
    },
    async create(req: Request, res: Response) {
      res.status(201).json({
        data: await service.createBranch(context(res), schemas.createBranchSchema.parse(req.body)),
      });
    },
    async update(req: Request, res: Response) {
      res.json({
        data: await service.updateBranch(
          context(res),
          schemas.idSchema.parse(req.params.id),
          schemas.updateBranchSchema.parse(req.body),
        ),
      });
    },
    async deliveryZones(req: Request, res: Response) {
      const input = schemas.deliveryZonesSchema.parse(req.body);
      res.json({
        data: await service.replaceDeliveryZones(
          context(res),
          schemas.idSchema.parse(req.params.id),
          input.zones,
        ),
      });
    },
    async terminals(req: Request, res: Response) {
      const input = schemas.terminalListSchema.parse(req.query);
      sendPage(res, await service.listTerminals(context(res), input), input);
    },
    async createTerminal(req: Request, res: Response) {
      res.status(201).json({
        data: await service.createTerminal(
          context(res),
          schemas.createTerminalSchema.parse(req.body),
        ),
      });
    },
    async shifts(req: Request, res: Response) {
      const input = schemas.shiftListSchema.parse(req.query);
      const result = await service.listShifts(context(res), input);
      sendPage(res, { ...result, items: result.items.map(shiftResponse) }, input);
    },
    async openShift(req: Request, res: Response) {
      res.status(201).json({
        data: shiftResponse(
          await service.openShift(context(res), schemas.openShiftSchema.parse(req.body)),
        ),
      });
    },
    async closeShift(req: Request, res: Response) {
      res.json({
        data: shiftResponse(
          await service.closeShift(
            context(res),
            schemas.idSchema.parse(req.params.id),
            schemas.closeShiftSchema.parse(req.body),
          ),
        ),
      });
    },
    async summary(req: Request, res: Response) {
      res.json({
        data: shiftResponse(
          await service.shiftSummary(context(res), schemas.idSchema.parse(req.params.id)),
        ),
      });
    },
  };
}
