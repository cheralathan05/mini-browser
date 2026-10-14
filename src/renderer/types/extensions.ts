export type BrowserExtensionSource = "chrome-web-store" | "local-unpacked";

export interface BrowserExtensionCompatibilitySummary {
  level: "unreviewed";
  installPolicy: "allow" | "warn" | "block";
  label: string;
}

export interface BrowserExtensionActionSummary {
  title: string;
  popupUrl: string;
  defaultPopup: string;
  iconUrl?: string;
}

export interface BrowserExtensionSummary {
  id: string;
  profileId: string;
  name: string;
  version: string;
  description?: string;
  source: BrowserExtensionSource;
  path: string;
  enabled: boolean;
  loaded: boolean;
  installedAt: number;
  updatedAt: number;
  storeId?: string;
  storeUrl?: string;
  lastError?: string;
  compatibility: BrowserExtensionCompatibilitySummary;
  action?: BrowserExtensionActionSummary;
}
