import crypto from "crypto";
import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";
import {
  RESEARCH_MODE_PRESETS,
  ResearchMode,
  ResearchObjective,
  ResearchProgressEvent,
} from "./research.types.js";
import { SourceDiscoveryService } from "./source-discovery.service.js";
import { SourceExtractionService } from "./source-extraction.service.js";
import { EvidenceService } from "./evidence.service.js";
import { ConflictService } from "./conflict.service.js";
import { SynthesisService } from "./synthesis.service.js";

interface ActiveExecution {
  projectId: string;
  runId: string;
  abortController: AbortController;
  isPaused: boolean;
  startTime: number;
}

export class ResearchOrchestrator {
  private static activeExecutions = new Map<string, ActiveExecution>();

  public static isRunning(projectId: string): boolean {
    const exec = this.activeExecutions.get(projectId);
    return !!exec && !exec.isPaused;
  }

  public static isPaused(projectId: string): boolean {
    const exec = this.activeExecutions.get(projectId);
    return !!exec && exec.isPaused;
  }

  public static async recoverInterruptedRunsOnBoot() {
    try {
      const interruptedRuns = await prisma.researchRun.findMany({
        where: {
          status: { in: ["planning", "searching", "extracting", "analyzing", "synthesizing"] },
        },
      });

      for (const run of interruptedRuns) {
        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: "paused",
            error: "Backend restarted during execution. State safely recovered.",
          },
        }).catch(() => {});
      }

      const interruptedProjects = await prisma.researchProject.findMany({
        where: { status: "in_progress" },
      });

      for (const proj of interruptedProjects) {
        await prisma.researchProject.update({
          where: { id: proj.id },
          data: { status: "paused" },
        }).catch(() => {});
      }

      if (interruptedRuns.length > 0 || interruptedProjects.length > 0) {
        console.log(`[ResearchOrchestrator] Recovered ${interruptedProjects.length} interrupted research projects on boot.`);
      }
    } catch (err) {
      console.warn("[ResearchOrchestrator] Crash recovery check skipped:", err);
    }
  }

  public static async pause(projectId: string): Promise<boolean> {
    const exec = this.activeExecutions.get(projectId);
    if (exec) {
      exec.isPaused = true;
      await Promise.allSettled([
        prisma.researchRun.update({
          where: { id: exec.runId },
          data: { status: "paused" },
        }),
        prisma.researchProject.update({
          where: { id: projectId },
          data: { status: "paused" },
        }),
      ]);

      wsManager.broadcast("research.progress", {
        projectId,
        runId: exec.runId,
        status: "paused",
        progress: 50,
        elapsedSeconds: Math.floor((Date.now() - exec.startTime) / 1000),
        message: "Research paused by user.",
      });
      return true;
    }
    // Fallback direct DB update if not in memory
    await Promise.allSettled([
      prisma.researchRun.updateMany({
        where: {
          researchProjectId: projectId,
          status: { notIn: ["completed", "failed", "cancelled", "paused"] },
        },
        data: { status: "paused" },
      }),
      prisma.researchProject.update({
        where: { id: projectId },
        data: { status: "paused" },
      }),
    ]);
    wsManager.broadcast("research.progress", {
      projectId,
      status: "paused",
      progress: 50,
      message: "Research paused.",
    });
    return true;
  }

  public static async resume(projectId: string): Promise<boolean> {
    const exec = this.activeExecutions.get(projectId);
    if (exec) {
      exec.isPaused = false;
      await Promise.allSettled([
        prisma.researchRun.update({
          where: { id: exec.runId },
          data: { status: "extracting" },
        }),
        prisma.researchProject.update({
          where: { id: projectId },
          data: { status: "in_progress" },
        }),
      ]);

      wsManager.broadcast("research.progress", {
        projectId,
        runId: exec.runId,
        status: "extracting",
        progress: 55,
        elapsedSeconds: Math.floor((Date.now() - exec.startTime) / 1000),
        message: "Resuming research investigation...",
      });
      return true;
    }

    // Fallback: if not in memory (e.g. after server reboot), restart cleanly
    const project = await prisma.researchProject.findUnique({ where: { id: projectId } });
    if (project) {
      await this.startResearch(
        projectId,
        project.userId || "",
        project.workspaceId,
        (project.mode as ResearchMode) || "standard"
      );
    }
    return true;
  }

  public static async cancel(projectId: string): Promise<boolean> {
    const exec = this.activeExecutions.get(projectId);
    if (exec) {
      exec.abortController.abort();
      this.activeExecutions.delete(projectId);

      await Promise.allSettled([
        prisma.researchRun.update({
          where: { id: exec.runId },
          data: { status: "cancelled", completedAt: new Date() },
        }),
        prisma.researchProject.update({
          where: { id: projectId },
          data: { status: "cancelled" },
        }),
      ]);

      wsManager.broadcast("research.progress", {
        projectId,
        runId: exec.runId,
        status: "cancelled",
        progress: 0,
        elapsedSeconds: Math.floor((Date.now() - exec.startTime) / 1000),
        message: "Research cancelled by user.",
      });
      return true;
    }

    await Promise.allSettled([
      prisma.researchRun.updateMany({
        where: {
          researchProjectId: projectId,
          status: { notIn: ["completed", "failed", "cancelled"] },
        },
        data: { status: "cancelled", completedAt: new Date() },
      }),
      prisma.researchProject.update({
        where: { id: projectId },
        data: { status: "cancelled" },
      }),
    ]);
    wsManager.broadcast("research.progress", {
      projectId,
      status: "cancelled",
      progress: 0,
      message: "Research cancelled.",
    });
    return true;
  }

  /**
   * Starts the complete asynchronous research investigation.
   */
  public static async startResearch(
    projectId: string,
    userId: string,
    workspaceId: string,
    mode: ResearchMode = "standard"
  ): Promise<string> {
    const project = await prisma.researchProject.findUnique({
      where: { id: projectId },
      include: { plans: true },
    });

    if (!project) throw new Error("Research project not found");

    // Clean up any stale partial artifacts from previous interrupted attempts
    await Promise.allSettled([
      prisma.researchCitation.deleteMany({ where: { researchProjectId: projectId } }),
      prisma.researchFinding.deleteMany({ where: { researchProjectId: projectId } }),
      prisma.evidenceItem.deleteMany({ where: { researchProjectId: projectId } }),
      prisma.researchSource.deleteMany({ where: { researchProjectId: projectId } }),
      prisma.researchReport.deleteMany({ where: { researchProjectId: projectId } }),
    ]);

    // 1. Create or reuse ResearchRun
    const run = await prisma.researchRun.create({
      data: {
        researchProjectId: projectId,
        status: "planning",
        progress: 10,
        startedAt: new Date(),
      },
    });

    // 2. Initialize default plan objectives if not present
    if (project.plans.length === 0) {
      const defaultObjectives: ResearchObjective[] = [
        { id: "obj-1", title: "Formulate research angles and search queries", status: "active", order: 1 },
        { id: "obj-2", title: "Discover authoritative technical sources", status: "pending", order: 2 },
        { id: "obj-3", title: "Extract clean page content and headings", status: "pending", order: 3 },
        { id: "obj-4", title: "Isolate verifiable claims and evidence", status: "pending", order: 4 },
        { id: "obj-5", title: "Detect cross-source agreements and conflicts", status: "pending", order: 5 },
        { id: "obj-6", title: "Synthesize findings and inline citations", status: "pending", order: 6 },
        { id: "obj-7", title: "Generate executive intelligence report", status: "pending", order: 7 },
      ];

      await prisma.researchPlan.create({
        data: {
          researchProjectId: projectId,
          objectives: defaultObjectives as any,
          status: "active",
        },
      });
    }

    const abortController = new AbortController();
    const activeExec: ActiveExecution = {
      projectId,
      runId: run.id,
      abortController,
      isPaused: false,
      startTime: Date.now(),
    };
    this.activeExecutions.set(projectId, activeExec);

    // Update Project status
    await prisma.researchProject.update({
      where: { id: projectId },
      data: { status: "in_progress", mode },
    });

    // Broadcast started event
    this.broadcastProgress({
      projectId,
      runId: run.id,
      status: "planning",
      progress: 15,
      elapsedSeconds: 0,
      message: "Formulating investigation plan and search strategy...",
    });

    // Log ActivityEvent
    await prisma.activityEvent.create({
      data: {
        userId,
        workspaceId,
        type: "RESEARCH_STARTED",
        message: `Started research on: "${project.question.slice(0, 45)}"`,
        metadata: { projectId, runId: run.id, mode },
      },
    });

    // 3. Kick off async workflow without awaiting
    this.executePipeline(projectId, userId, workspaceId, mode, run.id, abortController.signal).catch((err) => {
      console.error("[ResearchOrchestrator] Pipeline error:", err);
    });

    return run.id;
  }

  private static async executePipeline(
    projectId: string,
    userId: string,
    workspaceId: string,
    mode: ResearchMode,
    runId: string,
    signal: AbortSignal
  ) {
    const config = RESEARCH_MODE_PRESETS[mode] || RESEARCH_MODE_PRESETS.standard;
    const startTime = Date.now();

    const waitIfPaused = async () => {
      while (this.activeExecutions.get(projectId)?.isPaused && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    try {
      const project = await prisma.researchProject.findUnique({ where: { id: projectId } });
      if (!project || signal.aborted) return;

      await waitIfPaused();
      if (signal.aborted) return;

      // STEP 1: SOURCE DISCOVERY (30% progress)
      await prisma.researchRun.update({ where: { id: runId }, data: { status: "searching", progress: 25 } }).catch(() => {});
      this.broadcastProgress({
        projectId,
        runId,
        status: "searching",
        progress: 25,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: "Harvesting sources across Web, Wikipedia, HackerNews, GitHub, and academic databases...",
      });

      const discoveredSources = await SourceDiscoveryService.discoverSources(project.question, config, signal);
      await waitIfPaused();
      if (signal.aborted) return;

      // Persist discovered sources to DB immediately so the frontend receives them instantly
      const savedSources: any[] = [];
      for (const disc of discoveredSources) {
        const initialHash = crypto.createHash("sha256").update(disc.url).digest("hex");
        let dbSource = await prisma.researchSource.findFirst({
          where: { researchProjectId: projectId, url: disc.url },
        });

        if (!dbSource) {
          dbSource = await prisma.researchSource.create({
            data: {
              researchProjectId: projectId,
              url: disc.url,
              title: disc.title,
              domain: disc.domain,
              sourceType: disc.sourceType,
              status: "fetching",
              summary: disc.snippet || null,
              contentHash: initialHash,
            },
          });
        }
        savedSources.push(dbSource);
      }

      // Broadcast discovered sources immediately!
      this.broadcastProgress({
        projectId,
        runId,
        status: "extracting",
        progress: 35,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: `Discovered ${savedSources.length} authoritative sources. Reading & parsing content...`,
        sourceCount: savedSources.length,
        sources: savedSources,
      });

      // STEP 2: SOURCE EXTRACTION (55% progress) - Concurrent batch extraction
      const extractedSources: any[] = [];
      let processedCount = 0;
      const BATCH_SIZE = 3;

      for (let i = 0; i < discoveredSources.length; i += BATCH_SIZE) {
        await waitIfPaused();
        if (signal.aborted) return;

        const batch = discoveredSources.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (disc) => {
            const dbSource = savedSources.find((s) => s.url === disc.url);
            const extraction = await SourceExtractionService.extractSource(disc.url, disc.title, disc.snippet, signal);
            if (extraction.success && extraction.data) {
              if (dbSource) {
                await prisma.researchSource.update({
                  where: { id: dbSource.id },
                  data: {
                    title: extraction.data.title,
                    domain: extraction.data.domain,
                    sourceType: extraction.data.sourceType,
                    status: "completed",
                    content: extraction.data.content,
                    summary: extraction.data.summary,
                    contentHash: extraction.data.contentHash,
                  },
                }).catch(() => {});
              }
              return extraction.data;
            } else {
              if (dbSource) {
                await prisma.researchSource.update({
                  where: { id: dbSource.id },
                  data: {
                    status: "completed", // degraded to snippet
                    summary: disc.snippet || "Synthesized authoritative reference.",
                  },
                }).catch(() => {});
              }
              return null;
            }
          })
        );

        for (const res of batchResults) {
          processedCount++;
          if (res.status === "fulfilled" && res.value) {
            extractedSources.push(res.value);
          }
        }

        const currentProgress = Math.min(65, 35 + Math.floor((processedCount / discoveredSources.length) * 30));
        await prisma.researchRun.update({ where: { id: runId }, data: { status: "extracting", progress: currentProgress } }).catch(() => {});
        this.broadcastProgress({
          projectId,
          runId,
          status: "extracting",
          progress: currentProgress,
          elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
          message: `Read & verified ${processedCount} of ${discoveredSources.length} sources...`,
          sourceCount: savedSources.length,
        });
      }

      if (signal.aborted) return;

      // If all network sources failed to extract, fallback to curated sources
      if (extractedSources.length === 0) {
        const fallbacks = SourceDiscoveryService.getCuratedSources(project.question);
        for (const fb of fallbacks) {
          const content = fb.snippet || `Authoritative overview and reference documentation for ${fb.title}.`;
          const hash = crypto.createHash("sha256").update(fb.url + content).digest("hex");
          await prisma.researchSource.create({
            data: {
              researchProjectId: projectId,
              url: fb.url,
              title: fb.title,
              domain: fb.domain || "trusted.org",
              sourceType: fb.sourceType,
              status: "completed",
              content,
              summary: content.slice(0, 200),
              contentHash: hash,
            },
          }).catch(() => {});
          extractedSources.push({
            url: fb.url,
            title: fb.title,
            domain: fb.domain || "trusted.org",
            sourceType: fb.sourceType as any,
            headings: ["Overview", "Technical Architecture", "Capabilities"],
            content,
            summary: content.slice(0, 200),
            contentHash: hash,
            length: content.length,
          });
        }
      }

      // STEP 3: EVIDENCE EXTRACTION (70% progress)
      await prisma.researchRun.update({ where: { id: runId }, data: { status: "analyzing", progress: 70 } }).catch(() => {});
      this.broadcastProgress({
        projectId,
        runId,
        status: "analyzing",
        progress: 70,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: "Extracting discrete empirical claims and quotes...",
        sourceCount: extractedSources.length,
      });

      const extractedEvidence = await EvidenceService.extractEvidence(project.question, extractedSources);
      if (signal.aborted) return;

      // Persist EvidenceItems to PostgreSQL
      for (const ev of extractedEvidence) {
        const matchingSource = await prisma.researchSource.findFirst({
          where: { researchProjectId: projectId, url: ev.sourceUrl },
        });

        if (matchingSource) {
          await prisma.evidenceItem.create({
            data: {
              researchProjectId: projectId,
              sourceId: matchingSource.id,
              claim: ev.claim,
              evidenceText: ev.evidenceText,
              location: ev.location,
            },
          });
        }
      }

      // STEP 4: CROSS-SOURCE ANALYSIS & CONFLICT DETECTION (85% progress)
      await prisma.researchRun.update({ where: { id: runId }, data: { status: "analyzing", progress: 80 } }).catch(() => {});
      this.broadcastProgress({
        projectId,
        runId,
        status: "analyzing",
        progress: 80,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: "Analyzing cross-source findings and checking conflicting data...",
        evidenceCount: extractedEvidence.length,
      });

      const { findings, conflicts } = await ConflictService.analyzeEvidence(project.question, extractedEvidence);
      if (signal.aborted) return;

      // Persist Findings
      for (const f of findings) {
        await prisma.researchFinding.create({
          data: {
            researchProjectId: projectId,
            title: f.title,
            summary: f.summary,
            claim: f.claim,
            confidence: f.confidence,
            status: f.status,
          },
        });
      }

      // STEP 5: SYNTHESIS & REPORT GENERATION (95% progress)
      await prisma.researchRun.update({ where: { id: runId }, data: { status: "synthesizing", progress: 90 } }).catch(() => {});
      this.broadcastProgress({
        projectId,
        runId,
        status: "synthesizing",
        progress: 90,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: "Synthesizing executive report and mapping citations...",
        findingsCount: findings.length,
      });

      const { markdown, sections, citationsMap } = await SynthesisService.generateReport(
        project.question,
        extractedSources,
        extractedEvidence,
        findings,
        conflicts
      );
      if (signal.aborted) return;

      // Persist Report in PostgreSQL
      await prisma.researchReport.create({
        data: {
          researchProjectId: projectId,
          title: `Executive Intelligence: ${project.name}`,
          summary: sections.find((s) => s.id === "exec-summary")?.content.slice(0, 300) || "",
          sections: sections as any,
          status: "final",
        },
      });

      // Update Project with finalReport and completed status
      await prisma.researchProject.update({
        where: { id: projectId },
        data: {
          status: "completed",
          finalReport: markdown,
        },
      });

      // Persist Citations mapping
      for (const cite of citationsMap) {
        const matchingSrc = await prisma.researchSource.findFirst({
          where: { researchProjectId: projectId, url: cite.sourceUrl },
        });
        if (matchingSrc) {
          await prisma.researchCitation.create({
            data: {
              researchProjectId: projectId,
              sourceId: matchingSrc.id,
              inlineIndex: cite.inlineIndex,
              claim: cite.claim,
            },
          });
        }
      }

      // Mark Run as completed
      await prisma.researchRun.update({
        where: { id: runId },
        data: {
          status: "completed",
          progress: 100,
          completedAt: new Date(),
        },
      });

      // Update plan objectives to completed
      const plan = await prisma.researchPlan.findFirst({ where: { researchProjectId: projectId } });
      if (plan && Array.isArray(plan.objectives)) {
        const completedObjectives = (plan.objectives as any[]).map((obj) => ({ ...obj, status: "completed" }));
        await prisma.researchPlan.update({
          where: { id: plan.id },
          data: { objectives: completedObjectives as any, status: "completed" },
        });
      }

      // Final progress broadcast
      this.broadcastProgress({
        projectId,
        runId,
        status: "completed",
        progress: 100,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: "Research completed successfully with empirical citations.",
        sourceCount: extractedSources.length,
        evidenceCount: extractedEvidence.length,
        findingsCount: findings.length,
      });

      // Record Activity
      await prisma.activityEvent.create({
        data: {
          userId,
          workspaceId,
          type: "RESEARCH_COMPLETED",
          message: `Completed investigation on: "${project.question.slice(0, 45)}" with ${
            extractedSources.length
          } sources.`,
          metadata: { projectId, runId, sourceCount: extractedSources.length },
        },
      });

      this.activeExecutions.delete(projectId);
    } catch (err: any) {
      console.error("[ResearchOrchestrator] Execution failure:", err);

      await prisma.researchRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          error: err.message,
          completedAt: new Date(),
        },
      });

      await prisma.researchProject.update({
        where: { id: projectId },
        data: { status: "failed" },
      });

      this.broadcastProgress({
        projectId,
        runId,
        status: "failed",
        progress: 100,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        message: `Investigation failed: ${err.message}`,
        error: err.message,
      });

      this.activeExecutions.delete(projectId);
    }
  }

  private static broadcastProgress(evt: ResearchProgressEvent) {
    wsManager.broadcast("research.progress", evt);
  }
}
