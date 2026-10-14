export type ContextPageType = string;
export type ContextOpportunityKind = string;

export type ContextOpportunitySurface =
  | "tiny_chip"
  | "selection_menu"
  | "field_popover"
  | "sidebar";

export interface ContextPageObservation {
  workspaceId?: string;
  tabId?: string;
  url: string;
  title?: string;
  locale?: "en-US" | "zh-CN";
  trigger?: "page_observation" | "selection_change" | "focus_change" | "copy";
  surface?: string;
  textSample?: string;
  headings?: string[];
  formHints?: string[];
  focusedElement?: {
    tagName?: string;
    role?: string;
    text?: string;
    ariaLabel?: string;
    placeholder?: string;
    name?: string;
    valueLength?: number;
    bounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  repeatedItemSamples?: string[];
  selectedText?: string;
  bodyTextLength?: number;
  articleTextLength?: number;
  headingCount?: number;
  linkCount?: number;
  formCount?: number;
  inputCount?: number;
  repeatedItemCount?: number;
  selectedTextLength?: number;
  copiedTextLength?: number;
  dwellMs?: number;
  updatedAt?: number;
}

export interface ContextOpportunity {
  id: string;
  kind: ContextOpportunityKind;
  label: string;
  actionLabel?: string;
  confidence: number;
  surface: ContextOpportunitySurface;
  cooldownKey: string;
  prompt: string;
  payload: Record<string, unknown>;
}

export interface ContextPageState {
  pageType: ContextPageType;
  opportunities: ContextOpportunity[];
  updatedAt: number;
}
