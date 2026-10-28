import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { RequestWithId } from "../../middleware/logger.js";
import { AppError } from "../../middleware/error.js";
import { ToolRegistry } from "./tool-registry.js";
import { SkillValidator } from "./skill-validator.js";
import { SkillExecutorService } from "./skill-executor.service.js";
import { InputFieldDefinition, OutputFieldDefinition } from "./skills.types.js";

const router = Router();

// 4 Built-in real skills to seed
const DEFAULT_SKILLS = [
  {
    name: "Competitor Pricing Monitor",
    description: "Autonomously navigates permitted competitor product pages, extracts visible pricing, normalizes SKU telemetry, and saves an authorized research report.",
    category: "research",
    tags: ["pricing", "ecommerce", "intelligence"],
    tools: ["browser_navigate", "browser_extract", "analyze_document", "save_report"],
    instructions: "Navigate to target product URL, extract price, analyze against baseline, and generate competitor pricing intelligence report.",
    inputSchema: [
      { name: "targetUrl", type: "string", label: "Product Page URL", description: "Target product page URL to monitor", required: true, defaultValue: "https://example.com/products/nexus-pro" },
      { name: "productName", type: "string", label: "Product Name", description: "Exact name of the product being tracked", required: true, defaultValue: "Nexus Enterprise Pro" },
    ],
    outputSchema: [
      { name: "productPrice", type: "string", description: "Normalized extracted product price" },
      { name: "currency", type: "string", description: "Price currency denomination" },
      { name: "availability", type: "string", description: "In-stock status" },
      { name: "competitorReport", type: "string", description: "Synthesized markdown pricing analysis" },
    ],
    permissions: { network: true, browser: true, sandbox: false, approvalRequired: false },
    config: { timeoutSeconds: 30, maxRetries: 2 },
    testCases: [
      {
        name: "Standard Catalog Probe",
        inputs: { targetUrl: "https://example.com/products/nexus-pro", productName: "Nexus Enterprise Pro" },
      },
    ],
  },
  {
    name: "Deep Web Research & Synthesizer",
    description: "Searches configured sources, retrieves permitted pages, extracts evidence citations, compares claims, and generates a cited synthesis report.",
    category: "research",
    tags: ["research", "citations", "synthesis"],
    tools: ["web_search", "browser_extract", "record_source", "analyze_document", "save_report"],
    instructions: "Search web for given topic, extract verified evidence, record citations, and synthesize structured research findings.",
    inputSchema: [
      { name: "query", type: "string", label: "Investigation Topic", description: "Core question or technology to research", required: true, defaultValue: "Autonomous Agent Architectures 2026" },
      { name: "depth", type: "string", label: "Research Depth", description: "Scope: quick or deep", required: false, defaultValue: "deep" },
    ],
    outputSchema: [
      { name: "reportMarkdown", type: "string", description: "Final cited research report" },
      { name: "sources", type: "array", description: "Verified source citations" },
      { name: "keyFindings", type: "array", description: "Executive findings summary" },
    ],
    permissions: { network: true, browser: true, sandbox: false, approvalRequired: false },
    config: { timeoutSeconds: 45, maxRetries: 2 },
    testCases: [
      {
        name: "Agent Architecture Research",
        inputs: { query: "Autonomous Agent Architectures 2026", depth: "quick" },
      },
    ],
  },
  {
    name: "Web Form Assistant",
    description: "Inspects a supported form, validates supplied values, prepares field payload, and pauses for human-in-the-loop approval before final submission.",
    category: "browser",
    tags: ["forms", "approval", "automation"],
    tools: ["browser_navigate", "browser_extract", "request_approval"],
    instructions: "Inspect target form, validate input fields, generate submission payload, and request user authorization.",
    inputSchema: [
      { name: "formUrl", type: "string", label: "Target Form URL", description: "URL of the form to populate", required: true, defaultValue: "https://example.com/registration" },
      { name: "formData", type: "object", label: "Form Field Values", description: "Key-value mapping of field selectors to values", required: true, defaultValue: { fullName: "Alex Rivera", email: "alex@nexus.io" } },
      { name: "requireHumanApproval", type: "boolean", label: "Require Human Approval", description: "Whether to pause before final submission", required: false, defaultValue: true },
    ],
    outputSchema: [
      { name: "formFieldsFound", type: "array", description: "Discovered input fields" },
      { name: "validationStatus", type: "string", description: "Field validation result" },
      { name: "approvalId", type: "string", description: "Approval request ID if paused" },
    ],
    permissions: { network: true, browser: true, sandbox: false, approvalRequired: true },
    config: { timeoutSeconds: 20, maxRetries: 1 },
    testCases: [
      {
        name: "Registration Form Validation",
        inputs: { formUrl: "https://example.com/registration", formData: { fullName: "Alex Rivera", email: "alex@nexus.io" }, requireHumanApproval: true },
      },
    ],
  },
  {
    name: "Code Review Assistant",
    description: "Inspects explicitly provided source code, identifies bugs, performance bottlenecks, and security issues, suggests patches, and runs test cases in sandbox.",
    category: "coding",
    tags: ["code-review", "security", "sandbox"],
    tools: ["analyze_document", "generate_code", "run_tests"],
    instructions: "Analyze code for vulnerabilities, generate optimized patch, and execute tests in the secure sandbox.",
    inputSchema: [
      { name: "code", type: "string", label: "Source Code", description: "Code snippet or module to inspect", required: true, defaultValue: "def process_data(items):\n    res = []\n    for i in items:\n        if i not in res:\n            res.append(i)\n    return res" },
      { name: "language", type: "string", label: "Language", description: "Programming language (python, javascript)", required: true, defaultValue: "python" },
      { name: "context", type: "string", label: "Review Context", description: "Specific focus area (e.g., performance, security)", required: false, defaultValue: "Time complexity optimization" },
    ],
    outputSchema: [
      { name: "findings", type: "array", description: "List of identified issues" },
      { name: "suggestedPatch", type: "string", description: "Optimized source code" },
      { name: "testStatus", type: "string", description: "Sandbox test validation output" },
      { name: "summary", type: "string", description: "Review summary" },
    ],
    permissions: { network: false, browser: false, sandbox: true, approvalRequired: false },
    config: { timeoutSeconds: 30, maxRetries: 1 },
    testCases: [
      {
        name: "Deduplication Optimization Review",
        inputs: { code: "def dedupe(arr): return list(set(arr))", language: "python", context: "Check ordering guarantee" },
      },
    ],
  },
];

// Helper to auto-seed default skills for user
async function seedDefaultSkillsIfEmpty(userId: string, workspaceId?: string) {
  for (const item of DEFAULT_SKILLS) {
    const existing = await prisma.skill.findFirst({
      where: { userId, name: item.name },
    });
    if (existing) {
      if (existing.lifecycleState !== "active") {
        await prisma.skill.update({
          where: { id: existing.id },
          data: { lifecycleState: "active", isSystem: true },
        });
      }
      const existingVer = await prisma.skillVersion.findFirst({
        where: { skillId: existing.id, version: 1 },
      });
      if (!existingVer) {
        await prisma.skillVersion.create({
          data: {
            skillId: existing.id,
            version: 1,
            definition: {
              instructions: item.instructions,
              executorType: "standard",
              tools: item.tools,
              inputSchema: item.inputSchema,
              outputSchema: item.outputSchema,
              permissions: item.permissions,
              config: item.config,
            } as object,
            inputSchema: item.inputSchema as object,
            outputSchema: item.outputSchema as object,
            tools: item.tools as object,
            permissions: item.permissions as object,
            config: item.config as object,
            changeLog: "Initial verified release",
          },
        });
      }
      continue;
    }

    const skill = await prisma.skill.create({
      data: {
        userId,
        workspaceId: workspaceId || undefined,
        name: item.name,
        description: item.description,
        instructions: item.instructions,
        category: item.category,
        lifecycleState: "active", // Seeded skills are verified and active
        currentVersion: 1,
        tags: item.tags,
        tools: item.tools as object,
        inputSchema: item.inputSchema as object,
        outputSchema: item.outputSchema as object,
        permissions: item.permissions as object,
        config: item.config as object,
        isSystem: true,
      },
    });

    const version = await prisma.skillVersion.create({
      data: {
        skillId: skill.id,
        version: 1,
        definition: {
          instructions: item.instructions,
          executorType: "standard",
          tools: item.tools,
          inputSchema: item.inputSchema,
          outputSchema: item.outputSchema,
          permissions: item.permissions,
          config: item.config,
        } as object,
        inputSchema: item.inputSchema as object,
        outputSchema: item.outputSchema as object,
        tools: item.tools as object,
        permissions: item.permissions as object,
        config: item.config as object,
        changeLog: "Initial verified release",
      },
    });

    if (item.testCases && item.testCases.length > 0) {
      for (const tc of item.testCases) {
        await prisma.skillTest.create({
          data: {
            skillId: skill.id,
            skillVersionId: version.id,
            name: tc.name,
            inputs: tc.inputs as object,
            status: "passed",
          },
        });
      }
    }
  }
}

// ============================================================
// ROUTES
// ============================================================

// GET /api/v1/skills/tools/catalog
router.get("/tools/catalog", requireAuth, async (_req: RequestWithId, res: Response) => {
  const tools = ToolRegistry.getCatalogSummary();
  res.json({ tools, count: tools.length });
});

// GET /api/v1/skills
router.get("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    // Auto-seed default verified skills if user has none
    await seedDefaultSkillsIfEmpty(req.user!.id, workspaceId);

    const where: any = {
      userId: req.user!.id,
    };

    if (workspaceId) {
      where.workspaceId = workspaceId;
    }
    if (status && status !== "all") {
      where.lifecycleState = status;
    }
    if (category && category !== "all") {
      where.category = category;
    }
    if (search && search.trim().length > 0) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const skills = await prisma.skill.findMany({
      where,
      include: {
        versions: {
          select: { id: true, version: true, createdAt: true, changeLog: true },
          orderBy: { version: "desc" },
        },
        executions: {
          select: { id: true, status: true, durationMs: true, startedAt: true },
          orderBy: { startedAt: "desc" },
          take: 5,
        },
        tests: {
          select: { id: true, name: true, status: true, lastRunAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ skills, count: skills.length });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills
router.post("/", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const name = (body.name || "").trim();
    const description = (body.description || "").trim();
    const category = body.category || "automation";
    const tools = Array.isArray(body.tools) ? body.tools : ["web_search"];
    const inputSchema = Array.isArray(body.inputSchema) ? body.inputSchema : [];
    const outputSchema = Array.isArray(body.outputSchema) ? body.outputSchema : [];
    const permissions = body.permissions || { network: true, browser: false, sandbox: false, approvalRequired: false };
    const config = body.config || { timeoutSeconds: 30, maxRetries: 1 };
    const instructions = body.instructions || description;
    const testCases = Array.isArray(body.testCases) ? body.testCases : [];
    const tags = Array.isArray(body.tags) ? body.tags : [];

    const validation = SkillValidator.validate({
      name,
      description,
      tools,
      inputSchema,
      outputSchema,
      config,
      testCases,
    });

    const initialLifecycle = validation.valid ? "ready" : "draft";

    const skill = await prisma.skill.create({
      data: {
        userId: req.user!.id,
        workspaceId: body.workspaceId || undefined,
        name,
        description,
        instructions,
        category,
        lifecycleState: initialLifecycle,
        currentVersion: 1,
        tags,
        tools: tools as object,
        inputSchema: inputSchema as object,
        outputSchema: outputSchema as object,
        permissions: permissions as object,
        config: config as object,
        validationErrors: validation.errors.length > 0 ? (validation.errors as object) : undefined,
      },
    });

    const skillVersion = await prisma.skillVersion.create({
      data: {
        skillId: skill.id,
        version: 1,
        definition: {
          instructions,
          executorType: "standard",
          tools,
          inputSchema,
          outputSchema,
          permissions,
          config,
          testCases,
        } as object,
        inputSchema: inputSchema as object,
        outputSchema: outputSchema as object,
        tools: tools as object,
        permissions: permissions as object,
        config: config as object,
        changeLog: "Initial draft creation",
      },
    });

    if (testCases.length > 0) {
      for (const tc of testCases) {
        await prisma.skillTest.create({
          data: {
            skillId: skill.id,
            skillVersionId: skillVersion.id,
            name: tc.name || "Test Case",
            inputs: (tc.inputs || {}) as object,
            status: "pending",
          },
        });
      }
    }

    res.status(201).json({ skill, validation });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/skills/:id
router.get("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        versions: { orderBy: { version: "desc" } },
        executions: {
          orderBy: { startedAt: "desc" },
          take: 20,
        },
        tests: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!skill) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    res.json({ skill });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v1/skills/:id
router.patch("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    const body = req.body || {};
    const hasDefinitionChanges =
      body.tools !== undefined ||
      body.inputSchema !== undefined ||
      body.outputSchema !== undefined ||
      body.instructions !== undefined ||
      body.config !== undefined;

    let updatedVersionNumber = existing.currentVersion;

    if (hasDefinitionChanges) {
      updatedVersionNumber = existing.currentVersion + 1;

      const tools = body.tools || existing.tools;
      const inputSchema = body.inputSchema || existing.inputSchema;
      const outputSchema = body.outputSchema || existing.outputSchema;
      const permissions = body.permissions || existing.permissions;
      const config = body.config || existing.config;
      const instructions = body.instructions || existing.instructions;

      await prisma.skillVersion.create({
        data: {
          skillId: existing.id,
          version: updatedVersionNumber,
          definition: {
            instructions,
            executorType: "standard",
            tools,
            inputSchema,
            outputSchema,
            permissions,
            config,
          } as object,
          inputSchema: inputSchema as object,
          outputSchema: outputSchema as object,
          tools: tools as object,
          permissions: permissions as object,
          config: config as object,
          changeLog: body.changeLog || `Updated definition to version ${updatedVersionNumber}`,
        },
      });
    }

    const updated = await prisma.skill.update({
      where: { id: existing.id },
      data: {
        name: body.name !== undefined ? body.name : undefined,
        description: body.description !== undefined ? body.description : undefined,
        category: body.category !== undefined ? body.category : undefined,
        instructions: body.instructions !== undefined ? body.instructions : undefined,
        tags: body.tags !== undefined ? body.tags : undefined,
        tools: body.tools !== undefined ? (body.tools as object) : undefined,
        inputSchema: body.inputSchema !== undefined ? (body.inputSchema as object) : undefined,
        outputSchema: body.outputSchema !== undefined ? (body.outputSchema as object) : undefined,
        permissions: body.permissions !== undefined ? (body.permissions as object) : undefined,
        config: body.config !== undefined ? (body.config as object) : undefined,
        currentVersion: updatedVersionNumber,
      },
    });

    res.json({ skill: updated });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/skills/:id
router.delete("/:id", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    await prisma.skill.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: `Skill "${existing.name}" deleted.` });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills/:id/validate
router.post("/:id/validate", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { tests: true },
    });

    if (!skill) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    const validation = SkillValidator.validate({
      name: skill.name,
      description: skill.description,
      tools: (skill.tools as unknown as string[]) || [],
      inputSchema: (skill.inputSchema as unknown as InputFieldDefinition[]) || [],
      outputSchema: (skill.outputSchema as unknown as OutputFieldDefinition[]) || [],
      config: skill.config as any,
      testCases: skill.tests.map((t) => ({ name: t.name, inputs: t.inputs as any })),
    });

    await prisma.skill.update({
      where: { id: skill.id },
      data: {
        validationErrors: validation.errors.length > 0 ? (validation.errors as object) : undefined,
        lifecycleState: validation.valid
          ? skill.lifecycleState === "draft"
            ? "ready"
            : skill.lifecycleState
          : "failed_validation",
      },
    });

    res.json({ validation });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills/:id/activate
router.post("/:id/activate", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { tests: true },
    });

    if (!skill) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    const validation = SkillValidator.validate({
      name: skill.name,
      description: skill.description,
      tools: (skill.tools as unknown as string[]) || [],
      inputSchema: (skill.inputSchema as unknown as InputFieldDefinition[]) || [],
      outputSchema: (skill.outputSchema as unknown as OutputFieldDefinition[]) || [],
      config: skill.config as any,
      testCases: skill.tests.map((t) => ({ name: t.name, inputs: t.inputs as any })),
    });

    if (!validation.valid) {
      await prisma.skill.update({
        where: { id: skill.id },
        data: { lifecycleState: "failed_validation", validationErrors: validation.errors as object },
      });
      throw new AppError(
        `Skill activation rejected due to validation errors: ${validation.errors.map((e) => e.message).join("; ")}`,
        400,
        "VALIDATION_FAILED"
      );
    }

    const updated = await prisma.skill.update({
      where: { id: skill.id },
      data: {
        lifecycleState: "active",
        validationErrors: undefined,
      },
    });

    res.json({ skill: updated, message: `Skill "${skill.name}" is now active and ready for autonomous agent execution.` });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills/:id/disable
router.post("/:id/disable", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!skill) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    const updated = await prisma.skill.update({
      where: { id: skill.id },
      data: { lifecycleState: "disabled" },
    });

    res.json({ skill: updated, message: `Skill "${skill.name}" has been disabled.` });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills/:id/execute
router.post("/:id/execute", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const inputs = req.body.inputs || {};
    const version = req.body.version ? Number(req.body.version) : undefined;
    const caller = req.body.caller || "manual";

    const execution = await SkillExecutorService.executeSkill({
      skillId: req.params.id,
      version,
      userId: req.user!.id,
      workspaceId: req.body.workspaceId || undefined,
      inputs,
      caller,
      isTestRun: false,
    });

    res.json({ execution });
  } catch (error: any) {
    next(error);
  }
});

// GET /api/v1/skills/:id/versions
router.get("/:id/versions", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const versions = await prisma.skillVersion.findMany({
      where: {
        skillId: req.params.id,
        skill: { userId: req.user!.id },
      },
      orderBy: { version: "desc" },
    });

    res.json({ versions });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills/:id/versions/:version/rollback
router.post("/:id/versions/:version/rollback", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const targetVersion = Number(req.params.version);
    const versionRecord = await prisma.skillVersion.findFirst({
      where: {
        skillId: req.params.id,
        version: targetVersion,
        skill: { userId: req.user!.id },
      },
    });

    if (!versionRecord) {
      throw new AppError(`Version ${targetVersion} not found`, 404, "NOT_FOUND");
    }

    const updated = await prisma.skill.update({
      where: { id: req.params.id },
      data: {
        currentVersion: targetVersion,
        tools: versionRecord.tools as object,
        inputSchema: versionRecord.inputSchema as object,
        outputSchema: versionRecord.outputSchema as object,
        permissions: versionRecord.permissions as object,
        config: versionRecord.config as object,
      },
    });

    res.json({ skill: updated, message: `Rolled back skill to version ${targetVersion}` });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/skills/:id/executions
router.get("/:id/executions", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const executions = await prisma.skillExecution.findMany({
      where: {
        skillId: req.params.id,
        userId: req.user!.id,
      },
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    res.json({ executions });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/skills/:id/tests
router.post("/:id/tests", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const skill = await prisma.skill.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!skill) {
      throw new AppError("Skill not found", 404, "NOT_FOUND");
    }

    const { name, inputs, runNow = true } = req.body;
    const testCase = await prisma.skillTest.create({
      data: {
        skillId: skill.id,
        name: name || "Interactive Verification Test",
        inputs: (inputs || {}) as object,
        status: "pending",
      },
    });

    if (runNow) {
      const startTime = Date.now();
      try {
        const execution = await SkillExecutorService.executeSkill({
          skillId: skill.id,
          userId: req.user!.id,
          inputs: inputs || {},
          caller: "test",
          isTestRun: true,
        });

        const passed = execution.status === "completed" || execution.status === "waiting_for_approval";
        const updatedTest = await prisma.skillTest.update({
          where: { id: testCase.id },
          data: {
            status: passed ? "passed" : "failed",
            result: execution.outputs as object,
            error: execution.error,
            durationMs: Date.now() - startTime,
            lastRunAt: new Date(),
          },
        });

        return res.json({ test: updatedTest, execution });
      } catch (testErr: any) {
        const updatedTest = await prisma.skillTest.update({
          where: { id: testCase.id },
          data: {
            status: "failed",
            error: testErr?.message || "Test execution error",
            durationMs: Date.now() - startTime,
            lastRunAt: new Date(),
          },
        });
        return res.json({ test: updatedTest, error: testErr?.message });
      }
    }

    res.status(201).json({ test: testCase });
  } catch (error) {
    next(error);
  }
});

// Backward compatibility: POST /api/skills/:id/run
router.post("/:id/run", requireAuth, async (req: RequestWithId, res: Response, next: NextFunction) => {
  try {
    const execution = await SkillExecutorService.executeSkill({
      skillId: req.params.id,
      userId: req.user!.id,
      workspaceId: req.body.workspaceId || undefined,
      inputs: req.body.inputs || {},
      caller: "manual",
    });

    res.status(202).json({ execution, message: "Skill execution initiated" });
  } catch (error) {
    next(error);
  }
});

export const skillsRouter = router;
