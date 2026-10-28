import {
  VisualWorkflowDefinition,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  NODE_REGISTRY,
} from "./workflow.types.js";

export class WorkflowValidator {
  /**
   * Validate a visual workflow definition
   */
  public static validate(definition: VisualWorkflowDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const nodes = definition.nodes || [];
    const edges = definition.edges || [];

    // 1. Basic node count limit
    if (nodes.length === 0) {
      errors.push({
        message: "Workflow must contain at least one node.",
        code: "EMPTY_GRAPH",
      });
      return { valid: false, errors, warnings };
    }

    if (nodes.length > 50) {
      errors.push({
        message: `Workflow exceeds maximum node limit (50 nodes). Found ${nodes.length}.`,
        code: "MAX_NODES_EXCEEDED",
      });
    }

    // 2. Unique node IDs
    const nodeMap = new Map<string, (typeof nodes)[0]>();
    for (const node of nodes) {
      if (!node.id || typeof node.id !== "string") {
        errors.push({
          message: "All nodes must have a valid non-empty string ID.",
          code: "INVALID_NODE_ID",
        });
        continue;
      }

      if (nodeMap.has(node.id)) {
        errors.push({
          nodeId: node.id,
          message: `Duplicate node ID "${node.id}" detected. Node IDs must be unique.`,
          code: "DUPLICATE_NODE_ID",
        });
      } else {
        nodeMap.set(node.id, node);
      }
    }

    // 3. Node Type Validation & Required Inputs
    for (const node of nodes) {
      const meta = NODE_REGISTRY[node.type];
      if (!meta) {
        errors.push({
          nodeId: node.id,
          message: `Unknown or unsupported node type "${node.type}".`,
          code: "UNSUPPORTED_NODE_TYPE",
        });
        continue;
      }

      const config = node.config || {};

      // Validate required inputs per node type
      if (node.type === "browser.openUrl") {
        if (!config.url || typeof config.url !== "string" || !config.url.trim()) {
          errors.push({
            nodeId: node.id,
            field: "url",
            message: `Node "${node.title || node.id}" requires a valid Target URL.`,
            code: "MISSING_REQUIRED_INPUT",
          });
        }
      } else if (node.type === "browser.click") {
        if (!config.selector || typeof config.selector !== "string" || !config.selector.trim()) {
          errors.push({
            nodeId: node.id,
            field: "selector",
            message: `Node "${node.title || node.id}" requires a target CSS Selector.`,
            code: "MISSING_REQUIRED_INPUT",
          });
        }
      } else if (node.type === "comm.sendWhatsApp" || node.type === "comm.prepareWhatsApp") {
        if (!config.phone || typeof config.phone !== "string" || !config.phone.trim()) {
          errors.push({
            nodeId: node.id,
            field: "phone",
            message: `Node "${node.title || node.id}" requires an international recipient phone number.`,
            code: "MISSING_REQUIRED_INPUT",
          });
        }
      } else if (node.type === "research.search") {
        if (!config.query || typeof config.query !== "string" || !config.query.trim()) {
          warnings.push({
            nodeId: node.id,
            message: `Node "${node.title || node.id}" has an empty default query. It will rely on upstream input mappings.`,
          });
        }
      } else if (node.type === "logic.loop") {
        const maxIter = Number(config.maxIterations || 10);
        if (isNaN(maxIter) || maxIter <= 0 || maxIter > 20) {
          errors.push({
            nodeId: node.id,
            field: "maxIterations",
            message: `Loop iteration bound must be between 1 and 20 iterations. Got ${config.maxIterations}.`,
            code: "INVALID_LOOP_BOUND",
          });
        }
      }
    }

    // 4. Edge Validation
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    const adjacencyList = new Map<string, string[]>();

    for (const nodeId of nodeMap.keys()) {
      inDegree.set(nodeId, 0);
      outDegree.set(nodeId, 0);
      adjacencyList.set(nodeId, []);
    }

    for (const edge of edges) {
      if (!edge.id) {
        errors.push({
          message: "All edges must have a valid ID.",
          code: "INVALID_EDGE_ID",
        });
        continue;
      }

      if (!nodeMap.has(edge.source)) {
        errors.push({
          edgeId: edge.id,
          message: `Edge "${edge.id}" references non-existent source node "${edge.source}".`,
          code: "DANGLING_EDGE_SOURCE",
        });
        continue;
      }

      if (!nodeMap.has(edge.target)) {
        errors.push({
          edgeId: edge.id,
          message: `Edge "${edge.id}" references non-existent target node "${edge.target}".`,
          code: "DANGLING_EDGE_TARGET",
        });
        continue;
      }

      if (edge.source === edge.target) {
        // Self-loop is only allowed for explicit logic.loop
        const sourceNode = nodeMap.get(edge.source);
        if (sourceNode?.type !== "logic.loop") {
          errors.push({
            edgeId: edge.id,
            nodeId: edge.source,
            message: `Direct self-loop detected on node "${edge.source}". Loops must use Bounded Loop nodes.`,
            code: "INVALID_SELF_LOOP",
          });
        }
      }

      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
      adjacencyList.get(edge.source)!.push(edge.target);
    }

    // 5. Entry Point Check
    const triggerNodes = nodes.filter(
      (n) => n.type.startsWith("trigger.") || inDegree.get(n.id) === 0
    );

    if (triggerNodes.length === 0) {
      errors.push({
        message: "Workflow must have at least one entry point (e.g. Manual Trigger).",
        code: "NO_ENTRY_POINT",
      });
    }

    // 6. Terminal Node Check
    const terminalNodes = nodes.filter(
      (n) => n.type.startsWith("output.") || outDegree.get(n.id) === 0
    );

    if (terminalNodes.length === 0 && nodes.length > 1) {
      warnings.push({
        message: "No explicit Output or End node found in workflow.",
      });
    }

    // 7. Cycle Detection (Topological Sort / Kahn's Algorithm for non-loop edges)
    // Filter out intentional loop backward edges for cycle checking
    const kahnInDegree = new Map<string, number>();
    for (const [nodeId, deg] of inDegree.entries()) {
      kahnInDegree.set(nodeId, deg);
    }

    const queue: string[] = [];
    for (const [nodeId, deg] of kahnInDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }

    let visitedCount = 0;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      visitedCount++;

      const neighbors = adjacencyList.get(curr) || [];
      for (const neighbor of neighbors) {
        const nextDeg = (kahnInDegree.get(neighbor) || 0) - 1;
        kahnInDegree.set(neighbor, nextDeg);
        if (nextDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If visitedCount < total nodes and there are edges, there's an uncontrolled cycle
    if (visitedCount < nodes.length && edges.length >= nodes.length) {
      // Check if nodes in cycle are purely within bounded loop
      const hasBoundedLoop = nodes.some((n) => n.type === "logic.loop");
      if (!hasBoundedLoop) {
        errors.push({
          message: "Unbounded cycle detected in workflow graph. Workflow graphs must be acyclic (DAG).",
          code: "CYCLE_DETECTED",
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
