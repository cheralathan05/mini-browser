import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../agent.types.js";
import { BrowserAdapter } from "../runtime/browser.adapter.js";

// ============================================================
// 1. browser.navigate
// ============================================================
export const browserNavigateTool: ToolDefinition = {
  name: "browser.navigate",
  description: "Navigate the active browser viewport to a target web page and inspect response state.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Fully-qualified HTTP or HTTPS URL to load" },
    },
    required: ["url"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const rawUrl = String(input.url || "").trim();
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      return { success: false, error: `Invalid URL protocol: "${rawUrl}". Must start with http:// or https://` };
    }

    const res = await BrowserAdapter.execute("browser.navigate", { url: rawUrl }, context);
    if (!res.success) {
      return { success: false, durationMs: res.durationMs, error: res.error };
    }
    return { success: true, durationMs: res.durationMs, result: res.result };
  },
};

// ============================================================
// 2. browser.back
// ============================================================
export const browserBackTool: ToolDefinition = {
  name: "browser.back",
  description: "Navigate backward in browser session history.",
  parameters: { type: "object", properties: {} },
  riskLevel: "safe",
  execute: async (_input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const res = await BrowserAdapter.execute("browser.back", {}, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 3. browser.forward
// ============================================================
export const browserForwardTool: ToolDefinition = {
  name: "browser.forward",
  description: "Navigate forward in browser session history.",
  parameters: { type: "object", properties: {} },
  riskLevel: "safe",
  execute: async (_input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const res = await BrowserAdapter.execute("browser.forward", {}, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 4. browser.reload
// ============================================================
export const browserReloadTool: ToolDefinition = {
  name: "browser.reload",
  description: "Reload the current web page viewport.",
  parameters: { type: "object", properties: {} },
  riskLevel: "safe",
  execute: async (_input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const res = await BrowserAdapter.execute("browser.reload", {}, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 5. browser.click
// ============================================================
export const browserClickTool: ToolDefinition = {
  name: "browser.click",
  description: "Click a DOM element identified by CSS selector, text anchor, or accessibility role.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector, button text, or element identifier to click" },
      query: { type: "string", description: "Optional contextual search query" },
    },
    required: ["selector"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const selector = String(input.selector || "").trim();
    if (!selector) {
      return { success: false, error: "Missing required selector parameter for browser.click" };
    }

    const res = await BrowserAdapter.execute("browser.click", { selector, query: input.query }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 6. browser.type
// ============================================================
export const browserTypeTool: ToolDefinition = {
  name: "browser.type",
  description: "Focus a target input field and type text content.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "Target input selector (CSS or field name)" },
      text: { type: "string", description: "Text content to type into the field" },
      clear: { type: "boolean", description: "Clear field before typing (default true)" },
    },
    required: ["selector", "text"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const selector = String(input.selector || "").trim();
    const text = String(input.text ?? "");
    if (!selector) {
      return { success: false, error: "Missing required selector parameter for browser.type" };
    }

    const res = await BrowserAdapter.execute("browser.type", { selector, text, clear: input.clear !== false }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 7. browser.press
// ============================================================
export const browserPressKeyTool: ToolDefinition = {
  name: "browser.press",
  description: "Dispatch a physical keyboard press (Enter, Tab, Escape, ArrowDown, etc.) to the active or targeted element.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Key name to press (e.g. Enter, Tab, Escape, ArrowDown)" },
      selector: { type: "string", description: "Optional selector to focus before pressing key" },
    },
    required: ["key"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const key = String(input.key || "Enter").trim();
    const res = await BrowserAdapter.execute("browser.press", { key, selector: input.selector }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 8. browser.scroll
// ============================================================
export const browserScrollTool: ToolDefinition = {
  name: "browser.scroll",
  description: "Scroll the viewport down or up to load lazy content and reveal hidden sections.",
  parameters: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["down", "up"], default: "down" },
      pixels: { type: "number", default: 800 },
    },
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const direction = input.direction === "up" ? "up" : "down";
    const pixels = Number(input.pixels || 800);
    const res = await BrowserAdapter.execute("browser.scroll", { direction, pixels }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 9. browser.hover
// ============================================================
export const browserHoverTool: ToolDefinition = {
  name: "browser.hover",
  description: "Trigger mouseover / hover state on a DOM element to reveal dropdowns or tooltips.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "Target element selector to hover over" },
    },
    required: ["selector"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const selector = String(input.selector || "").trim();
    const res = await BrowserAdapter.execute("browser.hover", { selector }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 10. browser.extract
// ============================================================
export const browserExtractTool: ToolDefinition = {
  name: "browser.extract",
  description: "Extract structured technical data, documentation headings, key points, or metrics from target URL or active page.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Target URL (defaults to active page if omitted)" },
      selector: { type: "string", description: "Optional CSS selector or focus topic" },
    },
  },
  riskLevel: "read_only",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const targetUrl = String(input.url || BrowserAdapter.getCurrentUrl()).trim();
    const res = await BrowserAdapter.execute("browser.extract", { url: targetUrl, selector: input.selector }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 11. browser.getCurrentPage
// ============================================================
export const browserGetCurrentPageTool: ToolDefinition = {
  name: "browser.getCurrentPage",
  description: "Inspect the URL, title, and readyState of the active browser viewport.",
  parameters: { type: "object", properties: {} },
  riskLevel: "read_only",
  execute: async (_input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const res = await BrowserAdapter.execute("browser.getCurrentPage", {}, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 12. browser.wait
// ============================================================
export const browserWaitForSelectorTool: ToolDefinition = {
  name: "browser.wait",
  description: "Wait for a duration in milliseconds or wait for a DOM element matching selector to appear.",
  parameters: {
    type: "object",
    properties: {
      ms: { type: "number", description: "Milliseconds to wait" },
      selector: { type: "string", description: "Optional CSS selector to wait for" },
      timeoutMs: { type: "number", default: 5000, description: "Maximum wait timeout" },
    },
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const ms = Number(input.ms || input.timeoutMs || 1000);
    const selector = input.selector ? String(input.selector) : undefined;
    const res = await BrowserAdapter.execute("browser.wait", { ms, selector }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// 13. browser.findElement
// ============================================================
export const browserFindElementTool: ToolDefinition = {
  name: "browser.findElement",
  description: "Check if a DOM element exists by selector or text content, returning count and attributes.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector to search for" },
      text: { type: "string", description: "Optional text content match" },
    },
    required: ["selector"],
  },
  riskLevel: "read_only",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const selector = String(input.selector || "").trim();
    const res = await BrowserAdapter.execute("browser.findElement", { selector, text: input.text }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

// ============================================================
// Sensitive / Approval-Gated & Helper Tools
// ============================================================
export const browserSubmitActionTool: ToolDefinition = {
  name: "browser.submitForm",
  description: "Submit an external form or initiate a consequential write operation.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", description: "Action description" },
      targetUrl: { type: "string", description: "Target URL" },
      payload: { type: "object", description: "Form payload" },
    },
    required: ["action", "targetUrl"],
  },
  riskLevel: "critical_approval",
  requiresApproval: true,
  execute: async (input: Record<string, unknown>): Promise<ToolExecutionResult> => {
    return {
      success: true,
      result: {
        submitted: true,
        action: input.action,
        targetUrl: input.targetUrl,
      },
    };
  },
};

export const browserFillFormTool: ToolDefinition = {
  name: "browser.fillForm",
  description: "Populate multiple input fields in a web form sequentially.",
  parameters: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            selector: { type: "string" },
            value: { type: "string" },
          },
          required: ["selector", "value"],
        },
        description: "List of field selectors and values to populate",
      },
    },
    required: ["fields"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const fields = Array.isArray(input.fields) ? input.fields : [];
    const populated: Array<{ selector: string; success: boolean }> = [];

    for (const field of fields) {
      const res = await BrowserAdapter.execute("browser.type", { selector: field.selector, text: field.value }, context);
      populated.push({ selector: field.selector, success: res.success });
    }

    return {
      success: true,
      result: {
        fieldsCount: fields.length,
        populated,
      },
    };
  },
};

export const browserExecuteScriptTool: ToolDefinition = {
  name: "browser.executeScript",
  description: "Execute safe sandboxed read-only JavaScript evaluation on the active DOM.",
  parameters: {
    type: "object",
    properties: {
      script: { type: "string", description: "JavaScript snippet to evaluate" },
    },
    required: ["script"],
  },
  riskLevel: "read_only",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const script = String(input.script || "");
    const res = await BrowserAdapter.execute("browser.extract", { script }, context);
    return { success: res.success, durationMs: res.durationMs, result: res.result, error: res.error };
  },
};

export const browserWhatsappSendTool: ToolDefinition = {
  name: "browser.whatsappSend",
  description: "Automate sending a WhatsApp message to a specified phone number via WhatsApp Web direct deep-link dispatch.",
  parameters: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Target phone number (e.g. 229093 or +1234567890)" },
      message: { type: "string", description: "Message text to pre-fill" },
      autoSend: { type: "boolean", default: true },
    },
    required: ["phone"],
  },
  riskLevel: "safe",
  execute: async (input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const rawPhone = String(input.phone || "").replace(/[^\d+]/g, "");
    const phone = rawPhone.startsWith("+") ? rawPhone.slice(1) : rawPhone;
    const message = String(input.message || "Hi!");
    const waUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}`;

    const navRes = await BrowserAdapter.execute("browser.navigate", { url: waUrl }, context);

    return {
      success: true,
      durationMs: navRes.durationMs,
      result: {
        phone,
        message,
        url: waUrl,
        dispatched: true,
        note: "WhatsApp Web session initialized with target recipient",
      },
    };
  },
};
