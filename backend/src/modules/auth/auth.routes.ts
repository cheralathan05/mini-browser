import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError("Email is already registered", 409, "EMAIL_EXISTS");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
      },
    });

    // Create default workspace for user
    await prisma.workspace.create({
      data: {
        userId: user.id,
        name: "Default Workspace",
        description: "Your primary NEXUS workspace",
      },
    });

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, env.JWT_SECRET, {
      expiresIn: "7d",
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, env.JWT_SECRET, {
      expiresIn: "7d",
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar },
      token,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post("/logout", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      if (token) {
        await prisma.session.deleteMany({ where: { token } });
      }
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, name: true, avatar: true, createdAt: true },
    });

    if (!user) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ user, token });
  } catch (error) {
    next(error);
  }
});

// ALL /api/auth/session - Automatic session bootstrap for desktop client
router.all("/session", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, name: true, avatar: true, createdAt: true },
    });

    if (!user) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ user, token });
  } catch (error) {
    next(error);
  }
});

export const authRouter = router;
