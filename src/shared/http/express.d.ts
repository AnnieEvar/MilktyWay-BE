import type { AuthContext } from "../application/auth-context.js";

declare global {
  namespace Express {
    interface Locals {
      auth?: AuthContext;
      requestId: string;
    }
  }
}

export {};
