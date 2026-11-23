const isProd = process.env.NODE_ENV === "production";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === "change-me") {
  if (isProd) throw new Error("JWT_SECRET must be set in production");
  console.warn("[config] JWT_SECRET is not set; using an insecure dev secret.");
}

const MB = 1024 * 1024;

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: jwtSecret && jwtSecret !== "change-me" ? jwtSecret : "dev-only-insecure-secret",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  /** Uploads are stored in Postgres, so keep individual files small. */
  maxUploadBytes: 10 * MB,
  /** Total size of all uploads. Neon's free plan has 0.5 GB for the whole database, so stay well under it. */
  maxStorageBytes: (Number(process.env.UPLOAD_STORAGE_LIMIT_MB) || 300) * MB,
};
