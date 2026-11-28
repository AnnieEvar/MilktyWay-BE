import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createContainer } from "./bootstrap/container.js";
import { createPrismaClient } from "./shared/infrastructure/database/prisma-client.js";
import { createLogger } from "./shared/infrastructure/logging/logger.js";

const logger = createLogger();
try {
  const config = loadConfig(process.env);
  const prisma = createPrismaClient(config.DATABASE_URL, config.DB_POOL_MAX);
  await prisma.$connect();
  const { service, branchService } = await createContainer(config, prisma);
  const app = createApp({
    config,
    service,
    branchService,
    logger,
    ready: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  });
  const server = app.listen(config.PORT, () =>
    logger.info({ event: "server_started", port: config.PORT }),
  );
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      void prisma.$disconnect().then(() => {
        clearTimeout(deadline);
      });
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  logger.fatal({
    event: "startup_failed",
    errorType: error instanceof Error ? error.name : "unknown",
  });
  process.exitCode = 1;
}
