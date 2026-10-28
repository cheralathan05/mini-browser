import { AutonomyMode, ExecutionPlan, AutomationStep, WorkflowPreset, RiskLevel } from "./automation.types.js";
import { AIProviderFactory } from "../../ai/provider-factory.js";

export class ObjectivePlannerService {
  /**
    Six Reusable Production Presets
   */
  public static readonly PRESETS: WorkflowPreset[] = [
    {
      id: "trending-ai-research",
      name: "Trending AI Research",
      description: "Search configured real sources, collect evidence, generate a cited report, and save to workspace.",
      category: "research",
      icon: "Microscope",
      defaultMode: "assisted",
      defaultGoal: "Investigate latest developments in open-weights reasoning models and multi-agent coordination architectures",
      capabilities: ["search", "extraction", "ai_synthesis", "memory"],
      plan: {
        goal: "Investigate latest developments in open-weights reasoning models and multi-agent coordination architectures",
        requiredCapabilities: ["search", "extraction", "ai_synthesis", "memory"],
        mode: "assisted",
        riskLevel: "safe",
        approvalRequirements: [],
        resourceBudget: { maxSteps: 4, timeoutSec: 180 },
        completionCriteria: "A structured research brief with citations saved to PostgreSQL Memory Vault",
        steps: [
          {
            id: "step_search",
            name: "Search Multi-Channel Tech Sources",
            type: "research.search",
            target: "DuckDuckGo, Wikipedia, ArXiv",
            params: { query: "open weights reasoning models multi agent architecture 2026", maxSources: 5 },
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Array of verified source URLs and metadata",
          },
          {
            id: "step_extract",
            name: "Extract Empirical Excerpts & Claims",
            type: "browser.extract",
            target: "Discovered research pages",
            params: { selector: "article, main, body", maxBytes: 200000 },
            dependencies: ["step_search"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Parsed evidence items with canonical URLs",
          },
          {
            id: "step_synthesize",
            name: "Synthesize Key Findings & Citation Provenance",
            type: "ai.synthesize",
            params: { prompt: "Synthesize latest architectural advances, benchmark scores, and consensus findings with inline citation references" },
            dependencies: ["step_extract"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Markdown research brief with inline citation badges",
          },
          {
            id: "step_save",
            name: "Save Report to Memory Vault",
            type: "memory.save",
            params: { category: "Research", title: "Trending AI Reasoning Architectures Report" },
            dependencies: ["step_synthesize"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "PostgreSQL Memory record ID",
          },
        ],
      },
    },
    {
      id: "ai-research-report",
      name: "AI Research and Report",
      description: "Research a topic, compare sources, summarize findings, and create a report with citations.",
      category: "research",
      icon: "FileText",
      defaultMode: "assisted",
      defaultGoal: "Compare vector databases and vector index algorithms (HNSW vs ScaNN vs DiskANN) for production workloads",
      capabilities: ["search", "ai_synthesis", "memory"],
      plan: {
        goal: "Compare vector databases and vector index algorithms (HNSW vs ScaNN vs DiskANN) for production workloads",
        requiredCapabilities: ["search", "ai_synthesis", "memory"],
        mode: "assisted",
        riskLevel: "safe",
        approvalRequirements: [],
        resourceBudget: { maxSteps: 3, timeoutSec: 120 },
        completionCriteria: "Comparative analysis report with trade-off matrix saved to knowledge base",
        steps: [
          {
            id: "step_gather",
            name: "Gather Vector Index Benchmarks",
            type: "research.search",
            params: { query: "vector database indexing HNSW ScaNN DiskANN trade-offs latency recall", maxSources: 4 },
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Benchmarking data and technical articles",
          },
          {
            id: "step_compare",
            name: "AI Cross-Source Trade-Off Analysis",
            type: "ai.synthesize",
            params: { prompt: "Compare recall vs latency trade-offs, memory footprints, and indexing throughput across HNSW, ScaNN, and DiskANN" },
            dependencies: ["step_gather"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Structured comparative breakdown with source citations",
          },
          {
            id: "step_persist",
            name: "Persist Comparative Study",
            type: "memory.save",
            params: { title: "Production Vector Search Comparative Analysis", category: "Architecture" },
            dependencies: ["step_compare"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Persistent memory record created",
          },
        ],
      },
    },
    {
      id: "web-form-assistance",
      name: "Web Form Assistance",
      description: "Open a supported website, help populate permitted fields, validate inputs, and pause before submission.",
      category: "forms",
      icon: "Layers",
      defaultMode: "assisted",
      defaultGoal: "Populate registration portal fields on target URL and await user submission approval",
      capabilities: ["browser", "form_fill", "approval"],
      plan: {
        goal: "Populate registration portal fields on target URL and await user submission approval",
        requiredCapabilities: ["browser", "form_fill", "approval"],
        mode: "assisted",
        riskLevel: "moderate",
        approvalRequirements: ["step_submit"],
        resourceBudget: { maxSteps: 4, timeoutSec: 90 },
        completionCriteria: "Form validated and submitted only upon explicit user approval",
        steps: [
          {
            id: "step_nav",
            name: "Navigate to Target Portal",
            type: "browser.navigate",
            target: "https://example.com/form",
            params: { url: "https://example.com/form" },
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "HTTP 200 and page DOM ready",
          },
          {
            id: "step_fill",
            name: "Validate & Populate Permitted Form Fields",
            type: "browser.fillForm",
            target: "form input fields",
            params: { fields: { "input[type='text']": "Verified User", "input[type='email']": "user@nexus.internal" } },
            dependencies: ["step_nav"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Inputs filled and sanitized",
          },
          {
            id: "step_gate",
            name: "Approval Gate for Form Submission",
            type: "approval.gate",
            target: "Form Submission Action",
            params: { action: "Submit Form", payloadDescription: "Submit registration with verified identity" },
            dependencies: ["step_fill"],
            riskLevel: "moderate",
            requiresApproval: true,
            expectedOutput: "User approval token or reject signal",
          },
          {
            id: "step_submit",
            name: "Execute Form Submission",
            type: "browser.submitForm",
            target: "form submit button",
            dependencies: ["step_gate"],
            riskLevel: "high",
            requiresApproval: true,
            expectedOutput: "Submission response & confirmation token",
          },
        ],
      },
    },
    {
      id: "whatsapp-automation",
      name: "WhatsApp Message Automation",
      description: "Validate recipient, prepare a message, show final preview, request approval, and send through authorized gateway.",
      category: "messaging",
      icon: "MessageSquare",
      defaultMode: "assisted",
      defaultGoal: "Validate recipient phone number, draft notification, obtain approval, and dispatch via WhatsApp Gateway",
      capabilities: ["validation", "ai_synthesis", "approval", "whatsapp"],
      plan: {
        goal: "Validate recipient phone number, draft notification, obtain approval, and dispatch via WhatsApp Gateway",
        requiredCapabilities: ["validation", "ai_synthesis", "approval", "whatsapp"],
        mode: "assisted",
        riskLevel: "moderate",
        approvalRequirements: ["step_send"],
        resourceBudget: { maxSteps: 4, timeoutSec: 60 },
        completionCriteria: "WhatsApp message delivered to verified recipient with delivery receipt ID",
        steps: [
          {
            id: "step_validate_recipient",
            name: "Validate International Phone Format (E.164)",
            type: "ai.plan",
            params: { recipient: "+1 (555) 019-2834" },
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Normalized E.164 phone number: +15550192834",
          },
          {
            id: "step_draft_content",
            name: "Prepare & Sanitize Message Payload",
            type: "ai.synthesize",
            params: { template: "Milestone Alert", message: "NEXUS Automation Studio: Your autonomous pipeline completed successfully." },
            dependencies: ["step_validate_recipient"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Formatted message preview card",
          },
          {
            id: "step_approval_review",
            name: "Human-in-the-Loop Review Gate",
            type: "approval.gate",
            target: "WhatsApp Dispatch Authorization",
            params: { recipient: "+15550192834", message: "NEXUS Automation Studio: Your autonomous pipeline completed successfully." },
            dependencies: ["step_draft_content"],
            riskLevel: "moderate",
            requiresApproval: true,
            expectedOutput: "Explicit user approval",
          },
          {
            id: "step_send",
            name: "Dispatch WhatsApp Message",
            type: "browser.whatsappSend",
            target: "WhatsApp Messaging Gateway",
            params: { recipient: "+15550192834", message: "NEXUS Automation Studio: Your autonomous pipeline completed successfully." },
            dependencies: ["step_approval_review"],
            riskLevel: "high",
            requiresApproval: true,
            expectedOutput: "Delivery receipt with messageId and timestamp",
          },
        ],
      },
    },
    {
      id: "coding-workflow",
      name: "Coding Workflow",
      description: "Generate code, review solution, run it in a secure configured sandbox, and summarize real test results.",
      category: "coding",
      icon: "Code2",
      defaultMode: "assisted",
      defaultGoal: "Generate optimized LRU Cache implementation in Python with unit tests and execute in secure sandbox",
      capabilities: ["coding_gen", "sandbox_exec", "verification"],
      plan: {
        goal: "Generate optimized LRU Cache implementation in Python with unit tests and execute in secure sandbox",
        requiredCapabilities: ["coding_gen", "sandbox_exec", "verification"],
        mode: "assisted",
        riskLevel: "safe",
        approvalRequirements: [],
        resourceBudget: { maxSteps: 3, timeoutSec: 60 },
        completionCriteria: "Code generated, verified in sandbox, and all test assertions passed",
        steps: [
          {
            id: "step_gen_code",
            name: "AI Code Generation with Optimal Strategy",
            type: "coding.generate",
            params: { language: "python", problemTitle: "LRU Cache", strategy: "optimal", includeTests: true },
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Clean Python code with unit test assertions",
          },
          {
            id: "step_exec_sandbox",
            name: "Execute Code in Secure Subprocess Sandbox",
            type: "coding.execute",
            params: { language: "python", timeoutMs: 5000 },
            dependencies: ["step_gen_code"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Process exit code 0 and stdout test results",
          },
          {
            id: "step_summary",
            name: "Summarize Performance & Test Results",
            type: "ai.synthesize",
            params: { prompt: "Summarize time/space complexity and test case validation outcomes" },
            dependencies: ["step_exec_sandbox"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Benchmark summary and test verification matrix",
          },
        ],
      },
    },
    {
      id: "website-capture-analysis",
      name: "Website Capture and Analysis",
      description: "Capture a supported public webpage, save screenshot, collect DOM metadata, and analyze with vision model.",
      category: "browser",
      icon: "Camera",
      defaultMode: "assisted",
      defaultGoal: "Capture full-page screenshot of target website, extract DOM telemetry, and perform AI vision audit",
      capabilities: ["browser_capture", "dom_telemetry", "vision_analysis"],
      plan: {
        goal: "Capture full-page screenshot of target website, extract DOM telemetry, and perform AI vision audit",
        requiredCapabilities: ["browser_capture", "dom_telemetry", "vision_analysis"],
        mode: "assisted",
        riskLevel: "safe",
        approvalRequirements: [],
        resourceBudget: { maxSteps: 3, timeoutSec: 60 },
        completionCriteria: "Screenshot saved, DOM headings extracted, and vision analysis persisted",
        steps: [
          {
            id: "step_capture",
            name: "Headless Chromium Screenshot Capture",
            type: "browser.capture",
            target: "https://news.ycombinator.com",
            params: { url: "https://news.ycombinator.com", width: 1280, height: 800 },
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Saved PNG screenshot file and resolution metadata",
          },
          {
            id: "step_telemetry",
            name: "Inspect Live DOM Telemetry & Headings",
            type: "browser.extract",
            target: "DOM elements",
            params: { extractHeadings: true, extractExcerpt: true },
            dependencies: ["step_capture"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Hierarchy of H1-H6 tags and page metrics",
          },
          {
            id: "step_vision_audit",
            name: "Multimodal AI Vision & UX Analysis",
            type: "ai.synthesize",
            params: { prompt: "Analyze design hierarchy, color contrast, responsive typography, and readability" },
            dependencies: ["step_telemetry"],
            riskLevel: "safe",
            requiresApproval: false,
            expectedOutput: "Audited design report saved to PostgreSQL",
          },
        ],
      },
    },
  ];

  /**
   * Plan an objective dynamically using AI or heuristic mapping
   */
  public static async planObjective(
    objective: string,
    mode: AutonomyMode = "assisted"
  ): Promise<ExecutionPlan> {
    const trimmed = objective.trim();
    if (!trimmed) {
      throw new Error("Research or automation objective cannot be empty.");
    }

    // Check if user objective matches a preset directly
    const lower = trimmed.toLowerCase();
    for (const preset of this.PRESETS) {
      if (
        lower.includes(preset.id.replace(/-/g, " ")) ||
        lower.includes(preset.name.toLowerCase()) ||
        lower === preset.defaultGoal.toLowerCase()
      ) {
        return this.applyModePolicy({ ...preset.plan, goal: trimmed }, mode);
      }
    }

    // Dynamic AI Planning
    let plan: ExecutionPlan;
    if (process.env.NODE_ENV === "test") {
      plan = this.createHeuristicPlan(trimmed, mode);
      return this.applyModePolicy(plan, mode);
    }

    try {
      const provider = await AIProviderFactory.getActiveProvider();
      const prompt = `You are the NEXUS Autonomous Workflow Planner.
Generate a structured JSON execution plan for this user objective:
"${trimmed}"

Rules:
1. Break down into 2 to 5 ordered steps.
2. Step types must be from:
   - "research.search" (web & academic search)
   - "browser.extract" (DOM or content extraction)
   - "browser.navigate" (open webpage)
   - "browser.fillForm" (populate forms)
   - "browser.submitForm" (submit form)
   - "browser.whatsappSend" (send WhatsApp message)
   - "browser.capture" (screenshot capture)
   - "coding.generate" (generate code)
   - "coding.execute" (sandbox code execution)
   - "ai.synthesize" (AI summarization/synthesis)
   - "memory.save" (persist output)
   - "approval.gate" (request user confirmation)
3. Step risk levels: "safe", "moderate", "high".
4. If the step communicates externally, submits forms, or executes non-idempotent changes, set riskLevel to "moderate" or "high".

Output strictly valid JSON matching this schema:
{
  "goal": "${trimmed.replace(/"/g, '\\"')}",
  "requiredCapabilities": ["search", "ai_synthesis"],
  "riskLevel": "safe" | "moderate" | "high",
  "resourceBudget": { "maxSteps": 5, "timeoutSec": 120 },
  "completionCriteria": "Expected success condition",
  "steps": [
    {
      "id": "step_1",
      "name": "Step Name",
      "type": "research.search",
      "params": {},
      "riskLevel": "safe",
      "expectedOutput": "Expected output description"
    }
  ]
}`;

      const aiResponse = await provider.generate(prompt, { timeout: 6000 });
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        plan = {
          goal: parsed.goal || trimmed,
          requiredCapabilities: Array.isArray(parsed.requiredCapabilities) ? parsed.requiredCapabilities : ["ai_synthesis"],
          mode,
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          riskLevel: parsed.riskLevel || "safe",
          approvalRequirements: [],
          resourceBudget: parsed.resourceBudget || { maxSteps: 5, timeoutSec: 120 },
          completionCriteria: parsed.completionCriteria || "Workflow completed successfully",
        };
      } else {
        throw new Error("Invalid AI JSON structure");
      }
    } catch {
      // Deterministic fallback plan
      plan = this.createHeuristicPlan(trimmed, mode);
    }

    return this.applyModePolicy(plan, mode);
  }

  /**
   * Deterministic heuristic plan builder if AI provider is offline
   */
  private static createHeuristicPlan(objective: string, mode: AutonomyMode): ExecutionPlan {
    const lower = objective.toLowerCase();

    if (lower.includes("whatsapp") || lower.includes("message") || lower.includes("phone") || lower.includes("chat")) {
      const p = this.PRESETS.find((pr) => pr.id === "whatsapp-automation")!.plan;
      return { ...p, goal: objective };
    }
    if (lower.includes("code") || lower.includes("python") || lower.includes("test") || lower.includes("algorithm")) {
      const p = this.PRESETS.find((pr) => pr.id === "coding-workflow")!.plan;
      return { ...p, goal: objective };
    }
    if (lower.includes("screenshot") || lower.includes("capture") || lower.includes("dom") || lower.includes("vision")) {
      const p = this.PRESETS.find((pr) => pr.id === "website-capture-analysis")!.plan;
      return { ...p, goal: objective };
    }
    if (lower.includes("form") || lower.includes("submit") || lower.includes("fill")) {
      const p = this.PRESETS.find((pr) => pr.id === "web-form-assistance")!.plan;
      return { ...p, goal: objective };
    }

    // Default: AI Research & Report
    const defaultPreset = this.PRESETS.find((pr) => pr.id === "ai-research-report")!.plan;
    return { ...defaultPreset, goal: objective };
  }

  /**
   * Enforces Autonomy Mode Policies:
   * - MANUAL: Every external, irreversible, or moderate/high risk step requires approval.
   * - ASSISTED: Safe internal steps execute; external/consequential steps require approval.
   * - AUTONOMOUS: Pre-authorized actions execute within bounds; only high-risk irreversible steps require approval.
   */
  public static applyModePolicy(plan: ExecutionPlan, mode: AutonomyMode): ExecutionPlan {
    const steps: AutomationStep[] = plan.steps.map((step) => {
      let requiresApproval = false;
      const type = (step.type || "").toLowerCase();
      const isExternal =
        type.includes("whatsapp") ||
        type.includes("submit") ||
        type.includes("delete") ||
        step.riskLevel === "high";

      if (mode === "manual") {
        // Manual mode: any step that communicates externally, writes to DB, or has moderate/high risk requires approval
        requiresApproval = isExternal || step.riskLevel === "moderate" || type.includes("approval");
      } else if (mode === "assisted") {
        // Assisted mode: safe internal steps run automatically, external/destructive actions require approval
        requiresApproval = isExternal || type.includes("approval");
      } else if (mode === "autonomous") {
        // Autonomous mode: only critical irreversible high-risk actions require approval
        requiresApproval = step.riskLevel === "high" || type.includes("approval.gate");
      }

      return {
        ...step,
        requiresApproval,
      };
    });

    const approvalRequirements = steps
      .filter((s) => s.requiresApproval)
      .map((s) => s.id);

    return {
      ...plan,
      mode,
      steps,
      approvalRequirements,
    };
  }

  /**
   * Validate a plan before execution
   */
  public static validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plan.goal || plan.goal.trim().length === 0) {
      errors.push("Plan goal cannot be empty");
    }
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push("Plan must contain at least one step");
    }
    if (plan.steps.length > 20) {
      errors.push("Plan exceeds maximum step limit of 20");
    }

    // Validate step dependencies and check for cycles
    const stepIds = new Set(plan.steps.map((s) => s.id));
    for (const step of plan.steps) {
      if (!step.id) errors.push("Every step must have a unique ID");
      if (step.dependencies) {
        for (const dep of step.dependencies) {
          if (!stepIds.has(dep)) {
            errors.push(`Step "${step.name}" depends on non-existent step "${dep}"`);
          }
          if (dep === step.id) {
            errors.push(`Step "${step.name}" cannot depend on itself (cycle detected)`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
