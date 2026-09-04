import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { usersTable } from "@workspace/db";
import { db } from "@workspace/db";
import { eq } from "drizzle-orm";

export type AuthUser = {
  id: number;
  role: "USER" | "ORGANIZER" | "ADMIN";
  name: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const secret = process.env.SESSION_SECRET ?? "hacksphere-development-secret";

export function createToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, role: user.role }, secret, { expiresIn: "7d" });
}

async function resolveUser(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, secret) as { id?: number };
    if (!payload.id) return null;
    const [user] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.id));
    return user ?? null;
  } catch {
    return null;
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) {
    req.user = (await resolveUser(header.slice(7))) ?? undefined;
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  await optionalAuth(req, res, () => undefined);
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(...roles: Array<AuthUser["role"]>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have permission to perform this action" });
      return;
    }
    next();
  };
}