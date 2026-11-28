import { z } from "zod";

export const idSchema = z.uuid();
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9_-]+$/);
const moneyVnd = z.number().int().min(0).max(2_000_000_000);
const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");
const page = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const branchFields = {
  code,
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500),
  phone: z
    .string()
    .trim()
    .regex(/^0[0-9]{9}$/)
    .nullable(),
  operatingHours: z.string().trim().max(200),
  isActive: z.boolean(),
  acceptsOnline: z.boolean(),
  maxPendingOnline: z.number().int().min(1).max(10_000),
};

export const branchListSchema = z
  .object({ ...page, includeInactive: queryBoolean.default(false) })
  .strict();
export const createBranchSchema = z
  .object(branchFields)
  .extend({
    address: branchFields.address.default(""),
    phone: branchFields.phone.default(null),
    operatingHours: branchFields.operatingHours.default(""),
    isActive: branchFields.isActive.default(true),
    acceptsOnline: branchFields.acceptsOnline.default(true),
    maxPendingOnline: branchFields.maxPendingOnline.default(20),
  })
  .strict();
export const updateBranchSchema = z
  .object(branchFields)
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Supply at least one branch field.",
  })
  .transform((value) => ({
    ...(value.code !== undefined ? { code: value.code } : {}),
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.address !== undefined ? { address: value.address } : {}),
    ...(value.phone !== undefined ? { phone: value.phone } : {}),
    ...(value.operatingHours !== undefined ? { operatingHours: value.operatingHours } : {}),
    ...(value.isActive !== undefined ? { isActive: value.isActive } : {}),
    ...(value.acceptsOnline !== undefined ? { acceptsOnline: value.acceptsOnline } : {}),
    ...(value.maxPendingOnline !== undefined ? { maxPendingOnline: value.maxPendingOnline } : {}),
  }));
const zoneSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    areaCode: code,
    feeVnd: moneyVnd.default(0),
    isActive: z.boolean().default(true),
  })
  .strict();
export const deliveryZonesSchema = z
  .object({ zones: z.array(zoneSchema).max(100) })
  .strict()
  .refine(({ zones }) => new Set(zones.map((zone) => zone.areaCode)).size === zones.length, {
    message: "Area codes must be unique within the branch.",
  });
export const terminalListSchema = z.object({ ...page, branchId: idSchema }).strict();
export const createTerminalSchema = z.object({ branchId: idSchema, code }).strict();
export const shiftListSchema = z
  .object({ ...page, branchId: idSchema, status: z.enum(["OPEN", "CLOSED"]).optional() })
  .strict()
  .transform(({ status, ...rest }) => ({ ...rest, ...(status ? { status } : {}) }));
export const openShiftSchema = z
  .object({ terminalId: idSchema, openingCashVnd: moneyVnd })
  .strict();
export const closeShiftSchema = z
  .object({ closingCashVnd: moneyVnd, note: z.string().trim().max(1000).nullable().default(null) })
  .strict();
