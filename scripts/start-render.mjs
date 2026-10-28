/**
 * start-render.mjs
 * Production entrypoint for Render web service deployment.
 * Launches the Express + WebSocket server immediately so port binding
 * and health check routes succeed without delay, while synchronizing
 * PostgreSQL database schema in parallel.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const MAX_RETRIES = 10;
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
  const dbUrl = process.env.DATABASE_URL || "";
  const isLocalhost = dbUrl.includes("127.0.0.1") || dbUrl.includes("localhost");

  if (isLocalhost) {
    console.warn(`\n====================================================`);
    console.warn(`⚠️ [start-render] DATABASE CONFIGURATION NOTICE:`);
    console.warn(`   DATABASE_URL is set to localhost (${dbUrl.replace(/:[^:@]*@/, ":****@")}).`);
    console.warn(`   On Render, PostgreSQL runs on a separate managed host.`);
    console.warn(`   👉 To connect your database:`);
    console.warn(`      1. Go to your Render Dashboard -> Environment.`);
    console.warn(`      2. Update DATABASE_URL to your Render PostgreSQL connection string`);
    console.warn(`         (e.g. postgresql://user:pass@dpg-xxx:5432/db).`);
    console.warn(`   Server will continue running in web preview mode.`);
    console.warn(`====================================================\n`);
    return false;
  }

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

function startServer() {
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

  return new Promise((resolve) => {
    serverProcess.on("close", (code) => {
      console.log(`[start-render] Server process exited with code ${code}`);
      process.exit(code ?? 0);
    });
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

  // 1. Launch server immediately so Render detects port binding and /health without delay
  const serverPromise = startServer();

  // 2. Run schema synchronization in background / parallel
  setTimeout(() => {
    syncDatabaseSchema().catch((err) => {
      console.warn(`[start-render] Schema sync background error:`, err?.message || err);
    });
  }, 1000);

  // 3. Keep runner alive with the server process
  await serverPromise;
}

main().catch((err) => {
  console.error(`[start-render] Fatal initialization error:`, err);
  process.exit(1);
});
