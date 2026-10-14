import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const electronDir = path.resolve(rootDir, "node_modules", "electron");
const distDir = path.resolve(electronDir, "dist");
const zipPath = path.resolve(electronDir, "electron-v41.1.0-win32-x64.zip");

const url = "https://github.com/electron/electron/releases/download/v41.1.0/electron-v41.1.0-win32-x64.zip";

async function run() {
  console.log(`[1/3] Downloading Electron v41.1.0 for win32-x64...`);
  console.log(`Source: ${url}`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }

  const totalBytes = Number(res.headers.get("content-length") || 0);
  console.log(`Size: ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);

  let downloaded = 0;
  let lastLogged = 0;

  const fileStream = fs.createWriteStream(zipPath);
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloaded += value.length;
    const mb = downloaded / (1024 * 1024);
    if (mb - lastLogged >= 10 || downloaded === totalBytes) {
      console.log(`Progress: ${mb.toFixed(1)} MB / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
      lastLogged = mb;
    }
  }
  fileStream.end();

  console.log(`[2/3] Extracting to ${distDir}...`);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  await extract(zipPath, { dir: distDir });

  console.log(`[3/3] Finalizing Electron installation...`);
  fs.writeFileSync(path.join(electronDir, "path.txt"), "electron.exe", "utf-8");

  try {
    fs.unlinkSync(zipPath);
  } catch {}

  console.log(`Electron v41.1.0 successfully installed!`);
}

run().catch((err) => {
  console.error("Installation failed:", err);
  process.exit(1);
});
