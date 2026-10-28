import crypto from "crypto";
import { prisma } from "../../config/db.js";
import { wsManager } from "../../websocket/ws-server.js";
import { AuditService } from "../activity/audit.service.js";
import { AgentService } from "../../agents/agent.service.js";
import { AutomationRunnerService } from "../automation/automation-runner.service.js";
import { AppError } from "../../middleware/error.js";

export interface CreateApprovalOptions {
  userId: string;
  workspaceId: string;
  taskId?: string;
  agentRunId?: string;
  workflowExecutionId?: string;
  stepId?: string;
  skillExecutionId?: string;
  actionTitle?: string;
  actionType?: string;
  action: string;
  target: string;
  details?: Record<string, any>;
  requestingActor?: string;
  callerId?: string;
  riskLevel?: "low" | "moderate" | "high" | "critical";
  autoExpireHours?: number;
}

export interface EvaluatePolicyOptions {
  action: string;
  actionType?: string;
  target?: string;
  details?: Record<string, any>;
  riskLevel?: string;
  userId: string;
  workspaceId?: string;
}

const DEFAULT_BASELINE_POLICIES = [
  {
    name: "External Communications Gate",
    category: "external_communication",
    description: "Requires explicit human authorization before dispatching messages via WhatsApp, Email, or external messaging gateways.",
    riskThreshold: "moderate",
    requiresApproval: true,
    autoExpireHours: 24,
  },
  {
    name: "External Form Submissions Guard",
    category: "form_submission",
    description: "Requires review of fields and target URL before autonomous form submission on external domains.",
    riskThreshold: "high",
    requiresApproval: true,
    autoExpireHours: 12,
  },
  {
    name: "Destructive Operations Guard",
    category: "destructive_operation",
    description: "Halts destructive mutations, record purges, table drops, and file deletions pending security approval.",
    riskThreshold: "high",
    requiresApproval: true,
    autoExpireHours: 6,
  },
  {
    name: "Sensitive Data & Credential Access Guard",
    category: "sensitive_data_access",
    description: "Intercepts requests to extract stored credentials, environment secrets, or bulk personal data.",
    riskThreshold: "critical",
    requiresApproval: true,
    autoExpireHours: 4,
  },
  {
    name: "Consequential Browser Mutations",
    category: "browser_mutation",
    description: "Requires authorization before automated clicks, uploads, or stateful POST actions on non-whitelisted domains.",
    riskThreshold: "moderate",
    requiresApproval: true,
    autoExpireHours: 24,
  },
];

export class ApprovalPolicyEngine {
  /**
   * Generates a deterministic SHA-256 hash of a normalized payload
   */
  public static computePayloadDigest(payload: any): string {
    if (!payload) return "";
    try {
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      return crypto.createHash("sha256").update(canonical).digest("hex");
    } catch {
      return crypto.createHash("sha256").update(String(payload)).digest("hex");
    }
  }

  /**
   * Seeds default security policies for a user if none exist
   */
  public static async seedDefaultPoliciesIfEmpty(userId: string, workspaceId?: string) {
    const existing = await prisma.approvalPolicy.count({
      where: { userId },
    });

    if (existing > 0) return;

    for (const p of DEFAULT_BASELINE_POLICIES) {
      await prisma.approvalPolicy.create({
        data: {
          userId,
          workspaceId: workspaceId || undefined,
          name: p.name,
          category: p.category,
          description: p.description,
          riskThreshold: p.riskThreshold,
          requiresApproval: p.requiresApproval,
          autoExpireHours: p.autoExpireHours,
          enabled: true,
        },
      });
    }
  }

  /**
   * Evaluates if a given action requires an approval gate based on active policies
   */
  public static async evaluateAction(options: EvaluatePolicyOptions): Promise<{
    requiresApproval: boolean;
    policyId?: string;
    policyName?: string;
    riskLevel: string;
    reason: string;
  }> {
    const { action, actionType, details = {}, riskLevel = "moderate", userId, workspaceId } = options;

    await this.seedDefaultPoliciesIfEmpty(userId, workspaceId);

    const activePolicies = await prisma.approvalPolicy.findMany({
      where: {
        userId,
        enabled: true,
      },
    });

    const actLower = (action || "").toLowerCase();
    const typeLower = (actionType || "").toLowerCase();

    // Check external communication policy
    const commPolicy = activePolicies.find((p) => p.category === "external_communication");
    if (commPolicy && commPolicy.requiresApproval && (actLower.includes("whatsapp") || actLower.includes("email") || actLower.includes("message") || typeLower.includes("comm."))) {
      return {
        requiresApproval: true,
        policyId: commPolicy.id,
        policyName: commPolicy.name,
        riskLevel: riskLevel || commPolicy.riskThreshold,
        reason: `Matched security policy: ${commPolicy.name}`,
      };
    }

    // Check form submission policy
    const formPolicy = activePolicies.find((p) => p.category === "form_submission");
    if (formPolicy && formPolicy.requiresApproval && (actLower.includes("form") || actLower.includes("submit") || typeLower.includes("fillform"))) {
      return {
        requiresApproval: true,
        policyId: formPolicy.id,
        policyName: formPolicy.name,
        riskLevel: riskLevel || formPolicy.riskThreshold,
        reason: `Matched security policy: ${formPolicy.name}`,
      };
    }

    // Check destructive operation policy
    const deletePolicy = activePolicies.find((p) => p.category === "destructive_operation");
    if (deletePolicy && deletePolicy.requiresApproval && (actLower.includes("delete") || actLower.includes("drop") || actLower.includes("purge") || actLower.includes("destroy"))) {
      return {
        requiresApproval: true,
        policyId: deletePolicy.id,
        policyName: deletePolicy.name,
        riskLevel: "high",
        reason: `Matched security policy: ${deletePolicy.name}`,
      };
    }

    // Check sensitive data access policy
    const dataPolicy = activePolicies.find((p) => p.category === "sensitive_data_access");
    if (dataPolicy && dataPolicy.requiresApproval && (actLower.includes("secret") || actLower.includes("credential") || actLower.includes("token") || actLower.includes("key"))) {
      return {
        requiresApproval: true,
        policyId: dataPolicy.id,
        policyName: dataPolicy.name,
        riskLevel: "critical",
        reason: `Matched security policy: ${dataPolicy.name}`,
      };
    }

    // Fallback: If caller labeled action as critical or high, fail-closed into approval
    if (riskLevel === "critical" || riskLevel === "high") {
      return {
        requiresApproval: true,
        riskLevel,
        reason: `Action declared as ${riskLevel} risk level requiring human sign-off.`,
      };
    }

    return {
      requiresApproval: false,
      riskLevel,
      reason: "Action classified as low-risk or read-only operation.",
    };
  }

  /**
   * Creates a persisted ApprovalRequest bound to payload digest and expiration
   */
  public static async createApproval(options: CreateApprovalOptions) {
    const {
      userId,
      workspaceId,
      taskId,
      agentRunId,
      workflowExecutionId,
      stepId,
      skillExecutionId,
      actionTitle,
      actionType,
      action,
      target,
      details = {},
      requestingActor = "system",
      callerId,
      riskLevel = "moderate",
      autoExpireHours = 24,
    } = options;

    let validUserId = userId;
    if (!validUserId) {
      const u = await prisma.user.findFirst();
      validUserId = u?.id || "";
    }

    let validWorkspaceId = workspaceId;
    if (!validWorkspaceId && validUserId) {
      const ws = await prisma.workspace.findFirst({ where: { userId: validUserId } });
      validWorkspaceId = ws?.id || "";
    }

    const safeDetails = AuditService.redactSecrets(details);
    const payloadDigest = this.computePayloadDigest(safeDetails);
    const expiresAt = new Date(Date.now() + autoExpireHours * 60 * 60 * 1000);

    const title = actionTitle || `Authorize ${action.replace(/[._]/g, " ")}`;

    const approval = await prisma.approvalRequest.create({
      data: {
        userId: validUserId,
        workspaceId: validWorkspaceId,
        taskId: taskId || undefined,
        agentRunId: agentRunId || undefined,
        workflowExecutionId: workflowExecutionId || undefined,
        stepId: stepId || undefined,
        skillExecutionId: skillExecutionId || undefined,
        actionTitle: title,
        actionType: actionType || action,
        action,
        target,
        details: safeDetails as object,
        requestingActor,
        callerId: callerId || undefined,
        payloadDigest,
        riskLevel,
        status: "pending",
        expiresAt,
      },
    });

    // Record ActivityEvent
    await AuditService.log({
      userId,
      workspaceId,
      category: "approvals",
      actorType: requestingActor.startsWith("workflow") ? "workflow" : requestingActor.startsWith("agent") ? "agent" : "system",
      sourceModule: "approvals",
      actionName: "approval.request_created",
      outcome: "pending",
      message: `Approval requested: ${title} on ${target} (${riskLevel} risk)`,
      type: "APPROVAL_REQUEST_CREATED",
      approvalRequestId: approval.id,
      workflowExecutionId: workflowExecutionId || undefined,
      skillExecutionId: skillExecutionId || undefined,
      taskId: taskId || undefined,
      metadata: {
        target,
        riskLevel,
        expiresAt: expiresAt.toISOString(),
      },
    });

    // Create Notification
    await prisma.notification.create({
      data: {
        userId,
        type: "APPROVAL_REQUIRED",
        title: "Action Authorization Required",
        message: `${requestingActor} requested to execute "${action}" on ${target}.`,
      },
    });

    // Broadcast over WebSocket
    wsManager.broadcast(
      "approval.required",
      {
        approvalId: approval.id,
        action: approval.action,
        actionTitle: approval.actionTitle,
        target: approval.target,
        riskLevel: approval.riskLevel,
        requestingActor: approval.requestingActor,
        expiresAt: approval.expiresAt?.toISOString(),
      },
      { userId, workspaceId }
    );

    return approval;
  }

  /**
   * Approves a pending request with payload tamper verification and execution resumption
   */
  public static async approve(id: string, userId: string, approverNotes?: string) {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id, userId },
      include: { decisions: true },
    });

    if (!approval) {
      throw new AppError("Approval request not found", 404, "NOT_FOUND");
    }

    if (approval.status !== "pending") {
      throw new AppError(`Approval request cannot be approved because current status is "${approval.status}".`, 400, "INVALID_STATE");
    }

    // Expiration check
    if (approval.expiresAt && new Date(approval.expiresAt).getTime() < Date.now()) {
      await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: { status: "expired" },
      });
      throw new AppError("Approval request has expired and can no longer be authorized.", 400, "EXPIRED");
    }

    // Cryptographic payload tamper check
    if (approval.payloadDigest && approval.details) {
      const currentDigest = this.computePayloadDigest(approval.details);
      if (currentDigest !== approval.payloadDigest) {
        throw new AppError("Action payload has drifted or was modified since request creation. Approval denied.", 400, "PAYLOAD_TAMPERED");
      }
    }

    // Atomic transaction
    const [updatedApproval, decision] = await prisma.$transaction([
      prisma.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: "approved",
          resolvedAt: new Date(),
        },
      }),
      prisma.approvalDecision.create({
        data: {
          approvalRequestId: approval.id,
          userId,
          decision: "approved",
          reason: approverNotes || "Authorized by user",
          payloadDigest: approval.payloadDigest,
        },
      }),
    ]);

    // Record Activity
    await AuditService.log({
      userId,
      workspaceId: approval.workspaceId,
      category: "approvals",
      actorType: "user",
      actorId: userId,
      sourceModule: "approvals",
      actionName: "approval.granted",
      outcome: "success",
      message: `Approved: ${approval.actionTitle || approval.action} on ${approval.target}`,
      type: "APPROVAL_RESOLVED",
      approvalRequestId: approval.id,
      workflowExecutionId: approval.workflowExecutionId || undefined,
      skillExecutionId: approval.skillExecutionId || undefined,
      taskId: approval.taskId || undefined,
      metadata: {
        decisionId: decision.id,
        target: approval.target,
        approverNotes,
      },
    });

    // Broadcast resolution
    wsManager.broadcast(
      "approval.resolved",
      {
        approvalId: approval.id,
        status: "approved",
        taskId: approval.taskId,
        workflowExecutionId: approval.workflowExecutionId,
      },
      { userId, workspaceId: approval.workspaceId }
    );

    // Resume execution
    if (approval.taskId) {
      try {
        await AgentService.resumeTask(approval.taskId, userId);
      } catch (err) {
        console.warn("[ApprovalPolicyEngine] Auto-resume task notice:", err);
      }
    }

    if (approval.workflowExecutionId && approval.stepId) {
      try {
        await AutomationRunnerService.resumeExecution(approval.workflowExecutionId, approval.stepId, userId);
      } catch (wfErr) {
        console.warn("[ApprovalPolicyEngine] Auto-resume workflow notice:", wfErr);
      }
    }

    return { approval: updatedApproval, decision };
  }

  /**
   * Rejects an approval request, permanently halting the waiting execution
   */
  public static async reject(id: string, userId: string, reason?: string) {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id, userId },
    });

    if (!approval) {
      throw new AppError("Approval request not found", 404, "NOT_FOUND");
    }

    if (approval.status !== "pending") {
      throw new AppError(`Approval request cannot be rejected because current status is "${approval.status}".`, 400, "INVALID_STATE");
    }

    const [updatedApproval, decision] = await prisma.$transaction([
      prisma.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: "rejected",
          resolvedAt: new Date(),
        },
      }),
      prisma.approvalDecision.create({
        data: {
          approvalRequestId: approval.id,
          userId,
          decision: "rejected",
          reason: reason || "Rejected by user",
          payloadDigest: approval.payloadDigest,
        },
      }),
    ]);

    // Halt executing tasks
    if (approval.taskId) {
      try {
        await AgentService.cancelTask(approval.taskId, userId);
      } catch {}
    }

    if (approval.workflowExecutionId) {
      try {
        await AutomationRunnerService.cancelExecution(approval.workflowExecutionId, userId);
      } catch {}
    }

    // Record Activity
    await AuditService.log({
      userId,
      workspaceId: approval.workspaceId,
      category: "approvals",
      actorType: "user",
      actorId: userId,
      sourceModule: "approvals",
      actionName: "approval.rejected",
      outcome: "warning",
      message: `Rejected: ${approval.actionTitle || approval.action} on ${approval.target}. Reason: ${reason || "User decision"}`,
      type: "APPROVAL_REJECTED",
      approvalRequestId: approval.id,
      workflowExecutionId: approval.workflowExecutionId || undefined,
      skillExecutionId: approval.skillExecutionId || undefined,
      taskId: approval.taskId || undefined,
      metadata: {
        reason,
        target: approval.target,
      },
    });

    wsManager.broadcast(
      "approval.resolved",
      {
        approvalId: approval.id,
        status: "rejected",
        taskId: approval.taskId,
        workflowExecutionId: approval.workflowExecutionId,
      },
      { userId, workspaceId: approval.workspaceId }
    );

    return { approval: updatedApproval, decision };
  }

  /**
   * Cancels a pending approval request
   */
  public static async cancel(id: string, userId: string, reason?: string) {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id, userId },
    });

    if (!approval) {
      throw new AppError("Approval request not found", 404, "NOT_FOUND");
    }

    if (approval.status !== "pending") {
      throw new AppError(`Approval request cannot be cancelled because current status is "${approval.status}".`, 400, "INVALID_STATE");
    }

    const [updatedApproval, decision] = await prisma.$transaction([
      prisma.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: "cancelled",
          resolvedAt: new Date(),
        },
      }),
      prisma.approvalDecision.create({
        data: {
          approvalRequestId: approval.id,
          userId,
          decision: "cancelled",
          reason: reason || "Cancelled by user",
          payloadDigest: approval.payloadDigest,
        },
      }),
    ]);

    // Halt executing tasks
    if (approval.taskId) {
      try {
        await AgentService.cancelTask(approval.taskId, userId);
      } catch {}
    }
    if (approval.workflowExecutionId) {
      try {
        await AutomationRunnerService.cancelExecution(approval.workflowExecutionId, userId);
      } catch {}
    }

    await AuditService.log({
      userId,
      workspaceId: approval.workspaceId,
      category: "approvals",
      actorType: "user",
      actorId: userId,
      sourceModule: "approvals",
      actionName: "approval.cancelled",
      outcome: "warning",
      message: `Cancelled: ${approval.actionTitle || approval.action} on ${approval.target}`,
      type: "APPROVAL_CANCELLED",
      approvalRequestId: approval.id,
      workflowExecutionId: approval.workflowExecutionId || undefined,
      skillExecutionId: approval.skillExecutionId || undefined,
      taskId: approval.taskId || undefined,
    });

    wsManager.broadcast(
      "approval.resolved",
      {
        approvalId: approval.id,
        status: "cancelled",
        taskId: approval.taskId,
      },
      { userId, workspaceId: approval.workspaceId }
    );

    return { approval: updatedApproval, decision };
  }
}
