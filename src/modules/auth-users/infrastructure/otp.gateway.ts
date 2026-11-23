import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../../../config/env.js";
import type { OtpGateway } from "../application/ports/security.js";

export function createOtpGateway(config: Config): OtpGateway {
  return {
    async deliver(input) {
      if (config.OTP_PROVIDER === "development") {
        if (config.NODE_ENV === "production") throw new Error("Development OTP delivery is disabled.");
        const directory = path.resolve(config.OTP_MAILBOX_DIR);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, `${input.challengeId}.json`), JSON.stringify(input), { mode: 0o600 });
        return;
      }
      const response = await fetch(config.OTP_WEBHOOK_URL, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", authorization: `Bearer ${config.OTP_WEBHOOK_TOKEN}` },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("OTP gateway rejected delivery.");
      await response.body?.cancel();
    },
  };
}
