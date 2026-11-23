import { z } from "zod";
import { staffRoles } from "../domain/identity.js";

const name = z.string().trim().min(1).max(120);
const email = z.string().trim().toLowerCase().email().max(254);
const reason = z.string().trim().min(5).max(500);
export const sessionKindSchema = z.enum(["STAFF", "CUSTOMER"]);
export const loginSchema = z.object({ email, password: z.string().min(1).max(256), remember: z.boolean().default(false) }).strict();
export const refreshSchema = z.object({ kind: sessionKindSchema }).strict();
export const csrfQuerySchema = z.object({ kind: sessionKindSchema }).strict();
export const listUsersSchema = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }).strict();
export const idSchema = z.uuid();
export const accessSchema = z.object({ role: z.enum(staffRoles).optional(), status: z.enum(["ACTIVE", "LOCKED"]).optional(), reason }).strict().refine((value) => value.role || value.status, { message: "Supply role or status." });
export const assignmentSchema = z.object({ userId: idSchema, branchId: idSchema.nullable().default(null), warehouseId: idSchema.nullable().default(null), terminalId: idSchema.nullable().default(null), reason }).strict().refine((value) => value.branchId || value.warehouseId, { message: "Supply a branch or warehouse." });
export const otpRequestSchema = z.object({ phone: z.string().regex(/^0[0-9]{9}$/) }).strict();
export const otpVerifySchema = z.object({ challengeId: idSchema, code: z.string().regex(/^[0-9]{6}$/), remember: z.boolean().default(false) }).strict();
export const membershipSchema = z.object({ fullName: name, consent: z.literal(true) }).strict();
export const profileSchema = z.object({ fullName: name.optional(), email: email.nullable().optional() }).strict().refine((value) => value.fullName !== undefined || value.email !== undefined, { message: "Supply at least one profile field." });
