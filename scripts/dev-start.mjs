import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const rendererUrl = "http://127.0.0.1:5188";
const rendererHost = "127.0.0.1";
const rendererPort = 5188;
const rendererReadinessPath = "/index.html?workspaceId=default";
const electronEntryPath = path.join(projectRoot, "dist-electron", "main.js");
const electronDistPath = path.join(projectRoot, "dist-electron");
const readinessPollMs = 250;
const restartDebounceMs = 150;
const localImportPattern = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

let childProcess = null;
let fileWatcher = null;
let restartTimer = null;
let restartRequested = false;
let startPending = false;
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRendererReady() {
  return new Promise((resolve) => {
    const request = http.get({
      host: rendererHost,
      port: rendererPort,
      path: rendererReadinessPath,
      timeout: readinessPollMs,
    }, (response) => {
      response.resume();
      response.once("end", () => {
        resolve(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 400);
      });
    });

    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
  });
}

function isRendererPortOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: rendererHost,
      port: rendererPort,
    });

    const finish = (ready) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ready);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function resolveRelativeModulePath(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const resolvedPath = path.resolve(path.dirname(fromFile), specifier);
  if (path.extname(resolvedPath)) {
    return resolvedPath;
  }

  for (const candidate of [
    `${resolvedPath}.js`,
    `${resolvedPath}.mjs`,
    `${resolvedPath}.cjs`,
    path.join(resolvedPath, "index.js"),
    path.join(resolvedPath, "index.mjs"),
    path.join(resolvedPath, "index.cjs"),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return `${resolvedPath}.js`;
}

function collectMissingLocalImports(entryPath, seen = new Set()) {
  if (seen.has(entryPath)) {
    return [];
  }
  seen.add(entryPath);

  if (!existsSync(entryPath)) {
    return [entryPath];
  }

  let source = "";
  try {
    source = readFileSync(entryPath, "utf8");
  } catch {
    return [entryPath];
  }

  const missing = [];
  const importPattern = new RegExp(localImportPattern.source, "g");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) {
      continue;
    }

    const importedPath = resolveRelativeModulePath(entryPath, specifier);
    if (!importedPath) {
      continue;
    }

    if (!existsSync(importedPath)) {
      missing.push(importedPath);
      continue;
    }

    if (/\.(?:js|mjs|cjs)$/i.test(importedPath)) {
      missing.push(...collectMissingLocalImports(importedPath, seen));
    }
  }

  return missing;
}

function isElectronMainGraphReady() {
  return collectMissingLocalImports(electronEntryPath).length === 0;
}

async function waitForDevReadiness() {
  while (!shuttingDown) {
    if (
      existsSync(electronEntryPath)
      && isElectronMainGraphReady()
      && await isRendererPortOpen()
      && await isRendererReady()
    ) {
      return;
    }
    await sleep(readinessPollMs);
  }
}

function startElectron() {
  if (shuttingDown) {
    return;
  }

  childProcess = spawn(electronBinary, ["."], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: rendererUrl,
    },
  });

  childProcess.once("error", (error) => {
    console.error("[dev:start] Failed to launch Electron.", error);
    process.exit(1);
  });

  childProcess.once("exit", (code, signal) => {
    childProcess = null;

    if (restartRequested && !shuttingDown) {
      restartRequested = false;
      void startElectronWhenReady();
      return;
    }

    if (shuttingDown) {
      process.exit(0);
      return;
    }

    if (signal) {
      process.exit(0);
      return;
    }

    process.exit(code ?? 0);
  });
}

async function startElectronWhenReady() {
  if (startPending || childProcess || shuttingDown) {
    return;
  }

  startPending = true;
  try {
    await waitForDevReadiness();
  } finally {
    startPending = false;
  }

  if (!childProcess && !shuttingDown) {
    startElectron();
  }
}

function requestRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;

    if (!childProcess) {
      void startElectronWhenReady();
      return;
    }

    restartRequested = true;
    childProcess.kill();
  }, restartDebounceMs);
}

function shouldRestartForFile(filename) {
  if (!filename) {
    return false;
  }

  return filename.endsWith(".js")
    || filename.endsWith(".cjs")
    || filename.endsWith(".mjs");
}

function startWatcher() {
  fileWatcher = watch(electronDistPath, { recursive: true }, (_eventType, filename) => {
    if (!shouldRestartForFile(filename)) {
      return;
    }
    requestRestart();
  });

  fileWatcher.once("error", (error) => {
    console.error("[dev:start] Failed to watch dist-electron for changes.", error);
  });
}

function stopWatcher() {
  if (!fileWatcher) {
    return;
  }

  fileWatcher.close();
  fileWatcher = null;
}

function stopElectron() {
  if (!childProcess) {
    return;
  }

  childProcess.kill();
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  restartRequested = false;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  stopWatcher();
  stopElectron();

  if (!childProcess) {
    process.exit(exitCode);
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(0));
}

await waitForDevReadiness();
startWatcher();
startElectron();
