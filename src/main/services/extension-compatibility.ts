import type { BrowserExtensionSource } from "./extensions.js";

export type ExtensionCompatibilityLevel = "unreviewed";

export type ExtensionInstallPolicy = "allow" | "warn" | "block";

export interface BrowserExtensionCompatibilitySummary {
  level: ExtensionCompatibilityLevel;
  installPolicy: ExtensionInstallPolicy;
  label: string;
}

export function getExtensionCompatibility(
  _extensionId: string,
  source: BrowserExtensionSource,
): BrowserExtensionCompatibilitySummary {
  return {
    level: "unreviewed",
    installPolicy: source === "chrome-web-store" ? "warn" : "allow",
    label: "Unreviewed",
  };
}

export function isChromeWebStoreExtensionInstallAllowed(_extensionId: string) {
  return true;
}

export function assertChromeWebStoreExtensionInstallAllowed(_extensionId: string) {}
