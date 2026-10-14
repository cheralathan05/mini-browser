import { app } from "electron";
import type { AppTheme } from "../state/app-settings.js";
import type { createDownloadManager } from "../services/downloads.js";
import type { createExtensionManager } from "../services/extensions.js";
import type { createUserScriptManager } from "../services/user-scripts.js";
import { registerIpcHandlers } from "./ipc.js";
import type { createPasskeyManager } from "../services/passkeys.js";

type IpcContext = Parameters<typeof registerIpcHandlers>[0];
type DownloadManager = ReturnType<typeof createDownloadManager>;
type ExtensionManager = ReturnType<typeof createExtensionManager>;
type UserScriptManager = ReturnType<typeof createUserScriptManager>;
type PasskeyManager = ReturnType<typeof createPasskeyManager>;

interface RegisterMainIpcHandlersOptions extends Omit<
  IpcContext,
  | "getDownloads"
  | "createDownload"
  | "pauseDownload"
  | "resumeDownload"
  | "cancelDownload"
  | "retryDownload"
  | "removeDownloadRecord"
  | "deleteDownloadFile"
  | "showDownloadInFolder"
  | "setTheme"
  | "setLanguage"
  | "listExtensions"
  | "getChromeWebStoreInstallState"
  | "beginChromeWebStoreInstall"
  | "completeChromeWebStoreInstall"
  | "installExtensionFromStore"
  | "installUnpackedExtension"
  | "setExtensionEnabled"
  | "removeExtension"
  | "reloadExtension"
  | "revealExtension"
  | "openExtensionActionPopup"
  | "listUserScripts"
  | "createUserScript"
  | "updateUserScript"
  | "removeUserScript"
  | "setUserScriptEnabled"
  | "runUserScriptNow"
  | "runUserScriptTest"
  | "createPasskeyCredential"
  | "getPasskeyAssertion"
> {
  installApplicationMenu: () => void;
  applyThemeToNativeTheme: (theme: AppTheme) => void;
  broadcastThemeChanged: (theme: string) => void;
  broadcastLanguageChanged: (language: string) => void;
  syncColorSchemeForAllTabs: () => Promise<void>;
  getDownloadSettings: () => {
    defaultThreadCount: number;
    defaultHeadersText: string;
  };
  setThemeSetting: (theme: unknown) => AppTheme;
  setLanguageSetting: (language: unknown) => string;
  parseDownloadHeadersText: (input: string) => Record<string, string>;
  resolveDownloadDirectory: () => string;
  downloadManager: DownloadManager;
  extensionManager: ExtensionManager;
  userScriptManager: UserScriptManager;
  passkeyManager: PasskeyManager;
}

export function registerMainIpcHandlers(options: RegisterMainIpcHandlersOptions) {
  const {
    installApplicationMenu,
    applyThemeToNativeTheme,
    broadcastThemeChanged,
    broadcastLanguageChanged,
    syncColorSchemeForAllTabs,
    getDownloadSettings,
    setThemeSetting,
    setLanguageSetting,
    parseDownloadHeadersText,
    resolveDownloadDirectory,
    downloadManager,
    extensionManager,
    userScriptManager,
    passkeyManager,
    ...context
  } = options;

  registerIpcHandlers({
    ...context,
    getDownloads: () => downloadManager.getRecords(),
    createDownload: (input) => {
      const downloadSettings = getDownloadSettings();
      const normalizedHeaders = input.headers && Object.keys(input.headers).length > 0
        ? input.headers
        : parseDownloadHeadersText(downloadSettings.defaultHeadersText);
      return downloadManager.create({
        ...input,
        directory: input.directory || resolveDownloadDirectory(),
        threadCount: input.threadCount ?? downloadSettings.defaultThreadCount,
        headers: normalizedHeaders,
      });
    },
    pauseDownload: (id) => downloadManager.pause(id),
    resumeDownload: (id) => downloadManager.resume(id),
    cancelDownload: (id) => downloadManager.cancel(id),
    retryDownload: (id) => downloadManager.retry(id),
    removeDownloadRecord: (id, options) => downloadManager.removeRecord(id, options),
    deleteDownloadFile: (id) => downloadManager.deleteFile(id),
    showDownloadInFolder: (id) => downloadManager.showInFolder(id),
    setTheme: async (theme) => {
      const normalizedTheme = setThemeSetting(theme);
      applyThemeToNativeTheme(normalizedTheme);
      broadcastThemeChanged(normalizedTheme);
      await syncColorSchemeForAllTabs();
    },
    setLanguage: (language) => {
      const normalizedLanguage = setLanguageSetting(language);
      if (app.isReady()) {
        installApplicationMenu();
      }

      broadcastLanguageChanged(normalizedLanguage);
    },
    listExtensions: (profileId) => extensionManager.listExtensions(profileId),
    getChromeWebStoreInstallState: (profileId, input) =>
      extensionManager.getChromeWebStoreInstallState(profileId, input),
    beginChromeWebStoreInstall: (profileId, input) =>
      extensionManager.beginChromeWebStoreInstall(profileId, input),
    completeChromeWebStoreInstall: (profileId, extensionId) =>
      extensionManager.completeChromeWebStoreInstall(profileId, extensionId),
    installExtensionFromStore: (profileId, input) =>
      extensionManager.installFromChromeWebStore(profileId, input),
    installUnpackedExtension: (profileId, extensionPath) =>
      extensionManager.installUnpacked(profileId, extensionPath),
    setExtensionEnabled: (profileId, extensionId, enabled) =>
      extensionManager.setEnabled(profileId, extensionId, enabled),
    removeExtension: (profileId, extensionId) =>
      extensionManager.remove(profileId, extensionId),
    reloadExtension: (profileId, extensionId) =>
      extensionManager.reload(profileId, extensionId),
    revealExtension: (profileId, extensionId) =>
      extensionManager.reveal(profileId, extensionId),
    openExtensionActionPopup: (profileId, extensionId, ownerWindow, anchor) =>
      extensionManager.openActionPopup(profileId, extensionId, ownerWindow, anchor),
    listUserScripts: (profileId) => userScriptManager.list(profileId),
    createUserScript: (profileId, input) =>
      userScriptManager.create(profileId, input),
    updateUserScript: (profileId, scriptId, input) =>
      userScriptManager.update(profileId, scriptId, input),
    removeUserScript: (profileId, scriptId) =>
      userScriptManager.remove(profileId, scriptId),
    setUserScriptEnabled: (profileId, scriptId, enabled) =>
      userScriptManager.setEnabled(profileId, scriptId, enabled),
    runUserScriptNow: (profileId, targetContents, scriptId) =>
      userScriptManager.runNow(profileId, targetContents, scriptId),
    runUserScriptTest: (profileId, targetContents, scriptId) =>
      userScriptManager.runTest(profileId, targetContents, scriptId),
    createPasskeyCredential: (profileId, input, ownerWindow) =>
      passkeyManager.createCredential(profileId, input, ownerWindow),
    getPasskeyAssertion: (profileId, input, ownerWindow) =>
      passkeyManager.getAssertion(profileId, input, ownerWindow),
  });
}
