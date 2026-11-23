import path from "node:path";

const isProd = process.env.NODE_ENV === "production";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === "change-me") {
  if (isProd) throw new Error("JWT_SECRET must be set in production");
  console.warn("[config] JWT_SECRET is not set; using an insecure dev secret.");
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: jwtSecret && jwtSecret !== "change-me" ? jwtSecret : "dev-only-insecure-secret",
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "./uploads"),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  maxUploadBytes: 25 * 1024 * 1024,
};
