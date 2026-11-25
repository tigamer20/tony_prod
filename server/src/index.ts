import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { requireAuth } from "./auth.js";
import { ensureDefaults } from "./bootstrap.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler } from "./lib/http.js";
import { initRealtime } from "./realtime.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { documentsRouter } from "./routes/documents.js";
import { deleteAbandonedUploads, filesRouter } from "./routes/files.js";
import { mentionsRouter } from "./routes/mentions.js";
import { teamRouter } from "./routes/team.js";
import { workRouter } from "./routes/work.js";

const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api", requireAuth, teamRouter, chatRouter, filesRouter, workRouter, documentsRouter, mentionsRouter);
app.use("/api", (_req, res) => void res.status(404).json({ error: "Not found." }));

// In production the API also serves the built web app.
const clientDist = path.resolve(import.meta.dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/(api|socket\.io)\/).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.use(errorHandler);

const server = http.createServer(app);
initRealtime(server);

await ensureDefaults();
await deleteAbandonedUploads().catch((e) => console.error("[uploads] cleanup failed", e));
setInterval(() => void deleteAbandonedUploads().catch(() => {}), 6 * 60 * 60 * 1000).unref();
server.listen(config.port, () => {
  console.log(`Tony Prod server listening on http://localhost:${config.port}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
