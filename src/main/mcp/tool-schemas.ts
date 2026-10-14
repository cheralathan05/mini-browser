// Milo Tool Schemas
// Strict JSON Schema Draft 2020-12 flavored registry for an AI Native, event-driven browser agent.
// Note: this file exports plain schema objects that are compatible with Draft 2020-12 structure.

export type JSONSchema = {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  prefixItems?: JSONSchema[];
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  unevaluatedProperties?: boolean | JSONSchema;
  default?: unknown;
  examples?: unknown[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  pattern?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  risk: "low" | "medium" | "high";
  tags: string[];
};

const stringSchema = (description?: string): JSONSchema => ({
  type: "string",
  ...(description ? { description } : {}),
});

const booleanSchema = (description?: string, defaultValue?: boolean): JSONSchema => ({
  type: "boolean",
  ...(description ? { description } : {}),
  ...(defaultValue !== undefined ? { default: defaultValue } : {}),
});

const constBooleanSchema = (value: boolean, description?: string): JSONSchema => ({
  type: "boolean",
  const: value,
  ...(description ? { description } : {}),
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

const jsonValueSchema = (description?: string): JSONSchema => ({
  type: ["object", "array", "string", "number", "boolean", "null"],
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

const OBSERVATION_CHANNEL_VALUES = [
  "input",
  "navigation",
  "dom",
  "network",
  "runtime",
  "focus",
  "selection",
] as const;

const HANDLE_KIND_VALUES = ["element", "form", "region"] as const;

const WAIT_SUCCESS_SIGNAL_SCHEMA: JSONSchema = {
  oneOf: [
    objectSchema(
      {
        type: enumStringSchema(["url_matches"]),
        value: stringSchema("URL regex or match string."),
      },
      ["type", "value"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["text_visible"]),
        value: stringSchema("Expected visible text."),
      },
      ["type", "value"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["response_ok"]),
        value: stringSchema("Request URL pattern."),
      },
      ["type", "value"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["element_visible"]),
        elementId: stringSchema("Expected visible element id."),
      },
      ["type", "elementId"],
    ),
  ],
};

const WAIT_EXPECTATION_SCHEMA: JSONSchema = {
  oneOf: [
    objectSchema(
      {
        type: enumStringSchema(["url_changed"]),
        value: stringSchema("Optional URL regex or match string."),
      },
      ["type"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["url_matches"]),
        value: stringSchema("URL regex or match string."),
      },
      ["type", "value"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["text_visible"]),
        value: stringSchema("Expected visible text."),
      },
      ["type", "value"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["element_visible"]),
        elementId: stringSchema("Expected visible element id."),
      },
      ["type", "elementId"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["region_visible"]),
        regionId: stringSchema("Expected region id."),
        regionRole: enumStringSchema(
          ["header", "nav", "sidebar", "main", "panel", "list", "table", "form", "dialog", "footer", "unknown"],
          "Optional expected region role.",
        ),
        text: stringSchema("Optional text expected in the region."),
      },
      ["type"],
    ),
    objectSchema(
      {
        type: enumStringSchema(["records_visible"]),
        regionId: stringSchema("Optional region id to scope record extraction."),
        regionRole: enumStringSchema(["table", "list", "panel", "main", "form"], "Preferred region role."),
        minRecords: integerSchema("Minimum required record count."),
        recordSchema: objectSchema({}, [], "Optional JSON Schema-like object used to validate each extracted record.", true),
      },
      ["type"],
    ),
  ],
};

function cloneSchema<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneSchema(entry)) as T;
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneSchema(entry);
    }
    return result as T;
  }

  return value;
}

function inlineLocalSchemaRefs(
  schema: JSONSchema,
  defs: Record<string, JSONSchema>,
  stack: string[] = [],
): JSONSchema {
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/$defs/")) {
      throw new Error(`Unsupported schema ref: ${schema.$ref}`);
    }

    const key = schema.$ref.slice("#/$defs/".length);
    if (stack.includes(key)) {
      throw new Error(`Circular schema ref detected: ${[...stack, key].join(" -> ")}`);
    }

    const target = defs[key];
    if (!target) {
      throw new Error(`Unknown schema ref: ${schema.$ref}`);
    }

    const { $ref: _ignoredRef, ...refSiblings } = schema;
    const resolvedTarget = inlineLocalSchemaRefs(target, defs, [...stack, key]);

    return inlineLocalSchemaRefs(
      {
        ...cloneSchema(resolvedTarget),
        ...cloneSchema(refSiblings),
      },
      defs,
      stack,
    );
  }

  const { $defs: _ignoredDefs, ...base } = cloneSchema(schema);
  const result: JSONSchema = base;

  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, value]) => [
        key,
        inlineLocalSchemaRefs(value, defs, stack),
      ]),
    );
  }

  if (result.items) {
    result.items = inlineLocalSchemaRefs(result.items, defs, stack);
  }

  if (result.prefixItems) {
    result.prefixItems = result.prefixItems.map((entry) =>
      inlineLocalSchemaRefs(entry, defs, stack)
    );
  }

  if (result.oneOf) {
    result.oneOf = result.oneOf.map((entry) => inlineLocalSchemaRefs(entry, defs, stack));
  }

  if (result.anyOf) {
    result.anyOf = result.anyOf.map((entry) => inlineLocalSchemaRefs(entry, defs, stack));
  }

  if (result.allOf) {
    result.allOf = result.allOf.map((entry) => inlineLocalSchemaRefs(entry, defs, stack));
  }

  if (result.additionalProperties && typeof result.additionalProperties === "object" && !Array.isArray(result.additionalProperties)) {
    result.additionalProperties = inlineLocalSchemaRefs(result.additionalProperties, defs, stack);
  }

  if (result.unevaluatedProperties && typeof result.unevaluatedProperties === "object" && !Array.isArray(result.unevaluatedProperties)) {
    result.unevaluatedProperties = inlineLocalSchemaRefs(result.unevaluatedProperties, defs, stack);
  }

  return result;
}

function assertSchemaHasNoRefs(schema: JSONSchema, path = "$") {
  if (schema.$ref) {
    throw new Error(`Schema refs are not allowed in exported tool schemas: ${path} -> ${schema.$ref}`);
  }

  if (schema.$defs) {
    throw new Error(`Schema defs are not allowed in exported tool schemas: ${path}.$defs`);
  }

  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      assertSchemaHasNoRefs(value, `${path}.properties.${key}`);
    }
  }

  if (schema.items) {
    assertSchemaHasNoRefs(schema.items, `${path}.items`);
  }

  if (schema.prefixItems) {
    schema.prefixItems.forEach((entry, index) => {
      assertSchemaHasNoRefs(entry, `${path}.prefixItems[${index}]`);
    });
  }

  if (schema.oneOf) {
    schema.oneOf.forEach((entry, index) => {
      assertSchemaHasNoRefs(entry, `${path}.oneOf[${index}]`);
    });
  }

  if (schema.anyOf) {
    schema.anyOf.forEach((entry, index) => {
      assertSchemaHasNoRefs(entry, `${path}.anyOf[${index}]`);
    });
  }

  if (schema.allOf) {
    schema.allOf.forEach((entry, index) => {
      assertSchemaHasNoRefs(entry, `${path}.allOf[${index}]`);
    });
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object" && !Array.isArray(schema.additionalProperties)) {
    assertSchemaHasNoRefs(schema.additionalProperties, `${path}.additionalProperties`);
  }

  if (schema.unevaluatedProperties && typeof schema.unevaluatedProperties === "object" && !Array.isArray(schema.unevaluatedProperties)) {
    assertSchemaHasNoRefs(schema.unevaluatedProperties, `${path}.unevaluatedProperties`);
  }
}

export const SharedDefs: Record<string, JSONSchema> = {
  BrowserSessionRef: objectSchema(
    {
      sessionId: stringSchema("Stable browser session identifier."),
      tabId: stringSchema("Stable tab identifier."),
      frameId: stringSchema("Optional frame identifier when scoped to a frame."),
      userId: stringSchema("Optional logical user identifier."),
    },
    ["sessionId", "tabId"],
    "Reference to the current browser observation/execution context.",
  ),

  PageRef: objectSchema(
    {
      sessionId: stringSchema("Stable browser session identifier."),
      tabId: stringSchema("Stable tab identifier."),
      frameId: stringSchema("Optional frame identifier when scoped to a frame."),
      userId: stringSchema("Optional logical user identifier."),
      documentId: stringSchema("Stable identifier for the currently loaded document."),
      leaseId: stringSchema("Execution lease identifier returned at attach time."),
      observeOnly: booleanSchema("Whether the attached page reference is observation-only."),
    },
    ["sessionId", "tabId", "documentId", "leaseId", "observeOnly"],
    "Agent-facing page reference with explicit document and lease binding.",
  ),

  EventCursor: objectSchema(
    {
      subscriptionId: stringSchema("Subscription identifier."),
      seq: integerSchema("Last observed event sequence number."),
      ts: numberSchema("Timestamp of the last observed event in milliseconds."),
      dropped: booleanSchema("Whether any events were dropped before this cursor."),
    },
    ["subscriptionId", "seq"],
    "Cursor used to continue reading an observation subscription.",
  ),

  SubscriptionState: objectSchema(
    {
      subscriptionId: stringSchema("Subscription identifier."),
      page: { $ref: "#/$defs/PageRef" },
      startedAt: numberSchema("Subscription start timestamp in milliseconds."),
      mode: enumStringSchema(["pull"], "Subscription delivery mode."),
      channels: arraySchema(
        enumStringSchema([...OBSERVATION_CHANNEL_VALUES], "Observation channel."),
        "Subscribed observation channels.",
      ),
      cursor: { $ref: "#/$defs/EventCursor" },
      sampleMouseMove: booleanSchema("Whether sampled mouse movement is included."),
      redactTextInput: booleanSchema("Whether text input is redacted."),
    },
    ["subscriptionId", "page", "startedAt", "mode", "channels", "cursor", "sampleMouseMove", "redactTextInput"],
    "Agent-facing subscription state for browser observation.",
  ),

  Viewport: objectSchema(
    {
      width: integerSchema("Viewport width in CSS pixels."),
      height: integerSchema("Viewport height in CSS pixels."),
    },
    ["width", "height"],
  ),

  Rect: objectSchema(
    {
      x: numberSchema("Left coordinate."),
      y: numberSchema("Top coordinate."),
      width: numberSchema("Width."),
      height: numberSchema("Height."),
    },
    ["x", "y", "width", "height"],
  ),

  FrameTreeNode: objectSchema(
    {
      frameId: stringSchema("Frame identifier."),
      url: stringSchema("Frame URL."),
    },
    ["frameId", "url"],
  ),

  RawBrowserEvent: {
    oneOf: [
      objectSchema(
        {
          kind: enumStringSchema([
            "input.click",
            "input.keydown",
            "input.input",
            "input.scroll",
            "input.mousemove",
          ], "Low-level input event kind."),
          ts: numberSchema("Timestamp in milliseconds."),
          url: stringSchema("Current page URL when available."),
          title: stringSchema("Current page title when available."),
          x: numberSchema("Pointer X."),
          y: numberSchema("Pointer Y."),
          key: stringSchema("Keyboard key if relevant."),
          text: stringSchema("Input text or redacted placeholder."),
          targetHint: stringSchema("Best-effort accessibility or semantic target hint."),
          targetRole: stringSchema("Observed target accessibility role when available."),
          targetName: stringSchema("Observed target accessible name when available."),
          targetLabel: stringSchema("Observed target associated label when available."),
          targetText: stringSchema("Observed target visible text when available."),
        },
        ["kind", "ts"],
        "Low-level input event.",
      ),
      objectSchema(
        {
          kind: enumStringSchema(["page.navigation", "page.lifecycle"], "Page event kind."),
          ts: numberSchema("Timestamp in milliseconds."),
          url: stringSchema("Current or target URL."),
          name: stringSchema("Lifecycle event name."),
        },
        ["kind", "ts"],
        "Page navigation or lifecycle event.",
      ),
      objectSchema(
        {
          kind: enumStringSchema(["dom.mutation"], "DOM event kind."),
          ts: numberSchema("Timestamp in milliseconds."),
          url: stringSchema("Current page URL when available."),
          title: stringSchema("Current page title when available."),
          summary: stringSchema("Human-readable DOM mutation summary."),
          selector: stringSchema("Best-effort CSS selector for the mutated target."),
          targetHint: stringSchema("Best-effort accessibility or semantic target hint."),
          targetRole: stringSchema("Observed target accessibility role when available."),
          targetName: stringSchema("Observed target accessible name when available."),
          targetLabel: stringSchema("Observed target associated label when available."),
          targetText: stringSchema("Observed target visible text when available."),
          backendNodeId: integerSchema("CDP backendNodeId for the mutated target when resolved."),
          axNodeId: stringSchema("Accessibility node id for the mutated target when resolved."),
          axRole: stringSchema("Accessibility role for the mutated target when resolved."),
          axName: stringSchema("Accessibility name for the mutated target when resolved."),
          axDescription: stringSchema("Accessibility description for the mutated target when resolved."),
          axValue: stringSchema("Accessibility value for the mutated target when resolved."),
          axIgnored: booleanSchema("Whether the resolved accessibility node is ignored."),
          axResolvedDepth: integerSchema("DOM ancestor distance used to resolve the accessibility node."),
          axResolvedSelector: stringSchema("Selector used for ancestor fallback when AX was resolved on an ancestor."),
          axResolvedTargetHint: stringSchema("Semantic hint for the selector used during ancestor fallback."),
          axResolvedTargetRole: stringSchema("Semantic role for the selector used during ancestor fallback."),
          axResolvedTargetName: stringSchema("Semantic name for the selector used during ancestor fallback."),
          axResolvedTargetLabel: stringSchema("Semantic label for the selector used during ancestor fallback."),
          axResolvedTargetText: stringSchema("Semantic text for the selector used during ancestor fallback."),
          axPath: arraySchema(
            objectSchema(
              {
                axNodeId: stringSchema("Accessibility node id."),
                role: stringSchema("Accessibility role."),
                name: stringSchema("Accessible name."),
                ignored: booleanSchema("Whether the node is ignored by accessibility."),
              },
              ["axNodeId", "ignored"],
            ),
            "Accessibility ancestor path ending at the resolved node.",
          ),
          axChildren: arraySchema(
            objectSchema(
              {
                axNodeId: stringSchema("Accessibility node id."),
                role: stringSchema("Accessibility role."),
                name: stringSchema("Accessible name."),
                ignored: booleanSchema("Whether the node is ignored by accessibility."),
              },
              ["axNodeId", "ignored"],
            ),
            "Immediate accessibility children of the resolved node.",
          ),
          axChildCount: integerSchema("Immediate accessibility child count for the resolved node."),
          axDiffSummary: stringSchema("Short summary of how the resolved accessibility subtree changed since the previous matching event."),
          axChangedFields: arraySchema(stringSchema("Changed accessibility field."), "Changed root accessibility fields."),
          axAddedChildren: arraySchema(
            objectSchema(
              {
                axNodeId: stringSchema("Accessibility node id."),
                role: stringSchema("Accessibility role."),
                name: stringSchema("Accessible name."),
                ignored: booleanSchema("Whether the node is ignored by accessibility."),
              },
              ["axNodeId", "ignored"],
            ),
            "Accessibility children added since the previous matching event.",
          ),
          axRemovedChildren: arraySchema(
            objectSchema(
              {
                axNodeId: stringSchema("Accessibility node id."),
                role: stringSchema("Accessibility role."),
                name: stringSchema("Accessible name."),
                ignored: booleanSchema("Whether the node is ignored by accessibility."),
              },
              ["axNodeId", "ignored"],
            ),
            "Accessibility children removed since the previous matching event.",
          ),
        },
        ["kind", "ts"],
        "DOM mutation event.",
      ),
      objectSchema(
        {
          kind: enumStringSchema(["network.request", "network.response"], "Network event kind."),
          ts: numberSchema("Timestamp in milliseconds."),
          requestId: stringSchema("Network request identifier."),
          url: stringSchema("Request URL."),
          status: integerSchema("HTTP status for responses."),
          method: stringSchema("HTTP method."),
        },
        ["kind", "ts"],
        "Network request or response event.",
      ),
      objectSchema(
        {
          kind: enumStringSchema(["runtime.exception", "runtime.console"], "Runtime event kind."),
          ts: numberSchema("Timestamp in milliseconds."),
          level: stringSchema("Console level or severity."),
          text: stringSchema("Console text or exception summary."),
        },
        ["kind", "ts"],
        "Runtime console or exception event.",
      ),
      objectSchema(
        {
          kind: enumStringSchema(["focus.changed", "selection.changed"], "Focus or selection event kind."),
          ts: numberSchema("Timestamp in milliseconds."),
          url: stringSchema("Current page URL when available."),
          title: stringSchema("Current page title when available."),
          targetHint: stringSchema("Best-effort accessibility or semantic target hint."),
          targetRole: stringSchema("Observed target accessibility role when available."),
          targetName: stringSchema("Observed target accessible name when available."),
          targetLabel: stringSchema("Observed target associated label when available."),
          targetText: stringSchema("Observed target visible text when available."),
          text: stringSchema("Selection text or a short event summary."),
        },
        ["kind", "ts"],
        "Focus or text selection event.",
      ),
    ],
  },

  PageRegion: objectSchema(
    {
      regionId: stringSchema("Stable semantic region identifier."),
      role: enumStringSchema([
        "header",
        "nav",
        "sidebar",
        "main",
        "panel",
        "list",
        "table",
        "form",
        "dialog",
        "footer",
        "unknown",
      ], "Semantic role of the page region."),
      name: stringSchema("Optional semantic name for the region."),
      bbox: { $ref: "#/$defs/Rect" },
      inViewport: booleanSchema("Whether the region intersects the current viewport."),
      textSummary: stringSchema("Best-effort short text summary."),
      childElementIds: arraySchema(stringSchema("Element identifier."), "Contained element ids."),
    },
    ["regionId", "role", "bbox", "inViewport", "childElementIds"],
  ),

  PageForm: objectSchema(
    {
      formId: stringSchema("Stable semantic form identifier."),
      regionId: stringSchema("Owning semantic region identifier."),
      name: stringSchema("Accessible or semantic name."),
      description: stringSchema("Accessible description."),
      method: stringSchema("HTML form method if available."),
      action: stringSchema("HTML form action if available."),
      bbox: { $ref: "#/$defs/Rect" },
      inViewport: booleanSchema("Whether the form intersects the current viewport."),
      textSummary: stringSchema("Best-effort short text summary."),
      controlElementIds: arraySchema(stringSchema("Form control element identifier."), "Contained form control ids."),
      submitActionElementIds: arraySchema(stringSchema("Submit action element identifier."), "Submit action candidate ids."),
      locatorHints: arraySchema(stringSchema("Best-effort locator hint."), "Locator hints for rebinding the form."),
    },
    [
      "formId",
      "regionId",
      "bbox",
      "inViewport",
      "controlElementIds",
      "submitActionElementIds",
      "locatorHints",
    ],
  ),

  SemanticElement: objectSchema(
    {
      elementId: stringSchema("Stable semantic element identifier."),
      regionId: stringSchema("Owning region identifier."),
      formId: stringSchema("Owning form identifier if the element belongs to a form."),
      role: enumStringSchema([
        "button",
        "link",
        "textbox",
        "searchbox",
        "checkbox",
        "radio",
        "combobox",
        "slider",
        "tab",
        "menuitem",
        "row",
        "cell",
        "heading",
        "text",
        "image",
        "unknown",
      ], "Semantic element role."),
      name: stringSchema("Accessible or semantic name."),
      description: stringSchema("Accessible description."),
      associatedLabel: stringSchema("Associated label text for form-like controls."),
      text: stringSchema("Visible text content."),
      value: stringSchema("Current value if applicable."),
      tagName: stringSchema("Underlying DOM tag name."),
      htmlType: stringSchema("Underlying input/button type attribute when available."),
      bbox: { $ref: "#/$defs/Rect" },
      visible: booleanSchema("Whether the element is visible."),
      enabled: booleanSchema("Whether the element is enabled."),
      isHitTestable: booleanSchema("Whether the element can currently receive pointer hit-testing."),
      focusable: booleanSchema("Whether the element can receive focus."),
      editable: booleanSchema("Whether the element accepts direct editing."),
      pointerCursor: booleanSchema("Whether the element uses cursor:pointer."),
      clickableHint: booleanSchema("Whether the element exposes click-like hints."),
      keyboardHint: booleanSchema("Whether the element exposes keyboard interaction hints."),
      draggable: booleanSchema("Whether the element is draggable."),
      isLeaf: booleanSchema("Whether the element is treated as a leaf action target."),
      isContainer: booleanSchema("Whether the element primarily behaves like a container."),
      isPrimaryActionCandidate: booleanSchema("Whether the element is a recommended direct action target."),
      interactivityScore: numberSchema("Heuristic interactivity score from 0 to 1."),
      selected: booleanSchema("Whether the element is selected."),
      checked: booleanSchema("Whether the element is checked."),
      pressed: booleanSchema("Whether the element is pressed."),
      expanded: booleanSchema("Whether the element is expanded."),
      primaryCapabilityType: enumStringSchema([
        "button",
        "input_text",
        "select",
        "checkbox",
        "radio",
        "slider",
        "tab_switcher",
        "pagination",
        "submit",
      ], "Primary inferred capability type."),
      supportedActions: arraySchema(
        enumStringSchema(["click", "type", "select", "drag", "submit_form", "press", "scroll"], "Supported action."),
        "Supported high-level actions for this element.",
      ),
      capabilityConfidence: numberSchema("Confidence from 0 to 1 for the inferred capability."),
      capabilityEvidence: arraySchema(stringSchema("Evidence string."), "Why the capability was inferred."),
      backendNodeId: integerSchema("CDP backendNodeId if available."),
      axNodeId: stringSchema("Accessibility node id if available."),
      locatorHints: arraySchema(stringSchema("Locator hint."), "Best-effort locator hints."),
    },
    [
      "elementId",
      "regionId",
      "role",
      "visible",
      "isHitTestable",
      "focusable",
      "isLeaf",
      "isContainer",
      "isPrimaryActionCandidate",
      "interactivityScore",
      "capabilityConfidence",
    ],
  ),

  PageInformationBlock: objectSchema(
    {
      blockId: stringSchema("Stable information block identifier."),
      regionId: stringSchema("Owning semantic region identifier."),
      type: enumStringSchema([
        "text",
        "image",
        "table",
        "list",
        "card_group",
        "article",
        "metric_group",
      ], "Inferred information type."),
      title: stringSchema("Short title for the block."),
      summary: stringSchema("Short summary for the block."),
      bbox: { $ref: "#/$defs/Rect" },
      inViewport: booleanSchema("Whether the block intersects the viewport."),
      confidence: numberSchema("Confidence from 0 to 1."),
      itemCount: integerSchema("Approximate item count when the block is repeated or tabular."),
      extractable: booleanSchema("Whether structured extraction is likely to work well for this block."),
      sourceElementIds: arraySchema(stringSchema("Semantic element identifier."), "Semantic elements contributing to this block."),
      relatedCapabilityIds: arraySchema(stringSchema("Capability identifier."), "Related capability ids."),
      regionHandleId: stringSchema("Optional handle id for the owning region when the block is returned from page.snapshot."),
    },
    [
      "blockId",
      "regionId",
      "type",
      "bbox",
      "inViewport",
      "confidence",
      "extractable",
      "sourceElementIds",
      "relatedCapabilityIds",
    ],
  ),

  PageCapability: objectSchema(
    {
      capabilityId: stringSchema("Stable capability identifier."),
      handleId: stringSchema("Optional handle id for direct interaction."),
      regionId: stringSchema("Owning semantic region identifier."),
      formId: stringSchema("Owning semantic form identifier when applicable."),
      elementId: stringSchema("Owning semantic element identifier when applicable."),
      type: enumStringSchema([
        "button",
        "input_text",
        "select",
        "checkbox",
        "radio",
        "slider",
        "tab_switcher",
        "pagination",
        "submit",
      ], "Inferred capability type."),
      title: stringSchema("Short title for the capability."),
      label: stringSchema("Associated label text."),
      description: stringSchema("Short description."),
      bbox: { $ref: "#/$defs/Rect" },
      visible: booleanSchema("Whether the capability is visible."),
      enabled: booleanSchema("Whether the capability is enabled."),
      confidence: numberSchema("Confidence from 0 to 1."),
      actions: arraySchema(
        enumStringSchema(["click", "type", "select", "drag", "submit_form", "press", "scroll"], "Supported action."),
        "Supported high-level actions.",
      ),
      evidence: arraySchema(stringSchema("Evidence string."), "Why the capability was inferred."),
      relatedBlockIds: arraySchema(stringSchema("Information block identifier."), "Related information block ids."),
    },
    [
      "capabilityId",
      "regionId",
      "type",
      "visible",
      "enabled",
      "confidence",
      "actions",
      "evidence",
      "relatedBlockIds",
    ],
  ),

  SnapshotDiff: objectSchema(
    {
      beforeSnapshotId: stringSchema("Base snapshot identifier."),
      afterSnapshotId: stringSchema("Compared snapshot identifier."),
      urlChanged: booleanSchema("Whether the page URL changed."),
      domChanged: booleanSchema("Whether the semantic DOM meaningfully changed."),
      visibleTextChanged: booleanSchema("Whether visible text changed."),
      stateChanged: booleanSchema("Whether element state changed, including meaningful visual state changes such as status colors."),
      changedRegionIds: arraySchema(stringSchema("Changed region identifier."), "Regions with material changes."),
      mainRegionChangeRatio: numberSchema("0 to 1 estimate of how much the main region changed."),
      significance: enumStringSchema(["none", "minor", "major"], "Human-readable snapshot change significance."),
      summary: stringSchema("Short diff summary."),
    },
    [
      "beforeSnapshotId",
      "afterSnapshotId",
      "urlChanged",
      "domChanged",
      "visibleTextChanged",
      "stateChanged",
      "changedRegionIds",
      "mainRegionChangeRatio",
      "significance",
      "summary",
    ],
  ),

  ActionExecutionResult: objectSchema(
    {
      actionId: stringSchema("Action identifier."),
      accepted: booleanSchema("Whether execution was accepted."),
      effective: booleanSchema("Whether the action produced a meaningful page or state change."),
      reason: stringSchema("Short explanation when the action was blocked or ineffective."),
      emittedEvents: arraySchema(stringSchema("Event kind."), "Events emitted during execution."),
      urlChanged: booleanSchema("Whether the page URL changed."),
      domChanged: booleanSchema("Whether the semantic DOM meaningfully changed."),
      networkTriggered: booleanSchema("Whether browser resource activity increased after the action."),
      focusedElementChanged: booleanSchema("Whether the focused element changed."),
      visibleTextChanged: booleanSchema("Whether visible text changed."),
      stateChanged: booleanSchema("Whether target/page state changed, including meaningful visual state changes such as status colors."),
      errorObserved: booleanSchema("Whether a validation or error-like state was observed after the action."),
      errorMessages: arraySchema(stringSchema("Observed error message."), "Observed validation or error-like messages after the action."),
      preSnapshotId: stringSchema("Pre-action snapshot identifier."),
      postSnapshotId: stringSchema("Post-action snapshot identifier."),
      targetElementId: stringSchema("Resolved semantic target element identifier when available."),
      targetFormId: stringSchema("Resolved semantic target form identifier when available."),
      snapshotDiff: { $ref: "#/$defs/SnapshotDiff" },
    },
    [
      "actionId",
      "accepted",
      "effective",
      "emittedEvents",
      "urlChanged",
      "domChanged",
      "networkTriggered",
      "focusedElementChanged",
      "visibleTextChanged",
      "stateChanged",
      "errorObserved",
      "errorMessages",
    ],
  ),

  LiveHandle: objectSchema(
    {
      handleId: stringSchema("Stable agent-facing handle identifier."),
      kind: enumStringSchema([...HANDLE_KIND_VALUES], "Kind of resource referenced by the handle."),
      page: { $ref: "#/$defs/PageRef" },
      snapshotId: stringSchema("Semantic snapshot identifier used to materialize the handle."),
      generation: integerSchema("Monotonic generation count for this handle."),
      stale: booleanSchema("Whether the handle is stale and should be re-located."),
      role: stringSchema("Best-effort semantic role for the handle."),
      name: stringSchema("Best-effort accessible or semantic name."),
      description: stringSchema("Best-effort short description."),
      locator: stringSchema("Best-effort selector or locator used for fallback rebinding."),
      targetElementId: stringSchema("Current semantic element identifier when handle kind is element."),
      targetFormId: stringSchema("Current semantic form identifier when handle kind is form."),
      targetRegionId: stringSchema("Current semantic region identifier when handle kind is region."),
    },
    ["handleId", "kind", "page", "snapshotId", "generation", "stale"],
    "Stable handle used by agents to interact with live page targets.",
  ),

  StepResult: objectSchema(
    {
      actionId: stringSchema("Action identifier when the step performed a tracked action."),
      status: enumStringSchema(["success", "failure", "blocked", "timeout", "unknown"], "Final step status."),
      reasonCode: stringSchema("Short machine-readable reason for the final status."),
      retryable: booleanSchema("Whether the step can be retried safely."),
      evidence: arraySchema(stringSchema("Evidence string."), "Observed evidence explaining the outcome."),
      page: { $ref: "#/$defs/PageRef" },
      target: { $ref: "#/$defs/LiveHandle" },
      execution: { $ref: "#/$defs/ActionExecutionResult" },
      errorObserved: booleanSchema("Whether a validation or error-like state was observed during the step."),
      errorMessages: arraySchema(stringSchema("Observed error message."), "Observed validation or error-like messages during the step."),
      postSnapshotId: stringSchema("Latest semantic snapshot after the step completed."),
      snapshotDiff: { $ref: "#/$defs/SnapshotDiff" },
      navigation: objectSchema(
        {
          url: stringSchema("Current page URL after navigation."),
          title: stringSchema("Current page title after navigation."),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Applied wait condition."),
          matched: booleanSchema("Whether requested wait condition was observed."),
          timedOut: booleanSchema("Whether waiting timed out."),
          matchedEvent: stringSchema("Lifecycle event that satisfied wait condition."),
        },
        ["url", "title", "waitUntil", "matched", "timedOut"],
      ),
    },
    ["status", "retryable", "evidence", "page", "errorObserved", "errorMessages"],
    "Unified agent-facing result returned by act.step.",
  ),

  ResolvedEvent: objectSchema(
    {
      raw: { $ref: "#/$defs/RawBrowserEvent" },
      resolvedRegionId: stringSchema("Resolved semantic region id."),
      resolvedElementId: stringSchema("Resolved semantic element id."),
      confidence: numberSchema("Resolution confidence from 0 to 1."),
    },
    ["raw", "confidence"],
  ),

  RegionAttentionScore: objectSchema(
    {
      regionId: stringSchema("Region identifier."),
      score: numberSchema("Unnormalized attention score."),
      probability: numberSchema("Normalized probability over regions."),
      confidence: numberSchema("Confidence from 0 to 1."),
      evidence: arraySchema(stringSchema("Evidence string."), "Human-readable evidence."),
    },
    ["regionId", "score", "probability", "confidence", "evidence"],
  ),

  RegionAttentionState: objectSchema(
    {
      regionId: stringSchema("Region identifier."),
      state: enumStringSchema(["seen", "inspected", "acted_on"], "Attention state class."),
      confidence: numberSchema("Confidence from 0 to 1."),
    },
    ["regionId", "state", "confidence"],
  ),

  WorkflowPattern: objectSchema(
    {
      patternId: stringSchema("Workflow pattern identifier."),
      pageType: stringSchema("Page type or task type."),
      steps: arraySchema(
        objectSchema(
          {
            actionType: stringSchema("Action type."),
            regionRole: stringSchema("Region role hint."),
            elementRole: stringSchema("Element role hint."),
            elementNameHint: stringSchema("Element name hint."),
          },
          ["actionType"],
        ),
        "Ordered pattern steps.",
      ),
      support: integerSchema("Number of supporting traces."),
      confidence: numberSchema("Pattern confidence from 0 to 1."),
    },
    ["patternId", "pageType", "steps", "support", "confidence"],
  ),

  RecoveryPattern: objectSchema(
    {
      recoveryId: stringSchema("Recovery pattern identifier."),
      trigger: enumStringSchema([
        "validation_error",
        "auth_redirect",
        "dialog_blocked",
        "network_failure",
        "unknown",
      ], "Failure trigger category."),
      actions: arraySchema(
        objectSchema(
          {
            actionType: stringSchema("Action type."),
            targetHint: stringSchema("Best-effort accessibility or semantic target hint."),
            targetRole: stringSchema("Observed target accessibility role when available."),
            targetName: stringSchema("Observed target accessible name when available."),
            targetLabel: stringSchema("Observed target associated label when available."),
            targetText: stringSchema("Observed target visible text when available."),
          },
          ["actionType"],
        ),
        "Ordered recovery actions.",
      ),
      support: integerSchema("Number of supporting traces."),
      successRate: numberSchema("Observed recovery success rate from 0 to 1."),
    },
    ["recoveryId", "trigger", "actions", "support", "successRate"],
  ),

  SuggestedAction: objectSchema(
    {
      actionType: enumStringSchema([
        "click",
        "type",
        "select",
        "scroll",
        "close_dialog",
        "switch_view",
      ], "Suggested action type."),
      targetRegionId: stringSchema("Suggested target region id."),
      targetElementId: stringSchema("Suggested target element id."),
      confidence: numberSchema("Confidence from 0 to 1."),
      reasons: arraySchema(stringSchema("Reason string."), "Explanation strings."),
      risk: enumStringSchema(["low", "medium", "high"], "Risk level."),
    },
    ["actionType", "confidence", "reasons", "risk"],
  ),

  ContextScope: objectSchema(
    {
      type: enumStringSchema(["page", "region", "form"], "Scope type used for the current description."),
      regionId: stringSchema("Scoped semantic region id when applicable."),
      formId: stringSchema("Scoped semantic form id when applicable."),
      role: stringSchema("Scoped semantic role when applicable."),
      name: stringSchema("Scoped semantic name when applicable."),
    },
    ["type"],
  ),

  ContextRegion: objectSchema(
    {
      handleId: stringSchema("Stable region handle id for follow-up drill-down or action targeting."),
      regionId: stringSchema("Semantic region identifier."),
      role: enumStringSchema([
        "header",
        "nav",
        "sidebar",
        "main",
        "panel",
        "list",
        "table",
        "form",
        "dialog",
        "footer",
        "unknown",
      ], "Semantic region role."),
      name: stringSchema("Optional semantic name."),
      bbox: { $ref: "#/$defs/Rect" },
      inViewport: booleanSchema("Whether the region intersects the current viewport."),
      textSummary: stringSchema("Best-effort short text summary."),
      attentionScore: numberSchema("Heuristic salience score for this region."),
      actionCount: integerSchema("Number of actionable targets found in the region."),
      formCount: integerSchema("Number of forms found in the region."),
      primaryActionElementIds: arraySchema(stringSchema("Semantic element identifier."), "Primary actionable element ids in this region."),
      primaryFormIds: arraySchema(stringSchema("Semantic form identifier."), "Primary form ids in this region."),
      canExtractRecords: booleanSchema("Whether repeated-record extraction is likely to work well from this region."),
    },
    [
      "handleId",
      "regionId",
      "role",
      "bbox",
      "inViewport",
      "attentionScore",
      "actionCount",
      "formCount",
      "primaryActionElementIds",
      "primaryFormIds",
      "canExtractRecords",
    ],
  ),

  ContextForm: objectSchema(
    {
      handleId: stringSchema("Stable form handle id for follow-up drill-down or submission."),
      formId: stringSchema("Semantic form identifier."),
      regionId: stringSchema("Owning semantic region identifier."),
      name: stringSchema("Accessible or semantic form name."),
      description: stringSchema("Accessible or semantic description."),
      method: stringSchema("HTML form method if available."),
      action: stringSchema("HTML form action if available."),
      bbox: { $ref: "#/$defs/Rect" },
      inViewport: booleanSchema("Whether the form intersects the current viewport."),
      textSummary: stringSchema("Best-effort short text summary."),
      controlCount: integerSchema("Number of contained form controls."),
      submitActionCount: integerSchema("Number of candidate submit actions."),
      submitActionHandleId: stringSchema("Handle id for the primary submit action candidate when available."),
    },
    [
      "handleId",
      "formId",
      "regionId",
      "bbox",
      "inViewport",
      "controlCount",
      "submitActionCount",
    ],
  ),

  ContextAction: objectSchema(
    {
      handleId: stringSchema("Stable element handle id for follow-up action."),
      elementId: stringSchema("Semantic element identifier."),
      regionId: stringSchema("Owning semantic region identifier."),
      formId: stringSchema("Owning semantic form identifier when available."),
      actionType: enumStringSchema(["click", "type", "select"], "Primary action type supported by this target."),
      role: stringSchema("Semantic role for this target."),
      name: stringSchema("Accessible or semantic name."),
      label: stringSchema("Associated label text when available."),
      text: stringSchema("Visible text when available."),
      bbox: { $ref: "#/$defs/Rect" },
      visible: booleanSchema("Whether the target is visible."),
      enabled: booleanSchema("Whether the target is enabled."),
      confidence: numberSchema("Confidence that this is a useful immediate target."),
      reasons: arraySchema(stringSchema("Reason string."), "Why this target is worth attention."),
      submitActionForFormId: stringSchema("Semantic form id when this target acts as a submit action."),
    },
    [
      "handleId",
      "elementId",
      "regionId",
      "actionType",
      "role",
      "visible",
      "confidence",
      "reasons",
    ],
  ),

  ContextDrilldown: objectSchema(
    {
      label: stringSchema("Short user-facing drill-down label."),
      tool: stringSchema("Suggested follow-up tool name."),
      reason: stringSchema("Why this drill-down is useful."),
      arguments: objectSchema({}, [], "Suggested follow-up arguments.", true),
    },
    ["label", "tool", "reason", "arguments"],
  ),
};

const withDraft202012 = (schema: JSONSchema, id: string, title?: string): JSONSchema => {
  const normalized = inlineLocalSchemaRefs(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: id,
      ...(title ? { title } : {}),
      ...schema,
    },
    SharedDefs,
  );

  assertSchemaHasNoRefs(normalized);
  return normalized;
};

function assertToolInputSchemasHaveObjectRoot(toolSchemas: Record<string, ToolDefinition>) {
  for (const tool of Object.values(toolSchemas)) {
    const types = Array.isArray(tool.inputSchema.type)
      ? tool.inputSchema.type
      : tool.inputSchema.type
        ? [tool.inputSchema.type]
        : [];

    if (!types.includes("object")) {
      throw new Error(`Tool inputSchema must declare top-level type "object": ${tool.name}`);
    }
  }
}

const TAB_ORGANIZATION_TAB_SCHEMA = objectSchema(
  {
    tabId: stringSchema("Tab id."),
    title: stringSchema("Tab title."),
    url: stringSchema("Current URL."),
    displayUrl: stringSchema("Display URL."),
    favicon: stringSchema("Favicon URL."),
    isActive: booleanSchema("Whether this is the active tab in the window."),
  },
  ["tabId", "title", "url", "displayUrl", "isActive"],
);

const TAB_ORGANIZATION_GROUP_SCHEMA = objectSchema(
  {
    folderId: stringSchema("Sidebar folder/group id."),
    title: stringSchema("Sidebar folder/group title."),
    icon: stringSchema("Optional folder icon."),
    backgroundColor: stringSchema("Optional folder background color."),
    isExpanded: booleanSchema("Whether the folder is expanded in the sidebar."),
    tabCount: integerSchema("Number of tabs referenced by this folder."),
    tabs: arraySchema(TAB_ORGANIZATION_TAB_SCHEMA, "Tabs inside this sidebar folder/group."),
  },
  ["folderId", "title", "isExpanded", "tabCount", "tabs"],
);

const TAB_ORGANIZATION_SPLIT_SCHEMA = objectSchema(
  {
    splitId: stringSchema("Split-view id."),
    mode: enumStringSchema(["horizontal", "vertical", "bento"], "Split-view layout mode."),
    tabCount: integerSchema("Number of tabs referenced by this split view."),
    focusedTabId: stringSchema("Focused tab id inside the split view."),
    syncScroll: booleanSchema("Whether synced scrolling is enabled."),
    tabs: arraySchema(TAB_ORGANIZATION_TAB_SCHEMA, "Tabs inside this split view."),
  },
  ["splitId", "mode", "tabCount", "focusedTabId", "syncScroll", "tabs"],
);

const TAB_ORGANIZATION_SCHEMA = objectSchema(
  {
    windowId: stringSchema("Browser window id."),
    workspaceId: stringSchema("Owning workspace id."),
    activeTabId: stringSchema("Active tab id."),
    totalTabCount: integerSchema("Total number of tabs in the window."),
    rootTabCount: integerSchema("Number of tabs shown at the root of the sidebar."),
    groupCount: integerSchema("Number of sidebar folders/groups."),
    splitCount: integerSchema("Number of split views."),
    groupedTabCount: integerSchema("Number of tabs inside sidebar folders/groups."),
    splitTabCount: integerSchema("Number of tabs inside split views."),
    rootTabs: arraySchema(TAB_ORGANIZATION_TAB_SCHEMA, "Tabs shown at the root of the sidebar."),
    groups: arraySchema(TAB_ORGANIZATION_GROUP_SCHEMA, "Sidebar folders/groups and their tabs."),
    splits: arraySchema(TAB_ORGANIZATION_SPLIT_SCHEMA, "Split views and their tabs."),
  },
  [
    "windowId",
    "workspaceId",
    "totalTabCount",
    "rootTabCount",
    "groupCount",
    "splitCount",
    "groupedTabCount",
    "splitTabCount",
    "rootTabs",
    "groups",
    "splits",
  ],
);

export const ToolSchemas = {
  "browser.list_windows": {
    name: "browser.list_windows",
    description: "List browser windows with workspace and active-tab context.",
    risk: "low",
    tags: ["browser", "window", "discovery"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          workspaceId: stringSchema("Optional workspace filter."),
        },
        [],
      ),
      "tool://browser.list_windows/input",
      "browser.list_windows input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windows: arraySchema(
            objectSchema(
              {
                windowId: stringSchema("Browser window id."),
                workspaceId: stringSchema("Owning workspace id."),
                tabCount: integerSchema("Number of tabs in this window."),
                activeTabId: stringSchema("Active tab id."),
                visible: booleanSchema("Whether the window is visible."),
                focused: booleanSchema("Whether the window is focused."),
                title: stringSchema("Window title."),
              },
              ["windowId", "workspaceId", "tabCount", "visible", "focused", "title"],
            ),
            "Window summaries.",
          ),
        },
        ["windows"],
      ),
      "tool://browser.list_windows/output",
      "browser.list_windows output",
    ),
  },

  "browser.list_tabs": {
    name: "browser.list_tabs",
    description:
      "List browser tabs, optionally filtered by window or workspace. "
      + "When available, tabOrganizations includes sidebar folders/groups and the tabs inside them.",
    risk: "low",
    tags: ["browser", "tab", "discovery"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Optional browser window id filter."),
          workspaceId: stringSchema("Optional workspace filter."),
        },
        [],
      ),
      "tool://browser.list_tabs/input",
      "browser.list_tabs input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          tabs: arraySchema(
            objectSchema(
              {
                tabId: stringSchema("Tab id."),
                windowId: stringSchema("Owning window id."),
                workspaceId: stringSchema("Owning workspace id."),
                title: stringSchema("Tab title."),
                url: stringSchema("Current URL."),
                displayUrl: stringSchema("Display URL."),
                favicon: stringSchema("Favicon URL."),
                isLoading: booleanSchema("Whether loading is in progress."),
                canGoBack: booleanSchema("Whether tab can navigate back."),
                canGoForward: booleanSchema("Whether tab can navigate forward."),
                isActive: booleanSchema("Whether this is the active tab in window."),
              },
              [
                "tabId",
                "windowId",
                "workspaceId",
                "title",
                "url",
                "displayUrl",
                "isLoading",
                "canGoBack",
                "canGoForward",
                "isActive",
              ],
            ),
            "Tab summaries.",
          ),
          tabOrganizations: arraySchema(
            TAB_ORGANIZATION_SCHEMA,
            "Per-window sidebar tab organization, including folders/groups and their tabs.",
          ),
        },
        ["tabs"],
      ),
      "tool://browser.list_tabs/output",
      "browser.list_tabs output",
    ),
  },

  "window.create": {
    name: "window.create",
    description: "Create a browser window for a workspace.",
    risk: "medium",
    tags: ["window", "management", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          workspaceId: stringSchema("Target workspace id. Defaults to default workspace."),
          show: booleanSchema("Whether window should be shown.", true),
          focus: booleanSchema("Whether window should be focused.", true),
        },
        [],
      ),
      "tool://window.create/input",
      "window.create input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Created window id."),
          workspaceId: stringSchema("Workspace id."),
          visible: booleanSchema("Whether window is visible."),
          focused: booleanSchema("Whether window is focused."),
          tabCount: integerSchema("Current tab count."),
          activeTabId: stringSchema("Current active tab id."),
        },
        ["windowId", "workspaceId", "visible", "focused", "tabCount"],
      ),
      "tool://window.create/output",
      "window.create output",
    ),
  },

  "window.focus": {
    name: "window.focus",
    description: "Bring an existing browser window to front and focus it.",
    risk: "low",
    tags: ["window", "management", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
        },
        ["windowId"],
      ),
      "tool://window.focus/input",
      "window.focus input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          visible: booleanSchema("Whether window is visible."),
          focused: booleanSchema("Whether window is focused."),
        },
        ["windowId", "visible", "focused"],
      ),
      "tool://window.focus/output",
      "window.focus output",
    ),
  },

  "window.close": {
    name: "window.close",
    description: "Close an existing browser window.",
    risk: "high",
    tags: ["window", "management", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
        },
        ["windowId"],
      ),
      "tool://window.close/input",
      "window.close input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          success: booleanSchema("Whether close request was accepted."),
        },
        ["windowId", "success"],
      ),
      "tool://window.close/output",
      "window.close output",
    ),
  },

  "tab.create": {
    name: "tab.create",
    description: "Create a new tab in a target window.",
    risk: "medium",
    tags: ["tab", "management", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          url: stringSchema("Optional URL."),
          activate: booleanSchema("Whether the created tab should become the active tab.", true),
        },
        ["windowId"],
      ),
      "tool://tab.create/input",
      "tab.create input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          tabId: stringSchema("Created tab id."),
          windowId: stringSchema("Owning window id."),
          title: stringSchema("Tab title."),
          url: stringSchema("Tab URL."),
          displayUrl: stringSchema("Display URL."),
          isLoading: booleanSchema("Whether tab is loading."),
          isActive: booleanSchema("Whether tab is active."),
        },
        ["tabId", "windowId", "title", "url", "displayUrl", "isLoading", "isActive"],
      ),
      "tool://tab.create/output",
      "tab.create output",
    ),
  },

  "tab.close": {
    name: "tab.close",
    description: "Close a tab in a target window.",
    risk: "high",
    tags: ["tab", "management", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
        },
        ["windowId", "tabId"],
      ),
      "tool://tab.close/input",
      "tab.close input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          activeTabId: stringSchema("Active tab id after close."),
        },
        ["windowId", "activeTabId"],
      ),
      "tool://tab.close/output",
      "tab.close output",
    ),
  },

  "tab.activate": {
    name: "tab.activate",
    description: "Activate a tab in a target window.",
    risk: "low",
    tags: ["tab", "management", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
        },
        ["windowId", "tabId"],
      ),
      "tool://tab.activate/input",
      "tab.activate input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          activeTabId: stringSchema("Active tab id."),
        },
        ["windowId", "activeTabId"],
      ),
      "tool://tab.activate/output",
      "tab.activate output",
    ),
  },

  "tab.go_back": {
    name: "tab.go_back",
    description: "Navigate tab back in history if possible.",
    risk: "medium",
    tags: ["tab", "navigation", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
        },
        ["windowId", "tabId"],
      ),
      "tool://tab.go_back/input",
      "tab.go_back input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
          navigated: booleanSchema("Whether back navigation was performed."),
          url: stringSchema("Current URL."),
          title: stringSchema("Current title."),
          displayUrl: stringSchema("Current display URL."),
          canGoBack: booleanSchema("Can navigate back."),
          canGoForward: booleanSchema("Can navigate forward."),
        },
        ["windowId", "tabId", "navigated", "url", "title", "displayUrl", "canGoBack", "canGoForward"],
      ),
      "tool://tab.go_back/output",
      "tab.go_back output",
    ),
  },

  "tab.go_forward": {
    name: "tab.go_forward",
    description: "Navigate tab forward in history if possible.",
    risk: "medium",
    tags: ["tab", "navigation", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
        },
        ["windowId", "tabId"],
      ),
      "tool://tab.go_forward/input",
      "tab.go_forward input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
          navigated: booleanSchema("Whether forward navigation was performed."),
          url: stringSchema("Current URL."),
          title: stringSchema("Current title."),
          displayUrl: stringSchema("Current display URL."),
          canGoBack: booleanSchema("Can navigate back."),
          canGoForward: booleanSchema("Can navigate forward."),
        },
        ["windowId", "tabId", "navigated", "url", "title", "displayUrl", "canGoBack", "canGoForward"],
      ),
      "tool://tab.go_forward/output",
      "tab.go_forward output",
    ),
  },

  "tab.reload": {
    name: "tab.reload",
    description: "Reload a tab. If loading, this operation stops the load.",
    risk: "medium",
    tags: ["tab", "navigation", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
        },
        ["windowId", "tabId"],
      ),
      "tool://tab.reload/input",
      "tab.reload input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          windowId: stringSchema("Target window id."),
          tabId: stringSchema("Target tab id."),
          reloading: booleanSchema("Whether reload started."),
          url: stringSchema("Current URL."),
          title: stringSchema("Current title."),
          displayUrl: stringSchema("Current display URL."),
          isLoading: booleanSchema("Current loading state."),
        },
        ["windowId", "tabId", "reloading", "url", "title", "displayUrl", "isLoading"],
      ),
      "tool://tab.reload/output",
      "tab.reload output",
    ),
  },

  "page.open": {
    name: "page.open",
    description: "Open or attach a page and immediately return a progressive semantic overview of the page's information blocks and capability blocks.",
    risk: "medium",
    tags: ["page", "open", "semantic", "agent"],
    inputSchema: withDraft202012(
      {
        type: "object",
        properties: {
          tabId: stringSchema("Existing tab id to attach to."),
          url: stringSchema("Optional URL to open or navigate to as part of the attach."),
          windowId: stringSchema("Optional preferred window id."),
          workspaceId: stringSchema("Optional preferred workspace id."),
          userId: stringSchema("Optional logical user identifier."),
          observeOnly: booleanSchema("Whether the attached page is observation-only.", false),
          createIfMissing: booleanSchema("Create a tab when none matches the filters.", true),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Optional lifecycle wait condition when navigating."),
          timeoutMs: integerSchema("Optional navigation timeout in milliseconds."),
          task: stringSchema("Optional task hint used to prioritize the first snapshot."),
          maxInformation: integerSchema("Maximum number of information blocks to return."),
          maxCapabilities: integerSchema("Maximum number of capability blocks to return."),
        },
        anyOf: [{ required: ["tabId"] }, { required: ["url"] }],
        additionalProperties: false,
      },
      "tool://page.open/input",
      "page.open input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          attachedAt: numberSchema("Attachment timestamp in ms."),
          windowId: stringSchema("Resolved window id."),
          tabId: stringSchema("Resolved tab id."),
          url: stringSchema("Current page URL after attach."),
          title: stringSchema("Current page title after attach."),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Applied wait condition."),
          matched: booleanSchema("Whether requested wait condition was observed."),
          timedOut: booleanSchema("Whether waiting timed out."),
          matchedEvent: stringSchema("Lifecycle event that satisfied wait condition."),
          createdTab: booleanSchema("Whether a new tab was created."),
          snapshotId: stringSchema("Semantic snapshot identifier."),
          summary: stringSchema("Short summary of the current page reality."),
          information: arraySchema({ $ref: "#/$defs/PageInformationBlock" }, "Initial information blocks."),
          capabilities: arraySchema({ $ref: "#/$defs/PageCapability" }, "Initial capability blocks."),
          drilldowns: arraySchema({ $ref: "#/$defs/ContextDrilldown" }, "Suggested follow-up drill-downs."),
        },
        ["page", "attachedAt", "windowId", "tabId", "url", "title", "waitUntil", "matched", "timedOut", "createdTab", "snapshotId", "summary", "information", "capabilities", "drilldowns"],
      ),
      "tool://page.open/output",
      "page.open output",
    ),
  },

  "page.snapshot": {
    name: "page.snapshot",
    description: "Progressively expose the current page as scoped information blocks and capability blocks instead of raw DOM details.",
    risk: "low",
    tags: ["page", "snapshot", "semantic", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          task: stringSchema("Optional natural-language task or goal used to prioritize relevant blocks and capabilities."),
          regionId: stringSchema("Optional semantic region id used to scope the snapshot."),
          formId: stringSchema("Optional semantic form id used to scope the snapshot."),
          blockId: stringSchema("Optional information block id used to scope the snapshot."),
          capabilityId: stringSchema("Optional capability id used to scope the snapshot."),
          maxRegions: integerSchema("Maximum number of salient regions to return."),
          maxForms: integerSchema("Maximum number of forms to return."),
          maxInformation: integerSchema("Maximum number of information blocks to return."),
          maxCapabilities: integerSchema("Maximum number of capability blocks to return."),
        },
        ["page"],
      ),
      "tool://page.snapshot/input",
      "page.snapshot input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          snapshotId: stringSchema("Semantic snapshot identifier."),
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          viewport: { $ref: "#/$defs/Viewport" },
          scroll: objectSchema({ x: numberSchema("Scroll X."), y: numberSchema("Scroll Y.") }, ["x", "y"]),
          scope: { $ref: "#/$defs/ContextScope" },
          summary: stringSchema("Short summary of the current scoped page reality."),
          regions: arraySchema({ $ref: "#/$defs/ContextRegion" }, "Salient semantic regions."),
          forms: arraySchema({ $ref: "#/$defs/ContextForm" }, "Salient forms."),
          information: arraySchema({ $ref: "#/$defs/PageInformationBlock" }, "Salient information blocks."),
          capabilities: arraySchema({ $ref: "#/$defs/PageCapability" }, "Salient capability blocks."),
          suggestedActions: arraySchema({ $ref: "#/$defs/SuggestedAction" }, "High-level next actions suggested by the current scene."),
          drilldowns: arraySchema({ $ref: "#/$defs/ContextDrilldown" }, "Suggested follow-up drill-downs."),
        },
        ["page", "snapshotId", "url", "title", "viewport", "scroll", "scope", "summary", "regions", "forms", "information", "capabilities", "suggestedActions", "drilldowns"],
      ),
      "tool://page.snapshot/output",
      "page.snapshot output",
    ),
  },

  "page.extract": {
    name: "page.extract",
    description: "Extract scoped content from the current page using information blocks instead of raw DOM scripts.",
    risk: "medium",
    tags: ["page", "extract", "semantic", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          blockId: stringSchema("Optional information block id."),
          regionId: stringSchema("Optional semantic region id."),
          formId: stringSchema("Optional semantic form id."),
          mode: enumStringSchema(["auto", "records", "text", "images"], "Extraction mode."),
          sourceRole: enumStringSchema(["auto", "table", "list", "panel", "main", "form"], "Preferred structured source role."),
          maxItems: integerSchema("Maximum number of records or images to return."),
          recordSchema: objectSchema({}, [], "Optional JSON Schema-like object used to validate each extracted record.", true),
        },
        ["page"],
      ),
      "tool://page.extract/input",
      "page.extract input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          snapshotId: stringSchema("Semantic snapshot identifier used during extraction."),
          source: objectSchema(
            {
              blockId: stringSchema("Information block id when provided."),
              regionId: stringSchema("Semantic region id when provided or inferred."),
              formId: stringSchema("Semantic form id when provided or inferred."),
              type: stringSchema("Inferred source type."),
              mode: enumStringSchema(["records", "text", "images"], "Applied extraction mode."),
            },
            ["mode"],
          ),
          text: stringSchema("Extracted text content."),
          images: arraySchema(
            objectSchema(
              {
                src: stringSchema("Image source URL."),
                alt: stringSchema("Image alt text."),
                title: stringSchema("Image title text."),
              },
              ["src"],
            ),
            "Extracted images.",
          ),
          recordCount: integerSchema("Number of extracted records."),
          records: arraySchema(objectSchema({}, [], "Extracted record.", true), "Extracted records."),
          schemaValid: booleanSchema("Whether all records satisfied the provided schema."),
          validationErrors: arraySchema(stringSchema("Validation error."), "Validation errors."),
        },
        ["page", "snapshotId", "source"],
      ),
      "tool://page.extract/output",
      "page.extract output",
    ),
  },

  "page.interact": {
    name: "page.interact",
    description: "Interact with a scoped capability block and optionally wait for the page outcome, without exposing low-level target resolution details.",
    risk: "high",
    tags: ["page", "interact", "semantic", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          capabilityId: stringSchema("Capability id returned by page.snapshot."),
          handleId: stringSchema("Optional handle id returned by page.snapshot."),
          action: objectSchema(
            {
              type: enumStringSchema(["click", "type", "select", "drag", "submit_form", "press", "scroll"], "Interaction type."),
              text: stringSchema("Text to type."),
              value: stringSchema("Value to select."),
              key: stringSchema("Key value for press actions."),
              code: stringSchema("Optional keyboard event code."),
              ctrlKey: booleanSchema("Whether Ctrl is pressed.", false),
              altKey: booleanSchema("Whether Alt is pressed.", false),
              metaKey: booleanSchema("Whether Meta is pressed.", false),
              shiftKey: booleanSchema("Whether Shift is pressed.", false),
              direction: enumStringSchema(["up", "down"], "Scroll direction."),
              amount: numberSchema("Scroll amount in CSS pixels."),
              force: booleanSchema("Bypass target safety checks.", false),
              destinationHandleId: stringSchema("Destination handle id for drag."),
              destinationCapabilityId: stringSchema("Destination capability id for drag."),
            },
            [],
          ),
          wait: objectSchema(
            {
              subscriptionId: stringSchema("Optional subscription id used for response_ok wait signals."),
              timeoutMs: integerSchema("Maximum wait time in ms."),
              expectationMode: enumStringSchema(["all", "any"], "How multiple expectations should be matched."),
              successSignals: arraySchema(WAIT_SUCCESS_SIGNAL_SCHEMA, "Legacy success signals."),
              expectations: arraySchema(WAIT_EXPECTATION_SCHEMA, "Declarative wait expectations."),
            },
            [],
          ),
          dryRun: booleanSchema("Validate without actually performing the interaction.", false),
        },
        ["page"],
      ),
      "tool://page.interact/input",
      "page.interact input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          result: { $ref: "#/$defs/StepResult" },
          summary: stringSchema("Short post-action page summary."),
          information: arraySchema({ $ref: "#/$defs/PageInformationBlock" }, "Post-action information blocks."),
          capabilities: arraySchema({ $ref: "#/$defs/PageCapability" }, "Post-action capability blocks."),
        },
        ["result"],
      ),
      "tool://page.interact/output",
      "page.interact output",
    ),
  },

  "context.attach": {
    name: "context.attach",
    description: "Attach an agent-facing page context by attaching to an existing tab or opening and navigating a URL. Returns a page ref with explicit document and lease binding.",
    risk: "medium",
    tags: ["context", "session", "page", "agent"],
    inputSchema: withDraft202012(
      {
        type: "object",
        properties: {
          tabId: stringSchema("Existing tab id to attach to."),
          url: stringSchema("Optional URL to open or navigate to as part of the attach."),
          windowId: stringSchema("Optional preferred window id."),
          workspaceId: stringSchema("Optional preferred workspace id."),
          userId: stringSchema("Optional logical user identifier."),
          observeOnly: booleanSchema("Whether the attached page is observation-only.", false),
          createIfMissing: booleanSchema("Create a tab when none matches the filters.", true),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Optional lifecycle wait condition when navigating."),
          timeoutMs: integerSchema("Optional navigation timeout in milliseconds."),
        },
        anyOf: [{ required: ["tabId"] }, { required: ["url"] }],
        additionalProperties: false,
      },
      "tool://context.attach/input",
      "context.attach input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          attachedAt: numberSchema("Attachment timestamp in ms."),
          windowId: stringSchema("Resolved window id."),
          tabId: stringSchema("Resolved tab id."),
          url: stringSchema("Current page URL after attach."),
          title: stringSchema("Current page title after attach."),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Applied wait condition."),
          matched: booleanSchema("Whether requested wait condition was observed."),
          timedOut: booleanSchema("Whether waiting timed out."),
          matchedEvent: stringSchema("Lifecycle event that satisfied wait condition."),
          createdTab: booleanSchema("Whether a new tab was created."),
        },
        ["page", "attachedAt", "windowId", "tabId", "url", "title", "waitUntil", "matched", "timedOut", "createdTab"],
      ),
      "tool://context.attach/output",
      "context.attach output",
    ),
  },

  "context.get": {
    name: "context.get",
    description: "Refresh and return the current agent-facing page context, including the latest document binding.",
    risk: "low",
    tags: ["context", "page", "agent"],
    inputSchema: withDraft202012(
      objectSchema({ page: { $ref: "#/$defs/PageRef" } }, ["page"]),
      "tool://context.get/input",
      "context.get input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          url: stringSchema("Current page URL."),
          title: stringSchema("Page title."),
          viewport: { $ref: "#/$defs/Viewport" },
          scroll: objectSchema({ x: numberSchema("Scroll X."), y: numberSchema("Scroll Y.") }, ["x", "y"]),
          frameTree: arraySchema({ $ref: "#/$defs/FrameTreeNode" }, "Frame tree nodes."),
        },
        ["page", "url", "title", "viewport", "scroll", "frameTree"],
      ),
      "tool://context.get/output",
      "context.get output",
    ),
  },

  "context.describe": {
    name: "context.describe",
    description: "Describe the current page as layered actionable reality for an agent: salient regions, forms, actionable targets, and suggested drill-downs. Prioritizes an optional task hint instead of exposing raw DOM or HTML.",
    risk: "low",
    tags: ["context", "describe", "semantic", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          task: stringSchema("Optional natural-language task or goal used to prioritize relevant regions and actions."),
          regionId: stringSchema("Optional semantic region id used to scope the description."),
          formId: stringSchema("Optional semantic form id used to scope the description."),
          maxRegions: integerSchema("Maximum number of salient regions to return."),
          maxForms: integerSchema("Maximum number of forms to return."),
          maxInformation: integerSchema("Maximum number of information blocks to return."),
          maxCapabilities: integerSchema("Maximum number of capability blocks to return."),
          maxActions: integerSchema("Maximum number of actionable targets to return."),
        },
        ["page"],
      ),
      "tool://context.describe/input",
      "context.describe input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          snapshotId: stringSchema("Semantic snapshot identifier used during description."),
          scope: { $ref: "#/$defs/ContextScope" },
          summary: stringSchema("Short summary of the current actionable scene."),
          regions: arraySchema({ $ref: "#/$defs/ContextRegion" }, "Salient semantic regions."),
          forms: arraySchema({ $ref: "#/$defs/ContextForm" }, "Salient forms."),
          information: arraySchema({ $ref: "#/$defs/PageInformationBlock" }, "Salient information blocks."),
          capabilities: arraySchema({ $ref: "#/$defs/PageCapability" }, "Salient capability blocks."),
          actions: arraySchema({ $ref: "#/$defs/ContextAction" }, "Immediate actionable targets."),
          suggestedActions: arraySchema({ $ref: "#/$defs/SuggestedAction" }, "High-level next actions suggested by the current scene."),
          drilldowns: arraySchema({ $ref: "#/$defs/ContextDrilldown" }, "Suggested follow-up drill-downs."),
        },
        ["page", "snapshotId", "scope", "summary", "regions", "forms", "information", "capabilities", "actions", "suggestedActions", "drilldowns"],
      ),
      "tool://context.describe/output",
      "context.describe output",
    ),
  },

  "context.subscribe": {
    name: "context.subscribe",
    description: "Create an agent-facing observation subscription for browser events. The current transport is pull-based, returns a subscription cursor, and may replay a short recent event window to reduce subscribe-after-action races.",
    risk: "low",
    tags: ["context", "subscription", "observe", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          channels: arraySchema(
            enumStringSchema([...OBSERVATION_CHANNEL_VALUES], "Observation channel."),
            "Observation channels.",
          ),
          sampleMouseMove: booleanSchema("Whether to include sampled mouse movement.", false),
          redactTextInput: booleanSchema("Whether to redact typed text.", true),
        },
        ["page", "channels"],
      ),
      "tool://context.subscribe/input",
      "context.subscribe input",
    ),
    outputSchema: withDraft202012(
      objectSchema({ subscription: { $ref: "#/$defs/SubscriptionState" } }, ["subscription"]),
      "tool://context.subscribe/output",
      "context.subscribe output",
    ),
  },

  "context.read": {
    name: "context.read",
    description: "Read events from an existing observation subscription using a structured cursor.",
    risk: "low",
    tags: ["context", "subscription", "events", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          cursor: { $ref: "#/$defs/EventCursor" },
          limit: integerSchema("Maximum number of events to return."),
        },
        ["subscriptionId"],
      ),
      "tool://context.read/input",
      "context.read input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          events: arraySchema({ $ref: "#/$defs/RawBrowserEvent" }, "Captured raw browser events."),
          nextCursor: { $ref: "#/$defs/EventCursor" },
          dropped: booleanSchema("Whether any events were dropped before or during this read."),
        },
        ["subscriptionId", "events", "dropped"],
      ),
      "tool://context.read/output",
      "context.read output",
    ),
  },

  "context.unsubscribe": {
    name: "context.unsubscribe",
    description: "Stop an existing agent-facing observation subscription.",
    risk: "low",
    tags: ["context", "subscription", "observe", "agent"],
    inputSchema: withDraft202012(
      objectSchema({ subscriptionId: stringSchema("Subscription identifier.") }, ["subscriptionId"]),
      "tool://context.unsubscribe/input",
      "context.unsubscribe input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          subscriptionId: stringSchema("Subscription identifier."),
          stoppedAt: numberSchema("Stop timestamp in ms."),
          eventCount: integerSchema("Total number of retained events."),
        },
        ["subscriptionId", "stoppedAt", "eventCount"],
      ),
      "tool://context.unsubscribe/output",
      "context.unsubscribe output",
    ),
  },

  "locate.find": {
    name: "locate.find",
    description: "Locate semantic elements, forms, or regions and return stable agent-facing handles that can be reused across steps.",
    risk: "low",
    tags: ["locate", "semantic", "handle", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          kind: enumStringSchema([...HANDLE_KIND_VALUES], "Resource kind to locate."),
          role: stringSchema("Semantic role filter."),
          name: stringSchema("Accessible or semantic name filter."),
          text: stringSchema("Visible text filter."),
          label: stringSchema("Associated label text filter."),
          selector: stringSchema("Optional selector hint used to constrain matching."),
          regionId: stringSchema("Optional semantic region id used to scope matching."),
          formId: stringSchema("Optional semantic form id used to scope matching."),
          includeHidden: booleanSchema("Whether hidden candidates should be returned.", false),
          limit: integerSchema("Maximum number of handles to return."),
        },
        ["page"],
      ),
      "tool://locate.find/input",
      "locate.find input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          snapshotId: stringSchema("Semantic snapshot identifier used during location."),
          handles: arraySchema({ $ref: "#/$defs/LiveHandle" }, "Resolved handles."),
          truncated: booleanSchema("Whether additional matches were omitted because of the limit."),
        },
        ["page", "snapshotId", "handles", "truncated"],
      ),
      "tool://locate.find/output",
      "locate.find output",
    ),
  },

  "extract.records": {
    name: "extract.records",
    description: "Extract repeated structured records from the current page, a semantic region, a semantic form, or a previously located handle.",
    risk: "medium",
    tags: ["extract", "records", "semantic", "agent"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          handleId: stringSchema("Optional handle id returned by locate.find."),
          regionId: stringSchema("Optional semantic region id."),
          formId: stringSchema("Optional semantic form id."),
          sourceRole: enumStringSchema(["auto", "table", "list", "panel", "main", "form"], "Preferred semantic source role."),
          minRecords: integerSchema("Minimum expected record count."),
          maxRecords: integerSchema("Maximum number of records to extract."),
          recordSchema: objectSchema({}, [], "Optional JSON Schema-like object used to validate each extracted record.", true),
        },
        ["page"],
      ),
      "tool://extract.records/input",
      "extract.records input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          snapshotId: stringSchema("Semantic snapshot identifier used during extraction."),
          sourceRegionId: stringSchema("Source semantic region id when available."),
          sourceRole: stringSchema("Resolved semantic source role."),
          recordCount: integerSchema("Number of extracted records."),
          records: arraySchema(objectSchema({}, [], "Extracted record.", true), "Extracted records."),
          schemaValid: booleanSchema("Whether all records satisfied the provided schema."),
          validationErrors: arraySchema(stringSchema("Validation error."), "Validation errors."),
        },
        ["page", "snapshotId", "recordCount", "records"],
      ),
      "tool://extract.records/output",
      "extract.records output",
    ),
  },

  "act.step": {
    name: "act.step",
    description: "Execute a single agent-facing interaction step by combining target resolution, action execution, and optional declarative waiting into one tool call, while tracking observable page changes including meaningful stateful visual changes.",
    risk: "high",
    tags: ["act", "step", "agent", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          page: { $ref: "#/$defs/PageRef" },
          target: objectSchema(
            {
              handleId: stringSchema("Stable handle id returned by locate.find."),
              elementId: stringSchema("Semantic element id fallback."),
              formId: stringSchema("Semantic form id fallback."),
              regionId: stringSchema("Semantic region id fallback."),
              selector: stringSchema("Direct selector fallback."),
              description: stringSchema("Optional human-readable fallback hint."),
            },
            [],
          ),
          action: {
            oneOf: [
              objectSchema(
                {
                  type: enumStringSchema(["navigate"]),
                  url: stringSchema("Target URL."),
                  waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Lifecycle wait condition."),
                },
                ["type", "url"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["click"]),
                  force: booleanSchema("Bypass click-target safety checks.", false),
                },
                ["type"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["hover"]),
                  force: booleanSchema("Bypass hover-target safety checks.", false),
                },
                ["type"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["type"]),
                  text: stringSchema("Text to type."),
                  force: booleanSchema("Bypass target safety checks.", false),
                },
                ["type", "text"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["select"]),
                  value: stringSchema("Value to select."),
                  force: booleanSchema("Bypass target safety checks.", false),
                },
                ["type", "value"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["scroll"]),
                  direction: enumStringSchema(["up", "down"], "Scroll direction."),
                  amount: numberSchema("Optional scroll amount in CSS pixels."),
                },
                ["type", "direction"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["press"]),
                  key: stringSchema("Key value, for example Enter, Escape, ArrowDown, a, or /."),
                  code: stringSchema("Optional keyboard event code, for example Enter or KeyK."),
                  ctrlKey: booleanSchema("Whether Ctrl is pressed.", false),
                  altKey: booleanSchema("Whether Alt is pressed.", false),
                  metaKey: booleanSchema("Whether Meta is pressed.", false),
                  shiftKey: booleanSchema("Whether Shift is pressed.", false),
                },
                ["type", "key"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["drag"]),
                  destination: objectSchema(
                    {
                      handleId: stringSchema("Stable handle id returned by locate.find."),
                      elementId: stringSchema("Semantic element id fallback."),
                      selector: stringSchema("Direct selector fallback."),
                      description: stringSchema("Optional human-readable fallback hint."),
                    },
                    [],
                  ),
                  force: booleanSchema("Bypass drag-target safety checks.", false),
                },
                ["type", "destination"],
              ),
              objectSchema(
                {
                  type: enumStringSchema(["submit_form"]),
                  force: booleanSchema("Bypass submit-target safety checks.", false),
                },
                ["type"],
              ),
            ],
          },
          wait: objectSchema(
            {
              subscriptionId: stringSchema("Optional subscription id used for response_ok wait signals."),
              timeoutMs: integerSchema("Maximum wait time in ms."),
              expectationMode: enumStringSchema(["all", "any"], "How multiple expectations should be matched."),
              successSignals: arraySchema(WAIT_SUCCESS_SIGNAL_SCHEMA, "Legacy success signals."),
              expectations: arraySchema(WAIT_EXPECTATION_SCHEMA, "Declarative wait expectations."),
            },
            [],
          ),
          dryRun: booleanSchema("Validate without actually performing the action.", false),
        },
        ["page", "action"],
      ),
      "tool://act.step/input",
      "act.step input",
    ),
    outputSchema: withDraft202012(
      { $ref: "#/$defs/StepResult" },
      "tool://act.step/output",
      "act.step output",
    ),
  },

  "browser.open_url": {
    name: "browser.open_url",
    description: "Open a URL with one call by selecting or creating a tab, attaching a session, and navigating.",
    risk: "medium",
    tags: ["browser", "navigation", "session", "automation"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          url: stringSchema("Target URL."),
          tabId: stringSchema("Optional preferred tab id."),
          windowId: stringSchema("Optional preferred window id."),
          workspaceId: stringSchema("Optional preferred workspace id."),
          userId: stringSchema("Optional logical user identifier."),
          observeOnly: booleanSchema("Whether created session is observation-only.", false),
          createIfMissing: booleanSchema("Create a tab when none matches filters.", true),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Optional lifecycle wait condition."),
          timeoutMs: integerSchema("Optional wait timeout in milliseconds."),
        },
        ["url"],
      ),
      "tool://browser.open_url/input",
      "browser.open_url input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          attachedAt: numberSchema("Attachment timestamp in ms."),
          windowId: stringSchema("Resolved window id."),
          tabId: stringSchema("Resolved tab id."),
          url: stringSchema("Current page URL after navigation."),
          title: stringSchema("Current page title after navigation."),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Applied wait condition."),
          matched: booleanSchema("Whether requested wait condition was observed."),
          timedOut: booleanSchema("Whether waiting timed out."),
          matchedEvent: stringSchema("Lifecycle event that satisfied wait condition."),
          createdTab: booleanSchema("Whether a new tab was created."),
        },
        ["session", "attachedAt", "windowId", "tabId", "url", "title", "waitUntil", "matched", "timedOut", "createdTab"],
      ),
      "tool://browser.open_url/output",
      "browser.open_url output",
    ),
  },

  "browser.attach_session": {
    name: "browser.attach_session",
    description: "Attach to a browser tab and create an observation/execution session.",
    risk: "low",
    tags: ["browser", "session"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          tabId: stringSchema("Target tab identifier."),
          userId: stringSchema("Optional logical user identifier."),
          observeOnly: booleanSchema("Whether the session is observation-only.", false),
        },
        ["tabId"],
      ),
      "tool://browser.attach_session/input",
      "browser.attach_session input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          url: stringSchema("Current URL."),
          title: stringSchema("Page title."),
          attachedAt: numberSchema("Attachment timestamp in ms."),
        },
        ["session", "url", "attachedAt"],
      ),
      "tool://browser.attach_session/output",
      "browser.attach_session output",
    ),
  },

  "browser.get_page_context": {
    name: "browser.get_page_context",
    description: "Get current URL, title, viewport, scroll position, and frame tree.",
    risk: "low",
    tags: ["browser", "context", "page"],
    inputSchema: withDraft202012(
      objectSchema({ session: { $ref: "#/$defs/BrowserSessionRef" } }, ["session"]),
      "tool://browser.get_page_context/input",
      "browser.get_page_context input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          url: stringSchema("Current page URL."),
          title: stringSchema("Page title."),
          viewport: { $ref: "#/$defs/Viewport" },
          scroll: objectSchema({ x: numberSchema("Scroll X."), y: numberSchema("Scroll Y.") }, ["x", "y"]),
          frameTree: arraySchema({ $ref: "#/$defs/FrameTreeNode" }, "Frame tree nodes."),
        },
        ["url", "viewport", "scroll"],
      ),
      "tool://browser.get_page_context/output",
      "browser.get_page_context output",
    ),
  },

  "browser.extract_data": {
    name: "browser.extract_data",
    description: "Execute a JavaScript function body against the current page DOM, or use semantic region/list/table extraction to pull structured repeated records with schema validation. Script mode expects a function body script, not an IIFE, not a full function definition, and not a bare expression. You MUST explicitly return exactly one JSON-serializable value containing only the extracted data; do not omit return, do not return undefined, and do not wrap the result as { url, title, data } because the tool fills URL/title itself.",
    risk: "medium",
    tags: ["browser", "dom", "extraction"],
    inputSchema: withDraft202012(
      {
        type: "object",
        oneOf: [
          objectSchema(
            {
              session: { $ref: "#/$defs/BrowserSessionRef" },
              script: {
                type: "string",
                minLength: 1,
                description: "JavaScript source inserted as the body of an internal async function on the current page. Pass only the function body script. DO NOT pass an IIFE, an arrow function, a full function definition, or a bare expression. You MUST explicitly return a JSON-serializable value. Missing return is an error. Returning undefined, DOM nodes, functions, BigInt, cyclic objects, or any other non-serializable value is invalid. Return only the extracted data, and do not wrap it with url/title/data.",
              },
            },
            ["session", "script"],
          ),
          objectSchema(
            {
              session: { $ref: "#/$defs/BrowserSessionRef" },
              snapshotId: stringSchema("Optional semantic snapshot id used to scope regions/forms."),
              extraction: objectSchema(
                {
                  type: enumStringSchema(["records"], "Structured extraction mode."),
                  regionId: stringSchema("Optional semantic region id to scope extraction."),
                  formId: stringSchema("Optional semantic form id to scope extraction."),
                  sourceRole: enumStringSchema(["auto", "table", "list", "panel", "main", "form"], "Preferred semantic source role."),
                  minRecords: integerSchema("Minimum expected record count."),
                  maxRecords: integerSchema("Maximum number of records to extract."),
                  recordSchema: objectSchema({}, [], "Optional JSON Schema-like object used to validate each extracted record.", true),
                },
                ["type"],
              ),
            },
            ["session", "extraction"],
          ),
        ],
      },
      "tool://browser.extract_data/input",
      "browser.extract_data input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          url: stringSchema("Current page URL."),
          title: stringSchema("Current page title."),
          data: jsonValueSchema("Extracted JSON value returned by the script. If script execution or serialization fails, this field contains a structured error object while preserving the same outer envelope."),
        },
        ["url", "title", "data"],
      ),
      "tool://browser.extract_data/output",
      "browser.extract_data output",
    ),
  },

  "browser.navigate": {
    name: "browser.navigate",
    description: "Navigate the attached tab to a URL and optionally wait for lifecycle readiness.",
    risk: "medium",
    tags: ["browser", "navigation", "automation"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          url: stringSchema("Target URL."),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Optional lifecycle wait condition."),
          timeoutMs: integerSchema("Optional wait timeout in milliseconds."),
        },
        ["session", "url"],
      ),
      "tool://browser.navigate/input",
      "browser.navigate input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          url: stringSchema("Current page URL after navigation."),
          title: stringSchema("Current page title after navigation."),
          waitUntil: enumStringSchema(["none", "domcontentloaded", "load", "network_idle"], "Applied wait condition."),
          matched: booleanSchema("Whether requested wait condition was observed."),
          timedOut: booleanSchema("Whether waiting timed out."),
          matchedEvent: stringSchema("Lifecycle event that satisfied wait condition."),
        },
        ["url", "title", "waitUntil", "matched", "timedOut"],
      ),
      "tool://browser.navigate/output",
      "browser.navigate output",
    ),
  },

  "browser.send_cdp_command": {
    name: "browser.send_cdp_command",
    description: "Send a raw CDP command on the attached session for advanced automation use-cases.",
    risk: "high",
    tags: ["browser", "cdp", "automation"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          method: stringSchema("CDP method name, e.g. Runtime.evaluate."),
          params: objectSchema({}, [], "CDP command params.", true),
        },
        ["session", "method"],
      ),
      "tool://browser.send_cdp_command/input",
      "browser.send_cdp_command input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          result: objectSchema({}, [], "Raw CDP response payload.", true),
        },
        ["result"],
      ),
      "tool://browser.send_cdp_command/output",
      "browser.send_cdp_command output",
    ),
  },

  "browser.detach_session": {
    name: "browser.detach_session",
    description: "Detach and release a browser session.",
    risk: "low",
    tags: ["browser", "session"],
    inputSchema: withDraft202012(
      objectSchema({ session: { $ref: "#/$defs/BrowserSessionRef" } }, ["session"]),
      "tool://browser.detach_session/input",
      "browser.detach_session input",
    ),
    outputSchema: withDraft202012(
      objectSchema({ success: booleanSchema("Whether detach succeeded.") }, ["success"]),
      "tool://browser.detach_session/output",
      "browser.detach_session output",
    ),
  },

  "observe.start_event_capture": {
    name: "observe.start_event_capture",
    description: "Start streaming low-level browser observation events.",
    risk: "low",
    tags: ["observe", "capture", "events"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          channels: arraySchema(enumStringSchema(["input", "navigation", "dom", "network", "runtime", "focus", "selection"]), "Observation channels."),
          sampleMouseMove: booleanSchema("Whether to include sampled mouse movement.", false),
          redactTextInput: booleanSchema("Whether to redact typed text.", true),
        },
        ["session", "channels"],
      ),
      "tool://observe.start_event_capture/input",
      "observe.start_event_capture input",
    ),
    outputSchema: withDraft202012(
      objectSchema({ captureId: stringSchema("Capture identifier."), startedAt: numberSchema("Capture start timestamp in ms.") }, ["captureId", "startedAt"]),
      "tool://observe.start_event_capture/output",
      "observe.start_event_capture output",
    ),
  },

  "observe.stop_event_capture": {
    name: "observe.stop_event_capture",
    description: "Stop an event capture stream.",
    risk: "low",
    tags: ["observe", "capture", "events"],
    inputSchema: withDraft202012(
      objectSchema({ captureId: stringSchema("Capture identifier.") }, ["captureId"]),
      "tool://observe.stop_event_capture/input",
      "observe.stop_event_capture input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          captureId: stringSchema("Capture identifier."),
          stoppedAt: numberSchema("Stop timestamp in ms."),
          eventCount: integerSchema("Total number of captured events."),
        },
        ["captureId", "stoppedAt", "eventCount"],
      ),
      "tool://observe.stop_event_capture/output",
      "observe.stop_event_capture output",
    ),
  },

  "observe.read_events": {
    name: "observe.read_events",
    description: "Read captured low-level browser events.",
    risk: "low",
    tags: ["observe", "events", "stream"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          captureId: stringSchema("Capture identifier."),
          afterTs: numberSchema("Only return events after this timestamp in ms."),
          afterCursor: stringSchema("Opaque cursor from previous read_events response."),
          limit: integerSchema("Maximum number of events to return."),
        },
        ["captureId"],
      ),
      "tool://observe.read_events/input",
      "observe.read_events input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          events: arraySchema({ $ref: "#/$defs/RawBrowserEvent" }, "Captured raw browser events."),
          nextCursor: stringSchema("Opaque cursor for pagination or continuation."),
        },
        ["events"],
      ),
      "tool://observe.read_events/output",
      "observe.read_events output",
    ),
  },

  "semantic.capture_page_snapshot": {
    name: "semantic.capture_page_snapshot",
    description: "Capture a semantic-ready snapshot using DOM, layout, and AX sources.",
    risk: "low",
    tags: ["semantic", "snapshot", "page"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          includeStyles: constBooleanSchema(
            false,
            "Style-derived data is not supported by the current snapshot extractor and must remain false.",
          ),
          includeDOM: constBooleanSchema(
            true,
            "The current snapshot extractor requires DOM data and this flag must remain true.",
          ),
          includeLayout: constBooleanSchema(
            true,
            "The current snapshot extractor requires layout data and this flag must remain true.",
          ),
          includeAX: constBooleanSchema(
            true,
            "The current snapshot extractor requires accessibility data and this flag must remain true.",
          ),
        },
        ["session"],
      ),
      "tool://semantic.capture_page_snapshot/input",
      "semantic.capture_page_snapshot input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          snapshotId: stringSchema("Snapshot identifier."),
          capturedAt: numberSchema("Capture timestamp in ms."),
          url: stringSchema("Snapshot page URL."),
          regions: arraySchema({ $ref: "#/$defs/PageRegion" }, "Semantic regions extracted from the page."),
          forms: arraySchema({ $ref: "#/$defs/PageForm" }, "Semantic forms extracted from the page."),
          elements: arraySchema({ $ref: "#/$defs/SemanticElement" }, "Semantic elements extracted from the page."),
          information: arraySchema({ $ref: "#/$defs/PageInformationBlock" }, "Information blocks inferred from the page."),
          capabilities: arraySchema({ $ref: "#/$defs/PageCapability" }, "Capability blocks inferred from the page."),
        },
        ["snapshotId", "capturedAt", "url", "regions", "forms", "elements", "information", "capabilities"],
      ),
      "tool://semantic.capture_page_snapshot/output",
      "semantic.capture_page_snapshot output",
    ),
  },

  "semantic.resolve_event_targets": {
    name: "semantic.resolve_event_targets",
    description: "Resolve raw events to semantic elements and regions.",
    risk: "low",
    tags: ["semantic", "events", "resolution"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          snapshotId: stringSchema("Snapshot identifier."),
          events: arraySchema({ $ref: "#/$defs/RawBrowserEvent" }, "Raw browser events."),
        },
        ["snapshotId", "events"],
      ),
      "tool://semantic.resolve_event_targets/input",
      "semantic.resolve_event_targets input",
    ),
    outputSchema: withDraft202012(
      objectSchema({ events: arraySchema({ $ref: "#/$defs/ResolvedEvent" }, "Resolved events.") }, ["events"]),
      "tool://semantic.resolve_event_targets/output",
      "semantic.resolve_event_targets output",
    ),
  },

  "execute.perform_action": {
    name: "execute.perform_action",
    description: "Perform a browser action against a semantic target. Click-like targets are rebound against the current DOM before execution using locator hints, region context, and labels, and the result distinguishes acceptance from actual effect.",
    risk: "high",
    tags: ["execute", "action", "browser"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          action: {
            oneOf: [
              objectSchema({ type: enumStringSchema(["click"]), elementId: stringSchema("Target element id."), force: booleanSchema("Bypass click-target safety checks.", false) }, ["type", "elementId"]),
              objectSchema({ type: enumStringSchema(["click"]), selector: stringSchema("Target CSS selector."), force: booleanSchema("Bypass click-target safety checks.", false) }, ["type", "selector"]),
              objectSchema({ type: enumStringSchema(["type"]), elementId: stringSchema("Target element id."), text: stringSchema("Text to type."), force: booleanSchema("Bypass target safety checks.", false) }, ["type", "elementId", "text"]),
              objectSchema({ type: enumStringSchema(["type"]), selector: stringSchema("Target CSS selector."), text: stringSchema("Text to type."), force: booleanSchema("Bypass target safety checks.", false) }, ["type", "selector", "text"]),
              objectSchema({ type: enumStringSchema(["select"]), elementId: stringSchema("Target element id."), value: stringSchema("Value to select."), force: booleanSchema("Bypass target safety checks.", false) }, ["type", "elementId", "value"]),
              objectSchema({ type: enumStringSchema(["select"]), selector: stringSchema("Target CSS selector."), value: stringSchema("Value to select."), force: booleanSchema("Bypass target safety checks.", false) }, ["type", "selector", "value"]),
              objectSchema({ type: enumStringSchema(["scroll"]), direction: enumStringSchema(["up", "down"], "Scroll direction."), amount: numberSchema("Optional scroll amount in CSS pixels.") }, ["type", "direction"]),
            ],
          },
          dryRun: booleanSchema("Validate without actually performing the action.", false),
        },
        ["session", "action"],
      ),
      "tool://execute.perform_action/input",
      "execute.perform_action input",
    ),
    outputSchema: withDraft202012(
      { $ref: "#/$defs/ActionExecutionResult" },
      "tool://execute.perform_action/output",
      "execute.perform_action output",
    ),
  },

  "execute.submit_form": {
    name: "execute.submit_form",
    description: "Rebind a semantic form against the live DOM, choose a submit action candidate, and submit it while reporting both acceptance and observed effect.",
    risk: "high",
    tags: ["execute", "form", "submit"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          formId: stringSchema("Semantic form identifier."),
          submitterElementId: stringSchema("Optional submit action element identifier to prefer."),
          force: booleanSchema("Bypass submit-target safety checks.", false),
          dryRun: booleanSchema("Validate without actually performing the submit.", false),
        },
        ["session", "formId"],
      ),
      "tool://execute.submit_form/input",
      "execute.submit_form input",
    ),
    outputSchema: withDraft202012(
      { $ref: "#/$defs/ActionExecutionResult" },
      "tool://execute.submit_form/output",
      "execute.submit_form output",
    ),
  },

  "execute.observe_outcome": {
    name: "execute.observe_outcome",
    description: "Observe the event stream after an action and determine the outcome. Supports legacy success signals and declarative expectations such as URL change, visible result regions, repeated-record extraction, and record-schema validation. response_ok success signals require a network event capture that started before the action; pass captureId to pin the exact capture.",
    risk: "medium",
    tags: ["execute", "outcome", "events"],
    inputSchema: withDraft202012(
      objectSchema(
        {
          session: { $ref: "#/$defs/BrowserSessionRef" },
          actionId: stringSchema("Action identifier."),
          captureId: stringSchema("Optional event capture id to use for response_ok success signals. It must refer to a capture on the same session with channels including network, and it must have started before the action."),
          successSignals: arraySchema(
            {
              oneOf: [
                objectSchema({ type: enumStringSchema(["url_matches"]), value: stringSchema("URL regex or match string.") }, ["type", "value"]),
                objectSchema({ type: enumStringSchema(["text_visible"]), value: stringSchema("Expected visible text.") }, ["type", "value"]),
                objectSchema({ type: enumStringSchema(["response_ok"]), value: stringSchema("Request URL pattern. Requires a network event capture that started before the action.") }, ["type", "value"]),
                objectSchema({ type: enumStringSchema(["element_visible"]), elementId: stringSchema("Expected visible element id.") }, ["type", "elementId"]),
              ],
            },
            "Outcome success signals.",
          ),
          expectations: arraySchema(
            {
              oneOf: [
                objectSchema({ type: enumStringSchema(["url_changed"]), value: stringSchema("Optional URL regex or match string.") }, ["type"]),
                objectSchema({ type: enumStringSchema(["url_matches"]), value: stringSchema("URL regex or match string.") }, ["type", "value"]),
                objectSchema({ type: enumStringSchema(["text_visible"]), value: stringSchema("Expected visible text.") }, ["type", "value"]),
                objectSchema({ type: enumStringSchema(["element_visible"]), elementId: stringSchema("Expected visible element id.") }, ["type", "elementId"]),
                objectSchema(
                  {
                    type: enumStringSchema(["region_visible"]),
                    regionId: stringSchema("Expected region id."),
                    regionRole: enumStringSchema(["header", "nav", "sidebar", "main", "panel", "list", "table", "form", "dialog", "footer", "unknown"], "Optional expected region role."),
                    text: stringSchema("Optional text expected in the region."),
                  },
                  ["type"],
                ),
                objectSchema(
                  {
                    type: enumStringSchema(["records_visible"]),
                    regionId: stringSchema("Optional region id to scope record extraction."),
                    regionRole: enumStringSchema(["table", "list", "panel", "main", "form"], "Preferred region role."),
                    minRecords: integerSchema("Minimum required record count."),
                    recordSchema: objectSchema({}, [], "Optional JSON Schema-like object used to validate each extracted record.", true),
                  },
                  ["type"],
                ),
              ],
            },
            "Declarative outcome expectations. When provided, observe_outcome only returns success after the expectations are satisfied.",
          ),
          expectationMode: enumStringSchema(["all", "any"], "How multiple expectations should be matched."),
          timeoutMs: integerSchema("Maximum observation time in ms."),
        },
        ["session", "actionId"],
      ),
      "tool://execute.observe_outcome/input",
      "execute.observe_outcome input",
    ),
    outputSchema: withDraft202012(
      objectSchema(
        {
          status: enumStringSchema(["success", "failure", "timeout", "unknown"], "Observed outcome status."),
          evidence: arraySchema(stringSchema("Evidence string."), "Outcome evidence."),
          matchedExpectations: arraySchema(stringSchema("Matched expectation summary."), "Matched expectations."),
          failedExpectations: arraySchema(stringSchema("Failed expectation summary."), "Failed expectations."),
          postSnapshotId: stringSchema("Latest semantic snapshot captured during observation."),
          snapshotDiff: { $ref: "#/$defs/SnapshotDiff" },
        },
        ["status", "evidence"],
      ),
      "tool://execute.observe_outcome/output",
      "execute.observe_outcome output",
    ),
  },
} satisfies Record<string, ToolDefinition>;

assertToolInputSchemasHaveObjectRoot(ToolSchemas);

export const ToolRegistry = Object.values(ToolSchemas);
export type ToolName = keyof typeof ToolSchemas;

export function getToolSchema(name: ToolName): ToolDefinition {
  return ToolSchemas[name];
}

export function listToolNames(): ToolName[] {
  return Object.keys(ToolSchemas) as ToolName[];
}

export function validateToolExists(name: string): name is ToolName {
  return name in ToolSchemas;
}
