export type TabHistoryNavigationDirection = "back" | "forward";

const HISTORY_NAVIGATION_DEDUPE_WINDOW_MS = 250;

const recentHistoryNavigationByWindow = new Map<number, {
  at: number;
  direction: TabHistoryNavigationDirection;
  tabId: string | null;
}>();

export function shouldHandleTabHistoryNavigation(
  windowId: number,
  direction: TabHistoryNavigationDirection,
  tabId?: string | null,
) {
  const now = Date.now();
  const normalizedTabId = typeof tabId === "string" && tabId.trim() ? tabId : null;
  const recentNavigation = recentHistoryNavigationByWindow.get(windowId);

  if (
    recentNavigation
    && recentNavigation.direction === direction
    && now - recentNavigation.at < HISTORY_NAVIGATION_DEDUPE_WINDOW_MS
    && (
      recentNavigation.tabId === null
      || normalizedTabId === null
      || recentNavigation.tabId === normalizedTabId
    )
  ) {
    return false;
  }

  recentHistoryNavigationByWindow.set(windowId, {
    at: now,
    direction,
    tabId: normalizedTabId,
  });
  return true;
}

export function clearTabHistoryNavigationWindow(windowId: number) {
  recentHistoryNavigationByWindow.delete(windowId);
}
