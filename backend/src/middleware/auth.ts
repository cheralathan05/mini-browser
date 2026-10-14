import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
import { RequestWithId } from "./logger.js";

interface JwtPayload {
  userId: string;
  email: string;
  name: string;
}

export async function getDefaultUser(): Promise<{ id: string; email: string; name: string }> {
  let user = await prisma.user.findFirst({
    where: { email: "cheralathan@nexus.ai" },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    user = await prisma.user.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, name: true },
    });
  }

  if (!user) {
    const passwordHash = await bcrypt.hash("nexus123", 10);
    const created = await prisma.user.create({
      data: {
        email: "cheralathan@nexus.ai",
        name: "Cheralathan",
        passwordHash,
      },
    });
    user = { id: created.id, email: created.email, name: created.name };
  }

  // Ensure user has at least one active workspace
  const workspace = await prisma.workspace.findFirst({
    where: { userId: user.id },
  });

  if (!workspace) {
    await prisma.workspace.create({
      data: {
        userId: user.id,
        name: "Primary Workspace",
        description: "General research, automated workflows, and active web sessions.",
      },
    });
  }

  return user;
}

export async function requireAuth(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
          const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, email: true, name: true },
          });

          if (user) {
            req.user = user;
            return next();
          }
        } catch {
          // Token expired or invalid signature - fallback gracefully in local desktop app
        }
      }
    }

    // Local Desktop Fallback:
    // Always ensure an authenticated user is assigned so desktop browser functions
    // never hit 401 UNAUTHORIZED barriers.
    const defaultUser = await getDefaultUser();
    req.user = defaultUser;
    next();
  } catch (error) {
    next(error);
  }
}

export async function optionalAuth(req: RequestWithId, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
          const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, email: true, name: true },
          });
          if (user) {
            req.user = user;
            return next();
          }
        } catch {
          // Ignore invalid tokens
        }
      }
    }

    const defaultUser = await getDefaultUser();
    req.user = defaultUser;
    next();
  } catch (error) {
    next(error);
  }
}
