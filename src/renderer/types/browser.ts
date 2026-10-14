export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  displayUrl: string;
  favicon?: string;
  isLoading: boolean;
  isAutomationControlled: boolean;
  manualInterventionMessage?: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type BrowserTabPatch = Partial<Omit<BrowserTabState, "id" | "displayUrl">> & {
  url?: string;
};
