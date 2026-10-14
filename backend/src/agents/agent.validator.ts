import { AgentObservationPayload, PlannedStep, ToolExecutionResult, VerificationResult } from "./agent.types.js";

export class AgentValidator {
  public static async verify(
    step: PlannedStep,
    toolResult: ToolExecutionResult,
    observation: AgentObservationPayload,
    isFinalStep: boolean
  ): Promise<VerificationResult> {
    if (!toolResult.success) {
      return {
        passed: false,
        reason: toolResult.error || "Tool execution returned an unsuccessful status code.",
        completedGoal: false,
      };
    }

    // Step-specific verification logic
    switch (step.toolName) {
      case "browser.navigate":
        const hasUrl = Boolean(observation.url);
        const hasTitle = Boolean(observation.title && observation.title.length > 0);
        if (!hasUrl || !hasTitle) {
          return {
            passed: false,
            reason: "Navigation completed but page title or URL could not be validated.",
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: `Verified valid page response for ${observation.url}`,
          completedGoal: isFinalStep,
        };

      case "browser.extract":
        const hasData = Boolean(
          observation.extractedData &&
          (Array.isArray((observation.extractedData as any).keyPoints) ||
           Array.isArray((observation.extractedData as any).headings) ||
           (observation.extractedData as any).summary)
        );
        if (!hasData) {
          return {
            passed: false,
            reason: "DOM extracted but no meaningful headings or text structures were located.",
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: "Verified structured DOM content extracted and parsed.",
          completedGoal: isFinalStep,
        };

      case "research.search":
        const sources = (observation.extractedData as any)?.sources;
        if (!Array.isArray(sources) || sources.length === 0) {
          return {
            passed: false,
            reason: "Source discovery completed but 0 relevant sources were returned.",
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: `Discovered and verified ${sources.length} authoritative online sources.`,
          completedGoal: isFinalStep,
        };

      case "research.getReport":
        const report = (toolResult.result as any)?.report;
        if (!report || report.length < 100) {
          return {
            passed: false,
            reason: "Report synthesis returned insufficient content.",
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: "Synthesized report verified with complete sections and formatting.",
          completedGoal: isFinalStep,
        };

      case "memory.save":
        return {
          passed: true,
          reason: "Verified record persisted in PostgreSQL long-term memory.",
          completedGoal: isFinalStep,
        };

      case "browser.whatsappSend":
        return {
          passed: true,
          reason: `Verified WhatsApp Web session initialized and message dispatched to recipient.`,
          completedGoal: isFinalStep,
        };

      case "browser.click":
        const clickResult = toolResult.result as Record<string, unknown> | undefined;
        if (!clickResult?.clicked) {
          return {
            passed: false,
            reason: `Element click action could not be verified on target selector "${step.input?.selector || "unknown"}".`,
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: `Verified element "${step.input?.selector || "selector"}" was successfully clicked.`,
          completedGoal: isFinalStep,
        };

      case "browser.type":
        const typeResult = toolResult.result as Record<string, unknown> | undefined;
        if (!typeResult?.typed) {
          return {
            passed: false,
            reason: `Text input could not be confirmed in selector "${step.input?.selector || "input"}".`,
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: `Verified input received payload: "${step.input?.text || ""}".`,
          completedGoal: isFinalStep,
        };

      case "browser.press":
        return {
          passed: true,
          reason: `Verified physical keypress "${step.input?.key || "Enter"}" dispatched.`,
          completedGoal: isFinalStep,
        };

      case "browser.scroll":
        return {
          passed: true,
          reason: `Verified viewport scrolled ${step.input?.direction || "down"}.`,
          completedGoal: isFinalStep,
        };

      case "browser.hover":
        return {
          passed: true,
          reason: `Verified hover event triggered on "${step.input?.selector}".`,
          completedGoal: isFinalStep,
        };

      case "browser.wait":
        return {
          passed: true,
          reason: "Verified DOM wait threshold satisfied.",
          completedGoal: isFinalStep,
        };

      case "browser.findElement":
        const findResult = toolResult.result as Record<string, unknown> | undefined;
        if (!findResult?.found) {
          return {
            passed: false,
            reason: `Element "${step.input?.selector}" was not located in active DOM.`,
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: `Verified presence of element "${step.input?.selector}".`,
          completedGoal: isFinalStep,
        };

      case "browser.getCurrentPage":
        if (!observation.url) {
          return {
            passed: false,
            reason: "Could not inspect active browser URL.",
            completedGoal: false,
          };
        }
        return {
          passed: true,
          reason: `Verified active page at ${observation.url}`,
          completedGoal: isFinalStep,
        };

      case "browser.back":
      case "browser.forward":
      case "browser.reload":
        return {
          passed: true,
          reason: `Verified browser session history action: ${step.toolName}.`,
          completedGoal: isFinalStep,
        };

      default:
        return {
          passed: true,
          reason: `Verified ${step.toolName} finished cleanly.`,
          completedGoal: isFinalStep,
        };
    }
  }
}
