import { builtinModules } from "node:module";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const electronOutDir = path.resolve(projectRoot, "dist-electron");

const external = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

async function buildElectronEntry({
  entry,
  outDir,
  format,
  entryFileName,
  emptyOutDir,
}) {
  await build({
    configFile: false,
    publicDir: false,
    ssr: {
      noExternal: true,
      external,
    },
    build: {
      target: "es2022",
      outDir,
      emptyOutDir,
      codeSplitting: false,
      minify: false,
      sourcemap: true,
      ssr: entry,
      rollupOptions: {
        external,
        output: {
          entryFileNames: entryFileName,
          format,
        },
      },
    },
  });
}

rmSync(electronOutDir, { recursive: true, force: true });

await buildElectronEntry({
  entry: path.resolve(projectRoot, "src/main/main.ts"),
  outDir: electronOutDir,
  format: "es",
  entryFileName: "main.js",
  emptyOutDir: true,
});

await buildElectronEntry({
  entry: path.resolve(projectRoot, "src/main/bridge/preload.cts"),
  outDir: path.resolve(electronOutDir, "bridge"),
  format: "cjs",
  entryFileName: "preload.cjs",
  emptyOutDir: false,
});
