import { Router, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";

const router = Router();

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar: z.string().url().or(z.string().startsWith("data:")).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// GET /api/users/me - Get full current user profile
router.get("/me", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        preferences: true,
        _count: {
          select: {
            workspaces: true,
            agentTasks: true,
            researchProjects: true,
            memories: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/users/me - Update user name and avatar
router.patch("/me", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { name, avatar } = updateProfileSchema.parse(req.body);

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(name ? { name } : {}),
        ...(avatar !== undefined ? { avatar } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        updatedAt: true,
      },
    });

    res.json({ user: updated, message: "Profile updated successfully" });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/me/password - Change password securely
router.put("/me/password", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      throw new AppError("User not found", 404, "NOT_FOUND");
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError("Current password is incorrect", 400, "INVALID_PASSWORD");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash },
    });

    res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    next(error);
  }
});

// GET /api/users/me/preferences - Get preferences
router.get("/me/preferences", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const prefs = await prisma.userPreference.findMany({
      where: { userId: req.user!.id },
    });

    const prefMap: Record<string, unknown> = {};
    for (const p of prefs) {
      prefMap[p.key] = p.value;
    }

    res.json({ preferences: prefMap });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/me/preferences - Bulk upsert preferences
router.put("/me/preferences", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const updates = req.body as Record<string, unknown>;
    if (!updates || typeof updates !== "object") {
      throw new AppError("Preferences payload must be an object", 400, "BAD_REQUEST");
    }

    for (const [key, value] of Object.entries(updates)) {
      await prisma.userPreference.upsert({
        where: {
          userId_key: {
            userId: req.user!.id,
            key,
          },
        },
        update: { value: value as any },
        create: {
          userId: req.user!.id,
          key,
          value: value as any,
        },
      });
    }

    res.json({ success: true, message: "Preferences saved" });
  } catch (error) {
    next(error);
  }
});

// GET /api/users - List users directory (team/workspace members)
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

export const usersRouter = router;

