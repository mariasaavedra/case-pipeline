import type { Request, Response, NextFunction } from "express";
import { validateToken } from "./validate-token.js";
import type { AzureClaims } from "./validate-token.js";
import { usersDb } from "../db/users-db.js";

declare global {
  namespace Express {
    interface Request {
      user?: AzureClaims;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    req.user = await validateToken(auth.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Gate a route to admins only. Runs AFTER requireAuth (needs req.user set) and
 * checks the caller's role in users.db. Use for config/permission mutations.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const oid = req.user?.oid ?? "";
  const row = usersDb
    .prepare("SELECT role FROM users WHERE azure_oid = ?")
    .get(oid) as { role: string } | undefined;
  if (row?.role !== "admin") {
    res.status(403).json({ error: "Forbidden — admin access required" });
    return;
  }
  next();
}
