export interface StartPageUrlOptions {
  startPageUrl: string;
  miloScheme: string;
  miloHomeHost: string;
}

export interface ResolveInputToUrlOptions {
  homeDisplayUrl: string;
  startPageUrl: string;
  searchBaseUrl: string;
}

export interface DisplayUrlOptions extends StartPageUrlOptions {
  homeDisplayUrl: string;
}

interface WorkspaceSortRecord {
  id: string;
  name: string;
  createdAt: number;
}

function resolveChromePlatformToken() {
  switch (process.platform) {
    case "win32":
      return process.arch === "arm64"
        ? "Windows NT 10.0; Win64; ARM64"
        : "Windows NT 10.0; Win64; x64";
    case "darwin":
      // Chromium keeps a stable macOS token for compatibility.
      return "Macintosh; Intel Mac OS X 10_15_7";
    default:
      return process.arch === "arm64" ? "X11; Linux aarch64" : "X11; Linux x86_64";
  }
}

export function buildChromeUserAgent() {
  const platformToken = resolveChromePlatformToken();
  const fullVersion = process.versions.chrome || "120.0.0.0";
  const majorVersion = fullVersion.split(".")[0];
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36`;
}

const GOOGLE_RELATED_HOST_PATTERNS = [
  /^(?:.+\.)?google\.[a-z.]+$/,
  /^(?:.+\.)?googleapis\.(?:com|cn)$/,
  /^(?:.+\.)?gstatic\.(?:com|cn)$/,
  /^(?:.+\.)?googleusercontent\.com$/,
  /^(?:.+\.)?googlevideo\.com$/,
  /^(?:.+\.)?ggpht\.com$/,
  /^(?:.+\.)?googlesyndication\.com$/,
  /^(?:.+\.)?googleadservices\.com$/,
  /^(?:.+\.)?googletagmanager\.com$/,
  /^(?:.+\.)?googletagservices\.com$/,
  /^(?:.+\.)?google-analytics\.com$/,
  /^(?:.+\.)?doubleclick\.net$/,
  /^(?:.+\.)?youtube\.com$/,
  /^(?:.+\.)?youtu\.be$/,
  /^(?:.+\.)?ytimg\.com$/,
  /^(?:.+\.)?googlesource\.com$/,
] as const;

export function isGoogleRelatedUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return GOOGLE_RELATED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

export function isStartPageUrl(url: string, options: StartPageUrlOptions) {
  const { startPageUrl, miloScheme, miloHomeHost } = options;

  if (url.startsWith("data:text/html")) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === `${miloScheme}:` && parsedUrl.hostname === miloHomeHost;
  } catch {
    return url === startPageUrl;
  }
}

export function inferTitleFromUrl(url: string, options: StartPageUrlOptions) {
  if (isStartPageUrl(url, options)) {
    return "Start";
  }

  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return "New Tab";
  }
}

export function toDisplayUrl(url: string, options: DisplayUrlOptions) {
  return isStartPageUrl(url, options) ? options.homeDisplayUrl : url;
}

export function resolveInputToUrl(input: string, options: ResolveInputToUrlOptions) {
  const { homeDisplayUrl, startPageUrl, searchBaseUrl } = options;
  const value = input.trim();

  if (!value || value === homeDisplayUrl || value.toLowerCase() === "home") {
    return startPageUrl;
  }
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
    return value;
  }
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return `${searchBaseUrl}${encodeURIComponent(value)}`;
}

export function buildWorkspacePartition(profileId: string) {
  return `persist:workspace:${profileId}`;
}

export function compareWorkspacesByCreatedAt(
  left: WorkspaceSortRecord,
  right: WorkspaceSortRecord,
  pinnedWorkspaceId?: string,
) {
  if (pinnedWorkspaceId) {
    if (left.id === pinnedWorkspaceId && right.id !== pinnedWorkspaceId) {
      return -1;
    }
    if (right.id === pinnedWorkspaceId && left.id !== pinnedWorkspaceId) {
      return 1;
    }
  }

  const createdAtOrder = left.createdAt - right.createdAt;
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  const nameOrder = left.name.localeCompare(right.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }

  return left.id.localeCompare(right.id);
}
