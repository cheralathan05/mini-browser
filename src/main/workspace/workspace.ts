import { app, BrowserWindow, type WebContents } from "electron";
import {
  CdpSession,
  type CdpEventHandler,
  type CdpEventSubscriptionOptions,
} from "../shared/cdp-session.js";
import type {
  BrowserBootstrapData,
  SidebarOrganizationState,
  WindowSummary,
  WorkspaceRecord,
  WorkspaceSummary,
} from "../shared/contracts.js";
import {
  compareWorkspacesByCreatedAt,
  isStartPageUrl,
  type StartPageUrlOptions,
} from "../shared/utils.js";

interface WorkspaceManagerContext {
  DEFAULT_WORKSPACE_ID: string;
  workspaces: Map<string, WorkspaceRecord>;
  windowToWorkspace: Map<number, string>;
  getWorkspaceWindows: (workspaceId: string) => BrowserWindow[];
  serializeWindow: (targetWindow: BrowserWindow) => WindowSummary;
  serializeWindows: () => WindowSummary[];
  getSidebarOrganizationState?: (input: {
    windowId: number;
    workspaceId: string;
  }) => SidebarOrganizationState;
  startPageUrlOptions: StartPageUrlOptions;
  onAutomationTargetChanged?: (workspaceId: string, targetContentsId?: number) => void;
}

function serializeAutomationUrl(startPageUrlOptions: StartPageUrlOptions, url?: string) {
  if (!url) {
    return undefined;
  }

  return isStartPageUrl(url, startPageUrlOptions) ? "home://start" : url;
}

export function createWorkspaceManager(context: WorkspaceManagerContext) {
  const {
    DEFAULT_WORKSPACE_ID,
    workspaces,
    windowToWorkspace,
    getWorkspaceWindows,
    serializeWindow,
    serializeWindows,
    getSidebarOrganizationState,
    startPageUrlOptions,
  } = context;

  const guestContentsById = new Map<number, WebContents>();
  const guestToWorkspace = new Map<number, string>();
  const workspaceAutomationTargets = new Map<string, number>();
  const cdpSessions = new Map<number, CdpSession>();

  function getGuestContents(contentsId: number) {
    const targetContents = guestContentsById.get(contentsId);
    if (!targetContents || targetContents.isDestroyed()) {
      guestContentsById.delete(contentsId);
      return null;
    }

    return targetContents;
  }

  function getWorkspaceAutomationTarget(workspaceId: string) {
    const targetContentsId = workspaceAutomationTargets.get(workspaceId);
    if (!targetContentsId) {
      return null;
    }

    const targetContents = getGuestContents(targetContentsId);
    if (!targetContents) {
      workspaceAutomationTargets.delete(workspaceId);
      return null;
    }

    return targetContents;
  }

  function getOrCreateCdpSession(targetContents: WebContents) {
    const existingSession = cdpSessions.get(targetContents.id);
    if (existingSession) {
      return existingSession;
    }

    const session = new CdpSession(targetContents);
    cdpSessions.set(targetContents.id, session);
    return session;
  }

  function serializeWorkspace(workspace: WorkspaceRecord): WorkspaceSummary {
    const workspaceWindows = getWorkspaceWindows(workspace.id);
    const sourceWorkspace = workspace.profileSourceWorkspaceId
      ? workspaces.get(workspace.profileSourceWorkspaceId)
      : undefined;
    const automationTarget = getWorkspaceAutomationTarget(workspace.id);
    const automationSession = automationTarget
      ? cdpSessions.get(automationTarget.id)
      : undefined;

    return {
      id: workspace.id,
      name: workspace.name,
      profileId: workspace.profileId,
      profileMode: workspace.profileMode,
      profileSourceWorkspaceId: workspace.profileSourceWorkspaceId,
      profileSourceWorkspaceName: sourceWorkspace?.name,
      automationEnabled: workspace.automationEnabled,
      ...(workspace.tags?.length ? { tags: [...workspace.tags] } : {}),
      automationAttached: Boolean(automationSession?.isAttached),
      automationTargetId: automationTarget?.id,
      automationTargetUrl: serializeAutomationUrl(startPageUrlOptions, automationTarget?.getURL()),
      hasWindow: workspaceWindows.length > 0,
      windowVisible: workspaceWindows.some((targetWindow) => targetWindow.isVisible()),
      windowCount: workspaceWindows.length,
    };
  }

  function serializeWorkspaces() {
    return Array.from(workspaces.values())
      .sort((left, right) => compareWorkspacesByCreatedAt(left, right, DEFAULT_WORKSPACE_ID))
      .map((workspace) => serializeWorkspace(workspace));
  }

  function getWorkspaceForContents(contents: WebContents) {
    const guestWorkspaceId = guestToWorkspace.get(contents.id);
    if (guestWorkspaceId) {
      return workspaces.get(guestWorkspaceId) ?? workspaces.get(DEFAULT_WORKSPACE_ID) ?? null;
    }

    const targetWindow = BrowserWindow.fromWebContents(contents);
    if (!targetWindow) {
      return workspaces.get(DEFAULT_WORKSPACE_ID) ?? null;
    }

    const workspaceId = windowToWorkspace.get(targetWindow.id) ?? DEFAULT_WORKSPACE_ID;
    return workspaces.get(workspaceId) ?? workspaces.get(DEFAULT_WORKSPACE_ID) ?? null;
  }

  function tryBuildBootstrapData(contents: WebContents): BrowserBootstrapData | null {
    const currentWorkspace =
      getWorkspaceForContents(contents) ?? workspaces.get(DEFAULT_WORKSPACE_ID);
    const currentWorkspaceWindow = currentWorkspace
      ? getWorkspaceWindows(currentWorkspace.id)[0]
      : undefined;
    const currentBrowserWindow =
      BrowserWindow.fromWebContents(contents) ?? currentWorkspaceWindow ?? BrowserWindow.getAllWindows()[0];

    if (!currentWorkspace || !currentBrowserWindow) {
      return null;
    }

    return {
      appInfo: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
      },
      currentWorkspace: serializeWorkspace(currentWorkspace),
      currentWindow: serializeWindow(currentBrowserWindow),
      workspaces: serializeWorkspaces(),
      windows: serializeWindows(),
      ...(getSidebarOrganizationState
        ? {
          sidebarOrganizationState: getSidebarOrganizationState({
            windowId: currentBrowserWindow.id,
            workspaceId: currentWorkspace.id,
          }),
        }
        : {}),
    };
  }

  function buildBootstrapData(contents: WebContents): BrowserBootstrapData {
    const bootstrapData = tryBuildBootstrapData(contents);
    if (!bootstrapData) {
      throw new Error("Browser context is not initialized.");
    }

    return bootstrapData;
  }

  function broadcastWorkspaceContext() {
    const sentContentsIds = new Set<number>();

    function sendWorkspaceContext(targetContents: WebContents) {
      if (targetContents.isDestroyed() || sentContentsIds.has(targetContents.id)) {
        return;
      }

      const bootstrapData = tryBuildBootstrapData(targetContents);
      if (!bootstrapData) {
        return;
      }

      sentContentsIds.add(targetContents.id);
      targetContents.send("browser:workspace-context", bootstrapData);
    }

    for (const targetWindow of BrowserWindow.getAllWindows()) {
      sendWorkspaceContext(targetWindow.webContents);
    }

    for (const guestContents of guestContentsById.values()) {
      sendWorkspaceContext(guestContents);
    }
  }

  function cleanupGuestContents(contentsId: number) {
    const workspaceId = guestToWorkspace.get(contentsId);

    guestContentsById.delete(contentsId);
    guestToWorkspace.delete(contentsId);

    const session = cdpSessions.get(contentsId);
    session?.dispose();
    cdpSessions.delete(contentsId);

    if (workspaceId && workspaceAutomationTargets.get(workspaceId) === contentsId) {
      workspaceAutomationTargets.delete(workspaceId);
      context.onAutomationTargetChanged?.(workspaceId, undefined);
    }

    broadcastWorkspaceContext();
  }

  function registerGuestContents(
    workspaceId: string,
    guestContents: WebContents,
    options?: { automationTargetEligible?: boolean },
  ) {
    const contentsId = guestContents.id;
    guestContentsById.set(contentsId, guestContents);
    guestToWorkspace.set(contentsId, workspaceId);

    guestContents.on("destroyed", () => {
      cleanupGuestContents(contentsId);
    });

    guestContents.on("did-start-loading", () => {
      broadcastWorkspaceContext();
    });

    guestContents.on("did-stop-loading", () => {
      broadcastWorkspaceContext();
    });

    guestContents.on("did-navigate", () => {
      broadcastWorkspaceContext();
      if (workspaceAutomationTargets.get(workspaceId) === contentsId) {
        context.onAutomationTargetChanged?.(workspaceId, contentsId);
      }
    });

    guestContents.on("did-navigate-in-page", () => {
      broadcastWorkspaceContext();
    });

    if (
      options?.automationTargetEligible !== false
      && !workspaceAutomationTargets.has(workspaceId)
    ) {
      workspaceAutomationTargets.set(workspaceId, guestContents.id);
      context.onAutomationTargetChanged?.(workspaceId, guestContents.id);
      void getOrCreateCdpSession(guestContents).attach().catch(() => undefined);
    }

    broadcastWorkspaceContext();
  }

  function getWorkspaceRecord(workspaceId: string) {
    const workspace = workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found.");
    }

    return workspace;
  }

  function ensureAutomationWorkspace(workspaceId: string) {
    return getWorkspaceRecord(workspaceId);
  }

  async function setWorkspaceAutomationTarget(
    workspaceId: string,
    targetContentsId: number,
  ) {
    const workspace = ensureAutomationWorkspace(workspaceId);
    const targetContents = getGuestContents(targetContentsId);

    if (!targetContents) {
      throw new Error("The selected automation target no longer exists.");
    }

    if (guestToWorkspace.get(targetContentsId) !== workspaceId) {
      throw new Error("The selected target does not belong to this workspace.");
    }

    workspaceAutomationTargets.set(workspaceId, targetContentsId);
    context.onAutomationTargetChanged?.(workspaceId, targetContentsId);
    await getOrCreateCdpSession(targetContents).attach();
    broadcastWorkspaceContext();
    return serializeWorkspace(workspace);
  }

  async function sendWorkspaceCdpCommand<TResult = unknown>(
    workspaceId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResult> {
    ensureAutomationWorkspace(workspaceId);

    const targetContents = getWorkspaceAutomationTarget(workspaceId);
    if (!targetContents) {
      throw new Error(
        "No active webContents target is registered for this workspace.",
      );
    }

    const session = getOrCreateCdpSession(targetContents);
    const result = await session.send<TResult>(method, params);
    broadcastWorkspaceContext();
    return result;
  }

  async function sendContentsCdpCommand<TResult = unknown>(
    contentsId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResult> {
    const targetContents = getGuestContents(contentsId);
    if (!targetContents) {
      throw new Error("Target webContents is no longer available.");
    }

    const session = getOrCreateCdpSession(targetContents);
    return session.send<TResult>(method, params);
  }

  async function subscribeContentsCdpEvents(
    contentsId: number,
    listener: CdpEventHandler,
    options?: CdpEventSubscriptionOptions,
  ) {
    const targetContents = getGuestContents(contentsId);
    if (!targetContents) {
      throw new Error("Target webContents is no longer available.");
    }

    const session = getOrCreateCdpSession(targetContents);
    await session.attach();
    return session.onMessage(listener, options);
  }

  function createWorkspaceName(name?: string) {
    const trimmed = name?.trim();
    if (trimmed) {
      return trimmed;
    }

    return `workspace-${workspaces.size}`;
  }

  function ensureDefaultWorkspace() {
    if (workspaces.has(DEFAULT_WORKSPACE_ID)) {
      return;
    }

    workspaces.set(DEFAULT_WORKSPACE_ID, {
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_ID,
      createdAt: 0,
      profileId: DEFAULT_WORKSPACE_ID,
      profileMode: "new",
      automationEnabled: true,
    });
  }

  return {
    serializeWorkspace,
    serializeWorkspaces,
    buildBootstrapData,
    broadcastWorkspaceContext,
    registerGuestContents,
    getWorkspaceRecord,
    setWorkspaceAutomationTarget,
    sendWorkspaceCdpCommand,
    sendContentsCdpCommand,
    subscribeContentsCdpEvents,
    createWorkspaceName,
    ensureDefaultWorkspace,
  };
}
