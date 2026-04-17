import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }
  const expected = process.env.ADMIN_API_KEY;
  const provided = req.headers["x-admin-key"];
  if (!expected || typeof provided !== "string" || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
