import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import lucideDynamicIconImportsSource from "lucide-react/dist/esm/dynamicIconImports.js?raw";

export const LUCIDE_FOLDER_ICON_VALUE_PREFIX = "lucide:";
const Folder = LucideIcons.Folder;

function isLucideIconComponent(value: unknown): value is LucideIcon {
  return typeof value === "object" && value !== null && "$$typeof" in value;
}

function isLucideBaseIconExport(name: string, value: unknown): value is LucideIcon {
  return /^[A-Z]/.test(name)
    && name !== "Icon"
    && !name.startsWith("Lucide")
    && !name.endsWith("Icon")
    && isLucideIconComponent(value);
}

function lucideExportNameToIconName(name: string) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function buildLucideIconNameAliases(name: string) {
  return new Set([
    name,
    name.replace(/-(\d{2,})(?=-|$)/g, (_, digits: string) => `-${digits.split("").join("-")}`),
    name.replace(/-(\d)-([a-z])(?=-|$)/g, "-$1$2"),
    name.replace(/-(a)(z)(?=-|$)/g, "-a-z"),
    name.replace(/-(z)(a)(?=-|$)/g, "-z-a"),
    name.replace(/-(\d)-x-(\d)(?=-|$)/g, "-$1x$2"),
    name.replace(/-([0-9])/g, "$1"),
  ]);
}

function formatLucideFolderIconLabel(name: string) {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export type LucideFolderIconName = string;

const lucideIconComponentByName = new Map<LucideFolderIconName, LucideIcon>();
const lucideCanonicalNameByAlias = new Map<string, LucideFolderIconName>();

Object.entries(LucideIcons)
  .filter(([exportName, value]) => isLucideBaseIconExport(exportName, value))
  .forEach(([exportName, Component]) => {
    const IconComponent = Component as LucideIcon;
    const name = lucideExportNameToIconName(exportName) as LucideFolderIconName;
    buildLucideIconNameAliases(name).forEach((alias) => {
      if (!lucideIconComponentByName.has(alias)) {
        lucideIconComponentByName.set(alias, IconComponent);
      }
    });
  });

const lucideDynamicIconEntries = Array.from(
  lucideDynamicIconImportsSource.matchAll(
    /^\s*"([^"]+)":\s*\(\)\s*=>\s*import\('\.\/icons\/([^']+)\.js'\),?$/gm,
  ),
  (match) => ({
    name: match[1] as LucideFolderIconName,
    targetName: match[2] as LucideFolderIconName,
  }),
);

export const lucideFolderIconOptions = lucideDynamicIconEntries.map((entry) => ({
  Component: lucideIconComponentByName.get(entry.name)
    ?? lucideIconComponentByName.get(entry.targetName)
    ?? Folder,
  name: entry.name,
  label: formatLucideFolderIconLabel(entry.name),
}));

lucideDynamicIconEntries.forEach((entry) => {
  [entry.name, entry.targetName, ...buildLucideIconNameAliases(entry.name)].forEach((alias) => {
    if (!lucideCanonicalNameByAlias.has(alias)) {
      lucideCanonicalNameByAlias.set(alias, entry.name);
    }
  });
});

function normalizeLucideFolderIconName(value: string) {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

  return lucideCanonicalNameByAlias.get(normalized) ?? null;
}

export function buildLucideFolderIconValue(name: LucideFolderIconName) {
  return `${LUCIDE_FOLDER_ICON_VALUE_PREFIX}${name}`;
}

export function getLucideFolderIconName(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.toLowerCase().startsWith(LUCIDE_FOLDER_ICON_VALUE_PREFIX)) {
    return null;
  }

  return normalizeLucideFolderIconName(trimmed.slice(LUCIDE_FOLDER_ICON_VALUE_PREFIX.length));
}

export function getLucideFolderIconComponent(name: LucideFolderIconName) {
  return lucideIconComponentByName.get(name) ?? null;
}

export function isImageFolderIconValue(value: string) {
  return /^(https?:\/\/|data:image)/i.test(value.trim());
}

interface FolderIconContentProps {
  icon?: string | null;
  fallbackLabel?: string;
  imageClassName?: string;
  lucideClassName?: string;
  textClassName?: string;
  fallbackClassName?: string;
}

export function FolderIconContent({
  icon,
  fallbackLabel,
  imageClassName = "h-full w-full rounded-md object-cover",
  lucideClassName = "h-3.5 w-3.5",
  textClassName = "text-sm leading-none",
  fallbackClassName = "h-3.5 w-3.5",
}: FolderIconContentProps) {
  const trimmedIcon = icon?.trim() ?? "";
  const lucideIconName = getLucideFolderIconName(trimmedIcon);

  if (trimmedIcon) {
    if (isImageFolderIconValue(trimmedIcon)) {
      return <img alt="" className={imageClassName} src={trimmedIcon} />;
    }

    if (lucideIconName) {
      const Icon = getLucideFolderIconComponent(lucideIconName);
      return (
        Icon
          ? <Icon aria-hidden="true" className={lucideClassName} />
          : <Folder aria-hidden="true" className={fallbackClassName} />
      );
    }

    return <span className={textClassName}>{trimmedIcon}</span>;
  }

  if (fallbackLabel) {
    return <span className={textClassName}>{fallbackLabel.slice(0, 1)}</span>;
  }

  return <Folder aria-hidden="true" className={fallbackClassName} />;
}
