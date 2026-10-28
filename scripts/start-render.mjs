/**
 * start-render.mjs
 * Production entrypoint for Render web service deployment.
 * Handles resilient PostgreSQL schema synchronization with automatic retry
 * before launching the Express + WebSocket server.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const MAX_RETRIES = 15;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", (err) => {
      console.error(`[start-render] Process error:`, err.message);
      resolve(false);
    });
  });
}

async function syncDatabaseSchema() {
  const prismaCli = path.resolve(rootDir, "node_modules", "prisma", "build", "index.js");
  const schemaPath = path.resolve(rootDir, "prisma", "schema.prisma");

  console.log(`[start-render] 🔄 Initializing database schema synchronization...`);
  console.log(`[start-render] Target Schema: ${schemaPath}`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[start-render] Database sync attempt ${attempt}/${MAX_RETRIES}...`);
    
    const success = await runCommand(
      "node",
      [
        `"${prismaCli}"`,
        "db",
        "push",
        `--schema="${schemaPath}"`,
        "--skip-generate",
        "--accept-data-loss",
      ],
      rootDir
    );

    if (success) {
      console.log(`[start-render] ✅ Database schema successfully pushed to PostgreSQL!`);
      return true;
    }

    if (attempt < MAX_RETRIES) {
      console.log(`[start-render] ⏳ Database is warming up or connection pending. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.error(`[start-render] ❌ Failed to synchronize database schema after ${MAX_RETRIES} attempts.`);
  return false;
}

async function startServer() {
  console.log(`[start-render] 🚀 Launching Milo backend server...`);
  const serverPath = path.resolve(rootDir, "dist-backend", "server.js");

  const serverProcess = spawn("node", [`"${serverPath}"`], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });

  const handleTermination = (signal) => {
    console.log(`[start-render] Received ${signal}, shutting down gracefully...`);
    serverProcess.kill(signal);
  };

  process.on("SIGINT", () => handleTermination("SIGINT"));
  process.on("SIGTERM", () => handleTermination("SIGTERM"));

  serverProcess.on("close", (code) => {
    console.log(`[start-render] Server process exited with code ${code}`);
    process.exit(code ?? 0);
  });
}

async function main() {
  console.log(`====================================================`);
  console.log(`🌟 MILO / NEXUS - RENDER CLOUD STARTUP RUNNER`);
  console.log(`Node:    ${process.version}`);
  console.log(`Env:     ${process.env.NODE_ENV || "production"}`);
  console.log(`Port:    ${process.env.PORT || 10000}`);
  console.log(`DB Host: ${(process.env.DATABASE_URL || "").replace(/:[^:@]*@/, ":****@")}`);
  console.log(`====================================================`);

  const dbOk = await syncDatabaseSchema();
  if (!dbOk) {
    console.warn(`[start-render] ⚠️ Proceeding with server boot despite db push warning...`);
  }

  await startServer();
}

main().catch((err) => {
  console.error(`[start-render] Fatal initialization error:`, err);
  process.exit(1);
});
