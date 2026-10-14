import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface ChromiumImportBrowserDefinition {
  browserId: string;
  browserName: string;
  basePath: string;
  localStatePath: string;
}

export interface ChromiumProfileFileSource {
  browserId: string;
  browserName: string;
  profileId: string;
  profileName: string;
  filePath: string;
}

interface ParsedChromiumLocalState {
  profile?: {
    info_cache?: Record<string, { name?: string }>;
  };
}

function resolveHomePath(...segments: string[]) {
  return path.join(homedir(), ...segments);
}

function resolveWindowsLocalAppDataPath(...segments: string[]) {
  const basePath = process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local");
  return path.join(basePath, ...segments);
}

function resolveLinuxConfigPath(...segments: string[]) {
  const basePath = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return path.join(basePath, ...segments);
}

export function buildChromiumBrowserDefinitions() {
  switch (process.platform) {
    case "darwin":
      return [
        {
          browserId: "google-chrome",
          browserName: "Google Chrome",
          basePath: resolveHomePath("Library", "Application Support", "Google", "Chrome"),
          localStatePath: resolveHomePath("Library", "Application Support", "Google", "Chrome", "Local State"),
        },
        {
          browserId: "microsoft-edge",
          browserName: "Microsoft Edge",
          basePath: resolveHomePath("Library", "Application Support", "Microsoft Edge"),
          localStatePath: resolveHomePath("Library", "Application Support", "Microsoft Edge", "Local State"),
        },
        {
          browserId: "brave",
          browserName: "Brave",
          basePath: resolveHomePath("Library", "Application Support", "BraveSoftware", "Brave-Browser"),
          localStatePath: resolveHomePath("Library", "Application Support", "BraveSoftware", "Brave-Browser", "Local State"),
        },
        {
          browserId: "chromium",
          browserName: "Chromium",
          basePath: resolveHomePath("Library", "Application Support", "Chromium"),
          localStatePath: resolveHomePath("Library", "Application Support", "Chromium", "Local State"),
        },
        {
          browserId: "vivaldi",
          browserName: "Vivaldi",
          basePath: resolveHomePath("Library", "Application Support", "Vivaldi"),
          localStatePath: resolveHomePath("Library", "Application Support", "Vivaldi", "Local State"),
        },
        {
          browserId: "arc",
          browserName: "Arc",
          basePath: resolveHomePath("Library", "Application Support", "Arc", "User Data"),
          localStatePath: resolveHomePath("Library", "Application Support", "Arc", "User Data", "Local State"),
        },
      ] satisfies ChromiumImportBrowserDefinition[];
    case "win32":
      return [
        {
          browserId: "google-chrome",
          browserName: "Google Chrome",
          basePath: resolveWindowsLocalAppDataPath("Google", "Chrome", "User Data"),
          localStatePath: resolveWindowsLocalAppDataPath("Google", "Chrome", "User Data", "Local State"),
        },
        {
          browserId: "microsoft-edge",
          browserName: "Microsoft Edge",
          basePath: resolveWindowsLocalAppDataPath("Microsoft", "Edge", "User Data"),
          localStatePath: resolveWindowsLocalAppDataPath("Microsoft", "Edge", "User Data", "Local State"),
        },
        {
          browserId: "brave",
          browserName: "Brave",
          basePath: resolveWindowsLocalAppDataPath("BraveSoftware", "Brave-Browser", "User Data"),
          localStatePath: resolveWindowsLocalAppDataPath("BraveSoftware", "Brave-Browser", "User Data", "Local State"),
        },
        {
          browserId: "chromium",
          browserName: "Chromium",
          basePath: resolveWindowsLocalAppDataPath("Chromium", "User Data"),
          localStatePath: resolveWindowsLocalAppDataPath("Chromium", "User Data", "Local State"),
        },
        {
          browserId: "vivaldi",
          browserName: "Vivaldi",
          basePath: resolveWindowsLocalAppDataPath("Vivaldi", "User Data"),
          localStatePath: resolveWindowsLocalAppDataPath("Vivaldi", "User Data", "Local State"),
        },
        {
          browserId: "arc",
          browserName: "Arc",
          basePath: resolveWindowsLocalAppDataPath("Arc", "User Data"),
          localStatePath: resolveWindowsLocalAppDataPath("Arc", "User Data", "Local State"),
        },
      ] satisfies ChromiumImportBrowserDefinition[];
    default:
      return [
        {
          browserId: "google-chrome",
          browserName: "Google Chrome",
          basePath: resolveLinuxConfigPath("google-chrome"),
          localStatePath: resolveLinuxConfigPath("google-chrome", "Local State"),
        },
        {
          browserId: "microsoft-edge",
          browserName: "Microsoft Edge",
          basePath: resolveLinuxConfigPath("microsoft-edge"),
          localStatePath: resolveLinuxConfigPath("microsoft-edge", "Local State"),
        },
        {
          browserId: "brave",
          browserName: "Brave",
          basePath: resolveLinuxConfigPath("BraveSoftware", "Brave-Browser"),
          localStatePath: resolveLinuxConfigPath("BraveSoftware", "Brave-Browser", "Local State"),
        },
        {
          browserId: "chromium",
          browserName: "Chromium",
          basePath: resolveLinuxConfigPath("chromium"),
          localStatePath: resolveLinuxConfigPath("chromium", "Local State"),
        },
        {
          browserId: "vivaldi",
          browserName: "Vivaldi",
          basePath: resolveLinuxConfigPath("vivaldi"),
          localStatePath: resolveLinuxConfigPath("vivaldi", "Local State"),
        },
      ] satisfies ChromiumImportBrowserDefinition[];
  }
}

export function readChromiumProfileNames(localStatePath: string) {
  if (!existsSync(localStatePath)) {
    return new Map<string, string>();
  }

  try {
    const raw = readFileSync(localStatePath, "utf-8");
    const parsed = JSON.parse(raw) as ParsedChromiumLocalState;
    const infoCache = parsed.profile?.info_cache;
    if (!infoCache || typeof infoCache !== "object") {
      return new Map<string, string>();
    }

    const profileNames = new Map<string, string>();
    for (const [profileId, entry] of Object.entries(infoCache)) {
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      if (name) {
        profileNames.set(profileId, name);
      }
    }
    return profileNames;
  } catch {
    return new Map<string, string>();
  }
}

export function compareProfileIds(left: string, right: string) {
  if (left === "Default") return right === "Default" ? 0 : -1;
  if (right === "Default") return 1;
  return left.localeCompare(right, undefined, { numeric: true });
}

export function buildChromiumSourceLabel(browserName: string, profileName: string) {
  return profileName === "Default" ? browserName : `${browserName} (${profileName})`;
}

export function listChromiumProfileFileSources(profileFileName: string) {
  const sources: ChromiumProfileFileSource[] = [];

  for (const definition of buildChromiumBrowserDefinitions()) {
    if (!existsSync(definition.basePath)) {
      continue;
    }

    const profileNames = readChromiumProfileNames(definition.localStatePath);

    let directoryEntries: Array<{ isDirectory: () => boolean; name: string }>;
    try {
      directoryEntries = readdirSync(definition.basePath, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      continue;
    }

    for (const entry of directoryEntries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const filePath = path.join(definition.basePath, entry.name, profileFileName);
      if (!existsSync(filePath)) {
        continue;
      }

      sources.push({
        browserId: definition.browserId,
        browserName: definition.browserName,
        profileId: entry.name,
        profileName: profileNames.get(entry.name) || entry.name,
        filePath,
      });
    }
  }

  return sources.sort((left, right) => {
    const browserComparison = left.browserName.localeCompare(right.browserName);
    if (browserComparison !== 0) {
      return browserComparison;
    }
    return compareProfileIds(left.profileId, right.profileId);
  });
}
