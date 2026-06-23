import type { Request, Response, NextFunction } from "express";
import { validateToken } from "./validate-token.js";
import type { AzureClaims } from "./validate-token.js";

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
