// NEXUS AGENT - APPROVAL MANAGER

import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";

export class ApprovalManager {
  private static waitingRuns: Map<string, { approvalId: string; resolve: (approved: boolean) => void }> = new Map();

  public static isWaiting(runId: string): boolean {
    return this.waitingRuns.has(runId);
  }

  public static registerPendingApproval(
    runId: string,
    approvalId: string,
    resolve: (approved: boolean) => void
  ) {
    this.waitingRuns.set(runId, { approvalId, resolve });
  }

  public static async resolve(approvalId: string, status: "approved" | "rejected", userId: string): Promise<boolean> {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: approvalId, userId },
    });

    if (!approval) return false;

    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: { status, resolvedAt: new Date() },
    });

    const approved = status === "approved";

    // Broadcast resolution
    wsManager.broadcast(
      "approval.resolved",
      { approvalId, status, taskId: approval.taskId, runId: approval.agentRunId },
      { userId: approval.userId, workspaceId: approval.workspaceId }
    );

    // If an active run is in-memory waiting for this approval, resume or fail it
    for (const [runId, entry] of this.waitingRuns.entries()) {
      if (entry.approvalId === approvalId) {
        entry.resolve(approved);
        this.waitingRuns.delete(runId);
        break;
      }
    }

    return true;
  }

  public static cleanup(runId: string) {
    this.waitingRuns.delete(runId);
  }
}
