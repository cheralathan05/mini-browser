import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { shell } from "electron";

export interface WidgetPackageManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  description?: string;
  defaultTitle?: string;
  defaultSize?: {
    h?: number;
    w?: number;
  };
  permissions?: {
    network?: boolean;
    openExternal?: boolean;
  };
}

export interface WidgetPackageSummary {
  defaultSize: {
    h: number;
    w: number;
  };
  defaultTitle: string;
  description?: string;
  entry: string;
  id: string;
  name: string;
  permissions: {
    network: boolean;
    openExternal: boolean;
  };
  rootPath: string;
  version: string;
}

export interface WidgetPackageFileRecord {
  content: string;
  path: string;
}

export interface WidgetPackageSource {
  files: WidgetPackageFileRecord[];
  manifest: WidgetPackageManifest;
  package: WidgetPackageSummary;
}

export interface SaveWidgetPackageSourceInput {
  deletePaths?: string[];
  files: WidgetPackageFileRecord[];
  manifest: WidgetPackageManifest;
  replace?: boolean;
}

export interface ResolvedWidgetAssetTarget {
  allowHtml: boolean;
  targetUrl: string;
}

interface CreateWidgetRegistryOptions {
  rootPath: string;
}

const MANIFEST_FILE_NAME = "widget.json";
const DEFAULT_WIDGET_SIZE = Object.freeze({ h: 4, w: 4 });
const WIDGET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const TEXT_WIDGET_FILE_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".htm",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".txt",
  ".ts",
  ".tsx",
]);

const SAMPLE_WIDGET_MANIFEST: WidgetPackageManifest = {
  id: "hello-snapshot",
  name: "Hello Snapshot",
  version: "1.0.0",
  entry: "index.html",
  description: "A starter widget package showing the Milo host protocol.",
  defaultTitle: "Hello Snapshot",
  defaultSize: {
    h: 4,
    w: 4,
  },
  permissions: {
    network: false,
    openExternal: false,
  },
};

const SAMPLE_WIDGET_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hello Snapshot</title>
    <link rel="stylesheet" href="./widget.css" />
  </head>
  <body>
    <div class="shell">
      <div class="header">
        <span class="badge">Sample Widget</span>
        <span class="badge badge-secondary" id="theme-badge">dark</span>
      </div>
      <h1 id="title">Hello Snapshot</h1>
      <p class="subtitle" id="subtitle">Waiting for host context...</p>
      <div class="stat">
        <span class="stat-label">Last refresh</span>
        <span class="stat-value" id="clock">--:--:--</span>
      </div>
      <pre class="payload" id="payload"></pre>
    </div>
    <script type="module" src="./widget.js"></script>
  </body>
</html>
`;

const SAMPLE_WIDGET_CSS = `:root {
  color-scheme: dark light;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  min-height: 100vh;
  color: #e5eef8;
  background:
    radial-gradient(circle at top left, rgba(56, 189, 248, 0.28), transparent 38%),
    radial-gradient(circle at top right, rgba(251, 146, 60, 0.2), transparent 34%),
    linear-gradient(180deg, #07111f 0%, #0f172a 100%);
}

body[data-theme="light"] {
  color: #102033;
  background:
    radial-gradient(circle at top left, rgba(125, 211, 252, 0.42), transparent 40%),
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.24), transparent 34%),
    linear-gradient(180deg, #f9fbff 0%, #e7eef7 100%);
}

.shell {
  min-height: 100vh;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.badge-secondary {
  background: rgba(15, 23, 42, 0.32);
}

body[data-theme="light"] .badge {
  background: rgba(255, 255, 255, 0.72);
}

h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.06em;
}

.subtitle {
  margin: 0;
  color: rgba(226, 232, 240, 0.78);
  font-size: 13px;
  line-height: 1.6;
}

body[data-theme="light"] .subtitle {
  color: rgba(51, 65, 85, 0.8);
}

.stat {
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.08);
}

body[data-theme="light"] .stat {
  background: rgba(255, 255, 255, 0.7);
}

.stat-label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(226, 232, 240, 0.56);
}

body[data-theme="light"] .stat-label {
  color: rgba(51, 65, 85, 0.58);
}

.stat-value {
  display: block;
  margin-top: 8px;
  font-size: 32px;
  letter-spacing: -0.05em;
}

.payload {
  margin: 0;
  padding: 12px;
  border-radius: 18px;
  background: rgba(2, 6, 23, 0.34);
  color: inherit;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

body[data-theme="light"] .payload {
  background: rgba(255, 255, 255, 0.62);
}
`;

const SAMPLE_WIDGET_JS = `const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const clockEl = document.getElementById("clock");
const payloadEl = document.getElementById("payload");
const themeBadgeEl = document.getElementById("theme-badge");

let latestPayload = null;

function renderSnapshot(reason) {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString();

  if (!latestPayload) {
    subtitleEl.textContent = "Waiting for host:init...";
    payloadEl.textContent = "No payload received yet.";
    return;
  }

  subtitleEl.textContent = "Updated from " + reason + " at " + now.toLocaleTimeString();
  payloadEl.textContent = JSON.stringify(latestPayload, null, 2);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "host:init" || message.type === "host:update-context") {
    latestPayload = message.payload;
    document.body.dataset.theme = message.payload?.theme === "light" ? "light" : "dark";
    themeBadgeEl.textContent = message.payload?.theme === "light" ? "light" : "dark";
    titleEl.textContent = message.payload?.title || "Hello Snapshot";
    renderSnapshot(message.type);
    parent.postMessage({ type: "widget:ready" }, "*");
    return;
  }

  if (message.type === "host:refresh") {
    renderSnapshot(message.payload?.reason || "refresh");
  }
});

parent.postMessage({ type: "widget:ready" }, "*");
`;

function buildSampleWidgetHtml(title: string) {
  return SAMPLE_WIDGET_HTML.replaceAll("Hello Snapshot", title);
}

function buildSampleWidgetJs(defaultTitle: string) {
  return SAMPLE_WIDGET_JS.replaceAll("Hello Snapshot", defaultTitle);
}

function normalizeWidgetId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return WIDGET_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizePackageRelativePath(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed);
  if (
    normalized === "."
    || normalized.startsWith("../")
    || normalized.includes("/../")
    || path.posix.isAbsolute(normalized)
  ) {
    return null;
  }

  return normalized;
}

function clampWidgetSize(value: unknown) {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(12, Math.max(2, Math.round(Number(value))));
}

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath !== ""
    && !relativePath.startsWith("..")
    && !path.isAbsolute(relativePath);
}

function isReadableWidgetTextFile(relativePath: string) {
  return TEXT_WIDGET_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function listWidgetPackageTextFiles(packageRoot: string, currentDirectory = packageRoot) {
  const files: WidgetPackageFileRecord[] = [];

  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listWidgetPackageTextFiles(packageRoot, absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(packageRoot, absolutePath).replace(/\\/g, "/");
    if (relativePath === MANIFEST_FILE_NAME || !isReadableWidgetTextFile(relativePath)) {
      continue;
    }

    files.push({
      path: relativePath,
      content: readFileSync(absolutePath, "utf8"),
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeManifest(
  value: unknown,
  rootPath: string,
): WidgetPackageSummary | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const source = value as WidgetPackageManifest;
  const id = normalizeWidgetId(source.id);
  const entry = normalizePackageRelativePath(source.entry);
  const name =
    typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : null;
  const version =
    typeof source.version === "string" && source.version.trim()
      ? source.version.trim()
      : null;
  if (!id || !entry || !name || !version) {
    return null;
  }

  const entryPath = path.resolve(rootPath, entry);
  if (!isPathInsideRoot(rootPath, entryPath)) {
    return null;
  }

  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) {
    return null;
  }

  return {
    defaultSize: {
      h: clampWidgetSize(source.defaultSize?.h) ?? DEFAULT_WIDGET_SIZE.h,
      w: clampWidgetSize(source.defaultSize?.w) ?? DEFAULT_WIDGET_SIZE.w,
    },
    defaultTitle:
      typeof source.defaultTitle === "string" && source.defaultTitle.trim()
        ? source.defaultTitle.trim()
        : name,
    description:
      typeof source.description === "string" && source.description.trim()
        ? source.description.trim()
        : undefined,
    entry,
    id,
    name,
    permissions: {
      network: Boolean(source.permissions?.network),
      openExternal: Boolean(source.permissions?.openExternal),
    },
    rootPath,
    version,
  };
}

export function createWidgetRegistry(options: CreateWidgetRegistryOptions) {
  const { rootPath } = options;

  function ensureRootDirectory() {
    mkdirSync(rootPath, { recursive: true });
  }

  function writeIfMissing(targetPath: string, contents: string) {
    if (existsSync(targetPath)) {
      return;
    }

    writeFileSync(targetPath, contents, "utf8");
  }

  function ensureSampleWidgetPackage() {
    const packageRoot = path.join(rootPath, SAMPLE_WIDGET_MANIFEST.id);
    mkdirSync(packageRoot, { recursive: true });
    writeIfMissing(
      path.join(packageRoot, MANIFEST_FILE_NAME),
      `${JSON.stringify(SAMPLE_WIDGET_MANIFEST, null, 2)}\n`,
    );
    writeIfMissing(
      path.join(packageRoot, "index.html"),
      buildSampleWidgetHtml(SAMPLE_WIDGET_MANIFEST.name),
    );
    writeIfMissing(path.join(packageRoot, "widget.css"), SAMPLE_WIDGET_CSS);
    writeIfMissing(
      path.join(packageRoot, "widget.js"),
      buildSampleWidgetJs(SAMPLE_WIDGET_MANIFEST.defaultTitle ?? SAMPLE_WIDGET_MANIFEST.name),
    );
  }

  function ensureRegistry() {
    ensureRootDirectory();
    ensureSampleWidgetPackage();
  }

  function readPackageManifest(packageRoot: string) {
    const manifestPath = path.join(packageRoot, MANIFEST_FILE_NAME);
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
      return null;
    }

    try {
      return JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      return null;
    }
  }

  function inspectPackageDirectory(sourceDirectoryPath: string) {
    ensureRegistry();

    const normalizedSourcePath = path.resolve(sourceDirectoryPath);
    if (!existsSync(normalizedSourcePath) || !statSync(normalizedSourcePath).isDirectory()) {
      throw new Error("The selected widget package directory does not exist.");
    }

    const manifest = readPackageManifest(normalizedSourcePath);
    const normalizedManifest = normalizeManifest(manifest, normalizedSourcePath);
    if (!normalizedManifest) {
      throw new Error("The selected folder does not contain a valid widget.json manifest.");
    }

    return normalizedManifest;
  }

  function listPackages() {
    ensureRegistry();

    const packages: WidgetPackageSummary[] = [];
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageRoot = path.join(rootPath, entry.name);
      const manifest = readPackageManifest(packageRoot);
      const normalized = normalizeManifest(manifest, packageRoot);
      if (!normalized) {
        continue;
      }

      packages.push(normalized);
    }

    return packages.sort((left, right) => left.name.localeCompare(right.name));
  }

  function getPackage(packageId: string) {
    const normalizedId = normalizeWidgetId(packageId);
    if (!normalizedId) {
      return null;
    }

    return listPackages().find((entry) => entry.id === normalizedId) ?? null;
  }

  function getPackageManifest(packageId: string) {
    const widgetPackage = getPackage(packageId);
    if (!widgetPackage) {
      return null;
    }

    const manifest = readPackageManifest(widgetPackage.rootPath);
    if (!manifest || typeof manifest !== "object") {
      return null;
    }

    return manifest as WidgetPackageManifest;
  }

  function getPackageSource(packageId: string) {
    ensureRegistry();

    const widgetPackage = getPackage(packageId);
    if (!widgetPackage) {
      return null;
    }

    const manifest = getPackageManifest(packageId);
    if (!manifest) {
      return null;
    }

    return {
      package: widgetPackage,
      manifest,
      files: listWidgetPackageTextFiles(widgetPackage.rootPath),
    } satisfies WidgetPackageSource;
  }

  function resolveAssetRequest(requestUrl: URL): ResolvedWidgetAssetTarget | null {
    if (requestUrl.hostname.toLowerCase() !== "widget-package") {
      return null;
    }

    const pathSegments = requestUrl.pathname
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment).trim();
        } catch {
          return segment.trim();
        }
      })
      .filter(Boolean);
    const packageId = pathSegments[0] ?? "";
    const widgetPackage = getPackage(packageId);
    if (!widgetPackage) {
      return null;
    }

    const relativePath = normalizePackageRelativePath(
      pathSegments.length > 1 ? pathSegments.slice(1).join("/") : widgetPackage.entry,
    );
    if (!relativePath) {
      return null;
    }

    const targetPath = path.resolve(widgetPackage.rootPath, relativePath);
    if (
      !isPathInsideRoot(widgetPackage.rootPath, targetPath)
      || !existsSync(targetPath)
      || !statSync(targetPath).isFile()
    ) {
      return null;
    }

    return {
      allowHtml: /\.html?$/i.test(targetPath),
      targetUrl: pathToFileURL(targetPath).toString(),
    };
  }

  async function revealRootDirectory() {
    ensureRegistry();
    const openError = await shell.openPath(rootPath);
    if (openError) {
      throw new Error(openError);
    }
    return rootPath;
  }

  function getRootDirectory() {
    ensureRegistry();
    return rootPath;
  }

  function installPackageFromDirectory(sourceDirectoryPath: string) {
    ensureRegistry();
    const normalizedSourcePath = path.resolve(sourceDirectoryPath);
    const normalizedManifest = inspectPackageDirectory(normalizedSourcePath);

    const targetRootPath = path.join(rootPath, normalizedManifest.id);
    if (path.resolve(targetRootPath) === normalizedSourcePath) {
      return getPackage(normalizedManifest.id) ?? normalizedManifest;
    }

    const stagingRootPath = mkdtempSync(path.join(rootPath, `${normalizedManifest.id}-install-`));
    const stagingPackagePath = path.join(stagingRootPath, normalizedManifest.id);
    try {
      cpSync(normalizedSourcePath, stagingPackagePath, { recursive: true });

      const copiedManifest = readPackageManifest(stagingPackagePath);
      const copiedSummary = normalizeManifest(copiedManifest, stagingPackagePath);
      if (!copiedSummary) {
        throw new Error("The copied widget package failed validation.");
      }

      if (existsSync(targetRootPath)) {
        rmSync(targetRootPath, { force: true, recursive: true });
      }

      renameSync(stagingPackagePath, targetRootPath);
      return getPackage(copiedSummary.id) ?? {
        ...copiedSummary,
        rootPath: targetRootPath,
      };
    } finally {
      if (existsSync(stagingRootPath)) {
        rmSync(stagingRootPath, { force: true, recursive: true });
      }
    }
  }

  async function revealPackage(packageId: string) {
    const widgetPackage = getPackage(packageId);
    if (!widgetPackage) {
      throw new Error("The widget package was not found.");
    }

    const openError = await shell.openPath(widgetPackage.rootPath);
    if (openError) {
      throw new Error(openError);
    }
    return widgetPackage.rootPath;
  }

  function removePackage(packageId: string) {
    ensureRegistry();

    const widgetPackage = getPackage(packageId);
    if (!widgetPackage) {
      throw new Error("The widget package was not found.");
    }

    rmSync(widgetPackage.rootPath, { force: true, recursive: true });
    return widgetPackage.id;
  }

  function createStarterPackage() {
    ensureRegistry();

    const baseId = "starter-widget";
    let suffix = 0;
    let nextId = baseId;
    while (existsSync(path.join(rootPath, nextId))) {
      suffix += 1;
      nextId = `${baseId}-${suffix + 1}`;
    }

    const labelSuffix = suffix > 0 ? ` ${suffix + 1}` : "";
    const manifest: WidgetPackageManifest = {
      id: nextId,
      name: `Starter Widget${labelSuffix}`,
      version: "1.0.0",
      entry: "index.html",
      description: "A starter widget package generated from Milo.",
      defaultTitle: `Starter Widget${labelSuffix}`,
      defaultSize: {
        h: 4,
        w: 4,
      },
      permissions: {
        network: false,
        openExternal: false,
      },
    };

    const packageRoot = path.join(rootPath, manifest.id);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, MANIFEST_FILE_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(path.join(packageRoot, "index.html"), buildSampleWidgetHtml(manifest.name), "utf8");
    writeFileSync(path.join(packageRoot, "widget.css"), SAMPLE_WIDGET_CSS, "utf8");
    writeFileSync(
      path.join(packageRoot, "widget.js"),
      buildSampleWidgetJs(manifest.defaultTitle ?? manifest.name),
      "utf8",
    );

    return getPackage(manifest.id) ?? inspectPackageDirectory(packageRoot);
  }

  function savePackageSource(input: SaveWidgetPackageSourceInput) {
    ensureRegistry();

    const normalizedManifest = input.manifest;
    const normalizedId = normalizeWidgetId(normalizedManifest.id);
    if (!normalizedId) {
      throw new Error("Widget manifest id is invalid.");
    }

    const targetRootPath = path.join(rootPath, normalizedId);
    const shouldReplace = input.replace === true;
    const stagingRootPath = mkdtempSync(path.join(rootPath, `${normalizedId}-save-`));
    const stagingPackagePath = path.join(stagingRootPath, normalizedId);

    try {
      if (!shouldReplace && existsSync(targetRootPath)) {
        cpSync(targetRootPath, stagingPackagePath, { recursive: true });
      } else {
        mkdirSync(stagingPackagePath, { recursive: true });
      }

      for (const filePath of input.deletePaths ?? []) {
        const relativePath = normalizePackageRelativePath(filePath);
        if (!relativePath) {
          throw new Error(`Widget file path "${String(filePath)}" is invalid.`);
        }
        if (relativePath === MANIFEST_FILE_NAME) {
          throw new Error("Widget file deletes must not include widget.json. Pass manifest updates through manifest instead.");
        }

        const targetPath = path.resolve(stagingPackagePath, relativePath);
        if (!isPathInsideRoot(stagingPackagePath, targetPath)) {
          throw new Error(`Widget file path "${relativePath}" escapes the package root.`);
        }
        if (existsSync(targetPath)) {
          rmSync(targetPath, { force: true, recursive: true });
        }
      }

      const seenPaths = new Set<string>();
      for (const file of input.files) {
        const relativePath = normalizePackageRelativePath(file.path);
        if (!relativePath) {
          throw new Error(`Widget file path "${String(file.path)}" is invalid.`);
        }
        if (relativePath === MANIFEST_FILE_NAME) {
          throw new Error("Widget files must not include widget.json. Pass it through manifest instead.");
        }
        if (seenPaths.has(relativePath)) {
          throw new Error(`Widget file path "${relativePath}" is duplicated.`);
        }
        seenPaths.add(relativePath);

        const targetPath = path.resolve(stagingPackagePath, relativePath);
        if (!isPathInsideRoot(stagingPackagePath, targetPath)) {
          throw new Error(`Widget file path "${relativePath}" escapes the package root.`);
        }

        mkdirSync(path.dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, file.content, "utf8");
      }

      writeFileSync(
        path.join(stagingPackagePath, MANIFEST_FILE_NAME),
        `${JSON.stringify(normalizedManifest, null, 2)}\n`,
        "utf8",
      );

      const savedSummary = inspectPackageDirectory(stagingPackagePath);
      if (existsSync(targetRootPath)) {
        rmSync(targetRootPath, { force: true, recursive: true });
      }

      renameSync(stagingPackagePath, targetRootPath);
      return getPackageSource(savedSummary.id) ?? {
        package: {
          ...savedSummary,
          rootPath: targetRootPath,
        },
        manifest: normalizedManifest,
        files: listWidgetPackageTextFiles(targetRootPath),
      };
    } finally {
      if (existsSync(stagingRootPath)) {
        rmSync(stagingRootPath, { force: true, recursive: true });
      }
    }
  }

  return {
    createStarterPackage,
    getPackage,
    getPackageManifest,
    getPackageSource,
    getRootDirectory,
    inspectPackageDirectory,
    installPackageFromDirectory,
    listPackages,
    removePackage,
    resolveAssetRequest,
    savePackageSource,
    revealPackage,
    revealRootDirectory,
  };
}
