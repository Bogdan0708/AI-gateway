import { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";

const PUBLIC_PATHS = new Set(["/health", "/ping"]);

function safeCompare(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  const masterKey = process.env.GATEWAY_MASTER_KEY;
  const authHeader = req.headers.authorization;

  if (!masterKey || !authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token || !safeCompare(token, masterKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
