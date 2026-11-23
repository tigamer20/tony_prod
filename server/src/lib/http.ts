import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const forbidden = (msg = "You do not have permission to do that.") => new HttpError(403, msg);
export const notFound = (msg = "Not found.") => new HttpError(404, msg);
export const badRequest = (msg = "Invalid request.") => new HttpError(400, msg);

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw badRequest(`${where}${issue?.message ?? "Invalid input"}`);
  }
  return result.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
    const isAvatar = (err as { field?: string }).field === "avatar";
    res.status(413).json({ error: isAvatar ? "That photo is too large (1 MB max)." : "File is too large (10 MB max)." });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0]! : (v as string);
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "channel"
  );
}
