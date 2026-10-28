import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export interface ExecutionTestCase {
  id?: string;
  input: string;
  expectedOutput?: string;
}

export interface ExecutionTestResult {
  input: string;
  expectedOutput?: string;
  actualOutput: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface CodeExecutionOptions {
  language: string;
  code: string;
  stdin?: string;
  testCases?: ExecutionTestCase[];
  timeoutMs?: number;
}

export interface CodeExecutionResult {
  success: boolean;
  status: "completed" | "timeout" | "error" | "unsupported_language";
  language: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  testResults: ExecutionTestResult[];
  error?: string;
}

export class CodeExecutionService {
  private static readonly MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB
  private static readonly DEFAULT_TIMEOUT_MS = 8000;

  /**
   * Check if a runtime is available
   */
  public static async isRuntimeAvailable(language: string): Promise<boolean> {
    const lang = language.toLowerCase();
    const cmd = lang.includes("python") ? "python" : (lang.includes("js") || lang.includes("node") || lang.includes("ts")) ? "node" : lang.includes("dotnet") || lang.includes("c#") ? "dotnet" : null;
    if (!cmd) return false;

    return new Promise((resolve) => {
      const proc = spawn(cmd, ["--version"], { shell: false });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  }

  /**
   * Executes source code in an isolated scratch directory with bounded resources
   */
  public static async execute(options: CodeExecutionOptions): Promise<CodeExecutionResult> {
    const lang = options.language.toLowerCase().trim();
    const timeoutMs = Math.min(options.timeoutMs || this.DEFAULT_TIMEOUT_MS, 15000);

    // Normalize language key
    let normalizedLang = "python";
    let filename = "main.py";
    let command = "python";
    let args: string[] = [];

    if (lang.includes("python") || lang === "py") {
      normalizedLang = "python";
      filename = "solution.py";
      command = "python";
      args = ["-u", filename];
    } else if (lang.includes("javascript") || lang === "js" || lang === "node") {
      normalizedLang = "javascript";
      filename = "solution.js";
      command = "node";
      args = [filename];
    } else if (lang.includes("typescript") || lang === "ts") {
      normalizedLang = "typescript";
      filename = "solution.js"; // Run with node via transpile or direct execution
      command = "node";
      args = [filename];
    } else {
      return {
        success: false,
        status: "unsupported_language",
        language: options.language,
        stdout: "",
        stderr: `Language "${options.language}" execution sandbox is not configured on this host. Currently supported: Python (3.13) and JavaScript/Node.js (v24).`,
        exitCode: 1,
        durationMs: 0,
        testResults: [],
        error: `Unsupported language: ${options.language}`,
      };
    }

    // Create ephemeral scratch sandbox
    const runId = crypto.randomUUID();
    const sandboxDir = path.join(os.tmpdir(), `nexus-sandbox-${runId}`);
    await fs.mkdir(sandboxDir, { recursive: true });

    try {
      const scriptPath = path.join(sandboxDir, filename);
      await fs.writeFile(scriptPath, options.code, "utf8");

      // 1. Single run with main stdin if no test cases
      if (!options.testCases || options.testCases.length === 0) {
        const singleRun = await this.spawnProcess(command, args, sandboxDir, options.stdin || "", timeoutMs);
        return {
          success: singleRun.exitCode === 0 && !singleRun.timedOut,
          status: singleRun.timedOut ? "timeout" : singleRun.exitCode === 0 ? "completed" : "error",
          language: normalizedLang,
          stdout: singleRun.stdout,
          stderr: singleRun.stderr,
          exitCode: singleRun.exitCode,
          durationMs: singleRun.durationMs,
          testResults: [],
          error: singleRun.timedOut ? `Execution timed out after ${timeoutMs}ms` : undefined,
        };
      }

      // 2. Test Cases suite execution
      const testResults: ExecutionTestResult[] = [];
      let combinedStdout = "";
      let combinedStderr = "";
      let lastExitCode = 0;
      let totalDurationMs = 0;

      for (let i = 0; i < options.testCases.length; i++) {
        const tc = options.testCases[i];
        const res = await this.spawnProcess(command, args, sandboxDir, tc.input || "", timeoutMs);
        totalDurationMs += res.durationMs;
        combinedStdout += `[Test Case #${i + 1} Output]:\n${res.stdout}\n`;
        if (res.stderr) {
          combinedStderr += `[Test Case #${i + 1} Stderr]:\n${res.stderr}\n`;
        }
        lastExitCode = res.exitCode;

        const actualTrimmed = res.stdout.trim();
        const expectedTrimmed = (tc.expectedOutput || "").trim();
        const passed = res.exitCode === 0 && !res.timedOut && (expectedTrimmed ? actualTrimmed === expectedTrimmed || actualTrimmed.includes(expectedTrimmed) : true);

        testResults.push({
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          actualOutput: actualTrimmed,
          passed,
          durationMs: res.durationMs,
          error: res.timedOut ? "Timeout" : res.stderr ? res.stderr.slice(0, 200) : undefined,
        });
      }

      const allPassed = testResults.every((t) => t.passed);
      return {
        success: allPassed && lastExitCode === 0,
        status: lastExitCode === 0 ? "completed" : "error",
        language: normalizedLang,
        stdout: combinedStdout.trim(),
        stderr: combinedStderr.trim(),
        exitCode: lastExitCode,
        durationMs: totalDurationMs,
        testResults,
      };
    } finally {
      // Ephemeral workspace cleanup
      try {
        await fs.rm(sandboxDir, { recursive: true, force: true });
      } catch (cleanupErr: any) {
        console.warn("[CodeExecutionService] Sandbox cleanup notice:", cleanupErr.message);
      }
    }
  }

  /**
   * Spawns isolated process with timeout, stdin, and buffer limits
   */
  private static async spawnProcess(
    command: string,
    args: string[],
    cwd: string,
    stdinData: string,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean }> {
    const t0 = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let closed = false;

      const proc = spawn(command, args, {
        cwd,
        env: {
          PATH: process.env.PATH,
          PYTHONUNBUFFERED: "1",
          NODE_ENV: "production",
        },
        shell: false,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < this.MAX_OUTPUT_BYTES) {
          stdout += chunk.toString("utf8");
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < this.MAX_OUTPUT_BYTES) {
          stderr += chunk.toString("utf8");
        }
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        if (!closed) {
          closed = true;
          resolve({
            stdout,
            stderr: `${stderr}\nProcess error: ${err.message}`.trim(),
            exitCode: 1,
            durationMs: Date.now() - t0,
            timedOut,
          });
        }
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (!closed) {
          closed = true;
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: timedOut ? 124 : (code ?? 0),
            durationMs: Date.now() - t0,
            timedOut,
          });
        }
      });

      if (stdinData) {
        try {
          proc.stdin.write(stdinData);
          proc.stdin.end();
        } catch {}
      } else {
        try {
          proc.stdin.end();
        } catch {}
      }
    });
  }
}
