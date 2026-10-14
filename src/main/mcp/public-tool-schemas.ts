import type { JSONSchema, ToolDefinition } from "./tool-schemas.js";

const stringSchema = (description?: string): JSONSchema => ({
  type: "string",
  ...(description ? { description } : {}),
});

const booleanSchema = (description?: string, defaultValue?: boolean): JSONSchema => ({
  type: "boolean",
  ...(description ? { description } : {}),
  ...(defaultValue !== undefined ? { default: defaultValue } : {}),
});

const numberSchema = (description?: string): JSONSchema => ({
  type: "number",
  ...(description ? { description } : {}),
});

const integerSchema = (description?: string): JSONSchema => ({
  type: "integer",
  ...(description ? { description } : {}),
});

const enumStringSchema = (values: string[], description?: string): JSONSchema => ({
  type: "string",
  enum: values,
  ...(description ? { description } : {}),
});

const arraySchema = (items: JSONSchema, description?: string): JSONSchema => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

const objectSchema = (
  properties: Record<string, JSONSchema>,
  required: string[] = [],
  description?: string,
  additionalProperties: boolean | JSONSchema = false,
): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties,
  ...(description ? { description } : {}),
});

const withDraft202012 = (schema: JSONSchema, id: string, title?: string): JSONSchema => ({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: id,
  ...(title ? { title } : {}),
  ...schema,
});

const WAIT_UNTIL_VALUES = ["none", "domcontentloaded", "load", "network_idle"] as const;
const EVENT_CHANNEL_VALUES = [
  "input",
  "navigation",
  "dom",
  "dialog",
  "download",
  "tab",
  "network",
  "runtime",
  "focus",
  "selection",
] as const;

export const PUBLIC_PRESS_KEY_VALUES = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
] as const;

export type PublicPressKey = typeof PUBLIC_PRESS_KEY_VALUES[number];

const SESSION_SCHEMA = objectSchema(
  {
    sessionId: stringSchema("Stable browser session identifier."),
    tabId: stringSchema("Stable tab identifier."),
    frameId: stringSchema("Optional frame identifier."),
    userId: stringSchema("Optional logical user identifier."),
  },
  ["sessionId", "tabId"],
);

const CURSOR_SCHEMA = objectSchema(
  {
    subscriptionId: stringSchema("Subscription identifier."),
    seq: integerSchema("Last observed event sequence number."),
    ts: numberSchema("Timestamp of the last observed event in milliseconds."),
    dropped: booleanSchema("Whether earlier events were dropped before this cursor."),
  },
  ["subscriptionId", "seq"],
);

const TARGET_SCHEMA = objectSchema(
  {
    axNodeId: stringSchema("Accessibility node id returned by browser_ax_snapshot/query."),
    backendNodeId: integerSchema("CDP backend DOM node id."),
    selector: stringSchema("CSS selector fallback."),
  },
  [],
  "Resolvable page target.",
);

const AX_NODE_SCHEMA = objectSchema(
  {
    axNodeId: stringSchema("Accessibility node id."),
    backendNodeId: integerSchema("CDP backend DOM node id when available."),
    parentAxNodeId: stringSchema("Parent accessibility node id."),
    childAxNodeIds: arraySchema(stringSchema("Child accessibility node id.")),
    role: stringSchema("Accessibility role."),
    name: stringSchema("Accessible name."),
    description: stringSchema("Accessible description."),
    value: stringSchema("Accessible value."),
    ignored: booleanSchema("Whether the node is ignored by accessibility."),
    disabled: booleanSchema("Whether the node is disabled."),
    focused: booleanSchema("Whether the node is focused."),
    expanded: booleanSchema("Whether the node is expanded."),
    selected: booleanSchema("Whether the node is selected."),
    invalid: booleanSchema("Whether the node is marked invalid."),
    required: booleanSchema("Whether the node is required."),
    level: integerSchema("Heading or tree level when available."),
    url: stringSchema("Associated URL when available."),
  },
  ["axNodeId", "childAxNodeIds", "ignored"],
);

const EVENT_AX_NODE_SUMMARY_SCHEMA = objectSchema(
  {
    axNodeId: stringSchema("Accessibility node id."),
    role: stringSchema("Accessibility role."),
    name: stringSchema("Accessible name."),
    ignored: booleanSchema("Whether the node is ignored by accessibility."),
  },
  ["axNodeId", "ignored"],
);

const OPENED_TAB_SCHEMA = objectSchema(
  {
    tabId: stringSchema("Created tab id."),
    windowId: stringSchema("Owning window id."),
    openerTabId: stringSchema("Opener tab id when available."),
    url: stringSchema("New tab URL."),
    title: stringSchema("New tab title."),
    source: stringSchema("Creation source such as window_open."),
  },
  ["tabId"],
);

const INVALID_CONTROL_SCHEMA = objectSchema(
  {
    label: stringSchema("Best-effort field label."),
    name: stringSchema("Best-effort field name."),
    selector: stringSchema("Best-effort selector fallback for the invalid control."),
    tagName: stringSchema("Lowercase DOM tag name."),
    htmlType: stringSchema("HTML input type when available."),
    validationMessage: stringSchema("Browser validation message when available."),
  },
  [],
);

const DIALOG_OBSERVATION_SCHEMA = objectSchema(
  {
    kind: stringSchema("Dialog event kind."),
    ts: numberSchema("Timestamp in milliseconds."),
    dialogType: enumStringSchema(["alert", "confirm", "prompt", "beforeunload"], "JavaScript dialog type."),
    message: stringSchema("Dialog message."),
    defaultPrompt: stringSchema("Default prompt text."),
    accepted: booleanSchema("Whether the dialog was accepted."),
    text: stringSchema("Submitted prompt text when available."),
  },
  ["kind", "ts"],
);

const DOWNLOAD_OBSERVATION_SCHEMA = objectSchema(
  {
    kind: stringSchema("Download event kind."),
    ts: numberSchema("Timestamp in milliseconds."),
    downloadId: stringSchema("Download identifier."),
    filename: stringSchema("Download filename."),
    state: stringSchema("Download state."),
    url: stringSchema("Associated URL when available."),
    summary: stringSchema("Human-readable summary."),
    bytes: numberSchema("Received bytes."),
    totalBytes: numberSchema("Expected total bytes."),
    text: stringSchema("Associated error or status text."),
  },
  ["kind", "ts"],
);

const GENERIC_EVENT_SCHEMA = objectSchema(
  {
    kind: stringSchema("Event kind."),
    ts: numberSchema("Timestamp in milliseconds."),
    seq: integerSchema("Monotonic sequence number inside the subscription."),
    windowId: stringSchema("Owning browser window id when relevant."),
    tabId: stringSchema("Owning tab id when relevant."),
    openerTabId: stringSchema("Opener tab id for new-tab events."),
    url: stringSchema("Associated URL when relevant."),
    title: stringSchema("Associated page title when relevant."),
    summary: stringSchema("Human-readable summary."),
    targetHint: stringSchema("Best-effort accessibility or semantic target hint."),
    targetRole: stringSchema("Observed target accessibility role when available."),
    targetName: stringSchema("Observed target accessible name when available."),
    targetLabel: stringSchema("Observed target associated label when available."),
    targetText: stringSchema("Observed target visible text when available."),
    selector: stringSchema("Best-effort CSS selector for the target when available."),
    backendNodeId: integerSchema("CDP backend DOM node id when resolved."),
    axNodeId: stringSchema("Accessibility node id when resolved."),
    axRole: stringSchema("Accessibility role when resolved."),
    axName: stringSchema("Accessibility name when resolved."),
    axDescription: stringSchema("Accessibility description when resolved."),
    axValue: stringSchema("Accessibility value when resolved."),
    axIgnored: booleanSchema("Whether the resolved accessibility node is ignored."),
    axResolvedDepth: integerSchema("DOM ancestor distance used to resolve the accessibility node."),
    axResolvedSelector: stringSchema("Selector used for ancestor fallback when AX was resolved on an ancestor."),
    axResolvedTargetHint: stringSchema("Semantic hint for the selector used during ancestor fallback."),
    axResolvedTargetRole: stringSchema("Semantic role for the selector used during ancestor fallback."),
    axResolvedTargetName: stringSchema("Semantic name for the selector used during ancestor fallback."),
    axResolvedTargetLabel: stringSchema("Semantic label for the selector used during ancestor fallback."),
    axResolvedTargetText: stringSchema("Semantic text for the selector used during ancestor fallback."),
    axPath: arraySchema(EVENT_AX_NODE_SUMMARY_SCHEMA, "Accessibility ancestor path ending at the resolved node."),
    axChildren: arraySchema(EVENT_AX_NODE_SUMMARY_SCHEMA, "Immediate accessibility children of the resolved node."),
    axChildCount: integerSchema("Immediate accessibility child count for the resolved node."),
    axDiffSummary: stringSchema("Short summary of how the resolved accessibility subtree changed since the previous matching event."),
    axChangedFields: arraySchema(stringSchema("Changed accessibility field."), "Changed root accessibility fields."),
    axAddedChildren: arraySchema(EVENT_AX_NODE_SUMMARY_SCHEMA, "Accessibility children added since the previous matching event."),
    axRemovedChildren: arraySchema(EVENT_AX_NODE_SUMMARY_SCHEMA, "Accessibility children removed since the previous matching event."),
    requestId: stringSchema("Network request id when relevant."),
    status: integerSchema("HTTP status or normalized lifecycle status when relevant."),
    dialogType: enumStringSchema(["alert", "confirm", "prompt", "beforeunload"], "JavaScript dialog type."),
    message: stringSchema("Dialog or runtime message."),
    defaultPrompt: stringSchema("Default prompt text."),
    accepted: booleanSchema("Whether a dialog was accepted."),
    downloadId: stringSchema("Download identifier."),
    filename: stringSchema("Download filename."),
    bytes: numberSchema("Received bytes or scroll amount."),
    totalBytes: numberSchema("Expected total bytes."),
    state: stringSchema("Event state or status."),
    text: stringSchema("Associated text payload."),
  },
  ["kind", "ts"],
  "Event emitted by the event-driven browser automation runtime.",
  true,
);

export const PublicToolSchemas = {
  "browser_session_open": {
    name: "browser_session_open",
    description: "Open a URL or attach an existing tab and create an automation session.",
    risk: "medium",
    tags: ["browser", "session", "open"],
    inputSchema: withDraft202012(
      {
        type: "object",
        properties: {
          tabId: stringSchema("Existing tab id to attach to."),
          url: stringSchema("Optional URL to open and attach."),
          windowId: stringSchema("Preferred window id."),
          workspaceId: stringSchema("Preferred workspace id."),
          userId: stringSchema("Optional logical user identifier."),
          observeOnly: booleanSchema("Whether the session is observation-only.", false),
          waitUntil: enumStringSchema([...WAIT_UNTIL_VALUES], "Navigation readiness condition."),
          timeoutMs: integerSchema("Optional navigation timeout in milliseconds."),
        },
        anyOf: [{ required: ["tabId"] }, { required: ["url"] }],
        additionalProperties: false,
      },
      "tool://browser_session_open/input",
      "browser_session_open input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          attachedAt: numberSchema("Attachment timestamp in milliseconds."),
          windowId: stringSchema("Resolved window id."),
          tabId: stringSchema("Resolved tab id."),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          waitUntil: enumStringSchema([...WAIT_UNTIL_VALUES], "Applied wait condition."),
          matched: booleanSchema("Whether waitUntil was satisfied."),
          timedOut: booleanSchema("Whether waiting timed out."),
          matchedEvent: stringSchema("Matched lifecycle event."),
          createdTab: booleanSchema("Whether a new tab was created."),
        },
        ["session", "attachedAt", "windowId", "tabId", "url", "title", "waitUntil", "matched", "timedOut", "createdTab"],
      ),
      "tool://browser_session_open/output",
      "browser_session_open output",
    ),
  },

  "browser_session_close": {
    name: "browser_session_close",
    description: "Detach and release an automation session.",
    risk: "low",
    tags: ["browser", "session"],
    inputSchema: withDraft202012(
      objectSchema({ session: SESSION_SCHEMA }, ["session"]),
      "tool://browser_session_close/input",
      "browser_session_close input",
    ),
    outputSchema: withDraft202012(
      objectSchema({ success: booleanSchema("Whether detach succeeded.") }, ["success"]),
      "tool://browser_session_close/output",
      "browser_session_close output",
    ),
  },

  "browser_tab_create": {
    name: "browser_tab_create",
    description: "Create a new tab in the current automation window or a specific window.",
    risk: "medium",
    tags: ["browser", "tab", "create"],
    inputSchema: withDraft202012(
      {
        type: "object",
        properties: {
          session: SESSION_SCHEMA,
          windowId: stringSchema("Target window id."),
          url: stringSchema("Optional initial URL."),
          activate: booleanSchema("Whether the created tab should become the active tab.", true),
        },
        anyOf: [{ required: ["session"] }, { required: ["windowId"] }],
        additionalProperties: false,
      },
      "tool://browser_tab_create/input",
      "browser_tab_create input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          tabId: stringSchema("Created tab id."),
          windowId: stringSchema("Owning window id."),
          title: stringSchema("Tab title."),
          url: stringSchema("Current tab URL."),
          displayUrl: stringSchema("Display URL."),
          isLoading: booleanSchema("Whether the tab is loading."),
          isActive: booleanSchema("Whether the tab is active."),
        },
        ["tabId", "windowId", "title", "url", "displayUrl", "isLoading", "isActive"],
      ),
      "tool://browser_tab_create/output",
      "browser_tab_create output",
    ),
  },

  "browser_ax_snapshot": {
    name: "browser_ax_snapshot",
    description: "Read the current page accessibility tree or a condensed outline view.",
    risk: "low",
    tags: ["browser", "accessibility", "snapshot"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          scope: enumStringSchema(["full", "outline"], "Whether to return the full tree or only the high-signal outline."),
          rootAxNodeId: stringSchema("Optional root accessibility node id."),
          maxDepth: integerSchema("Optional maximum traversal depth."),
          limit: integerSchema("Maximum number of nodes to return."),
          includeIgnored: booleanSchema("Whether ignored accessibility nodes should be returned.", false),
        },
        ["session"],
      ),
      "tool://browser_ax_snapshot/input",
      "browser_ax_snapshot input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          scope: enumStringSchema(["full", "outline"], "Applied scope."),
          nodes: arraySchema(AX_NODE_SCHEMA, "Accessibility nodes."),
        },
        ["session", "url", "title", "scope", "nodes"],
      ),
      "tool://browser_ax_snapshot/output",
      "browser_ax_snapshot output",
    ),
  },

  "browser_ax_query": {
    name: "browser_ax_query",
    description: "Search the accessibility tree by role, name, or text and return matching nodes.",
    risk: "low",
    tags: ["browser", "accessibility", "query"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          role: stringSchema("Accessibility role filter."),
          name: stringSchema("Accessible name filter."),
          text: stringSchema("Accessible value or description filter."),
          rootAxNodeId: stringSchema("Optional root accessibility node id."),
          limit: integerSchema("Maximum number of matches."),
          includeIgnored: booleanSchema("Whether ignored accessibility nodes should be considered.", false),
        },
        ["session"],
      ),
      "tool://browser_ax_query/input",
      "browser_ax_query input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          matches: arraySchema(AX_NODE_SCHEMA, "Matching accessibility nodes."),
        },
        ["session", "url", "title", "matches"],
      ),
      "tool://browser_ax_query/output",
      "browser_ax_query output",
    ),
  },

  "browser_element_click": {
    name: "browser_element_click",
    description:
      "Click an element resolved from the accessibility tree or a selector. "
      + "The result includes lightweight diagnostics and a short sample of post-click side effects such as dialogs, dialog-like DOM regions, stateful style or color changes, downloads, and newly opened tabs.",
    risk: "high",
    tags: ["browser", "element", "click"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          target: TARGET_SCHEMA,
          force: booleanSchema("Bypass conservative safety checks.", false),
        },
        ["session", "target"],
      ),
      "tool://browser_element_click/input",
      "browser_element_click input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          ok: booleanSchema("Whether the click was dispatched."),
          action: enumStringSchema(["click"]),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          target: TARGET_SCHEMA,
          effective: booleanSchema("Whether the click produced an observable effect in the current tab or opened a new tab."),
          urlChanged: booleanSchema("Whether the current tab URL changed."),
          visibleTextChanged: booleanSchema("Whether visible page text changed."),
          focusedElementChanged: booleanSchema("Whether focus moved after the click."),
          formValidationFailed: booleanSchema("Whether the click appears to have triggered browser form validation."),
          openedTabs: arraySchema(OPENED_TAB_SCHEMA, "Tabs opened as a side effect of the click."),
          invalidControls: arraySchema(INVALID_CONTROL_SCHEMA, "Invalid controls detected on the related form after the click."),
          errorObserved: booleanSchema("Whether a validation or error-like message was observed after the click."),
          errorMessages: arraySchema(stringSchema("Observed error message."), "Observed validation or error-like messages after the click."),
          dialogOpened: booleanSchema("Whether a JavaScript dialog opened immediately after the click."),
          dialogRegionObserved: booleanSchema("Whether post-click DOM mutations suggest an in-page dialog or modal region appeared."),
          downloadStarted: booleanSchema("Whether the click appears to have started a browser download."),
          navigationObserved: booleanSchema("Whether a navigation event was observed immediately after the click."),
          domMutationObserved: booleanSchema("Whether DOM mutations or visual state changes such as color changes were observed immediately after the click."),
          observedEventKinds: arraySchema(stringSchema("Observed event kind."), "Unique post-click event kinds captured during the short observation window."),
          observedEvents: arraySchema(GENERIC_EVENT_SCHEMA, "Prioritized sample of post-click side-effect events."),
          dialogs: arraySchema(DIALOG_OBSERVATION_SCHEMA, "Observed JavaScript dialog events after the click."),
          downloads: arraySchema(DOWNLOAD_OBSERVATION_SCHEMA, "Observed download events after the click."),
        },
        [
          "ok",
          "action",
          "url",
          "title",
          "target",
          "effective",
          "urlChanged",
          "visibleTextChanged",
          "focusedElementChanged",
          "formValidationFailed",
          "openedTabs",
          "invalidControls",
          "errorObserved",
          "errorMessages",
          "dialogOpened",
          "dialogRegionObserved",
          "downloadStarted",
          "navigationObserved",
          "domMutationObserved",
          "observedEventKinds",
          "observedEvents",
          "dialogs",
          "downloads",
        ],
      ),
      "tool://browser_element_click/output",
      "browser_element_click output",
    ),
  },

  "browser_element_input": {
    name: "browser_element_input",
    description:
      "Set text into an input-like element resolved from the accessibility tree or a selector. "
      + "For combobox/autocomplete fields, check requiresSelection and availableOptions in the result because typing alone may not commit a valid choice. "
      + "The result also includes a short sample of post-input side effects such as dialog-like DOM changes, stateful style or color changes, dialogs, downloads, navigation, and newly opened tabs.",
    risk: "high",
    tags: ["browser", "element", "input"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          target: TARGET_SCHEMA,
          text: stringSchema("Text to insert."),
          replace: booleanSchema("Replace existing text instead of appending.", true),
        },
        ["session", "target", "text"],
      ),
      "tool://browser_element_input/input",
      "browser_element_input input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          ok: booleanSchema("Whether the input value was set."),
          action: enumStringSchema(["input"]),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          target: TARGET_SCHEMA,
          value: stringSchema("Resulting element value when readable."),
          committed: booleanSchema("Whether the entered text appears committed as a final value."),
          requiresSelection: booleanSchema("Whether the control appears to require picking from suggestions or options."),
          availableOptions: arraySchema(stringSchema("Visible option label."), "Visible options or suggestions after input."),
          openedTabs: arraySchema(OPENED_TAB_SCHEMA, "Tabs opened as a side effect of the input."),
          errorObserved: booleanSchema("Whether a validation or error-like message was observed after the input."),
          errorMessages: arraySchema(stringSchema("Observed error message."), "Observed validation or error-like messages after the input."),
          dialogOpened: booleanSchema("Whether a JavaScript dialog opened immediately after the input."),
          dialogRegionObserved: booleanSchema("Whether post-input DOM mutations suggest an in-page dialog or modal region appeared."),
          downloadStarted: booleanSchema("Whether the input appears to have started a browser download."),
          navigationObserved: booleanSchema("Whether a navigation event was observed immediately after the input."),
          domMutationObserved: booleanSchema("Whether DOM mutations or visual state changes such as color changes were observed immediately after the input."),
          observedEventKinds: arraySchema(stringSchema("Observed event kind."), "Unique post-input event kinds captured during the short observation window."),
          observedEvents: arraySchema(GENERIC_EVENT_SCHEMA, "Prioritized sample of post-input side-effect events."),
          dialogs: arraySchema(DIALOG_OBSERVATION_SCHEMA, "Observed JavaScript dialog events after the input."),
          downloads: arraySchema(DOWNLOAD_OBSERVATION_SCHEMA, "Observed download events after the input."),
        },
        [
          "ok",
          "action",
          "url",
          "title",
          "target",
          "committed",
          "requiresSelection",
          "availableOptions",
          "openedTabs",
          "errorObserved",
          "errorMessages",
          "dialogOpened",
          "dialogRegionObserved",
          "downloadStarted",
          "navigationObserved",
          "domMutationObserved",
          "observedEventKinds",
          "observedEvents",
          "dialogs",
          "downloads",
        ],
      ),
      "tool://browser_element_input/output",
      "browser_element_input output",
    ),
  },

  "browser_element_select": {
    name: "browser_element_select",
    description:
      "Select an option on a native select, datalist, or combobox-like control by value or visible label. "
      + "Use this when typing alone is not enough and the page requires an explicit choice from a dropdown or suggestion list.",
    risk: "high",
    tags: ["browser", "element", "select"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          target: TARGET_SCHEMA,
          value: stringSchema("Requested option value or visible label."),
          exact: booleanSchema("Require exact matching instead of case-insensitive fuzzy matching.", false),
        },
        ["session", "target", "value"],
      ),
      "tool://browser_element_select/input",
      "browser_element_select input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          ok: booleanSchema("Whether a matching option was selected."),
          action: enumStringSchema(["select"]),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          target: TARGET_SCHEMA,
          value: stringSchema("Resulting selected value when readable."),
          optionLabel: stringSchema("Selected option label when readable."),
          availableOptions: arraySchema(stringSchema("Visible option label."), "Available options inspected during selection."),
        },
        ["ok", "action", "url", "title", "target", "availableOptions"],
      ),
      "tool://browser_element_select/output",
      "browser_element_select output",
    ),
  },

  "browser_element_press": {
    name: "browser_element_press",
    description:
      "Press a limited keyboard key against a resolved target or the currently focused element. "
      + "Use this when the page specifically expects keyboard navigation or keyboard confirmation.",
    risk: "high",
    tags: ["browser", "element", "press", "keyboard"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          target: TARGET_SCHEMA,
          key: enumStringSchema([...PUBLIC_PRESS_KEY_VALUES], "Supported keyboard key."),
        },
        ["session", "key"],
      ),
      "tool://browser_element_press/input",
      "browser_element_press input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          ok: booleanSchema("Whether the key press was dispatched."),
          action: enumStringSchema(["press"]),
          key: enumStringSchema([...PUBLIC_PRESS_KEY_VALUES], "Pressed keyboard key."),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          target: TARGET_SCHEMA,
          value: stringSchema("Readable value of the target or focused element after the press."),
          selectedIndex: integerSchema("Selected index when the target is a native select."),
          effective: booleanSchema("Whether the key press produced an observable effect."),
          urlChanged: booleanSchema("Whether the current tab URL changed."),
          visibleTextChanged: booleanSchema("Whether visible page text changed."),
          focusedElementChanged: booleanSchema("Whether focus moved after the key press."),
          selectionChanged: booleanSchema("Whether text or option selection changed after the key press."),
          stateChanged: booleanSchema("Whether the target or focused element state changed after the key press."),
          openedTabs: arraySchema(OPENED_TAB_SCHEMA, "Tabs opened as a side effect of the key press."),
          errorObserved: booleanSchema("Whether a validation or error-like message was observed after the key press."),
          errorMessages: arraySchema(stringSchema("Observed error message."), "Observed validation or error-like messages after the key press."),
          dialogOpened: booleanSchema("Whether a JavaScript dialog opened immediately after the key press."),
          dialogRegionObserved: booleanSchema("Whether post-keypress DOM mutations suggest an in-page dialog or modal region appeared."),
          downloadStarted: booleanSchema("Whether the key press appears to have started a browser download."),
          navigationObserved: booleanSchema("Whether a navigation event was observed immediately after the key press."),
          domMutationObserved: booleanSchema("Whether DOM mutations or visual state changes were observed immediately after the key press."),
          observedEventKinds: arraySchema(stringSchema("Observed event kind."), "Unique post-keypress event kinds captured during the short observation window."),
          observedEvents: arraySchema(GENERIC_EVENT_SCHEMA, "Prioritized sample of post-keypress side-effect events."),
          dialogs: arraySchema(DIALOG_OBSERVATION_SCHEMA, "Observed JavaScript dialog events after the key press."),
          downloads: arraySchema(DOWNLOAD_OBSERVATION_SCHEMA, "Observed download events after the key press."),
        },
        [
          "ok",
          "action",
          "key",
          "url",
          "title",
          "effective",
          "urlChanged",
          "visibleTextChanged",
          "focusedElementChanged",
          "selectionChanged",
          "stateChanged",
          "openedTabs",
          "errorObserved",
          "errorMessages",
          "dialogOpened",
          "dialogRegionObserved",
          "downloadStarted",
          "navigationObserved",
          "domMutationObserved",
          "observedEventKinds",
          "observedEvents",
          "dialogs",
          "downloads",
        ],
      ),
      "tool://browser_element_press/output",
      "browser_element_press output",
    ),
  },

  "browser_element_scroll": {
    name: "browser_element_scroll",
    description: "Scroll the page or a specific element resolved from the accessibility tree or a selector.",
    risk: "medium",
    tags: ["browser", "element", "scroll"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          target: TARGET_SCHEMA,
          direction: enumStringSchema(["up", "down"], "Scroll direction."),
          amount: numberSchema("Scroll amount in CSS pixels."),
        },
        ["session"],
      ),
      "tool://browser_element_scroll/input",
      "browser_element_scroll input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          ok: booleanSchema("Whether scroll was dispatched."),
          action: enumStringSchema(["scroll"]),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          target: TARGET_SCHEMA,
          pageScrollY: numberSchema("Current page scroll Y offset."),
          elementScrollTop: numberSchema("Current element scrollTop when target is an element."),
        },
        ["ok", "action", "url", "title"],
      ),
      "tool://browser_element_scroll/output",
      "browser_element_scroll output",
    ),
  },

  "browser_events_subscribe": {
    name: "browser_events_subscribe",
    description: "Subscribe to event-driven browser automation signals such as DOM changes, new tabs, dialogs, and downloads. A short recent event window may be replayed to reduce subscribe-after-action races.",
    risk: "low",
    tags: ["browser", "events", "subscribe"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          channels: arraySchema(enumStringSchema([...EVENT_CHANNEL_VALUES], "Observation channel."), "Subscribed event channels."),
          sampleMouseMove: booleanSchema("Whether sampled mouse move events should be emitted.", false),
          redactTextInput: booleanSchema("Whether typed text should be redacted in events.", true),
        },
        ["session", "channels"],
      ),
      "tool://browser_events_subscribe/input",
      "browser_events_subscribe input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          subscription: objectSchema(
            {
              subscriptionId: stringSchema("Subscription identifier."),
              session: SESSION_SCHEMA,
              startedAt: numberSchema("Subscription start time."),
              channels: arraySchema(enumStringSchema([...EVENT_CHANNEL_VALUES]), "Subscribed channels."),
              sampleMouseMove: booleanSchema("Whether mouse move sampling is enabled."),
              redactTextInput: booleanSchema("Whether text input is redacted."),
              cursor: CURSOR_SCHEMA,
            },
            ["subscriptionId", "session", "startedAt", "channels", "sampleMouseMove", "redactTextInput", "cursor"],
          ),
        },
        ["subscription"],
      ),
      "tool://browser_events_subscribe/output",
      "browser_events_subscribe output",
    ),
  },

  "browser_events_read": {
    name: "browser_events_read",
    description: "Read events from an existing browser event subscription.",
    risk: "low",
    tags: ["browser", "events", "read"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          cursor: CURSOR_SCHEMA,
          limit: integerSchema("Maximum number of events to return."),
        },
        ["subscriptionId"],
      ),
      "tool://browser_events_read/input",
      "browser_events_read input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          events: arraySchema(GENERIC_EVENT_SCHEMA, "Observed events."),
          dropped: booleanSchema("Whether earlier events were dropped."),
          nextCursor: CURSOR_SCHEMA,
        },
        ["subscriptionId", "events", "dropped"],
      ),
      "tool://browser_events_read/output",
      "browser_events_read output",
    ),
  },

  "browser_events_await": {
    name: "browser_events_await",
    description: "Wait asynchronously until a subscribed browser event matching the filter arrives.",
    risk: "low",
    tags: ["browser", "events", "await"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          cursor: CURSOR_SCHEMA,
          match: objectSchema(
            {
              kinds: arraySchema(stringSchema("Event kind to match."), "Allowed event kinds."),
              tabId: stringSchema("Require a specific tab id."),
              openerTabId: stringSchema("Require a specific opener tab id. Use \"current\" to mean the subscribed session tab."),
              windowId: stringSchema("Require a specific browser window id."),
              source: stringSchema("Require a specific event source such as window_open."),
              urlMatches: stringSchema("Case-insensitive regular expression for event.url."),
              titleMatches: stringSchema("Case-insensitive regular expression for event.title."),
              summaryMatches: stringSchema("Case-insensitive regular expression for event.summary."),
            },
            [],
          ),
          timeoutMs: integerSchema("Maximum time to wait in milliseconds."),
          coalesceMs: integerSchema("Optional batching window after the first match in milliseconds."),
          maxEvents: integerSchema("Maximum number of matched events to return."),
        },
        ["subscriptionId"],
      ),
      "tool://browser_events_await/input",
      "browser_events_await input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          matched: booleanSchema("Whether one or more matching events were observed."),
          timedOut: booleanSchema("Whether waiting ended because of timeout."),
          events: arraySchema(GENERIC_EVENT_SCHEMA, "Matched events."),
          event: GENERIC_EVENT_SCHEMA,
          dropped: booleanSchema("Whether earlier events were dropped before the returned cursor."),
          nextCursor: CURSOR_SCHEMA,
        },
        ["subscriptionId", "matched", "timedOut", "events", "dropped"],
      ),
      "tool://browser_events_await/output",
      "browser_events_await output",
    ),
  },

  "browser_events_unsubscribe": {
    name: "browser_events_unsubscribe",
    description: "Stop an existing browser event subscription.",
    risk: "low",
    tags: ["browser", "events", "unsubscribe"],
    inputSchema: withDraft202012(
      objectSchema({ subscriptionId: stringSchema("Subscription identifier.") }, ["subscriptionId"]),
      "tool://browser_events_unsubscribe/input",
      "browser_events_unsubscribe input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          stoppedAt: numberSchema("Stop timestamp in milliseconds."),
          eventCount: integerSchema("Buffered event count when the subscription stopped."),
        },
        ["subscriptionId", "eventCount"],
      ),
      "tool://browser_events_unsubscribe/output",
      "browser_events_unsubscribe output",
    ),
  },

  "browser_dialog_handle": {
    name: "browser_dialog_handle",
    description: "Accept or dismiss the currently open JavaScript dialog on the page.",
    risk: "high",
    tags: ["browser", "dialog"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: SESSION_SCHEMA,
          accept: booleanSchema("Whether to accept the dialog."),
          promptText: stringSchema("Text to submit to a prompt dialog."),
        },
        ["session", "accept"],
      ),
      "tool://browser_dialog_handle/input",
      "browser_dialog_handle input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          ok: booleanSchema("Whether the dialog command was sent."),
          accepted: booleanSchema("Whether the dialog was accepted."),
          promptText: stringSchema("Prompt text that was submitted."),
        },
        ["ok", "accepted"],
      ),
      "tool://browser_dialog_handle/output",
      "browser_dialog_handle output",
    ),
  },
} satisfies Record<string, ToolDefinition>;

export type PublicToolName = keyof typeof PublicToolSchemas;
export const PublicToolRegistry = Object.values(PublicToolSchemas);

export function validatePublicToolExists(name: string): name is PublicToolName {
  return name in PublicToolSchemas;
}
