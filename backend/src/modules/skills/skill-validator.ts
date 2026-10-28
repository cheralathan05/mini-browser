import { ToolRegistry } from "./tool-registry.js";
import { SkillDefinition, ValidationResult } from "./skills.types.js";

export class SkillValidator {
  public static validate(definition: Partial<SkillDefinition> & { name?: string; description?: string }): ValidationResult {
    const errors: Array<{ field?: string; message: string; code: string }> = [];
    const warnings: Array<{ field?: string; message: string }> = [];

    // 1. Basic Metadata
    if (!definition.name || definition.name.trim().length === 0) {
      errors.push({ field: "name", message: "Skill name is required.", code: "REQUIRED_NAME" });
    }
    if (!definition.description || definition.description.trim().length === 0) {
      errors.push({ field: "description", message: "Skill description is required.", code: "REQUIRED_DESCRIPTION" });
    }

    // 2. Tools Registry Enforcement
    const tools = definition.tools || [];
    if (!Array.isArray(tools) || tools.length === 0) {
      errors.push({ field: "tools", message: "Skill must declare at least one registered capability tool.", code: "NO_TOOLS" });
    } else {
      for (const toolId of tools) {
        if (!ToolRegistry.has(toolId)) {
          errors.push({
            field: "tools",
            message: `Tool "${toolId}" is not registered in the Central Tool Registry.`,
            code: "UNKNOWN_TOOL",
          });
        }
      }
    }

    // 3. Input Schema Validation
    const inputSchema = definition.inputSchema || [];
    if (!Array.isArray(inputSchema)) {
      errors.push({ field: "inputSchema", message: "inputSchema must be an array of field definitions.", code: "INVALID_INPUT_SCHEMA" });
    } else {
      const seenNames = new Set<string>();
      const validTypes = ["string", "number", "boolean", "object", "array"];

      for (let i = 0; i < inputSchema.length; i++) {
        const field = inputSchema[i];
        if (!field.name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field.name)) {
          errors.push({
            field: `inputSchema[${i}].name`,
            message: `Field #${i + 1} has an invalid identifier name "${field.name || ""}".`,
            code: "INVALID_FIELD_NAME",
          });
        } else if (seenNames.has(field.name)) {
          errors.push({
            field: `inputSchema[${i}].name`,
            message: `Duplicate input field name "${field.name}".`,
            code: "DUPLICATE_FIELD_NAME",
          });
        } else {
          seenNames.add(field.name);
        }

        if (!validTypes.includes(field.type)) {
          errors.push({
            field: `inputSchema[${i}].type`,
            message: `Field "${field.name}" has invalid type "${field.type}". Supported: ${validTypes.join(", ")}.`,
            code: "INVALID_FIELD_TYPE",
          });
        }
      }
    }

    // 4. Output Schema Validation
    const outputSchema = definition.outputSchema || [];
    if (!Array.isArray(outputSchema)) {
      errors.push({ field: "outputSchema", message: "outputSchema must be an array of field definitions.", code: "INVALID_OUTPUT_SCHEMA" });
    } else {
      const seenOutputNames = new Set<string>();
      const validTypes = ["string", "number", "boolean", "object", "array"];

      for (let i = 0; i < outputSchema.length; i++) {
        const field = outputSchema[i];
        if (!field.name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field.name)) {
          errors.push({
            field: `outputSchema[${i}].name`,
            message: `Output field #${i + 1} has an invalid identifier name "${field.name || ""}".`,
            code: "INVALID_OUTPUT_FIELD_NAME",
          });
        } else if (seenOutputNames.has(field.name)) {
          errors.push({
            field: `outputSchema[${i}].name`,
            message: `Duplicate output field name "${field.name}".`,
            code: "DUPLICATE_OUTPUT_FIELD_NAME",
          });
        } else {
          seenOutputNames.add(field.name);
        }

        if (!validTypes.includes(field.type)) {
          errors.push({
            field: `outputSchema[${i}].type`,
            message: `Output field "${field.name}" has invalid type "${field.type}". Supported: ${validTypes.join(", ")}.`,
            code: "INVALID_OUTPUT_FIELD_TYPE",
          });
        }
      }
    }

    // 5. Execution Limits & Config
    const config = definition.config;
    if (config) {
      if (typeof config.timeoutSeconds === "number") {
        if (config.timeoutSeconds < 1 || config.timeoutSeconds > 300) {
          errors.push({
            field: "config.timeoutSeconds",
            message: "timeoutSeconds must be between 1 and 300 seconds.",
            code: "INVALID_TIMEOUT",
          });
        }
      }
      if (typeof config.maxRetries === "number") {
        if (config.maxRetries < 0 || config.maxRetries > 5) {
          errors.push({
            field: "config.maxRetries",
            message: "maxRetries must be between 0 and 5.",
            code: "INVALID_RETRIES",
          });
        }
      }
    }

    // 6. Test Cases Validation
    const testCases = definition.testCases || [];
    if (testCases.length === 0) {
      warnings.push({
        field: "testCases",
        message: "Defining at least one automated test case is recommended before production activation.",
      });
    } else {
      const requiredInputs = (definition.inputSchema || []).filter((f) => f.required).map((f) => f.name);
      for (let t = 0; t < testCases.length; t++) {
        const tc = testCases[t];
        if (!tc.name) {
          errors.push({
            field: `testCases[${t}].name`,
            message: `Test case #${t + 1} requires a descriptive name.`,
            code: "REQUIRED_TEST_NAME",
          });
        }
        for (const reqInput of requiredInputs) {
          if (tc.inputs === undefined || tc.inputs[reqInput] === undefined) {
            warnings.push({
              field: `testCases[${t}].inputs`,
              message: `Test case "${tc.name || t + 1}" does not supply required input "${reqInput}".`,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
