import { resolve } from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { config, DISCLAIMER, ROOT } from "./config.js";
import { openDb } from "./db.js";
import { registerRoutes } from "./routes.js";
import { runPoll } from "./ingest/poller.js";

async function main(): Promise<void> {
  openDb();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await registerRoutes(app);

  const webDist = resolve(ROOT, "web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/v1")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  const first = await runPoll();
  app.log.info({ poll: first }, "initial poll complete");

  const timer = setInterval(() => {
    runPoll().catch((err) => app.log.error(err, "poll failed"));
  }, config.pollMs);
  timer.unref();

  const address = await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      address,
      feedMode: config.feedMode,
      telegram: config.telegramToken && config.telegramChatId ? "live" : "dry-run",
    },
    `TrenchDesk up. ${DISCLAIMER}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
