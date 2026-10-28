import {
  type CSSProperties,
  type ChangeEvent,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  startTransition,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  normalizeLanguageSetting,
  type SupportedLocale,
} from "@/lib/i18n";
import {
  buildStartPageSurfaceBackgroundStyle,
  getStartPageBackgroundBaseColor,
  loadStartPageBackgroundImageMetrics,
  type StartPageBackgroundImageMetrics,
} from "@/lib/start-page-background";
import { usePageLocale } from "@/lib/use-page-locale";
import type {
  AgentSessionEventTriggerSnapshot,
  AgentSessionEventTriggerStatus,
  AgentSessionListItem,
  AgentSessionScheduleSnapshot,
  AgentSessionSnapshot,
  AgentSessionStatus,
  AgentSubAgentDetails,
  AgentSubAgentRunDetail,
  AgentSubAgentRunStatus,
} from "@/types/agent";
import {
  Bookmark,
  Bot,
  Clock,
  Database,
  ExternalLink,
  Globe,
  Grid2x2,
  LayoutGrid,
  MessageSquare,
  Monitor,
  Palette,
  PanelBottom,
  Pause,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Shield,
  ShieldOff,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { AgentMessageMarkdown } from "@/components/agent/agent-message-markdown";
import { AgentSubAgentDetailsBlock, type SubAgentLabelMap } from "@/components/agent/sub-agent-details-block";
import { formatDurationMs, isSameSubAgentDetails } from "@/components/agent/sub-agent-utils";
import {
  parseStartPageProtocolWidgetSource,
  StartPageProtocolWidget,
  type StartPageProtocolWidgetErrorCode,
  type StartPageProtocolWidgetParseResult,
} from "@/components/home/start-page-protocol-widget";

import { NexusHeader, type NexusTab } from "@/components/nexus/NexusHeader";
import { NexusDashboard } from "@/components/nexus/NexusDashboard";
import { NexusAgentView } from "@/components/nexus/NexusAgentView";
import { NexusResearchView } from "@/components/nexus/NexusResearchView";
import { NexusWorkflowsView } from "@/components/nexus/NexusWorkflowsView";
import { NexusMemoryView } from "@/components/nexus/NexusMemoryView";
import { NexusSkillsView } from "@/components/nexus/NexusSkillsView";
import { NexusApprovalsView } from "@/components/nexus/NexusApprovalsView";
import { NexusApprovalsBanner } from "@/components/nexus/NexusApprovalsBanner";
import { NexusActivityView } from "@/components/nexus/NexusActivityView";
import { NexusSettingsView } from "@/components/nexus/NexusSettingsView";
import { NexusAuthModal } from "@/components/nexus/NexusAuthModal";
import { NexusBrowserHome } from "@/components/nexus/NexusBrowserHome";
import { NexusBrowserView } from "@/components/nexus/NexusBrowserView";
import { NexusIntelligencePanel } from "@/components/nexus/NexusIntelligencePanel";
import { NexusCommandPalette } from "@/components/nexus/NexusCommandPalette";
import { NexusActionBar } from "@/components/nexus/NexusActionBar";
import { nexusClient } from "@/lib/nexus/nexus-client";
import { nexusWs } from "@/lib/nexus/nexus-ws";

const STORAGE_KEY = "milo_start_page";
const SETTINGS_STORAGE_KEY = "milo.settings.v1";
const REORDER_THRESHOLD = 4;
const AGENT_CHAT_AUTO_SCROLL_THRESHOLD = 150;
const SEARCH_WIDTH_MIN = 320;
const SEARCH_WIDTH_MAX = 980;
const DEFAULT_SEARCH_WIDTH = 680;
const WIDGET_GRID_COLUMNS = 12;
const WIDGET_GRID_GAP = 12;
const WIDGET_GRID_MOVE_THRESHOLD = 4;
const WIDGET_GRID_MIN_SPAN = 2;
const WIDGET_GRID_DEFAULT_SPAN = 3;
const WIDGET_GRID_SCAN_LIMIT = 96;
const BACKGROUND_IMAGE_MAX_EDGE = 1920;
const BACKGROUND_IMAGE_OUTPUT_QUALITIES = [0.82, 0.72, 0.64] as const;
const MAX_BACKGROUND_IMAGE_DATA_URL_LENGTH = 3_200_000;
const LAUNCHPAD_FAVICON_PERSIST_DEBOUNCE_MS = 180;
const LAUNCHPAD_FAVICON_PREFETCH_CONCURRENCY = 6;
const LEGACY_WIKIPEDIA_WIDGET_ID = "embed-1";
const LEGACY_WIKIPEDIA_WIDGET_URL = "https://en.wikipedia.org/wiki/Main_Page";
const HOME_PAGE_URL = "milo://home";
const AGENT_PAGE_URL = "milo://agent";
const TASKS_PAGE_URL = "milo://tasks/";
const WIDGETS_PAGE_URL = "milo://widgets";

const messages = {
  "en-US": {
    pageTitle: "Milo",
    editLayout: "Edit Layout",
    done: "Done",
    searchPlaceholder: "Search, ask, or enter a URL...",
    agentSearchPlaceholder: "Tell Milo what to do across the web...",
    footerTip: "Ctrl/Cmd + T or N New tab · Edit: drag to reorder, arrows to rearrange",
    modeLabel: "Mode",
    modeNormal: "Normal",
    modeAgent: "Send to Milo",
    modeNormalHint: "Open links or run a normal search immediately.",
    modeAgentHint: "Hand the intent to Milo's agent workspace and switch there.",
    modeSwitchToNormal: "Switch to normal mode",
    modeSwitchToAgent: "Switch to Agent mode",
    agentPrivacyModeEnable: "Enable privacy mode",
    agentPrivacyModeDisable: "Disable privacy mode",
    agentPrivacyModeLocked: "Privacy mode is fixed when a task is created",
    modeAgentResume: "Task Manager",
    send: "Send",
    agentKicker: "Milo Agent Workspace",
    agentTitle: "AI Native Task Console",
    agentSubtitle: "Turn browser intent into supervised autonomous web work.",
    agentThreadTitle: "Task Thread",
    agentSummaryTitle: "Agent Context",
    agentSummaryEmpty: "No task has been sent yet.",
    agentStatusIdle: "Idle",
    agentStatusRunning: "Running",
    agentStatusWaitingEvent: "Waiting",
    agentStatusQueued: "Queued",
    agentStatusError: "Error",
    agentStatusInterrupted: "Interrupted",
    agentUserLabel: "You",
    agentAssistantLabel: "Milo",
    agentSystemLabel: "System",
    agentThinkingLabel: "Thinking",
    agentSubAgentDetailsTitle: "Sub-agent details",
    agentSubAgentTaskLabel: "Task",
    agentSubAgentExtractionLabel: "Extraction",
    agentSubAgentBookmarkLabel: "Bookmark organizer",
    agentSubAgentImageLabel: "Image recognition",
    agentSubAgentUserScriptLabel: "User script",
    agentSubAgentWidgetBuilderLabel: "Widget builder",
    agentSubAgentStatusPending: "Pending",
    agentSubAgentStatusRunning: "Running",
    agentSubAgentStatusCompleted: "Completed",
    agentSubAgentStatusNeedsUser: "Needs user",
    agentSubAgentStatusBlocked: "Blocked",
    agentSubAgentStatusFailed: "Failed",
    agentSubAgentStatusCancelled: "Cancelled",
    agentSubAgentStarted: "Started",
    agentSubAgentFinished: "Finished",
    agentSubAgentTab: "Tab",
    agentSubAgentWindow: "Window",
    agentSubAgentStartUrl: "Start URL",
    agentSubAgentConflictPolicy: "Policy",
    agentSubAgentResourceKey: "Resource",
    agentSubAgentSummary: "Summary",
    agentSubAgentNextStep: "Next step",
    agentSubAgentError: "Error",
    agentSubAgentSteps: "Steps",
    agentSubAgentResult: "Result",
    agentSubAgentDuration: "Duration",
    agentNewTask: "Send another task",
    agentTaskManagerTitle: "Task Manager",
    agentTaskManagerSubtitle:
      "Review active runs, reopen paused tasks, or delete stale threads.",
    agentTaskManagerBack: "Back to Agent",
    agentTaskManagerOpen: "Open",
    agentTaskManagerInterrupt: "Interrupt",
    agentTaskManagerResume: "Resume",
    agentTaskManagerDelete: "Delete",
    agentTaskManagerDeleteConfirm: "Are you sure you want to delete this task? This action cannot be undone.",
    agentTaskManagerTriggerLastTrigger: "Last trigger",
    agentTaskManagerTriggerStatusTriggered: "Triggered",
    agentTaskManagerTriggerStatusSkipped: "Skipped",
    agentTaskManagerTriggerStatusFailed: "Failed",
    agentTaskManagerEventTrigger: "Event Trigger",
    agentTaskManagerEventChannels: "Channels",
    agentTaskManagerEventMatcher: "Matcher",
    agentTaskManagerEventAwaitWindow: "Wait window",
    agentTaskManagerEventCooldown: "Cooldown",
    agentTaskManagerEventLastEvent: "Last event",
    agentTaskManagerEventAnyMatch: "Any matching event",
    agentOpenWorkspaceWindow: "Open Milo Window",
    agentOpenWorkspaceWindowFailed: "Failed to open the Milo automation window.",
    agentTaskManagerCurrent: "Current",
    agentTaskManagerUpdated: "Updated",
    agentTaskManagerMessages: "messages",
    agentTaskManagerSession: "Session",
    agentTaskManagerEmptyTitle: "No Milo tasks yet",
    agentTaskManagerEmptySubtitle:
      "Tasks created from the start page or Milo agent workspace will appear here.",
    agentContextTab: "Active context",
    agentContextSessions: "Automation sessions",
    agentContextSubscriptions: "Event subscriptions",
    agentContextEvents: "Recent events",
    agentContextBackend: "Backend",
    agentContextUnavailable: "Unavailable",
    agentLearningTitle: "Learned Behavior",
    agentLearningUpdated: "Updated",
    agentLearningEmpty: "No learned behavior has been captured for this context yet.",
    agentLearningEpisodes: "Episodes",
    agentLearningPatterns: "Guidance",
    agentLearningRecentPatternsTitle: "Behavior guidance",
    agentThreadEmpty: "Milo is ready. Send a task from the start page.",
    agentLatestErrorTitle: "Latest error",
    agentEmptyTitle: "Milo Command Center",

    agentSuggestion1: "Research a market and compare sources",
    agentSuggestion2: "Automate a search for open source projects",
    agentSuggestion3: "Monitor price changes for a product",
    agentSuggestion4: "Organize my tabs, bookmarks, and downloads",
    agentSuggestion5: "Build a start page widget for a recurring workflow",
    agentInputPlaceholder: "Describe the web outcome you want...",
    agentWebAccess: "Live Web",
    agentLogicEngine: "Reasoning",
    agentResetSession: "New Task",
    agentExecuting: "Executing reasoning chain...",
    agentWaitingEvent: "Waiting for a browser event...",
    agentWaiting: "Waiting for instructions...",
    agentQueued: "Queued behind the current run...",
    agentInterrupted: "Task paused. Resume it from the task manager or continue here.",
    agentErrorState: "Last run failed. Review the error and continue when ready.",
    agentOpenTaskManager: "Task Manager",
    agentRecentEventsTitle: "Recent Events",
    agentNoEvents: "No events recorded yet...",
    agentBackendEngine: "Backend Engine",
    agentBackendDesc: "Reasoning model tuned for planning, tool use, and browser operation.",
    agentProTipTitle: "Milo Tip",
    agentProTip: 'Start with "Automate" to let Milo plan and run a multi-step web workflow.',
    addWidgetTitle: "Add widget",
    addMenuEmbed: "Embed",
    addMenuProtocol: "Protocol",
    addMenuNotes: "Notes",
    launchpadBtnTitle: "Launchpad",
    launchpadTitle: "Launchpad",
    launchpadSubtitle: "A full-screen bookmark launcher inspired by macOS.",
    launchpadSearchPlaceholder: "Search bookmarks",
    launchpadUnsorted: "Unsorted",
    launchpadEmptyTitle: "No bookmarks yet",
    launchpadEmptyDesc: "Saved bookmarks will appear here.",
    launchpadSearchEmptyTitle: "No matching bookmarks",
    launchpadSearchEmptyDesc: "Try another title, domain, or folder.",
    launchpadFolderRenameHint: "Double-click to rename",
    launchpadFolderRenamePlaceholder: "Folder name",
    launchpadFolderRenameFailed: "Failed to rename folder.",
    launchpadBookmarkRemoveFailed: "Failed to remove bookmark.",
    launchpadBookmarkMoveFailed: "Failed to move bookmark.",
    dockTheme: "Theme",
    themeBtnTitle: "Change theme",
    customizeBtnTitle: "Start Page Settings",
    resetBtnTitle: "Reset to defaults",
    addEmbedTitle: "Add Embed",
    addProtocolTitle: "Add Protocol Widget",
    embedTitleLabel: "Title",
    embedTitlePlaceholder: "Example Site",
    embedUrlLabel: "URL",
    embedUrlPlaceholder: "https://example.com",
    protocolSourceLabel: "Protocol URL",
    protocolSourcePlaceholder: "widget://clock?refresh=1s",
    protocolSourceHint:
      "Examples: widget://iframe#https://example.com · widget://package/hello-snapshot · widget://dev/local-demo?entry=http://127.0.0.1:5175/widget.html · widget://clock?refresh=1s",
    protocolPackagesTitle: "Installed widget packages",
    protocolPackagesDesc: "Click a package to fill its protocol source.",
    protocolPackagesLoading: "Loading widget packages...",
    protocolPackageEmpty: "No local widget packages installed yet.",
    protocolPackageUse: "Use package",
    installWidgetPackage: "Install widget package",
    installWidgetPackageBusy: "Installing...",
    installWidgetPackageFailed: "Failed to install the widget package.",
    installWidgetPackageReplaceConfirm:
      "Widget package \"{name}\" ({id}) already exists. Replace the installed package with this folder?",
    openWidgetDirectory: "Open widgets folder",
    openWidgetDirectoryFailed: "Unable to open the widgets folder.",
    manageWidgetPackages: "Manage widget packages",
    openWidgetManagerFailed: "Unable to open the widget packages page.",
    cancel: "Cancel",
    add: "Add",
    customizeTitle: "Start Page Settings",
    settingsGeneral: "General",
    settingsGeneralDesc: "Search behavior and basic start page modules.",
    settingsAppearance: "Appearance",
    settingsAppearanceDesc: "Theme, date display, and clock presentation.",
    settingsDock: "Dock",
    settingsDockDesc: "Manage pinned shortcuts and Dock behavior.",
    settingsData: "Data",
    settingsDataDesc: "Reset preferences, widgets, and saved Dock items.",
    settingsClose: "Close",
    settingsSectionSummary: "Only affects the current start page.",
    generalModulesTitle: "Modules",
    generalModulesDesc: "Toggle the core blocks shown on the start page.",
    generalSearchTitle: "Search",
    generalSearchDesc: "Configure the search field and its default behavior.",
    appearanceThemeTitle: "Theme",
    appearanceThemeDesc: "Choose the background style for the start page.",
    appearanceBackgroundTitle: "Background image",
    appearanceBackgroundDesc: "Upload a custom image and layer it over the selected theme.",
    appearanceBackgroundHint:
      "Images are compressed and saved locally on this device. A wide image works best.",
    appearanceBackgroundEmpty: "No custom background image selected.",
    appearanceBackgroundActive: "Custom background image enabled.",
    appearanceBackgroundUpload: "Upload image",
    appearanceBackgroundReplace: "Replace image",
    appearanceBackgroundRemove: "Remove image",
    appearanceBackgroundProcessing: "Processing...",
    appearanceBackgroundUploadError:
      "This image could not be saved. Try a smaller file or a more common format.",
    appearanceClockTitle: "Clock",
    appearanceClockDesc: "Adjust how time and date appear on the start page.",
    dockManageTitle: "Pinned items",
    dockManageDesc: "Pages added from the page or tab context menu appear here.",
    dockEmptyTitle: "No Dock items yet",
    dockEmptyDesc: "Use “Add to Dock” from a tab or page context menu to pin shortcuts here.",
    dockClearAll: "Clear Dock",
    dockOpenItem: "Open",
    dataOverviewTitle: "Data overview",
    dataOverviewDesc: "Review the current start page footprint before resetting.",
    dataWidgetsCount: "Widgets",
    dataDockCount: "Dock Items",
    dataThemeValue: "Theme",
    dataActionsTitle: "Reset actions",
    dataActionsDesc: "Use targeted reset actions before falling back to a full reset.",
    dataResetPreferences: "Restore preferences",
    dataResetPreferencesDesc: "Reset general and appearance options to their defaults.",
    dataResetWidgets: "Restore widgets",
    dataResetWidgetsDesc: "Reset the homepage widgets to the default layout.",
    dataResetAll: "Reset all start page data",
    dataResetAllDesc: "Clear Dock items and widgets, then restore the default start page.",
    showTime: "Show time",
    showDate: "Show date",
    showSeconds: "Show seconds",
    showSearchBox: "Show search box",
    showBottomTip: "Show bottom tip",
    timeFormat: "Time format",
    dateStyle: "Date style",
    timeFormat24: "24-hour",
    timeFormat12: "12-hour",
    dateStyleEnSample: "Tuesday, March 31",
    dateStyleZhSample: "2026年3月31日 周二",
    dateStyleIsoSample: "2026-03-31",
    searchPlaceholderLabel: "Search placeholder",
    searchUrlTemplateLabel: "Search URL template",
    searchUrlTemplatePlaceholder: "https://www.google.com/search?q=%s",
    resizeSearchBox: "Resize search box",
    setWidgetSize: "Set widget size",
    removeWidget: "Remove widget",
    bottomTipLabel: "Bottom tip",
    bottomTipPlaceholder: "Ctrl/Cmd + T or N New tab ...",
    dockRemoveItem: "Remove from Dock",
    apply: "Apply",
    notesTitle: "Notes",
    notesDefaultContent:
      "Welcome to Milo.\n\n- Shape this start page into your AI Native web workspace\n- Add embeds, notes, and widgets from the Dock\n- Turn on layout mode to reorder modules and switch between 1:1, 1:2, 2:1, and 2:2 sizes",
    noUrlProvided: "No URL provided",
    widgetProtocolMissingSource: "No widget protocol source provided",
    widgetProtocolInvalid: "Invalid widget protocol",
    widgetProtocolUnsupported: "Unsupported widget type",
    notesPlaceholder: "Type your notes here...",
    toggleHalf: "Half",
    toggleFull: "Full",
  },
  "zh-CN": {
    pageTitle: "Milo",
    editLayout: "编辑布局",
    done: "完成",
    searchPlaceholder: "搜索、提问或输入 URL...",
    agentSearchPlaceholder: "告诉 Milo 你想在 Web 上完成什么...",
    footerTip: "Ctrl/Cmd + T 或 N 新建标签页 · 编辑模式：拖拽排序，方向键调整位置",
    modeLabel: "模式",
    modeNormal: "普通",
    modeAgent: "交给 Milo",
    modeNormalHint: "直接打开链接，或立刻执行普通搜索。",
    modeAgentHint: "把意图交给 Milo Agent 工作区，并切换过去。",
    modeSwitchToNormal: "切换到普通模式",
    modeSwitchToAgent: "切换到 Agent 模式",
    agentPrivacyModeEnable: "开启隐私模式",
    agentPrivacyModeDisable: "关闭隐私模式",
    agentPrivacyModeLocked: "当前任务的隐私模式在创建时确定",
    modeAgentResume: "任务管理",
    send: "发送",
    agentKicker: "Milo Agent 工作区",
    agentTitle: "AI Native 任务控制台",
    agentSubtitle: "把浏览器里的意图转化为可监督的自主 Web 工作流。",
    agentThreadTitle: "任务线程",
    agentSummaryTitle: "Agent 上下文",
    agentSummaryEmpty: "还没有发送任何任务。",
    agentStatusIdle: "空闲",
    agentStatusRunning: "执行中",
    agentStatusWaitingEvent: "等待事件",
    agentStatusQueued: "排队中",
    agentStatusError: "错误",
    agentStatusInterrupted: "已中断",
    agentUserLabel: "你",
    agentAssistantLabel: "Milo",
    agentSystemLabel: "系统",
    agentThinkingLabel: "思考",
    agentSubAgentDetailsTitle: "子 Agent 详情",
    agentSubAgentTaskLabel: "任务",
    agentSubAgentExtractionLabel: "提取",
    agentSubAgentBookmarkLabel: "书签整理",
    agentSubAgentImageLabel: "图片识别",
    agentSubAgentUserScriptLabel: "UserScript",
    agentSubAgentWidgetBuilderLabel: "小组件构建",
    agentSubAgentStatusPending: "待执行",
    agentSubAgentStatusRunning: "执行中",
    agentSubAgentStatusCompleted: "已完成",
    agentSubAgentStatusNeedsUser: "需要人工",
    agentSubAgentStatusBlocked: "已阻塞",
    agentSubAgentStatusFailed: "失败",
    agentSubAgentStatusCancelled: "已取消",
    agentSubAgentStarted: "开始",
    agentSubAgentFinished: "结束",
    agentSubAgentTab: "标签页",
    agentSubAgentWindow: "窗口",
    agentSubAgentStartUrl: "起始 URL",
    agentSubAgentConflictPolicy: "冲突策略",
    agentSubAgentResourceKey: "资源",
    agentSubAgentSummary: "摘要",
    agentSubAgentNextStep: "下一步",
    agentSubAgentError: "错误",
    agentSubAgentSteps: "步骤",
    agentSubAgentResult: "结果",
    agentSubAgentDuration: "耗时",
    agentNewTask: "继续发起任务",
    agentTaskManagerTitle: "任务管理",
    agentTaskManagerSubtitle: "查看当前任务，处理中断中的执行，或删除不再需要的线程。",
    agentTaskManagerBack: "返回 Agent",
    agentTaskManagerOpen: "打开",
    agentTaskManagerInterrupt: "中断",
    agentTaskManagerResume: "恢复",
    agentTaskManagerDelete: "删除",
    agentTaskManagerDeleteConfirm: "确定要删除此任务吗？此操作无法撤销。",
    agentTaskManagerTriggerLastTrigger: "最近触发",
    agentTaskManagerTriggerStatusTriggered: "已触发",
    agentTaskManagerTriggerStatusSkipped: "已跳过",
    agentTaskManagerTriggerStatusFailed: "触发失败",
    agentTaskManagerEventTrigger: "事件触发器",
    agentTaskManagerEventChannels: "监听通道",
    agentTaskManagerEventMatcher: "匹配条件",
    agentTaskManagerEventAwaitWindow: "等待窗口",
    agentTaskManagerEventCooldown: "冷却时间",
    agentTaskManagerEventLastEvent: "最近事件",
    agentTaskManagerEventAnyMatch: "任意匹配事件",
    agentOpenWorkspaceWindow: "打开 Milo 窗口",
    agentOpenWorkspaceWindowFailed: "打开 Milo 自动化窗口失败。",
    agentTaskManagerCurrent: "当前任务",
    agentTaskManagerUpdated: "更新于",
    agentTaskManagerMessages: "条消息",
    agentTaskManagerSession: "会话",
    agentTaskManagerEmptyTitle: "还没有 Milo 任务",
    agentTaskManagerEmptySubtitle: "从开始页或 Milo Agent 工作区创建的新任务都会出现在这里。",
    agentContextTab: "当前上下文",
    agentContextSessions: "自动化会话",
    agentContextSubscriptions: "事件订阅",
    agentContextEvents: "最近事件",
    agentContextBackend: "后端",
    agentContextUnavailable: "不可用",
    agentLearningTitle: "学习到的行为",
    agentLearningUpdated: "更新于",
    agentLearningEmpty: "当前上下文还没有采集到可用的学习行为。",
    agentLearningEpisodes: "片段",
    agentLearningPatterns: "指导",
    agentLearningRecentPatternsTitle: "行为指导",
    agentThreadEmpty: "Milo 已就绪，请从开始页继续发送任务。",
    agentLatestErrorTitle: "最近错误",
    agentEmptyTitle: "Milo 控制台",

    agentSuggestion1: "研究一个市场并对比多个信息源",
    agentSuggestion2: "自动搜索开源项目",
    agentSuggestion3: "监控某个产品的价格变化",
    agentSuggestion4: "整理我的标签页、书签和下载内容",
    agentSuggestion5: "为一个重复工作流生成起始页小组件",
    agentInputPlaceholder: "描述你想完成的 Web 结果...",
    agentWebAccess: "实时 Web",
    agentLogicEngine: "推理",
    agentResetSession: "新任务",
    agentExecuting: "正在执行推理链...",
    agentWaitingEvent: "正在等待浏览器事件...",
    agentWaiting: "等待指令...",
    agentQueued: "当前任务后排队中...",
    agentInterrupted: "任务已暂停。可在任务管理中恢复，或在这里继续。",
    agentErrorState: "上一次执行失败了。查看错误后继续。",
    agentOpenTaskManager: "任务管理",
    agentRecentEventsTitle: "最近事件",
    agentNoEvents: "暂无事件记录...",
    agentBackendEngine: "后端引擎",
    agentBackendDesc: "面向规划、工具调用和浏览器操作优化的推理模型。",
    agentProTipTitle: "Milo 提示",
    agentProTip: '以“自动化”开头，让 Milo 规划并执行多步骤 Web 工作流。',
    addWidgetTitle: "添加组件",
    addMenuEmbed: "嵌入",
    addMenuProtocol: "协议组件",
    addMenuNotes: "笔记",
    launchpadBtnTitle: "Launchpad 启动台",
    launchpadTitle: "Launchpad",
    launchpadSubtitle: "以接近 macOS 启动台的方式展示你的书签。",
    launchpadSearchPlaceholder: "搜索书签",
    launchpadUnsorted: "未分组",
    launchpadEmptyTitle: "还没有书签",
    launchpadEmptyDesc: "保存书签后，它们会出现在这里。",
    launchpadSearchEmptyTitle: "没有匹配的书签",
    launchpadSearchEmptyDesc: "试试搜索标题、域名或目录。",
    launchpadFolderRenameHint: "双击可重命名",
    launchpadFolderRenamePlaceholder: "目录名称",
    launchpadFolderRenameFailed: "重命名目录失败。",
    launchpadBookmarkRemoveFailed: "移除书签失败。",
    launchpadBookmarkMoveFailed: "移动书签失败。",
    dockTheme: "主题",
    themeBtnTitle: "切换主题",
    customizeBtnTitle: "起始页设置",
    resetBtnTitle: "重置为默认",
    addEmbedTitle: "添加嵌入",
    addProtocolTitle: "添加协议组件",
    embedTitleLabel: "标题",
    embedTitlePlaceholder: "示例站点",
    embedUrlLabel: "URL",
    embedUrlPlaceholder: "https://example.com",
    protocolSourceLabel: "协议地址",
    protocolSourcePlaceholder: "widget://clock?refresh=1s",
    protocolSourceHint:
      "示例：widget://iframe#https://example.com · widget://package/hello-snapshot · widget://dev/local-demo?entry=http://127.0.0.1:5175/widget.html · widget://clock?refresh=1s",
    protocolPackagesTitle: "已安装的小组件包",
    protocolPackagesDesc: "点击包名即可自动填入协议地址。",
    protocolPackagesLoading: "正在加载小组件包...",
    protocolPackageEmpty: "当前还没有安装本地小组件包。",
    protocolPackageUse: "使用这个包",
    installWidgetPackage: "安装小组件包",
    installWidgetPackageBusy: "安装中...",
    installWidgetPackageFailed: "安装小组件包失败。",
    installWidgetPackageReplaceConfirm:
      "已存在同名小组件包“{name}”（{id}）。是否用当前目录覆盖已安装版本？",
    openWidgetDirectory: "打开 widgets 目录",
    openWidgetDirectoryFailed: "无法打开 widgets 目录。",
    manageWidgetPackages: "管理小组件包",
    openWidgetManagerFailed: "无法打开小组件包管理页。",
    cancel: "取消",
    add: "添加",
    customizeTitle: "起始页设置",
    settingsGeneral: "通用设置",
    settingsGeneralDesc: "搜索行为与基础起始页模块。",
    settingsAppearance: "外观设置",
    settingsAppearanceDesc: "主题、日期格式与时钟展示方式。",
    settingsDock: "Dock 设置",
    settingsDockDesc: "管理固定快捷入口与 Dock 内容。",
    settingsData: "数据",
    settingsDataDesc: "重置偏好、组件布局和已保存的 Dock 数据。",
    settingsClose: "关闭",
    settingsSectionSummary: "仅影响当前起始页体验。",
    generalModulesTitle: "模块",
    generalModulesDesc: "控制起始页上显示的核心模块。",
    generalSearchTitle: "搜索",
    generalSearchDesc: "配置搜索框以及默认搜索行为。",
    appearanceThemeTitle: "主题",
    appearanceThemeDesc: "选择起始页背景与整体观感。",
    appearanceBackgroundTitle: "背景图",
    appearanceBackgroundDesc: "上传自定义图片，并叠加到当前主题之上。",
    appearanceBackgroundHint: "图片只会在本机压缩并保存，建议使用横向图片。",
    appearanceBackgroundEmpty: "当前未设置自定义背景图。",
    appearanceBackgroundActive: "已启用自定义背景图。",
    appearanceBackgroundUpload: "上传图片",
    appearanceBackgroundReplace: "更换图片",
    appearanceBackgroundRemove: "移除图片",
    appearanceBackgroundProcessing: "处理中...",
    appearanceBackgroundUploadError: "这张图片暂时无法保存，请换一张更小或更常见格式的图片。",
    appearanceClockTitle: "时钟",
    appearanceClockDesc: "调整时间与日期在起始页上的展示方式。",
    dockManageTitle: "固定项目",
    dockManageDesc: "从标签页或网页右键菜单添加的项目会出现在这里。",
    dockEmptyTitle: "还没有 Dock 项目",
    dockEmptyDesc: "在标签页或页面右键菜单中使用“添加到 Dock 栏”即可固定快捷入口。",
    dockClearAll: "清空 Dock",
    dockOpenItem: "打开",
    dataOverviewTitle: "数据概览",
    dataOverviewDesc: "在执行重置前查看当前起始页的数据状态。",
    dataWidgetsCount: "组件数量",
    dataDockCount: "Dock 项目",
    dataThemeValue: "当前主题",
    dataActionsTitle: "重置操作",
    dataActionsDesc: "可先执行定向重置，再决定是否恢复全部起始页数据。",
    dataResetPreferences: "恢复偏好设置",
    dataResetPreferencesDesc: "将通用和外观设置恢复为默认值。",
    dataResetWidgets: "恢复默认组件",
    dataResetWidgetsDesc: "将起始页组件恢复为默认布局。",
    dataResetAll: "重置全部起始页数据",
    dataResetAllDesc: "清空 Dock 与组件内容，并恢复默认起始页。",
    showTime: "显示时间",
    showDate: "显示日期",
    showSeconds: "显示秒数",
    showSearchBox: "显示搜索框",
    showBottomTip: "显示底部提示",
    timeFormat: "时间格式",
    dateStyle: "日期样式",
    timeFormat24: "24 小时制",
    timeFormat12: "12 小时制",
    dateStyleEnSample: "Tuesday, March 31",
    dateStyleZhSample: "2026年3月31日 周二",
    dateStyleIsoSample: "2026-03-31",
    searchPlaceholderLabel: "搜索占位文案",
    searchUrlTemplateLabel: "搜索 URL 模板",
    searchUrlTemplatePlaceholder: "https://www.google.com/search?q=%s",
    resizeSearchBox: "调整搜索框宽度",
    setWidgetSize: "设置组件尺寸",
    removeWidget: "删除组件",
    bottomTipLabel: "底部提示文案",
    bottomTipPlaceholder: "Ctrl/Cmd + T 或 N 新建标签页 ...",
    dockRemoveItem: "从 Dock 移除",
    apply: "应用",
    notesTitle: "笔记",
    notesDefaultContent:
      "欢迎使用 Milo。\n\n- 把这个开始页塑造成你的 AI Native Web 工作空间\n- 可从 Dock 添加嵌入、笔记和小组件\n- 打开布局模式后可拖动排序模块，并切换 1:1、1:2、2:1、2:2 四种尺寸",
    noUrlProvided: "未提供 URL",
    widgetProtocolMissingSource: "未提供小组件协议地址",
    widgetProtocolInvalid: "小组件协议格式无效",
    widgetProtocolUnsupported: "暂不支持这个小组件类型",
    notesPlaceholder: "在这里输入你的笔记...",
    toggleHalf: "半宽",
    toggleFull: "全宽",
  },
} as const;

const themes = [
  {
    id: "default",
    darkGradient:
      "radial-gradient(ellipse at 20% 20%, rgba(251,191,36,0.15), transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(56,189,248,0.12), transparent 50%), radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.08), transparent 60%), linear-gradient(180deg, #090f1e 0%, #04070f 100%)",
    lightGradient:
      "radial-gradient(ellipse at 18% 18%, rgba(251,191,36,0.24), transparent 52%), radial-gradient(ellipse at 82% 20%, rgba(125,211,252,0.26), transparent 50%), radial-gradient(ellipse at 55% 78%, rgba(196,181,253,0.24), transparent 54%), linear-gradient(180deg, #fbfdff 0%, #e8eef7 100%)",
  },
  {
    id: "ocean",
    darkGradient:
      "radial-gradient(ellipse at 30% 40%, rgba(6,182,212,0.18), transparent 50%), radial-gradient(ellipse at 70% 60%, rgba(59,130,246,0.15), transparent 50%), linear-gradient(180deg, #0a1628 0%, #040a14 100%)",
    lightGradient:
      "radial-gradient(ellipse at 26% 34%, rgba(34,211,238,0.22), transparent 52%), radial-gradient(ellipse at 76% 64%, rgba(96,165,250,0.24), transparent 52%), linear-gradient(180deg, #f5fbff 0%, #dcecfb 100%)",
  },
  {
    id: "aurora",
    darkGradient:
      "radial-gradient(ellipse at 20% 30%, rgba(16,185,129,0.18), transparent 50%), radial-gradient(ellipse at 80% 70%, rgba(139,92,246,0.15), transparent 50%), radial-gradient(ellipse at 50% 90%, rgba(56,189,248,0.1), transparent 40%), linear-gradient(180deg, #091a14 0%, #040a0f 100%)",
    lightGradient:
      "radial-gradient(ellipse at 22% 28%, rgba(52,211,153,0.2), transparent 52%), radial-gradient(ellipse at 80% 68%, rgba(167,139,250,0.2), transparent 50%), radial-gradient(ellipse at 46% 88%, rgba(125,211,252,0.18), transparent 42%), linear-gradient(180deg, #f6fffb 0%, #e5eef6 100%)",
  },
  {
    id: "sunset",
    darkGradient:
      "radial-gradient(ellipse at 30% 20%, rgba(251,146,60,0.18), transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(244,63,94,0.15), transparent 50%), linear-gradient(180deg, #1a0f0a 0%, #0f0805 100%)",
    lightGradient:
      "radial-gradient(ellipse at 26% 18%, rgba(251,146,60,0.22), transparent 52%), radial-gradient(ellipse at 74% 82%, rgba(251,113,133,0.22), transparent 50%), linear-gradient(180deg, #fff8f4 0%, #fde6e8 100%)",
  },
  {
    id: "midnight",
    darkGradient:
      "radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.1), transparent 60%), linear-gradient(180deg, #0c0a1a 0%, #050410 100%)",
    lightGradient:
      "radial-gradient(ellipse at 48% 42%, rgba(129,140,248,0.18), transparent 58%), radial-gradient(ellipse at 78% 76%, rgba(148,163,184,0.16), transparent 48%), linear-gradient(180deg, #f7f8ff 0%, #e7ebf7 100%)",
  },
] as const;

type StartPageTheme = (typeof themes)[number];

function getResolvedThemeMode(): "light" | "dark" {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function getThemeGradient(theme: StartPageTheme, isLight: boolean) {
  return isLight ? theme.lightGradient : theme.darkGradient;
}

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekdaysZh = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WIDGET_SIZE_OPTIONS = [
  { gridH: 3, gridW: 3, label: "1:1", value: "1x1" },
  { gridH: 6, gridW: 3, label: "1:2", value: "1x2" },
  { gridH: 3, gridW: 6, label: "2:1", value: "2x1" },
  { gridH: 6, gridW: 6, label: "2:2", value: "2x2" },
] as const;

type MessageKey = keyof (typeof messages)["en-US"];
type ThemeId = (typeof themes)[number]["id"];
type WidgetSize = (typeof WIDGET_SIZE_OPTIONS)[number]["value"];
type SearchMode = "normal" | "agent";
type SurfaceView = "start" | "agent" | "tasks";
type StartPageSettingsSection = "general" | "appearance" | "dock" | "data";
type WidgetInteractionMode = "move" | "resize";
type SurfaceItemId = "clock" | "search" | string;

function SubAgentLabels({ locale, t }: { locale: SupportedLocale; t: (key: MessageKey) => string }): SubAgentLabelMap {
  return {
    detailsTitle: t("agentSubAgentDetailsTitle"),
    taskLabel: t("agentSubAgentTaskLabel"),
    extractionLabel: t("agentSubAgentExtractionLabel"),
    bookmarkLabel: t("agentSubAgentBookmarkLabel"),
    imageLabel: t("agentSubAgentImageLabel"),
    userScriptLabel: t("agentSubAgentUserScriptLabel"),
    widgetBuilderLabel: t("agentSubAgentWidgetBuilderLabel"),
    statusPending: t("agentSubAgentStatusPending"),
    statusRunning: t("agentSubAgentStatusRunning"),
    statusCompleted: t("agentSubAgentStatusCompleted"),
    statusNeedsUser: t("agentSubAgentStatusNeedsUser"),
    statusBlocked: t("agentSubAgentStatusBlocked"),
    statusFailed: t("agentSubAgentStatusFailed"),
    statusCancelled: t("agentSubAgentStatusCancelled"),
    started: t("agentSubAgentStarted"),
    finished: t("agentSubAgentFinished"),
    duration: t("agentSubAgentDuration"),
    tab: t("agentSubAgentTab"),
    window: t("agentSubAgentWindow"),
    startUrl: t("agentSubAgentStartUrl"),
    conflictPolicy: t("agentSubAgentConflictPolicy"),
    resourceKey: t("agentSubAgentResourceKey"),
    summary: t("agentSubAgentSummary"),
    nextStep: t("agentSubAgentNextStep"),
    error: t("agentSubAgentError"),
    steps: t("agentSubAgentSteps"),
    result: t("agentSubAgentResult"),
  };
}

interface WidgetRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

interface SurfaceBlockLayout {
  gridH: number;
  gridW: number;
  gridX: number;
  gridY: number;
}

interface LayoutOccupancyEntry {
  id: SurfaceItemId;
  rect: WidgetRect;
}

interface WidgetBase {
  gridH: number;
  gridW: number;
  gridX: number;
  gridY: number;
  id: string;
  title: string;
}

interface EmbedWidget extends WidgetBase {
  type: "embed";
  url: string;
}

interface ProtocolWidget extends WidgetBase {
  source: string;
  type: "protocol";
}

interface NotesWidget extends WidgetBase {
  content: string;
  type: "notes";
}

type Widget = EmbedWidget | ProtocolWidget | NotesWidget;

interface Customization {
  clockLayout: SurfaceBlockLayout;
  dateStyle: "en" | "zh" | "iso";
  footerTip: string;
  searchBaseUrl: string;
  searchLayout: SurfaceBlockLayout;
  searchPlaceholder: string;
  searchWidth: number;
  showClock: boolean;
  showDate: boolean;
  showFooter: boolean;
  showSearch: boolean;
  showSeconds: boolean;
  timeFormat: "24h" | "12h";
}

interface HomeSettings {
  backgroundImage: string | null;
  customization: Customization;
  theme: ThemeId;
  widgets: Widget[];
}

interface EmbedFormState {
  title: string;
  url: string;
}

interface ProtocolWidgetFormState {
  source: string;
  title: string;
}

interface StartPageDockItem {
  createdAt: number;
  favicon?: string;
  id: string;
  title: string;
  url: string;
}

interface DockItemMenuState {
  itemId: string;
  x: number;
  y: number;
}

interface LaunchpadBookmarkSnapshot {
  favicon?: string;
  folderId: string | null;
  id: string;
  title: string;
  url: string;
}

type LaunchpadDropTarget =
  | { kind: "folder"; folderId: string }
  | { kind: "root" };

interface LaunchpadDragState extends LaunchpadBookmarkSnapshot {
  currentX: number;
  currentY: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  sourceFolderId: string | null;
}

type LaunchpadPointerDownState =
  | {
      kind: "bookmark";
      bookmark: LaunchpadBookmarkSnapshot;
      offsetX: number;
      offsetY: number;
      pointerId: number;
      sourceFolderId: string | null;
      startX: number;
      startY: number;
    }
  | {
      kind: "folder";
      folderId: string;
      pointerId: number;
      startX: number;
      startY: number;
    };

interface WidgetInteractionState {
  isActive: boolean;
  mode: WidgetInteractionMode;
  previewRect: WidgetRect;
  startClientX: number;
  startClientY: number;
  startRect: WidgetRect;
  widgetId: SurfaceItemId;
}

interface WidgetGridMetrics {
  cellSize: number;
  pitch: number;
}

interface WidgetDraftState {
  rect: WidgetRect;
  widgetId: SurfaceItemId;
}

interface WidgetPlacementDraft {
  explicitPosition: boolean;
  rect: WidgetRect;
}

interface WidgetNormalizedResult {
  explicitPosition: boolean;
  widget: Widget;
}

interface HomePageProps {
  pageMode?: SurfaceView;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThemeId(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

function sanitizeBackgroundImage(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue.startsWith("data:image/")) {
    return null;
  }

  return normalizedValue.length <= MAX_BACKGROUND_IMAGE_DATA_URL_LENGTH
    ? normalizedValue
    : null;
}

function getScaledImageDimensions(width: number, height: number, maxEdge: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { height: 1, width: 1 };
  }

  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return {
      height: Math.max(1, Math.round(height)),
      width: Math.max(1, Math.round(width)),
    };
  }

  const scale = maxEdge / longestEdge;
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}

async function serializeBackgroundImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Invalid file type.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const { width, height } = getScaledImageDimensions(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      BACKGROUND_IMAGE_MAX_EDGE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable.");
    }

    context.drawImage(image, 0, 0, width, height);

    for (const quality of BACKGROUND_IMAGE_OUTPUT_QUALITIES) {
      const candidate = sanitizeBackgroundImage(canvas.toDataURL("image/webp", quality));
      if (candidate) {
        return candidate;
      }
    }

    const fallback = sanitizeBackgroundImage(canvas.toDataURL("image/jpeg", 0.78));
    if (fallback) {
      return fallback;
    }

    throw new Error("Image export exceeded the storage budget.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function createWidgetId(prefix: Widget["type"]) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clampSearchWidth(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SEARCH_WIDTH;
  }

  return Math.min(SEARCH_WIDTH_MAX, Math.max(SEARCH_WIDTH_MIN, Math.round(value)));
}

function clampWidgetGridSpan(value: number, max = WIDGET_GRID_COLUMNS) {
  if (!Number.isFinite(value)) {
    return Math.min(max, WIDGET_GRID_DEFAULT_SPAN);
  }

  return Math.min(max, Math.max(WIDGET_GRID_MIN_SPAN, Math.round(value)));
}

function clampWidgetCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function clampWidgetRect(rect: WidgetRect): WidgetRect {
  const w = clampWidgetGridSpan(rect.w, WIDGET_GRID_COLUMNS);
  const h = clampWidgetGridSpan(rect.h, WIDGET_GRID_SCAN_LIMIT);
  const x = Math.min(WIDGET_GRID_COLUMNS - w, clampWidgetCoordinate(rect.x));
  const y = clampWidgetCoordinate(rect.y);

  return {
    h,
    w,
    x,
    y,
  };
}

function getWidgetRect(widget: Pick<WidgetBase, "gridH" | "gridW" | "gridX" | "gridY">): WidgetRect {
  return {
    h: widget.gridH,
    w: widget.gridW,
    x: widget.gridX,
    y: widget.gridY,
  };
}

function isSameWidgetRect(left: WidgetRect, right: WidgetRect) {
  return left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

function applyWidgetRect<T extends Widget>(widget: T, rect: WidgetRect): T {
  return {
    ...widget,
    gridH: rect.h,
    gridW: rect.w,
    gridX: rect.x,
    gridY: rect.y,
  };
}

function getSurfaceBlockRect(layout: SurfaceBlockLayout): WidgetRect {
  return {
    h: layout.gridH,
    w: layout.gridW,
    x: layout.gridX,
    y: layout.gridY,
  };
}

function applySurfaceBlockRect(layout: SurfaceBlockLayout, rect: WidgetRect): SurfaceBlockLayout {
  return {
    ...layout,
    gridH: rect.h,
    gridW: rect.w,
    gridX: rect.x,
    gridY: rect.y,
  };
}

function createDefaultClockLayout(): SurfaceBlockLayout {
  return {
    gridH: 4,
    gridW: 6,
    gridX: 3,
    gridY: 0,
  };
}

function createDefaultSearchLayout(searchWidth = DEFAULT_SEARCH_WIDTH): SurfaceBlockLayout {
  const defaultWidth = clampWidgetGridSpan(
    Math.round((searchWidth / DEFAULT_SEARCH_WIDTH) * 8),
    WIDGET_GRID_COLUMNS,
  );
  return {
    gridH: 2,
    gridW: defaultWidth,
    gridX: Math.max(0, Math.floor((WIDGET_GRID_COLUMNS - defaultWidth) / 2)),
    gridY: 4,
  };
}

function normalizeSurfaceBlockLayout(
  raw: unknown,
  fallback: SurfaceBlockLayout,
): SurfaceBlockLayout {
  if (!isPlainObject(raw)) {
    return fallback;
  }

  return applySurfaceBlockRect(fallback, clampWidgetRect({
    h: typeof raw.gridH === "number" ? raw.gridH : fallback.gridH,
    w: typeof raw.gridW === "number" ? raw.gridW : fallback.gridW,
    x: typeof raw.gridX === "number" ? raw.gridX : fallback.gridX,
    y: typeof raw.gridY === "number" ? raw.gridY : fallback.gridY,
  }));
}

function getWidgetPresetSize(
  widget: Pick<WidgetBase, "gridH" | "gridW">,
): WidgetSize | null {
  return WIDGET_SIZE_OPTIONS.find((option) =>
    option.gridW === widget.gridW && option.gridH === widget.gridH)?.value ?? null;
}

function getWidgetSizeOption(size: WidgetSize) {
  return WIDGET_SIZE_OPTIONS.find((option) => option.value === size) ?? WIDGET_SIZE_OPTIONS[0];
}

function getNextWidgetSize(widget: Pick<WidgetBase, "gridH" | "gridW">): WidgetSize {
  const currentSize = getWidgetPresetSize(widget);
  const currentIndex = currentSize
    ? WIDGET_SIZE_OPTIONS.findIndex((option) => option.value === currentSize)
    : -1;
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % WIDGET_SIZE_OPTIONS.length;
  return WIDGET_SIZE_OPTIONS[nextIndex]!.value;
}

function createWidgetRectFromSize(
  size: WidgetSize,
  origin: Pick<WidgetRect, "x" | "y"> = { x: 0, y: 0 },
): WidgetRect {
  const nextSize = getWidgetSizeOption(size);
  return clampWidgetRect({
    h: nextSize.gridH,
    w: nextSize.gridW,
    x: origin.x,
    y: origin.y,
  });
}

function doWidgetRectsOverlap(left: WidgetRect, right: WidgetRect) {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

function isLayoutRectAvailable(
  entries: readonly LayoutOccupancyEntry[],
  rect: WidgetRect,
  ignoreId?: SurfaceItemId,
) {
  return entries.every((entry) => {
    if (entry.id === ignoreId) {
      return true;
    }

    return !doWidgetRectsOverlap(rect, entry.rect);
  });
}

function findFirstAvailableLayoutRect(
  entries: readonly LayoutOccupancyEntry[],
  width: number,
  height: number,
): WidgetRect {
  const w = clampWidgetGridSpan(width, WIDGET_GRID_COLUMNS);
  const h = clampWidgetGridSpan(height, WIDGET_GRID_SCAN_LIMIT);

  for (let y = 0; y < WIDGET_GRID_SCAN_LIMIT; y += 1) {
    for (let x = 0; x <= WIDGET_GRID_COLUMNS - w; x += 1) {
      const rect = { h, w, x, y };
      if (isLayoutRectAvailable(entries, rect)) {
        return rect;
      }
    }
  }

  const fallbackY = entries.reduce(
    (max, entry) => Math.max(max, entry.rect.y + entry.rect.h),
    0,
  );
  return { h, w, x: 0, y: fallbackY };
}

function isWidgetRectAvailable(
  widgets: readonly Widget[],
  rect: WidgetRect,
  ignoreWidgetId?: string,
) {
  return isLayoutRectAvailable(
    widgets.map((widget) => ({ id: widget.id, rect: getWidgetRect(widget) })),
    rect,
    ignoreWidgetId,
  );
}

function findFirstAvailableWidgetRect(
  widgets: readonly Widget[],
  width: number,
  height: number,
): WidgetRect {
  return findFirstAvailableLayoutRect(
    widgets.map((widget) => ({ id: widget.id, rect: getWidgetRect(widget) })),
    width,
    height,
  );
}

function getWidgetGridLabel(widget: Pick<WidgetBase, "gridH" | "gridW">) {
  return `${widget.gridW}x${widget.gridH}`;
}

function getVisibleChromeLayoutEntries(
  customization: Pick<Customization, "clockLayout" | "searchLayout" | "showClock" | "showSearch">,
): LayoutOccupancyEntry[] {
  const entries: LayoutOccupancyEntry[] = [];

  if (customization.showClock) {
    entries.push({
      id: "clock",
      rect: getSurfaceBlockRect(customization.clockLayout),
    });
  }

  if (customization.showSearch) {
    entries.push({
      id: "search",
      rect: getSurfaceBlockRect(customization.searchLayout),
    });
  }

  return entries;
}

function getOccupiedLayoutEntries(
  customization: Pick<Customization, "clockLayout" | "searchLayout" | "showClock" | "showSearch">,
  widgets: readonly Widget[],
): LayoutOccupancyEntry[] {
  return [
    ...getVisibleChromeLayoutEntries(customization),
    ...widgets.map((widget) => ({
      id: widget.id,
      rect: getWidgetRect(widget),
    })),
  ];
}

function resolveCustomizationLayouts(customization: Customization): Customization {
  let nextCustomization = {
    ...customization,
    clockLayout: normalizeSurfaceBlockLayout(customization.clockLayout, createDefaultClockLayout()),
    searchLayout: normalizeSurfaceBlockLayout(customization.searchLayout, createDefaultSearchLayout(customization.searchWidth)),
  };

  if (nextCustomization.showClock && nextCustomization.showSearch) {
    const clockRect = getSurfaceBlockRect(nextCustomization.clockLayout);
    const searchRect = getSurfaceBlockRect(nextCustomization.searchLayout);
    if (doWidgetRectsOverlap(clockRect, searchRect)) {
      nextCustomization = {
        ...nextCustomization,
        searchLayout: applySurfaceBlockRect(
          nextCustomization.searchLayout,
          findFirstAvailableLayoutRect([{ id: "clock", rect: clockRect }], searchRect.w, searchRect.h),
        ),
      };
    }
  }

  return nextCustomization;
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function buildDockFallbackLabel(title: string, url: string) {
  const trimmedTitle = title.trim();
  const source = trimmedTitle || url;

  if (!source) {
    return "?";
  }

  const alphanumeric = Array.from(source)
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .slice(0, 2)
    .join("");

  if (alphanumeric) {
    return alphanumeric.toUpperCase();
  }

  return source.slice(0, 1).toUpperCase();
}

function buildDockFallbackStyle(seed: string) {
  const hue = hashString(seed || "dock") % 360;
  const nextHue = (hue + 32) % 360;

  return {
    background:
      `linear-gradient(145deg, hsla(${hue}, 82%, 64%, 0.96), hsla(${nextHue}, 84%, 56%, 0.88))`,
  };
}

const dockResolvedFaviconCache = new Map<string, string>();
const dockPersistingFaviconKeys = new Set<string>();

function getDockFaviconCacheKey(url: string) {
  return url.trim().toLowerCase();
}

function getCachedDockFavicon(cacheKey: string, favicon?: string) {
  const normalizedFavicon =
    typeof favicon === "string" && favicon.trim()
      ? favicon.trim()
      : null;

  if (normalizedFavicon) {
    dockResolvedFaviconCache.set(cacheKey, normalizedFavicon);
    return normalizedFavicon;
  }

  return dockResolvedFaviconCache.get(cacheKey) ?? null;
}

function getUrlHostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function isPointInsideRect(pointerX: number, pointerY: number, rect: DOMRect) {
  return (
    pointerX >= rect.left
    && pointerX <= rect.right
    && pointerY >= rect.top
    && pointerY <= rect.bottom
  );
}

function buildWebFaviconFallbackUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return new URL("/favicon.ico", parsed.origin).toString();
  } catch {
    return null;
  }
}

function buildAppleTouchIconUrl(url: string, precomposed = false) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return new URL(
      precomposed ? "/apple-touch-icon-precomposed.png" : "/apple-touch-icon.png",
      parsed.origin,
    ).toString();
  } catch {
    return null;
  }
}

function buildGoogleFaviconServiceUrl(url: string, size = 128) {
  try {
    const hostname = new URL(url).hostname;
    if (!hostname) {
      return null;
    }

    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
  } catch {
    return null;
  }
}

function extractFaviconCandidateSizeScore(url: string) {
  let best = 0;
  const normalized = url.toLowerCase();
  const sizePattern = /(\d{2,4})x(\d{2,4})/g;

  for (const match of normalized.matchAll(sizePattern)) {
    const width = Number.parseInt(match[1] ?? "", 10);
    const height = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      continue;
    }

    best = Math.max(best, Math.min(width, height));
  }

  const querySizePattern = /[?&](?:sz|size|width|height|w|h)=(\d{2,4})/g;
  for (const match of normalized.matchAll(querySizePattern)) {
    const size = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(size)) {
      continue;
    }

    best = Math.max(best, size);
  }

  return Math.min(best, 512);
}

function scoreDockFaviconCandidate(url: string) {
  const normalized = url.toLowerCase();
  let score = extractFaviconCandidateSizeScore(normalized);

  if (normalized.endsWith(".svg")) {
    score += 520;
  }

  if (normalized.includes("apple-touch-icon")) {
    score += 420;
  } else if (normalized.includes("android-chrome")) {
    score += 360;
  } else if (normalized.includes("mask-icon") || normalized.includes("mstile")) {
    score += 300;
  }

  if (normalized.includes("google.com/s2/favicons")) {
    score += 140;
  }

  if (normalized.endsWith("/favicon.ico") || normalized.includes("favicon.ico")) {
    score -= 24;
  } else if (normalized.includes("favicon")) {
    score -= 8;
  }

  return score;
}

function buildDockFaviconCandidates(pageUrl: string, favicon?: string) {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const appendCandidate = (value: string | null | undefined) => {
    if (!value) {
      return;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push(normalized);
  };

  appendCandidate(favicon);
  appendCandidate(buildAppleTouchIconUrl(pageUrl));
  appendCandidate(buildAppleTouchIconUrl(pageUrl, true));
  appendCandidate(buildGoogleFaviconServiceUrl(pageUrl));
  appendCandidate(buildWebFaviconFallbackUrl(pageUrl));

  return candidates.sort((left, right) => {
    const scoreDelta = scoreDockFaviconCandidate(right) - scoreDockFaviconCandidate(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    if (favicon && left === favicon) {
      return -1;
    }

    if (favicon && right === favicon) {
      return 1;
    }

    return 0;
  });
}

function resolveDockFaviconCandidateIndex(
  candidates: string[],
  cacheKey: string,
  favicon?: string,
) {
  const cachedFavicon = getCachedDockFavicon(cacheKey, favicon);
  if (!cachedFavicon) {
    return 0;
  }

  const cachedIndex = candidates.indexOf(cachedFavicon);
  return cachedIndex >= 0 ? cachedIndex : 0;
}

function probeImageSource(src: string) {
  return new Promise<boolean>((resolve) => {
    const image = new window.Image();
    let settled = false;

    const finalize = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };

    image.onload = () => {
      finalize(true);
    };
    image.onerror = () => {
      finalize(false);
    };
    image.src = src;
  });
}

async function resolveDockFaviconSource(url: string, favicon?: string) {
  const normalizedFavicon = favicon?.trim();
  const cacheKey = getDockFaviconCacheKey(url);
  const cachedFavicon = getCachedDockFavicon(cacheKey, normalizedFavicon);
  if (cachedFavicon) {
    return cachedFavicon;
  }

  const faviconCandidates = buildDockFaviconCandidates(url, normalizedFavicon);
  for (const candidate of faviconCandidates) {
    if (await probeImageSource(candidate)) {
      dockResolvedFaviconCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  return null;
}

async function persistDockItemFavicon(item: StartPageDockItem, favicon: string) {
  const normalizedFavicon = favicon.trim();
  if (!normalizedFavicon || item.favicon?.trim() === normalizedFavicon) {
    return;
  }

  const browserShell = window.browserShell;
  if (!browserShell?.startPageSetDockItemFavicon) {
    return;
  }

  const persistenceKey = `${item.id}:${normalizedFavicon}`;
  if (dockPersistingFaviconKeys.has(persistenceKey)) {
    return;
  }

  dockPersistingFaviconKeys.add(persistenceKey);
  try {
    await browserShell.startPageSetDockItemFavicon(item.id, normalizedFavicon);
  } catch {
    // Ignore cache write failures and keep the resolved icon in memory.
  } finally {
    dockPersistingFaviconKeys.delete(persistenceKey);
  }
}

function DockItemIcon({ item }: { item: StartPageDockItem }) {
  const normalizedFavicon = item.favicon?.trim();
  const cacheKey = getDockFaviconCacheKey(item.url);
  const faviconCandidates = buildDockFaviconCandidates(item.url, normalizedFavicon);
  const [faviconCandidateIndex, setFaviconCandidateIndex] = useState(() =>
    resolveDockFaviconCandidateIndex(faviconCandidates, cacheKey, normalizedFavicon),
  );
  const faviconSrc = faviconCandidates[faviconCandidateIndex] ?? null;

  useEffect(() => {
    setFaviconCandidateIndex(
      resolveDockFaviconCandidateIndex(faviconCandidates, cacheKey, normalizedFavicon),
    );
  }, [cacheKey, item.id, item.url, normalizedFavicon]);

  if (faviconSrc) {
    return (
      <img
        alt=""
        className="dock-favicon"
        draggable={false}
        onLoad={() => {
          dockResolvedFaviconCache.set(cacheKey, faviconSrc);
          void persistDockItemFavicon(item, faviconSrc);
        }}
        onError={() => {
          if (dockResolvedFaviconCache.get(cacheKey) === faviconSrc) {
            dockResolvedFaviconCache.delete(cacheKey);
          }
          setFaviconCandidateIndex((current) =>
            current < faviconCandidates.length - 1 ? current + 1 : current);
        }}
        src={faviconSrc}
      />
    );
  }

  return (
    <span
      className="dock-fallback"
      style={buildDockFallbackStyle(item.url || item.title)}
    >
      {buildDockFallbackLabel(item.title, item.url)}
    </span>
  );
}

function LaunchpadTileIcon({
  bookmarkId,
  favicon,
  onResolve,
  title,
  url,
}: {
  bookmarkId: string;
  url: string;
  title: string;
  favicon?: string;
  onResolve?: (bookmarkId: string, favicon: string) => void;
}) {
  const normalizedFavicon = favicon?.trim();
  const cacheKey = getDockFaviconCacheKey(url);
  const faviconCandidates = buildDockFaviconCandidates(url, normalizedFavicon);
  const [faviconCandidateIndex, setFaviconCandidateIndex] = useState(() =>
    resolveDockFaviconCandidateIndex(faviconCandidates, cacheKey, normalizedFavicon),
  );
  const faviconSrc = faviconCandidates[faviconCandidateIndex] ?? null;

  useEffect(() => {
    setFaviconCandidateIndex(
      resolveDockFaviconCandidateIndex(faviconCandidates, cacheKey, normalizedFavicon),
    );
  }, [cacheKey, url, normalizedFavicon]);

  if (faviconSrc) {
    return (
      <img
        alt=""
        className="launchpad-item-favicon"
        draggable={false}
        onLoad={() => {
          dockResolvedFaviconCache.set(cacheKey, faviconSrc);
          onResolve?.(bookmarkId, faviconSrc);
        }}
        onError={() => {
          if (dockResolvedFaviconCache.get(cacheKey) === faviconSrc) {
            dockResolvedFaviconCache.delete(cacheKey);
          }
          setFaviconCandidateIndex((current) =>
            current < faviconCandidates.length - 1 ? current + 1 : current);
        }}
        src={faviconSrc}
      />
    );
  }

  return (
    <span
      className="launchpad-item-fallback"
      style={buildDockFallbackStyle(url || title)}
    >
      {buildDockFallbackLabel(title, url)}
    </span>
  );
}

function FolderMiniIcon({
  bookmarkId,
  favicon,
  onResolve,
  title,
  url,
}: {
  bookmarkId: string;
  url: string;
  title: string;
  favicon?: string;
  onResolve?: (bookmarkId: string, favicon: string) => void;
}) {
  const normalizedFavicon = favicon?.trim();
  const cacheKey = getDockFaviconCacheKey(url);
  const faviconCandidates = buildDockFaviconCandidates(url, normalizedFavicon);
  const [faviconCandidateIndex, setFaviconCandidateIndex] = useState(() =>
    resolveDockFaviconCandidateIndex(faviconCandidates, cacheKey, normalizedFavicon),
  );
  const src = faviconCandidates[faviconCandidateIndex] ?? null;

  useEffect(() => {
    setFaviconCandidateIndex(
      resolveDockFaviconCandidateIndex(faviconCandidates, cacheKey, normalizedFavicon),
    );
  }, [cacheKey, url, normalizedFavicon]);

  if (src) {
    return (
      <img
        alt=""
        className="launchpad-folder-mini-favicon"
        onLoad={() => {
          dockResolvedFaviconCache.set(cacheKey, src);
          onResolve?.(bookmarkId, src);
        }}
        draggable={false}
        onError={() => {
          if (dockResolvedFaviconCache.get(cacheKey) === src) {
            dockResolvedFaviconCache.delete(cacheKey);
          }
          setFaviconCandidateIndex((current) =>
            current < faviconCandidates.length - 1 ? current + 1 : current);
        }}
        src={src}
      />
    );
  }

  return (
    <span
      className="launchpad-folder-mini-fallback"
      style={buildDockFallbackStyle(url || title)}
    >
      {buildDockFallbackLabel(title, url).slice(0, 1)}
    </span>
  );
}

function LaunchpadFolderIcon({
  items,
  onResolveFavicon,
}: {
  items: BookmarkRecord[];
  onResolveFavicon?: (bookmarkId: string, favicon: string) => void;
}) {
  const preview = items.slice(0, 4);
  return (
    <span className="launchpad-folder-grid">
      {preview.map((b) => (
        <FolderMiniIcon
          bookmarkId={b.id}
          favicon={b.favicon}
          key={b.id}
          onResolve={onResolveFavicon}
          title={b.title}
          url={b.url}
        />
      ))}
      {preview.length < 4 && Array.from({ length: 4 - preview.length }, (_, i) => (
        <span key={`empty-${i}`} className="launchpad-folder-mini-empty" />
      ))}
    </span>
  );
}

function buildSurfacePageUrl(surface: SurfaceView, sessionId?: string | null) {
  const target = surface === "start"
    ? HOME_PAGE_URL
    : surface === "tasks"
      ? TASKS_PAGE_URL
      : AGENT_PAGE_URL;

  if (!sessionId || surface !== "agent") {
    return target;
  }

  const url = new URL(target);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

function readSessionIdFromLocation() {
  try {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("sessionId")?.trim();
    return sessionId || null;
  } catch {
    return null;
  }
}

function createDefaultCustomization(locale: SupportedLocale): Customization {
  return {
    clockLayout: createDefaultClockLayout(),
    dateStyle: "en",
    footerTip: "",
    searchBaseUrl: "https://www.google.com/search?q=%s",
    searchLayout: createDefaultSearchLayout(),
    searchPlaceholder: messages[locale].searchPlaceholder,
    searchWidth: DEFAULT_SEARCH_WIDTH,
    showClock: true,
    showDate: true,
    showFooter: false,
    showSearch: true,
    showSeconds: false,
    timeFormat: "24h",
  };
}

function createDefaultWidgets(locale: SupportedLocale): Widget[] {
  return [
    {
      content: messages[locale].notesDefaultContent,
      gridH: 6,
      gridW: 6,
      gridX: 0,
      gridY: 0,
      id: "notes-1",
      title: messages[locale].notesTitle,
      type: "notes",
    },
  ];
}

function cloneWidget(widget: Widget): Widget {
  return { ...widget };
}

function serializeWidgetPayloads(
  widgets: ReadonlyArray<Widget | StartPageWidget>,
) {
  return JSON.stringify(widgets);
}

function areWidgetsEqual(
  left: readonly Widget[],
  right: readonly Widget[],
) {
  return serializeWidgetPayloads(left) === serializeWidgetPayloads(right);
}

function normalizeStoredWidgets(
  rawWidgets: readonly unknown[],
  customization: Pick<Customization, "clockLayout" | "searchLayout" | "showClock" | "showSearch">,
  locale: SupportedLocale,
) {
  return resolveNormalizedWidgets(
    rawWidgets
      .map((widget) => normalizeWidget(widget, locale))
      .filter((widget): widget is WidgetNormalizedResult => widget !== null),
    getVisibleChromeLayoutEntries(customization),
  );
}

function mergeSharedWidgetsWithLocal(
  sharedWidgets: readonly StartPageWidget[],
  localWidgets: readonly Widget[],
): StartPageWidget[] {
  const merged = sharedWidgets.map((widget) => ({ ...widget }));
  const seenIds = new Set(merged.map((widget) => widget.id));
  const seenProtocolSources = new Set(
    merged.flatMap((widget) =>
      widget.type === "protocol" && widget.source.trim()
        ? [widget.source.trim().toLowerCase()]
        : []),
  );

  for (const widget of localWidgets) {
    if (seenIds.has(widget.id)) {
      continue;
    }

    if (
      widget.type === "protocol"
      && widget.source.trim()
      && seenProtocolSources.has(widget.source.trim().toLowerCase())
    ) {
      continue;
    }

    merged.push({ ...widget });
    seenIds.add(widget.id);

    if (widget.type === "protocol" && widget.source.trim()) {
      seenProtocolSources.add(widget.source.trim().toLowerCase());
    }
  }

  return merged;
}

function sanitizeCustomization(
  raw: unknown,
  locale: SupportedLocale,
): Customization {
  const defaults = createDefaultCustomization(locale);
  const source = isPlainObject(raw) ? raw : {};

  return resolveCustomizationLayouts({
    clockLayout: normalizeSurfaceBlockLayout(
      source.clockLayout,
      defaults.clockLayout,
    ),
    dateStyle:
      source.dateStyle === "zh" || source.dateStyle === "iso"
        ? source.dateStyle
        : "en",
    footerTip:
      typeof source.footerTip === "string" && source.footerTip.trim()
        ? source.footerTip.trim()
        : defaults.footerTip,
    searchBaseUrl:
      typeof source.searchBaseUrl === "string" && source.searchBaseUrl.trim()
        ? source.searchBaseUrl.trim()
        : defaults.searchBaseUrl,
    searchLayout: normalizeSurfaceBlockLayout(
      source.searchLayout,
      createDefaultSearchLayout(
        typeof source.searchWidth === "number"
          ? clampSearchWidth(source.searchWidth)
          : defaults.searchWidth,
      ),
    ),
    searchPlaceholder:
      typeof source.searchPlaceholder === "string" &&
        source.searchPlaceholder.trim()
        ? source.searchPlaceholder.trim()
        : defaults.searchPlaceholder,
    searchWidth:
      typeof source.searchWidth === "number"
        ? clampSearchWidth(source.searchWidth)
        : defaults.searchWidth,
    showClock:
      typeof source.showClock === "boolean"
        ? source.showClock
        : defaults.showClock,
    showDate:
      typeof source.showDate === "boolean" ? source.showDate : defaults.showDate,
    showFooter: false,
    showSearch:
      typeof source.showSearch === "boolean"
        ? source.showSearch
        : defaults.showSearch,
    showSeconds:
      typeof source.showSeconds === "boolean"
        ? source.showSeconds
        : defaults.showSeconds,
    timeFormat: source.timeFormat === "12h" ? "12h" : "24h",
  });
}

function isSameSurfaceBlockLayout(left: SurfaceBlockLayout, right: SurfaceBlockLayout) {
  return left.gridH === right.gridH
    && left.gridW === right.gridW
    && left.gridX === right.gridX
    && left.gridY === right.gridY;
}

function isSameCustomization(left: Customization, right: Customization) {
  return isSameSurfaceBlockLayout(left.clockLayout, right.clockLayout)
    && left.dateStyle === right.dateStyle
    && left.footerTip === right.footerTip
    && left.searchBaseUrl === right.searchBaseUrl
    && isSameSurfaceBlockLayout(left.searchLayout, right.searchLayout)
    && left.searchPlaceholder === right.searchPlaceholder
    && left.searchWidth === right.searchWidth
    && left.showClock === right.showClock
    && left.showDate === right.showDate
    && left.showFooter === right.showFooter
    && left.showSearch === right.showSearch
    && left.showSeconds === right.showSeconds
    && left.timeFormat === right.timeFormat;
}

function isLegacyWikipediaWidget(widget: Record<string, unknown>) {
  return (
    widget.type === "embed" &&
    widget.id === LEGACY_WIKIPEDIA_WIDGET_ID &&
    widget.url === LEGACY_WIKIPEDIA_WIDGET_URL
  );
}

function normalizeWidget(
  raw: unknown,
  locale: SupportedLocale,
): WidgetNormalizedResult | null {
  if (!isPlainObject(raw) || isLegacyWikipediaWidget(raw)) {
    return null;
  }

  const type = raw.type;
  if (type !== "embed" && type !== "notes" && type !== "protocol") {
    return null;
  }

  const legacyPreset = getWidgetSizeOption(
    `${raw.cols === 2 ? 2 : 1}x${raw.rows === 2 ? 2 : 1}` as WidgetSize,
  );
  const fallbackRect = clampWidgetRect({
    h:
      typeof raw.h === "number"
        ? clampWidgetGridSpan(
          Math.round(((raw.h as number) / 280) * legacyPreset.gridH),
          WIDGET_GRID_SCAN_LIMIT,
        )
        : legacyPreset.gridH,
    w:
      typeof raw.w === "number"
        ? clampWidgetGridSpan(
          Math.round(((raw.w as number) / 340) * legacyPreset.gridW),
          WIDGET_GRID_COLUMNS,
        )
        : legacyPreset.gridW,
    x: 0,
    y: 0,
  });
  const explicitPosition =
    typeof raw.gridX === "number"
    && Number.isFinite(raw.gridX)
    && typeof raw.gridY === "number"
    && Number.isFinite(raw.gridY);
  const rect = clampWidgetRect({
    h:
      typeof raw.gridH === "number"
        ? clampWidgetGridSpan(raw.gridH, WIDGET_GRID_SCAN_LIMIT)
        : fallbackRect.h,
    w:
      typeof raw.gridW === "number"
        ? clampWidgetGridSpan(raw.gridW, WIDGET_GRID_COLUMNS)
        : fallbackRect.w,
    x: explicitPosition && typeof raw.gridX === "number" ? raw.gridX : 0,
    y: explicitPosition && typeof raw.gridY === "number" ? raw.gridY : 0,
  });

  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : createWidgetId(type);
  const protocolSource =
    type === "protocol" && typeof raw.source === "string"
      ? parseStartPageProtocolWidgetSource(raw.source)
      : null;
  const protocolDefaultTitle =
    protocolSource && protocolSource.kind !== "error"
      ? protocolSource.defaultTitle
      : messages[locale].addMenuProtocol;

  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : type === "notes"
        ? messages[locale].notesTitle
        : type === "protocol"
          ? protocolDefaultTitle
          : messages[locale].addMenuEmbed;

  if (type === "embed") {
    return {
      explicitPosition,
      widget: {
        gridH: rect.h,
        gridW: rect.w,
        gridX: rect.x,
        gridY: rect.y,
        id,
        title,
        type,
        url: typeof raw.url === "string" ? raw.url.trim() : "",
      },
    };
  }

  if (type === "protocol") {
    return {
      explicitPosition,
      widget: {
        gridH: rect.h,
        gridW: rect.w,
        gridX: rect.x,
        gridY: rect.y,
        id,
        source: typeof raw.source === "string" ? raw.source.trim() : "",
        title,
        type,
      },
    };
  }

  return {
    explicitPosition,
    widget: {
      content: typeof raw.content === "string" ? raw.content : "",
      gridH: rect.h,
      gridW: rect.w,
      gridX: rect.x,
      gridY: rect.y,
      id,
      title,
      type,
    },
  };
}

function resolveNormalizedWidgets(
  results: WidgetNormalizedResult[],
  reservedEntries: LayoutOccupancyEntry[] = [],
) {
  const placed: Widget[] = [];
  const occupiedEntries = [...reservedEntries];

  results.forEach((result) => {
    const rect = getWidgetRect(result.widget);
    const nextRect =
      result.explicitPosition && isLayoutRectAvailable(occupiedEntries, rect, result.widget.id)
        ? rect
        : findFirstAvailableLayoutRect(occupiedEntries, rect.w, rect.h);
    const nextWidget = applyWidgetRect(result.widget, nextRect);
    placed.push(nextWidget);
    occupiedEntries.push({ id: nextWidget.id, rect: nextRect });
  });

  return placed;
}

function normalizeSettings(
  raw: unknown,
  locale: SupportedLocale,
  options?: {
    includeBackgroundImage?: boolean;
  },
): HomeSettings {
  const source = isPlainObject(raw) ? raw : {};
  const customization = sanitizeCustomization(source.customization, locale);

  return {
    backgroundImage: options?.includeBackgroundImage === false
      ? null
      : sanitizeBackgroundImage(source.backgroundImage),
    customization,
    theme: isThemeId(source.theme) ? source.theme : "default",
    widgets: normalizeStoredWidgets(
      Array.isArray(source.widgets) ? source.widgets : createDefaultWidgets(locale),
      customization,
      locale,
    ),
  };
}

function shouldPersistBackgroundImageToLocalStorage() {
  return typeof window === "undefined" || typeof window.browserShell === "undefined";
}

function resolveStartPageStorageKey(workspaceId?: string | null) {
  const normalizedWorkspaceId = typeof workspaceId === "string" ? workspaceId.trim() : "";
  return normalizedWorkspaceId ? `${STORAGE_KEY}:${normalizedWorkspaceId}` : STORAGE_KEY;
}

function loadSettings(
  locale: SupportedLocale,
  options?: {
    includeBackgroundImage?: boolean;
    fallbackStorageKey?: string;
    storageKey?: string;
  },
): HomeSettings {
  try {
    const storageKey = options?.storageKey ?? STORAGE_KEY;
    const fallbackStorageKey = options?.fallbackStorageKey;
    const raw = localStorage.getItem(storageKey)
      ?? (
        fallbackStorageKey && fallbackStorageKey !== storageKey
          ? localStorage.getItem(fallbackStorageKey)
          : null
      );
    if (!raw) {
      return normalizeSettings(undefined, locale, options);
    }

    return normalizeSettings(JSON.parse(raw), locale, options);
  } catch {
    return normalizeSettings(undefined, locale, options);
  }
}

function persistLanguageSetting(language: string) {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const settings = isPlainObject(parsed) ? parsed : {};
    settings.language = normalizeLanguageSetting(language);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

function formatDate(now: Date, customization: Customization) {
  if (customization.dateStyle === "zh") {
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${weekdaysZh[now.getDay()]}`;
  }

  if (customization.dateStyle === "iso") {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return `${weekdays[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
}

function areHomeSettingsEqual(left: HomeSettings, right: HomeSettings) {
  return (
    left.backgroundImage === right.backgroundImage
    && left.theme === right.theme
    && isSameCustomization(left.customization, right.customization)
    && areWidgetsEqual(left.widgets, right.widgets)
  );
}

function formatTime(now: Date, customization: Customization) {
  let hours = now.getHours();
  let suffix = "";

  if (customization.timeFormat === "12h") {
    suffix = hours >= 12 ? " PM" : " AM";
    hours %= 12;
    if (hours === 0) {
      hours = 12;
    }
  }

  let value = `${String(hours).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (customization.showSeconds) {
    value += `:${String(now.getSeconds()).padStart(2, "0")}`;
  }

  return `${value}${suffix}`;
}

function resolveSearchUrl(customization: Customization, keyword: string) {
  const base = customization.searchBaseUrl.trim();
  if (base.includes("%s")) {
    return base.split("%s").join(encodeURIComponent(keyword));
  }

  return `${base}${encodeURIComponent(keyword)}`;
}

function canInterruptAgentSession(
  status: AgentSessionStatus | null | undefined,
  hasEventTrigger = false,
) {
  return status === "running"
    || status === "waiting_event"
    || status === "queued"
    || (status === "idle" && hasEventTrigger);
}

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < AGENT_CHAT_AUTO_SCROLL_THRESHOLD;
}

function isSameAgentMessage(
  left: AgentSessionSnapshot["messages"][number],
  right: AgentSessionSnapshot["messages"][number],
) {
  return left.id === right.id
    && left.role === right.role
    && left.kind === right.kind
    && left.content === right.content
    && left.thinkingContent === right.thinkingContent
    && left.createdAt === right.createdAt
    && left.state === right.state
    && left.toolName === right.toolName
    && isSameSubAgentDetails(left.subAgentDetails, right.subAgentDetails);
}

function isSameAgentSchedule(
  left: AgentSessionScheduleSnapshot | undefined,
  right: AgentSessionScheduleSnapshot | undefined,
) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.prompt === right.prompt
    && left.cronExpression === right.cronExpression
    && left.timezone === right.timezone
    && left.nextRunAt === right.nextRunAt
    && left.lastTriggeredAt === right.lastTriggeredAt
    && left.lastTriggerStatus === right.lastTriggerStatus
    && left.lastTriggerError === right.lastTriggerError;
}

function isSameAgentEventTrigger(
  left: AgentSessionEventTriggerSnapshot | undefined,
  right: AgentSessionEventTriggerSnapshot | undefined,
) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  const leftMatch = left.match;
  const rightMatch = right.match;
  const leftEvent = left.lastEvent;
  const rightEvent = right.lastEvent;

  return left.prompt === right.prompt
    && left.awaitTimeoutMs === right.awaitTimeoutMs
    && left.cooldownMs === right.cooldownMs
    && left.lastTriggeredAt === right.lastTriggeredAt
    && left.lastTriggerStatus === right.lastTriggerStatus
    && left.lastTriggerError === right.lastTriggerError
    && left.channels.join("|") === right.channels.join("|")
    && (leftMatch?.kinds?.join("|") ?? "") === (rightMatch?.kinds?.join("|") ?? "")
    && (leftMatch?.source ?? "") === (rightMatch?.source ?? "")
    && (leftMatch?.urlMatches ?? "") === (rightMatch?.urlMatches ?? "")
    && (leftMatch?.titleMatches ?? "") === (rightMatch?.titleMatches ?? "")
    && (leftMatch?.summaryMatches ?? "") === (rightMatch?.summaryMatches ?? "")
    && (leftEvent?.kind ?? "") === (rightEvent?.kind ?? "")
    && (leftEvent?.ts ?? 0) === (rightEvent?.ts ?? 0)
    && (leftEvent?.url ?? "") === (rightEvent?.url ?? "")
    && (leftEvent?.title ?? "") === (rightEvent?.title ?? "")
    && (leftEvent?.summary ?? "") === (rightEvent?.summary ?? "")
    && (leftEvent?.source ?? "") === (rightEvent?.source ?? "");
}

function shouldReplaceAgentSessionSnapshot(
  current: AgentSessionSnapshot | null,
  next: AgentSessionSnapshot,
) {
  if (!current || current.sessionId !== next.sessionId) {
    return true;
  }

  if (next.updatedAt !== current.updatedAt) {
    return next.updatedAt > current.updatedAt;
  }

  if (
    current.workspaceId !== next.workspaceId
    || current.windowId !== next.windowId
    || current.privacyMode !== next.privacyMode
    || current.automationWorkspaceBound !== next.automationWorkspaceBound
    || current.createdAt !== next.createdAt
    || current.title !== next.title
    || current.preview !== next.preview
    || current.status !== next.status
    || current.lastError !== next.lastError
  ) {
    return true;
  }

  if (
    current.context.activeTabId !== next.context.activeTabId
    || current.context.activeUrl !== next.context.activeUrl
    || current.context.activeTitle !== next.context.activeTitle
    || current.context.browserSessionCount !== next.context.browserSessionCount
    || current.context.subscriptionCount !== next.context.subscriptionCount
    || current.context.recentEventCount !== next.context.recentEventCount
  ) {
    return true;
  }

  if (
    current.backend.configured !== next.backend.configured
    || current.backend.provider !== next.backend.provider
    || current.backend.providerId !== next.backend.providerId
    || current.backend.providerName !== next.backend.providerName
    || current.backend.endpoint !== next.backend.endpoint
    || current.backend.model !== next.backend.model
    || current.backend.source !== next.backend.source
  ) {
    return true;
  }

  if (!isSameAgentSchedule(current.schedule, next.schedule)) {
    return true;
  }

  if (!isSameAgentEventTrigger(current.eventTrigger, next.eventTrigger)) {
    return true;
  }

  if (current.messages.length !== next.messages.length) {
    return true;
  }

  return next.messages.some((message, index) => !isSameAgentMessage(message, current.messages[index]!));
}

export function HomePage({ pageMode = "start" }: HomePageProps) {
  const locale = usePageLocale();
  const [activeNexusTab, setActiveNexusTab] = useState<NexusTab>(
    pageMode === "tasks" || pageMode === "agent" ? "agent" : "browser"
  );
  const [nexusUser, setNexusUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [wsConnected, setWsConnected] = useState(nexusWs.getStatus());
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [initialAiPrompt, setInitialAiPrompt] = useState<string | undefined>(undefined);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setShowAiPanel((prev) => !prev);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !isInput) {
        if (e.key === "1") { e.preventDefault(); setActiveNexusTab("browser"); }
        else if (e.key === "2") { e.preventDefault(); setActiveNexusTab("dashboard"); }
        else if (e.key === "3") { e.preventDefault(); setActiveNexusTab("agent"); }
        else if (e.key === "4") { e.preventDefault(); setActiveNexusTab("research"); }
        else if (e.key === "5") { e.preventDefault(); setActiveNexusTab("workflows"); }
        else if (e.key === "6") { e.preventDefault(); setActiveNexusTab("memory"); }
        else if (e.key === "7") { e.preventDefault(); setActiveNexusTab("skills"); }
        else if (e.key === "8") { e.preventDefault(); setActiveNexusTab("approvals"); }
        else if (e.key === "9") { e.preventDefault(); setActiveNexusTab("activity"); }
        else if (e.key === "0") { e.preventDefault(); setActiveNexusTab("settings"); }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    nexusWs.connect();
    const unsubConn = nexusWs.subscribe("connection.state", (data: any) => {
      setWsConnected(data.connected);
    });

    nexusClient.getMe().then((res) => {
      setNexusUser(res.user);
    }).catch(() => {
      nexusClient.ensureSession().then((res) => {
        if (res.user?.id) {
          setNexusUser(res.user);
        } else {
          setShowAuthModal(true);
        }
      }).catch(() => {
        setShowAuthModal(true);
      });
    });

    nexusClient.getApprovals("pending").then((res) => {
      setPendingApprovalsCount(res.approvals?.length || 0);
    }).catch(() => {});

    const unsubApprReq = nexusWs.subscribe("approval.required", () => {
      setPendingApprovalsCount((c) => c + 1);
    });
    const unsubApprRes = nexusWs.subscribe("approval.resolved", () => {
      setPendingApprovalsCount((c) => Math.max(0, c - 1));
    });

    return () => {
      unsubConn();
      unsubApprReq();
      unsubApprRes();
    };
  }, []);

  const handleNexusLogout = async () => {
    await nexusClient.logout();
    setNexusUser(null);
    setShowAuthModal(true);
  };
  const t = (key: MessageKey) => messages[locale][key];
  const tf = (key: MessageKey, vars: Record<string, string | number>) =>
    t(key).replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ""));

  const persistBackgroundImageLocally = shouldPersistBackgroundImageToLocalStorage();
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const startPageStorageKey = resolveStartPageStorageKey(currentWorkspaceId);
  const [settings, setSettings] = useState<HomeSettings>(() => loadSettings(locale, {
    fallbackStorageKey: STORAGE_KEY,
    includeBackgroundImage: persistBackgroundImageLocally,
    storageKey: startPageStorageKey,
  }));
  const [hydratedSettingsStorageKey, setHydratedSettingsStorageKey] =
    useState<string>(startPageStorageKey);
  const [now, setNow] = useState(() => new Date());
  const [isEditing, setIsEditing] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("normal");
  const [agentPrivacyEnabled, setAgentPrivacyEnabled] = useState(true);
  const [agentSessions, setAgentSessions] = useState<AgentSessionListItem[]>([]);
  const [selectedAgentSessionId, setSelectedAgentSessionId] = useState<string | null>(() =>
    readSessionIdFromLocation(),
  );
  const [agentSession, setAgentSession] = useState<AgentSessionSnapshot | null>(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [isEmbedModalOpen, setIsEmbedModalOpen] = useState(false);
  const [embedForm, setEmbedForm] = useState<EmbedFormState>({
    title: "",
    url: "",
  });
  const [isProtocolModalOpen, setIsProtocolModalOpen] = useState(false);
  const [protocolForm, setProtocolForm] = useState<ProtocolWidgetFormState>({
    source: "",
    title: "",
  });
  const [widgetPackages, setWidgetPackages] = useState<WidgetPackageSummary[]>([]);
  const [isWidgetPackagesLoading, setIsWidgetPackagesLoading] = useState(false);
  const [isWidgetPackageInstalling, setIsWidgetPackageInstalling] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customForm, setCustomForm] = useState<Customization>(() =>
    createDefaultCustomization(locale),
  );
  const [customTheme, setCustomTheme] = useState<ThemeId>("default");
  const [customBackgroundImage, setCustomBackgroundImage] = useState<string | null>(null);
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null);
  const [isBackgroundUploading, setIsBackgroundUploading] = useState(false);
  const [resolvedThemeMode, setResolvedThemeMode] = useState<"light" | "dark">(() =>
    getResolvedThemeMode());
  const [hasSharedAppearanceHydrated, setHasSharedAppearanceHydrated] = useState(false);
  const [hydratedAppearanceWorkspaceId, setHydratedAppearanceWorkspaceId] =
    useState<string | null>(null);
  const [hasSharedWidgetsHydrated, setHasSharedWidgetsHydrated] = useState(false);
  const [hydratedWidgetsWorkspaceId, setHydratedWidgetsWorkspaceId] =
    useState<string | null>(null);
  const [widgetRefreshEvents, setWidgetRefreshEvents] =
    useState<Record<string, StartPageWidgetRefreshEvent>>({});
  const [startPageBackgroundImageMetrics, setStartPageBackgroundImageMetrics] =
    useState<StartPageBackgroundImageMetrics | null>(null);
  const [startPageShellLayout, setStartPageShellLayout] = useState<StartPageShellLayout | null>(
    null,
  );
  const [settingsSection, setSettingsSection] = useState<StartPageSettingsSection>("general");
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  const [widgetDraftState, setWidgetDraftState] = useState<WidgetDraftState | null>(null);
  const [widgetGridMetrics, setWidgetGridMetrics] = useState<WidgetGridMetrics>({
    cellSize: 0,
    pitch: WIDGET_GRID_GAP,
  });
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [bookmarkFolders, setBookmarkFolders] = useState<BookmarkFolderRecord[]>([]);
  const [dockItems, setDockItems] = useState<StartPageDockItem[]>([]);
  const [isLaunchpadOpen, setIsLaunchpadOpen] = useState(false);
  const [launchpadQuery, setLaunchpadQuery] = useState("");
  const [isLaunchpadEditMode, setIsLaunchpadEditMode] = useState(false);
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [launchpadFolderRename, setLaunchpadFolderRename] = useState<{
    folderId: string;
    pending: boolean;
    value: string;
  } | null>(null);
  const [launchpadDragState, setLaunchpadDragState] = useState<LaunchpadDragState | null>(null);
  const [launchpadDropTarget, setLaunchpadDropTarget] = useState<LaunchpadDropTarget | null>(null);
  const [dockPointerX, setDockPointerX] = useState<number | null>(null);
  const [hoveredDockId, setHoveredDockId] = useState<string | null>(null);
  const [dockItemMenu, setDockItemMenu] = useState<DockItemMenuState | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [pendingAgentProfile, setPendingAgentProfile] =
    useState<"default" | "organizer" | "widget-builder">("default");
  const [interruptingAgentSessionId, setInterruptingAgentSessionId] = useState<string | null>(null);
  const [openingAgentWorkspaceWindow, setOpeningAgentWorkspaceWindow] = useState(false);

  const widgetInteractionRef = useRef<WidgetInteractionState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const launchpadLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchpadFaviconPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchpadPointerDownRef = useRef<LaunchpadPointerDownState | null>(null);
  const launchpadQueuedFaviconsRef = useRef(new Map<string, string>());
  const launchpadResolvingFaviconIdsRef = useRef(new Set<string>());
  const launchpadPersistingFaviconKeysRef = useRef(new Set<string>());
  const launchpadSuppressClickRef = useRef(false);
  const agentSessionIdRef = useRef<string | null>(null);
  const dockButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const widgetsAreaRef = useRef<HTMLDivElement | null>(null);
  const dockItemMenuRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const addWidgetButtonRef = useRef<HTMLButtonElement | null>(null);
  const embedTitleRef = useRef<HTMLInputElement | null>(null);
  const protocolTitleRef = useRef<HTMLInputElement | null>(null);
  const customSearchPlaceholderRef = useRef<HTMLInputElement | null>(null);
  const backgroundImageInputRef = useRef<HTMLInputElement | null>(null);
  const launchpadSearchRef = useRef<HTMLInputElement | null>(null);
  const launchpadFolderTitleInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shouldAutofocusSearchRef = useRef(true);
  const agentChatMessagesRef = useRef<HTMLDivElement | null>(null);
  const agentChatShouldAutoScrollRef = useRef(true);
  const agentChatForceScrollRef = useRef(false);
  const agentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSharedBackgroundImageRef = useRef<string | null>(null);
  const lastSharedWidgetsPayloadRef = useRef<string | null>(null);
  const currentWidgetsRef = useRef<Widget[]>(settings.widgets.map(cloneWidget));
  const surface = pageMode;
  const isLight = resolvedThemeMode === "light";
  const syncStartPageShellLayout = useEffectEvent(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.startPageGetShellLayout) {
      setStartPageShellLayout(null);
      return;
    }

    void browserShell.startPageGetShellLayout()
      .then((layout) => {
        setStartPageShellLayout((currentLayout) => (
          currentLayout
          && layout
          && currentLayout.shellWidth === layout.shellWidth
          && currentLayout.shellHeight === layout.shellHeight
          && currentLayout.viewX === layout.viewX
          && currentLayout.viewY === layout.viewY
          && currentLayout.viewWidth === layout.viewWidth
          && currentLayout.viewHeight === layout.viewHeight
            ? currentLayout
            : layout
        ));
      })
      .catch(() => {
        setStartPageShellLayout(null);
      });
  });

  const customization = settings.customization;
  const clockTime = formatTime(now, customization);
  const clockDate = formatDate(now, customization);
  const searchPlaceholder = searchMode === "agent"
    ? t("agentSearchPlaceholder")
    : customization.searchPlaceholder;
  const modeToggleTooltip = searchMode === "agent"
    ? t("modeSwitchToNormal")
    : t("modeSwitchToAgent");
  const privacyToggleTooltip = agentPrivacyEnabled
    ? t("agentPrivacyModeDisable")
    : t("agentPrivacyModeEnable");
  const selectedAgentSessionSummary = selectedAgentSessionId
    ? agentSessions.find((session) => session.sessionId === selectedAgentSessionId) ?? null
    : null;
  const selectedAgentPrivacyEnabled = agentSession?.privacyMode
    ?? selectedAgentSessionSummary?.privacyMode
    ?? agentPrivacyEnabled;
  const isAgentPrivacyToggleLocked = Boolean(selectedAgentSessionId);
  const agentInputPrivacyTooltip = isAgentPrivacyToggleLocked
    ? t("agentPrivacyModeLocked")
    : privacyToggleTooltip;
  const currentAgentSessionStatus = agentSession?.status ?? selectedAgentSessionSummary?.status ?? null;
  const selectedAgentWorkspaceId = agentSession?.automationWorkspaceBound
    ? agentSession.workspaceId
    : selectedAgentSessionSummary?.automationWorkspaceBound
      ? selectedAgentSessionSummary.workspaceId
      : null;
  const agentMessages = agentSession?.messages ?? [];
  const hasRunningAgentSession = agentSessions.some((session) =>
    canInterruptAgentSession(session.status, Boolean(session.eventTrigger)));
  const canInterruptCurrentAgentSession = Boolean(
    selectedAgentSessionId && canInterruptAgentSession(currentAgentSessionStatus, Boolean(agentSession?.eventTrigger ?? selectedAgentSessionSummary?.eventTrigger)),
  );
  const isInterruptingCurrentAgentSession = Boolean(
    selectedAgentSessionId && interruptingAgentSessionId === selectedAgentSessionId,
  );
  const deferredLaunchpadQuery = useDeferredValue(launchpadQuery);
  const normalizedLaunchpadQuery = deferredLaunchpadQuery.trim().toLowerCase();
  const bookmarkFolderById = new Map<string, BookmarkFolderRecord>();
  bookmarkFolders.forEach((folder) => {
    bookmarkFolderById.set(folder.id, folder);
  });
  const launchpadBookmarks = [...bookmarks]
    .filter((bookmark) => {
      if (!normalizedLaunchpadQuery) {
        return true;
      }

      const title = String(bookmark.title || "").toLowerCase();
      const url = String(bookmark.url || "").toLowerCase();
      const host = getUrlHostLabel(bookmark.url).toLowerCase();
      const folderPath = getBookmarkFolderPathLabel(bookmark.folderId).toLowerCase();

      return (
        title.includes(normalizedLaunchpadQuery)
        || url.includes(normalizedLaunchpadQuery)
        || host.includes(normalizedLaunchpadQuery)
        || folderPath.includes(normalizedLaunchpadQuery)
      );
    })
    .sort((left, right) => {
      const leftLabel = (left.title || getUrlHostLabel(left.url) || left.url).trim();
      const rightLabel = (right.title || getUrlHostLabel(right.url) || right.url).trim();
      return leftLabel.localeCompare(rightLabel, locale);
    });
  const launchpadSectionsMap = new Map<
    string,
    { id: string; items: BookmarkRecord[]; label: string }
  >();
  launchpadBookmarks.forEach((bookmark) => {
    const groupId = bookmark.folderId ?? "__launchpad_unsorted__";
    const existing = launchpadSectionsMap.get(groupId) ?? {
      id: groupId,
      items: [],
      label: getBookmarkFolderPathLabel(bookmark.folderId),
    };
    existing.items.push(bookmark);
    launchpadSectionsMap.set(groupId, existing);
  });
  const launchpadSections = Array.from(launchpadSectionsMap.values())
    .sort((left, right) => {
      if (left.id === "__launchpad_unsorted__") {
        return -1;
      }

      if (right.id === "__launchpad_unsorted__") {
        return 1;
      }

      return left.label.localeCompare(right.label, locale);
    });
  const launchpadFolderSections = launchpadSections
    .filter((section) => section.id !== "__launchpad_unsorted__");
  const launchpadRootBookmarks = launchpadSections
    .filter((section) => section.id === "__launchpad_unsorted__")
    .flatMap((section) => section.items);
  const expandedLaunchpadSection = expandedFolderId
    ? launchpadSections.find((section) => section.id === expandedFolderId) ?? null
    : null;
  const expandedLaunchpadFolder = expandedFolderId
    ? bookmarkFolderById.get(expandedFolderId) ?? null
    : null;

  useEffect(() => {
    agentSessionIdRef.current = agentSession?.sessionId ?? null;
  }, [agentSession?.sessionId]);

  useEffect(() => {
    currentWidgetsRef.current = settings.widgets.map(cloneWidget);
  }, [settings.widgets]);

  const applySharedWidgetsState = useEffectEvent((widgetsState: StartPageWidgetsState) => {
    lastSharedWidgetsPayloadRef.current = serializeWidgetPayloads(widgetsState.items);

    startTransition(() => {
      setSettings((current) => {
        const nextWidgetSource = widgetsState.migrated
          ? widgetsState.items
          : mergeSharedWidgetsWithLocal(widgetsState.items, current.widgets);
        const nextWidgets = normalizeStoredWidgets(nextWidgetSource, current.customization, locale);

        return areWidgetsEqual(current.widgets, nextWidgets)
          ? current
          : {
            ...current,
            widgets: nextWidgets,
          };
      });
    });
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = surface === "start"
      ? messages[locale].pageTitle
      : surface === "tasks"
        ? messages[locale].agentTaskManagerTitle
      : messages[locale].agentTitle;
  }, [locale, surface]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }

    const syncResolvedThemeMode = () => {
      const nextThemeMode = getResolvedThemeMode();
      setResolvedThemeMode((current) => current === nextThemeMode ? current : nextThemeMode);
    };

    syncResolvedThemeMode();
    const observer = new MutationObserver(syncResolvedThemeMode);
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.getBootstrapData) {
      return;
    }

    let disposed = false;

    void browserShell.getBootstrapData()
      .then((bootstrap) => {
        if (!disposed) {
          setCurrentWorkspaceId((current) =>
            current === bootstrap.currentWorkspace.id ? current : bootstrap.currentWorkspace.id);
        }
      })
      .catch(() => undefined);

    const disposeWorkspaceContext = browserShell.onWorkspaceContext?.((payload) => {
      if (!disposed) {
        setCurrentWorkspaceId((current) =>
          current === payload.currentWorkspace.id ? current : payload.currentWorkspace.id);
      }
    });

    return () => {
      disposed = true;
      disposeWorkspaceContext?.();
    };
  }, []);

  useEffect(() => {
    if (!persistBackgroundImageLocally && !currentWorkspaceId) {
      return;
    }

    const nextSettings = loadSettings(locale, {
      fallbackStorageKey: STORAGE_KEY,
      includeBackgroundImage: persistBackgroundImageLocally,
      storageKey: startPageStorageKey,
    });

    setSettings((current) => areHomeSettingsEqual(current, nextSettings) ? current : nextSettings);
    setHydratedSettingsStorageKey(startPageStorageKey);
  }, [currentWorkspaceId, locale, persistBackgroundImageLocally, startPageStorageKey]);

  useEffect(() => {
    try {
      if (!persistBackgroundImageLocally && !currentWorkspaceId) {
        return;
      }

      if (hydratedSettingsStorageKey !== startPageStorageKey) {
        return;
      }

      localStorage.setItem(startPageStorageKey, JSON.stringify({
        ...settings,
        backgroundImage: persistBackgroundImageLocally ? settings.backgroundImage : null,
      }));
    } catch {
      // Ignore storage failures.
    }
  }, [
    currentWorkspaceId,
    hydratedSettingsStorageKey,
    persistBackgroundImageLocally,
    settings,
    startPageStorageKey,
  ]);

  useEffect(() => {
    setCustomTheme((current) => current === settings.theme ? current : settings.theme);
    setCustomBackgroundImage((current) => current === settings.backgroundImage ? current : settings.backgroundImage);
    setCustomForm((current) =>
      isSameCustomization(current, settings.customization) ? current : { ...settings.customization });
  }, [settings.backgroundImage, settings.customization, settings.theme]);

  useEffect(() => {
    if (surface !== "start") {
      setStartPageShellLayout(null);
      return;
    }

    syncStartPageShellLayout();
    const handleResize = () => {
      syncStartPageShellLayout();
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("focus", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("focus", handleResize);
    };
  }, [surface, syncStartPageShellLayout]);

  useEffect(() => {
    const backgroundImage = settings.backgroundImage?.trim();
    if (!backgroundImage) {
      setStartPageBackgroundImageMetrics(null);
      return;
    }

    let cancelled = false;

    void loadStartPageBackgroundImageMetrics(backgroundImage)
      .then((metrics) => {
        if (!cancelled) {
          setStartPageBackgroundImageMetrics(metrics);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStartPageBackgroundImageMetrics(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [settings.backgroundImage]);

  useEffect(() => {
    const theme = themes.find((item) => item.id === settings.theme) ?? themes[0];
    const themeGradient = getThemeGradient(theme, isLight);
    const backgroundStyle = settings.backgroundImage
      ? buildStartPageSurfaceBackgroundStyle({
        backgroundImage: settings.backgroundImage,
        fallbackBackground: themeGradient,
        imageMetrics: startPageBackgroundImageMetrics,
        isLight,
        shellFrame: startPageShellLayout
          ? {
            height: startPageShellLayout.shellHeight,
            width: startPageShellLayout.shellWidth,
          }
          : null,
        surfaceRect: startPageShellLayout
          ? {
            height: startPageShellLayout.viewHeight,
            width: startPageShellLayout.viewWidth,
            x: startPageShellLayout.viewX,
            y: startPageShellLayout.viewY,
          }
          : null,
      })
      : {
        backgroundColor: getStartPageBackgroundBaseColor(isLight),
        backgroundImage: themeGradient,
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      };

    document.body.style.backgroundColor = backgroundStyle.backgroundColor;
    document.body.style.backgroundImage = backgroundStyle.backgroundImage;
    document.body.style.backgroundPosition = backgroundStyle.backgroundPosition;
    document.body.style.backgroundRepeat = backgroundStyle.backgroundRepeat;
    document.body.style.backgroundSize = backgroundStyle.backgroundSize;

    return () => {
      document.body.style.removeProperty("background-color");
      document.body.style.removeProperty("background-image");
      document.body.style.removeProperty("background-position");
      document.body.style.removeProperty("background-repeat");
      document.body.style.removeProperty("background-size");
    };
  }, [
    isLight,
    settings.backgroundImage,
    settings.theme,
    startPageBackgroundImageMetrics,
    startPageShellLayout,
  ]);

  useEffect(() => {
    if (surface !== "start") {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.startPageGetAppearance) {
      setHasSharedAppearanceHydrated(true);
      setHydratedAppearanceWorkspaceId(currentWorkspaceId);
      return;
    }

    if (!currentWorkspaceId) {
      setHasSharedAppearanceHydrated(false);
      setHydratedAppearanceWorkspaceId(null);
      return;
    }

    let disposed = false;
    setHasSharedAppearanceHydrated(false);
    setHydratedAppearanceWorkspaceId((current) =>
      current === currentWorkspaceId ? current : null);

    void browserShell.startPageGetAppearance()
      .then((appearance) => {
        if (disposed) {
          return;
        }

        lastSharedBackgroundImageRef.current = appearance.backgroundImage;
        // Keep hydration synchronous so the outbound sync effect does not
        // briefly see a stale local background image and write it back.
        setSettings((current) => {
          return current.backgroundImage === appearance.backgroundImage
            ? current
            : {
              ...current,
              backgroundImage: appearance.backgroundImage,
            };
        });
        setCustomBackgroundImage((current) =>
          current === appearance.backgroundImage ? current : appearance.backgroundImage);
        setHydratedAppearanceWorkspaceId(currentWorkspaceId);
        setHasSharedAppearanceHydrated(true);
      })
      .catch(() => {
        if (!disposed) {
          setHydratedAppearanceWorkspaceId(currentWorkspaceId);
          setHasSharedAppearanceHydrated(true);
        }
      });

    const disposeAppearanceListener = browserShell.onStartPageAppearanceChanged?.((appearance) => {
      if (disposed) {
        return;
      }

      lastSharedBackgroundImageRef.current = appearance.backgroundImage;
      setSettings((current) =>
        current.backgroundImage === appearance.backgroundImage
          ? current
          : {
            ...current,
            backgroundImage: appearance.backgroundImage,
          });
      setCustomBackgroundImage((current) =>
        current === appearance.backgroundImage ? current : appearance.backgroundImage);
      setHydratedAppearanceWorkspaceId(currentWorkspaceId);
      setHasSharedAppearanceHydrated(true);
    });

    return () => {
      disposed = true;
      disposeAppearanceListener?.();
    };
  }, [currentWorkspaceId, surface]);

  useEffect(() => {
    if (surface !== "start" || !hasSharedAppearanceHydrated) {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.startPageSetAppearance) {
      return;
    }

    if (browserShell && hydratedAppearanceWorkspaceId !== currentWorkspaceId) {
      return;
    }

    if (lastSharedBackgroundImageRef.current === settings.backgroundImage) {
      return;
    }

    let cancelled = false;

    void browserShell.startPageSetAppearance({
      backgroundImage: settings.backgroundImage,
    })
      .then((appearance) => {
        if (!cancelled) {
          lastSharedBackgroundImageRef.current = appearance.backgroundImage;
        }
      })
      .catch(() => {
        // Ignore appearance sync failures and keep the local start page usable.
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentWorkspaceId,
    hasSharedAppearanceHydrated,
    hydratedAppearanceWorkspaceId,
    settings.backgroundImage,
    surface,
  ]);

  useEffect(() => {
    if (surface !== "start" || !hasSharedWidgetsHydrated) {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.startPageSetWidgets) {
      return;
    }

    if (browserShell && hydratedWidgetsWorkspaceId !== currentWorkspaceId) {
      return;
    }

    const currentPayload = serializeWidgetPayloads(settings.widgets);
    if (lastSharedWidgetsPayloadRef.current === currentPayload) {
      return;
    }

    let cancelled = false;

    void browserShell.startPageSetWidgets(settings.widgets.map(cloneWidget))
      .then((widgetsState) => {
        if (cancelled) {
          return;
        }

        applySharedWidgetsState(widgetsState);
      })
      .catch(() => {
        // Ignore widget sync failures and keep the start page usable.
      });

    return () => {
      cancelled = true;
    };
  }, [
    applySharedWidgetsState,
    currentWorkspaceId,
    hasSharedWidgetsHydrated,
    hydratedWidgetsWorkspaceId,
    settings.widgets,
    surface,
  ]);

  useEffect(() => {
    if (!isCustomModalOpen) {
      return;
    }

    const nextCustomization = sanitizeCustomization(customForm, locale);
    setSettings((current) => {
      if (
        current.theme === customTheme
        && current.backgroundImage === customBackgroundImage
        && isSameCustomization(current.customization, nextCustomization)
      ) {
        return current;
      }

      return {
        ...current,
        backgroundImage: customBackgroundImage,
        customization: nextCustomization,
        theme: customTheme,
      };
    });
  }, [customBackgroundImage, customForm, customTheme, isCustomModalOpen, locale]);

  useEffect(() => {
    document.body.classList.toggle("agent-surface", surface !== "start");

    return () => {
      document.body.classList.remove("agent-surface");
    };
  }, [surface]);

  useEffect(() => {
    document.body.classList.toggle("edit-mode", isEditing);

    return () => {
      document.body.classList.remove("edit-mode");
    };
  }, [isEditing]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedWidgetId) {
      return;
    }

    const selectableIds = new Set<string>(settings.widgets.map((widget) => widget.id));
    if (settings.customization.showClock) {
      selectableIds.add("clock");
    }
    if (settings.customization.showSearch) {
      selectableIds.add("search");
    }

    if (!selectableIds.has(selectedWidgetId)) {
      setSelectedWidgetId(null);
    }
  }, [
    selectedWidgetId,
    settings.customization.showClock,
    settings.customization.showSearch,
    settings.widgets,
  ]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;

    void browserShell.settingsGetLanguage()
      .then((language) => {
        if (!disposed) {
          persistLanguageSetting(language);
        }
      })
      .catch(() => {
        // Ignore locale sync failures.
      });

    const disposeLanguage = browserShell.onLanguageChanged((language) => {
      if (!disposed) {
        persistLanguageSetting(language);
      }
    });

    return () => {
      disposed = true;
      disposeLanguage?.();
    };
  }, []);

  const handleAgentProtocolWidgetAddRequest = useEffectEvent((payload: {
    source: string;
    title?: string | null;
    skipIfExists?: boolean;
  }) => {
    if (!payload || typeof payload.source !== "string") {
      return;
    }

    void appendProtocolWidgetFromSource(payload.source, payload.title, {
      skipIfExists: payload.skipIfExists,
    });
  });

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.onStartPageAddProtocolWidgetRequested) {
      return;
    }

    const disposeStartPageWidgetRequest = browserShell.onStartPageAddProtocolWidgetRequested((payload) => {
      handleAgentProtocolWidgetAddRequest(payload);
    });

    return () => {
      disposeStartPageWidgetRequest?.();
    };
  }, []);

  useEffect(() => {
    if (surface !== "start") {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.startPageGetWidgets) {
      setHasSharedWidgetsHydrated(true);
      setHydratedWidgetsWorkspaceId(currentWorkspaceId);
      return;
    }

    if (!currentWorkspaceId) {
      setHasSharedWidgetsHydrated(false);
      setHydratedWidgetsWorkspaceId(null);
      return;
    }

    let disposed = false;
    setHasSharedWidgetsHydrated(false);
    setHydratedWidgetsWorkspaceId((current) =>
      current === currentWorkspaceId ? current : null);

    const hydrateWidgets = async (widgetsState: StartPageWidgetsState) => {
      applySharedWidgetsState(widgetsState);
      if (widgetsState.migrated || !browserShell.startPageSetWidgets) {
        if (!disposed) {
          setHydratedWidgetsWorkspaceId(currentWorkspaceId);
          setHasSharedWidgetsHydrated(true);
        }
        return;
      }

      try {
        const mergedWidgets = mergeSharedWidgetsWithLocal(widgetsState.items, currentWidgetsRef.current);
        const nextState = await browserShell.startPageSetWidgets(mergedWidgets);
        if (disposed) {
          return;
        }

        applySharedWidgetsState(nextState);
      } catch {
        // Ignore widget migration failures and keep the start page usable.
      } finally {
        if (!disposed) {
          setHydratedWidgetsWorkspaceId(currentWorkspaceId);
          setHasSharedWidgetsHydrated(true);
        }
      }
    };

    void browserShell.startPageGetWidgets()
      .then((widgetsState) => {
        if (!disposed) {
          void hydrateWidgets(widgetsState);
        }
      })
      .catch(() => {
        if (!disposed) {
          setHydratedWidgetsWorkspaceId(currentWorkspaceId);
          setHasSharedWidgetsHydrated(true);
        }
      });

    const disposeWidgetsListener = browserShell.onStartPageWidgetsChanged?.((widgetsState) => {
      if (disposed) {
        return;
      }

      applySharedWidgetsState(widgetsState);
      setHydratedWidgetsWorkspaceId(currentWorkspaceId);
      setHasSharedWidgetsHydrated(true);
    });

    return () => {
      disposed = true;
      disposeWidgetsListener?.();
    };
  }, [currentWorkspaceId, surface]);

  useEffect(() => {
    if (surface !== "start") {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.startPageGetWidgetRefreshes || !browserShell?.onStartPageWidgetRefresh) {
      return;
    }

    let disposed = false;
    setWidgetRefreshEvents({});

    void browserShell.startPageGetWidgetRefreshes()
      .then((events) => {
        if (disposed) {
          return;
        }

        const nextEvents: Record<string, StartPageWidgetRefreshEvent> = {};
        for (const event of events) {
          nextEvents[event.widgetId] = event;
        }
        setWidgetRefreshEvents(nextEvents);
      })
      .catch(() => {
        // Ignore refresh state hydration failures; live refresh events can still arrive.
      });

    const disposeRefreshListener = browserShell.onStartPageWidgetRefresh((event) => {
      if (disposed) {
        return;
      }

      setWidgetRefreshEvents((current) => ({
        ...current,
        [event.widgetId]: event,
      }));
    });

    return () => {
      disposed = true;
      disposeRefreshListener();
    };
  }, [currentWorkspaceId, surface]);

  useEffect(() => {
    if (surface !== "start") {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.startPageGetDockItems) {
      return;
    }

    let disposed = false;
    setDockItems([]);
    setDockItemMenu(null);

    void browserShell.startPageGetDockItems()
      .then((items) => {
        if (!disposed) {
          startTransition(() => {
            setDockItems(items);
          });
        }
      })
      .catch(() => {
        // Ignore Dock hydration failures and keep the page usable.
      });

    const disposeDockListener = browserShell.onStartPageDockChanged?.((items) => {
      if (disposed) {
        return;
      }

      startTransition(() => {
        setDockItems(items);
      });
    });

    return () => {
      disposed = true;
      disposeDockListener?.();
    };
  }, [currentWorkspaceId, surface]);

  useEffect(() => {
    if (surface !== "start") {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.bookmarksGetState) {
      return;
    }

    let disposed = false;

    const refresh = async () => {
      try {
        const payload = await browserShell.bookmarksGetState();
        if (disposed) {
          return;
        }

        startTransition(() => {
          setBookmarks(payload.bookmarks);
          setBookmarkFolders(payload.folders);
        });
      } catch {
        // Ignore bookmark hydration failures and keep the start page usable.
      }
    };

    void refresh();

    const handleBookmarkChange = () => {
      void refresh();
    };

    window.addEventListener("bookmarks:changed", handleBookmarkChange);

    return () => {
      disposed = true;
      window.removeEventListener("bookmarks:changed", handleBookmarkChange);
    };
  }, [surface]);

  const flushLaunchpadQueuedFavicons = useEffectEvent(async () => {
    const updates = Array.from(launchpadQueuedFaviconsRef.current.entries())
      .map(([id, favicon]) => ({ id, favicon }));
    if (updates.length === 0) {
      return;
    }

    launchpadQueuedFaviconsRef.current.clear();

    const browserShell = window.browserShell;
    if (!browserShell?.bookmarksUpdateFavicons) {
      return;
    }

    updates.forEach(({ id, favicon }) => {
      launchpadPersistingFaviconKeysRef.current.add(`${id}:${favicon}`);
    });

    try {
      const nextBookmarks = await browserShell.bookmarksUpdateFavicons(updates);
      startTransition(() => {
        setBookmarks(nextBookmarks);
      });
    } catch {
      // Ignore favicon persistence failures and keep the resolved icon in memory.
    } finally {
      updates.forEach(({ id, favicon }) => {
        launchpadPersistingFaviconKeysRef.current.delete(`${id}:${favicon}`);
      });
    }
  });

  const queueLaunchpadBookmarkFavicon = useEffectEvent((bookmarkId: string, favicon: string) => {
    const normalizedFavicon = favicon.trim();
    if (!normalizedFavicon) {
      return;
    }

    const bookmark = bookmarks.find((entry) => entry.id === bookmarkId);
    if (!bookmark || bookmark.favicon?.trim() === normalizedFavicon) {
      return;
    }

    const persistenceKey = `${bookmarkId}:${normalizedFavicon}`;
    if (
      launchpadPersistingFaviconKeysRef.current.has(persistenceKey)
      || launchpadQueuedFaviconsRef.current.get(bookmarkId) === normalizedFavicon
    ) {
      return;
    }

    launchpadQueuedFaviconsRef.current.set(bookmarkId, normalizedFavicon);
    if (launchpadFaviconPersistTimerRef.current !== null) {
      return;
    }

    launchpadFaviconPersistTimerRef.current = setTimeout(() => {
      launchpadFaviconPersistTimerRef.current = null;
      void flushLaunchpadQueuedFavicons();
    }, LAUNCHPAD_FAVICON_PERSIST_DEBOUNCE_MS);
  });

  useEffect(() => () => {
    if (launchpadFaviconPersistTimerRef.current !== null) {
      clearTimeout(launchpadFaviconPersistTimerRef.current);
      launchpadFaviconPersistTimerRef.current = null;
    }

    launchpadQueuedFaviconsRef.current.clear();
    launchpadResolvingFaviconIdsRef.current.clear();
    launchpadPersistingFaviconKeysRef.current.clear();
  }, []);

  useEffect(() => {
    if (surface !== "start" || !isLaunchpadOpen || bookmarks.length === 0) {
      return;
    }

    let cancelled = false;
    const uncachedBookmarks = bookmarks.filter((bookmark) =>
      !bookmark.favicon?.trim()
      && !launchpadResolvingFaviconIdsRef.current.has(bookmark.id));
    if (uncachedBookmarks.length === 0) {
      return;
    }

    const workerCount = Math.min(LAUNCHPAD_FAVICON_PREFETCH_CONCURRENCY, uncachedBookmarks.length);
    let cursor = 0;

    const prefetchWorker = async () => {
      while (!cancelled) {
        const bookmark = uncachedBookmarks[cursor];
        cursor += 1;
        if (!bookmark) {
          return;
        }

        launchpadResolvingFaviconIdsRef.current.add(bookmark.id);
        try {
          const resolvedFavicon = await resolveDockFaviconSource(bookmark.url, bookmark.favicon);
          if (cancelled || !resolvedFavicon) {
            continue;
          }

          queueLaunchpadBookmarkFavicon(bookmark.id, resolvedFavicon);
        } finally {
          launchpadResolvingFaviconIdsRef.current.delete(bookmark.id);
        }
      }
    };

    void Promise.all(Array.from({ length: workerCount }, () => prefetchWorker()));

    return () => {
      cancelled = true;
    };
  }, [bookmarks, isLaunchpadOpen, queueLaunchpadBookmarkFavicon, surface]);

  useEffect(() => {
    if (!dockItemMenu) {
      return;
    }

    if (!dockItems.some((item) => item.id === dockItemMenu.itemId)) {
      setDockItemMenu(null);
    }
  }, [dockItemMenu, dockItems]);

  useEffect(() => {
    if (!selectedAgentSessionId) {
      setAgentSession(null);
    }
  }, [selectedAgentSessionId]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;

    void loadAgentSessionsForCurrentWindow()
      .then((sessions) => {
        if (disposed) {
          return;
        }

        if (surface === "agent" && selectedAgentSessionId) {
          void loadAgentSessionById(selectedAgentSessionId);
          return;
        }

        if (surface === "tasks" && selectedAgentSessionId && sessions.some((session) => session.sessionId === selectedAgentSessionId)) {
          return;
        }

        if (surface === "tasks" && sessions.length > 0 && !selectedAgentSessionId) {
          startTransition(() => {
            setSelectedAgentSessionId(sessions[0]?.sessionId ?? null);
          });
        }
      })
      .catch(() => {
        // Ignore hydration failures and keep the start page usable.
      });

    return () => {
      disposed = true;
    };
  }, [selectedAgentSessionId, surface]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    return browserShell.onAgentSessionUpdate((update) => {
      startTransition(() => {
        if (update.snapshot) {
          syncAgentSessionSnapshot(update.snapshot);
          return;
        }
        removeAgentSessionSnapshot(update.sessionId);
      });
    });
  }, []);

  useEffect(() => {
    const browserShell = window.browserShell;
    const sessionId = selectedAgentSessionId;
    if (!browserShell || !sessionId) {
      return;
    }

    let disposed = false;

    const refresh = async () => {
      try {
        const snapshot = await browserShell.agentGetSession(sessionId);
        if (disposed) {
          return;
        }
        if (!snapshot) {
          startTransition(() => {
            removeAgentSessionSnapshot(sessionId);
          });
          return;
        }
        startTransition(() => {
          syncAgentSessionSnapshot(snapshot);
        });
      } catch {
        // Ignore refresh failures and rely on event updates when available.
      }
    };

    void refresh();

    const shouldPoll =
      surface === "agent"
      || agentSession?.status === "running"
      || agentSession?.status === "waiting_event"
      || agentSession?.status === "queued";

    if (!shouldPoll) {
      return () => {
        disposed = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [selectedAgentSessionId, agentSession?.status, surface]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    let disposed = false;

    const refresh = async () => {
      try {
        const sessions = await loadAgentSessionsForCurrentWindow();
        if (disposed || sessions.length > 0 || selectedAgentSessionId) {
          return;
        }
        startTransition(() => {
          setSelectedAgentSessionId(null);
        });
      } catch {
        // Ignore refresh failures and rely on event updates when available.
      }
    };

    void refresh();

    const shouldPoll = surface !== "start" || hasRunningAgentSession;
    if (!shouldPoll) {
      return () => {
        disposed = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [hasRunningAgentSession, selectedAgentSessionId, surface]);

  useEffect(() => {
    if (surface !== "start") {
      shouldAutofocusSearchRef.current = true;
      return;
    }

    if (!customization.showSearch || !shouldAutofocusSearchRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      shouldAutofocusSearchRef.current = false;
      const searchInput = searchInputRef.current;
      if (!searchInput) {
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body) {
        return;
      }

      searchInput.focus({ preventScroll: true });
    }, 80);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [customization.showSearch, surface]);

  useEffect(() => {
    if (isEmbedModalOpen) {
      embedTitleRef.current?.focus();
    }
  }, [isEmbedModalOpen]);

  useEffect(() => {
    if (isProtocolModalOpen) {
      protocolTitleRef.current?.focus();
    }
  }, [isProtocolModalOpen]);

  useEffect(() => {
    if (!isProtocolModalOpen) {
      return;
    }

    let disposed = false;
    setIsWidgetPackagesLoading(true);
    void refreshWidgetPackages()
      .then((packages) => {
        if (!disposed) {
          setWidgetPackages(packages);
        }
      })
      .catch(() => {
        if (!disposed) {
          setWidgetPackages([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setIsWidgetPackagesLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [isProtocolModalOpen]);

  useEffect(() => {
    if (isCustomModalOpen) {
      customSearchPlaceholderRef.current?.focus();
    }
  }, [isCustomModalOpen]);

  useEffect(() => {
    if (!isLaunchpadOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      launchpadSearchRef.current?.focus();
    }, 80);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isLaunchpadOpen]);

  useEffect(() => {
    if (isLaunchpadOpen) {
      cancelLongPress();
    }
  }, [isLaunchpadOpen]);

  useEffect(() => {
    if (!normalizedLaunchpadQuery) {
      return;
    }

    clearLaunchpadPressState();
    clearLaunchpadDragState();
    setIsLaunchpadEditMode(false);
    setExpandedFolderId(null);
    setLaunchpadFolderRename(null);
  }, [normalizedLaunchpadQuery]);

  useEffect(() => {
    if (
      !launchpadFolderRename
      || launchpadFolderRename.pending
      || launchpadFolderRename.folderId !== expandedFolderId
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      launchpadFolderTitleInputRef.current?.focus();
      launchpadFolderTitleInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [expandedFolderId, launchpadFolderRename]);

  useEffect(() => {
    if (!expandedFolderId) {
      setLaunchpadFolderRename(null);
      return;
    }

    if (!expandedLaunchpadSection || !expandedLaunchpadFolder) {
      setLaunchpadFolderRename(null);
      setExpandedFolderId(null);
      return;
    }

    if (launchpadFolderRename && launchpadFolderRename.folderId !== expandedFolderId) {
      setLaunchpadFolderRename(null);
    }
  }, [
    expandedFolderId,
    expandedLaunchpadFolder,
    expandedLaunchpadSection,
    launchpadFolderRename,
  ]);

  useEffect(() => {
    const container = agentChatMessagesRef.current;
    if (!container) {
      agentChatShouldAutoScrollRef.current = true;
      return;
    }

    const syncAutoScrollPreference = () => {
      agentChatShouldAutoScrollRef.current = isNearScrollBottom(container);
    };

    syncAutoScrollPreference();
    container.addEventListener("scroll", syncAutoScrollPreference, { passive: true });

    return () => {
      container.removeEventListener("scroll", syncAutoScrollPreference);
    };
  }, [selectedAgentSessionId]);

  useEffect(() => {
    agentChatShouldAutoScrollRef.current = true;
    agentChatForceScrollRef.current = true;
  }, [selectedAgentSessionId]);

  useLayoutEffect(() => {
    const container = agentChatMessagesRef.current;
    if (!container) return;

    if (!agentChatForceScrollRef.current && !agentChatShouldAutoScrollRef.current) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      agentChatShouldAutoScrollRef.current = true;
      agentChatForceScrollRef.current = false;
    });

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [agentMessages, agentSession?.status, selectedAgentSessionId]);

  useLayoutEffect(() => {
    const grid = widgetsAreaRef.current;
    if (!grid || surface !== "start") {
      return;
    }

    const measure = () => {
      const computedStyle = window.getComputedStyle(grid);
      const firstColumnWidth = computedStyle.gridTemplateColumns
        .split(" ")
        .map((token) => Number.parseFloat(token))
        .find((value) => Number.isFinite(value) && value > 0);

      if (!firstColumnWidth) {
        return;
      }

      const nextCellSize = Math.round(firstColumnWidth);
      setWidgetGridMetrics((current) =>
        current.cellSize === nextCellSize && current.pitch === nextCellSize + WIDGET_GRID_GAP
          ? current
          : {
            cellSize: nextCellSize,
            pitch: nextCellSize + WIDGET_GRID_GAP,
          });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(grid);

    return () => {
      observer.disconnect();
    };
  }, [surface]);

  function setWidgetDraft(next: WidgetDraftState | null) {
    setWidgetDraftState((current) => {
      if (current === null && next === null) {
        return current;
      }

      if (
        current &&
        next &&
        current.widgetId === next.widgetId &&
        isSameWidgetRect(current.rect, next.rect)
      ) {
        return current;
      }

      return next;
    });
  }

  function clearWidgetInteraction() {
    widgetInteractionRef.current = null;
    setWidgetDraft(null);
    setDraggingWidgetId(null);
    if (overlayRef.current) {
      overlayRef.current.style.display = "none";
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }

  function getCurrentSurfaceItemRect(
    itemId: SurfaceItemId,
    currentCustomization = customization,
    currentWidgets = settings.widgets,
  ) {
    if (itemId === "clock") {
      return getSurfaceBlockRect(currentCustomization.clockLayout);
    }

    if (itemId === "search") {
      return getSurfaceBlockRect(currentCustomization.searchLayout);
    }

    const widget = currentWidgets.find((item) => item.id === itemId);
    return widget ? getWidgetRect(widget) : null;
  }

  function getCurrentOccupiedEntries(
    currentCustomization = customization,
    currentWidgets = settings.widgets,
  ) {
    return getOccupiedLayoutEntries(currentCustomization, currentWidgets);
  }

  function commitSurfaceItemRect(itemId: SurfaceItemId, rect: WidgetRect) {
    setSettings((current) => ({
      ...current,
      customization:
        itemId === "clock"
          ? {
            ...current.customization,
            clockLayout: applySurfaceBlockRect(current.customization.clockLayout, rect),
          }
          : itemId === "search"
            ? {
              ...current.customization,
              searchLayout: applySurfaceBlockRect(current.customization.searchLayout, rect),
            }
            : current.customization,
      widgets:
        itemId === "clock" || itemId === "search"
          ? current.widgets
          : current.widgets.map((widget) =>
            widget.id === itemId ? applyWidgetRect(widget, rect) : widget),
    }));
  }

  const handleDocumentClick = useEffectEvent((event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (
      isAddMenuOpen &&
      addMenuRef.current &&
      addWidgetButtonRef.current &&
      !addMenuRef.current.contains(target) &&
      !addWidgetButtonRef.current.contains(target)
    ) {
      setIsAddMenuOpen(false);
    }

    if (
      dockItemMenu &&
      dockItemMenuRef.current &&
      !(target instanceof Element && target.closest("[data-dock-item-button]")) &&
      !dockItemMenuRef.current.contains(target)
    ) {
      setDockItemMenu(null);
    }

    if (
      isEditing &&
      !widgetInteractionRef.current &&
      !(target instanceof Element && target.closest(".widget-card"))
    ) {
      setSelectedWidgetId(null);
    }
  });

  const handleGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (launchpadDragState) {
        clearLaunchpadPressState();
        clearLaunchpadDragState();
        return;
      }

      if (launchpadFolderRename) {
        setLaunchpadFolderRename(null);
        return;
      }

      if (expandedFolderId) {
        setExpandedFolderId(null);
        return;
      }

      if (isLaunchpadEditMode) {
        stopLaunchpadEditing();
        return;
      }

      setDockItemMenu(null);
      setIsAddMenuOpen(false);
      closeLaunchpad();
      setHoveredDockId(null);
      setDockPointerX(null);
      clearWidgetInteraction();

      if (isEditing && !widgetInteractionRef.current) {
        setSelectedWidgetId(null);
      }
      return;
    }

    if (!isEditing || widgetInteractionRef.current) {
      return;
    }

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement
    ) {
      return;
    }

    if (!selectedWidgetId) {
      return;
    }

    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowRight" &&
      event.key !== "s" &&
      event.key !== "S"
    ) {
      return;
    }

    event.preventDefault();

    setSettings((current) => {
      const currentRect = getCurrentSurfaceItemRect(
        selectedWidgetId,
        current.customization,
        current.widgets,
      );
      if (!currentRect) {
        return current;
      }
      const occupiedEntries = getOccupiedLayoutEntries(current.customization, current.widgets);

      if (event.key === "s" || event.key === "S") {
        if (selectedWidgetId === "clock" || selectedWidgetId === "search") {
          return current;
        }
        const widget = current.widgets.find((item) => item.id === selectedWidgetId);
        if (!widget) {
          return current;
        }
        const nextSize = getNextWidgetSize(widget);
        const preferredRect = createWidgetRectFromSize(nextSize, {
          x: currentRect.x,
          y: currentRect.y,
        });
        const nextRect = isLayoutRectAvailable(occupiedEntries, preferredRect, selectedWidgetId)
          ? preferredRect
          : findFirstAvailableLayoutRect(
            occupiedEntries.filter((entry) => entry.id !== selectedWidgetId),
            preferredRect.w,
            preferredRect.h,
          );

        if (isSameWidgetRect(nextRect, currentRect)) {
          return current;
        }

        return {
          ...current,
          widgets: current.widgets.map((item) =>
            item.id === selectedWidgetId ? applyWidgetRect(item, nextRect) : item),
        };
      }

      const nextRect = event.shiftKey
        ? clampWidgetRect({
          h:
            event.key === "ArrowUp"
              ? currentRect.h - 1
              : event.key === "ArrowDown"
                ? currentRect.h + 1
                : currentRect.h,
          w:
            event.key === "ArrowLeft"
              ? currentRect.w - 1
              : event.key === "ArrowRight"
                ? currentRect.w + 1
                : currentRect.w,
          x: currentRect.x,
          y: currentRect.y,
        })
        : clampWidgetRect({
          h: currentRect.h,
          w: currentRect.w,
          x:
            event.key === "ArrowLeft"
              ? currentRect.x - 1
              : event.key === "ArrowRight"
                ? currentRect.x + 1
                : currentRect.x,
          y:
            event.key === "ArrowUp"
              ? currentRect.y - 1
              : event.key === "ArrowDown"
                ? currentRect.y + 1
                : currentRect.y,
        });

      if (
        isSameWidgetRect(nextRect, currentRect)
        || !isLayoutRectAvailable(occupiedEntries, nextRect, selectedWidgetId)
      ) {
        return current;
      }

      return {
        ...current,
        customization:
          selectedWidgetId === "clock"
            ? {
              ...current.customization,
              clockLayout: applySurfaceBlockRect(current.customization.clockLayout, nextRect),
            }
            : selectedWidgetId === "search"
              ? {
                ...current.customization,
                searchLayout: applySurfaceBlockRect(current.customization.searchLayout, nextRect),
              }
              : current.customization,
        widgets:
          selectedWidgetId === "clock" || selectedWidgetId === "search"
            ? current.widgets
            : current.widgets.map((item) =>
              item.id === selectedWidgetId ? applyWidgetRect(item, nextRect) : item),
      };
    });
  });

  const handleGlobalMouseMove = useEffectEvent((event: MouseEvent) => {
    const interaction = widgetInteractionRef.current;
    if (!interaction || widgetGridMetrics.cellSize <= 0) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - interaction.startClientX;
    const deltaY = event.clientY - interaction.startClientY;

    if (!interaction.isActive) {
      if (
        Math.abs(deltaX) < WIDGET_GRID_MOVE_THRESHOLD &&
        Math.abs(deltaY) < WIDGET_GRID_MOVE_THRESHOLD
      ) {
        return;
      }

      interaction.isActive = true;
      if (overlayRef.current) {
        overlayRef.current.style.display = "block";
      }
      setDraggingWidgetId(interaction.widgetId);
    }

    const deltaCols = Math.round(deltaX / widgetGridMetrics.pitch);
    const deltaRows = Math.round(deltaY / widgetGridMetrics.pitch);
    const candidateRect = interaction.mode === "move"
      ? clampWidgetRect({
        h: interaction.startRect.h,
        w: interaction.startRect.w,
        x: interaction.startRect.x + deltaCols,
        y: interaction.startRect.y + deltaRows,
      })
      : clampWidgetRect({
        h: interaction.startRect.h + deltaRows,
        w: interaction.startRect.w + deltaCols,
        x: interaction.startRect.x,
        y: interaction.startRect.y,
      });

    if (
      isSameWidgetRect(candidateRect, interaction.previewRect)
      || !isLayoutRectAvailable(getCurrentOccupiedEntries(), candidateRect, interaction.widgetId)
    ) {
      return;
    }

    interaction.previewRect = candidateRect;
    setWidgetDraft({
      rect: candidateRect,
      widgetId: interaction.widgetId,
    });
  });

  const handleGlobalMouseUp = useEffectEvent(() => {
    const interaction = widgetInteractionRef.current;
    if (!interaction) {
      return;
    }

    const shouldCommit =
      interaction.isActive && !isSameWidgetRect(interaction.previewRect, interaction.startRect);
    const { previewRect, widgetId } = interaction;
    clearWidgetInteraction();
    if (shouldCommit) {
      commitSurfaceItemRect(widgetId, previewRect);
    }
  });

  const handleLaunchpadGlobalPointerMove = useEffectEvent((event: PointerEvent) => {
    if (launchpadDragState) {
      if (event.pointerId !== launchpadDragState.pointerId) {
        return;
      }

      setLaunchpadDragState((current) =>
        current && current.pointerId === event.pointerId
          ? {
            ...current,
            currentX: event.clientX,
            currentY: event.clientY,
          }
          : current);
      setLaunchpadDropTarget(
        resolveLaunchpadDropTarget(
          event.clientX,
          event.clientY,
          launchpadDragState.sourceFolderId,
        ),
      );
      return;
    }

    const pending = launchpadPointerDownRef.current;
    if (!pending || event.pointerId !== pending.pointerId) {
      return;
    }

    const deltaX = event.clientX - pending.startX;
    const deltaY = event.clientY - pending.startY;
    const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);

    if (!isLaunchpadEditMode) {
      if (distanceSquared > 100) {
        clearLaunchpadPressState();
      }
      return;
    }

    if (pending.kind !== "bookmark" || distanceSquared <= 16) {
      return;
    }

    startLaunchpadBookmarkDrag(
      pending.bookmark,
      pending.sourceFolderId,
      pending.pointerId,
      event.clientX,
      event.clientY,
      pending.offsetX,
      pending.offsetY,
    );
    setLaunchpadDropTarget(
      resolveLaunchpadDropTarget(event.clientX, event.clientY, pending.sourceFolderId),
    );
  });

  const handleLaunchpadGlobalPointerUp = useEffectEvent((event: PointerEvent) => {
    const currentDragState = launchpadDragState;
    if (currentDragState && event.pointerId === currentDragState.pointerId) {
      const nextDropTarget = resolveLaunchpadDropTarget(
        event.clientX,
        event.clientY,
        currentDragState.sourceFolderId,
      );
      clearLaunchpadPressState();
      launchpadSuppressClickRef.current = true;
      scheduleLaunchpadSuppressClickReset();

      if (nextDropTarget) {
        clearLaunchpadDragState();
        void moveLaunchpadBookmark(currentDragState, nextDropTarget, currentDragState.sourceFolderId);
        return;
      }

      clearLaunchpadDragState();
      return;
    }

    const pending = launchpadPointerDownRef.current;
    if (pending && event.pointerId === pending.pointerId) {
      clearLaunchpadPressState();
      if (launchpadSuppressClickRef.current) {
        scheduleLaunchpadSuppressClickReset();
      }
    }
  });

  useEffect(() => {
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleGlobalKeyDown);
    document.addEventListener("mousemove", handleGlobalMouseMove);
    document.addEventListener("mouseup", handleGlobalMouseUp);
    document.addEventListener("pointermove", handleLaunchpadGlobalPointerMove);
    document.addEventListener("pointerup", handleLaunchpadGlobalPointerUp);
    document.addEventListener("pointercancel", handleLaunchpadGlobalPointerUp);

    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleGlobalKeyDown);
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
      document.removeEventListener("pointermove", handleLaunchpadGlobalPointerMove);
      document.removeEventListener("pointerup", handleLaunchpadGlobalPointerUp);
      document.removeEventListener("pointercancel", handleLaunchpadGlobalPointerUp);
      clearWidgetInteraction();
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
      }
      if (launchpadLongPressTimerRef.current !== null) {
        clearTimeout(launchpadLongPressTimerRef.current);
      }
      launchpadPointerDownRef.current = null;
      launchpadSuppressClickRef.current = false;
    };
  }, []);

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }

  function handlePageShellPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (surface !== "start" || isEditing || isLaunchpadOpen) {
      cancelLongPress();
      return;
    }

    const isPrimaryMousePress = event.pointerType !== "mouse" || event.button === 0;
    if (!isPrimaryMousePress || event.ctrlKey) {
      cancelLongPress();
      return;
    }

    const target = event.target as HTMLElement;
    const interactiveSelector =
      ".widget-card,.search-wrapper,.clock-widget,button,input,textarea,a,iframe,[data-dock-item-button]";
    if (target.closest(interactiveSelector)) {
      return;
    }

    longPressStartRef.current = { x: event.clientX, y: event.clientY };

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
      toggleEdit();
    }, 500);
  }

  function handlePageShellPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (longPressTimerRef.current === null || longPressStartRef.current === null) {
      return;
    }

    const dx = event.clientX - longPressStartRef.current.x;
    const dy = event.clientY - longPressStartRef.current.y;

    if (dx * dx + dy * dy > 100) {
      cancelLongPress();
    }
  }

  function handlePageShellPointerUp() {
    cancelLongPress();
  }

  function handlePageShellContextMenu() {
    cancelLongPress();
  }

  function toggleEdit() {
    const nextEditing = !isEditing;
    setIsAddMenuOpen(false);
    closeLaunchpad();
    setDockItemMenu(null);
    setIsEditing(nextEditing);

    if (!nextEditing) {
      clearWidgetInteraction();
      setSelectedWidgetId(null);
    }
  }

  function updateWidgets(updater: (widgets: Widget[]) => Widget[]) {
    setSettings((current) => ({
      ...current,
      widgets: updater(current.widgets.map(cloneWidget)),
    }));
  }

  function closeStartPageChrome() {
    setIsEditing(false);
    setSelectedWidgetId(null);
    clearWidgetInteraction();
    closeLaunchpad();
    setIsAddMenuOpen(false);
    setHoveredDockId(null);
    setDockPointerX(null);
    setDockItemMenu(null);
    setIsEmbedModalOpen(false);
    setIsProtocolModalOpen(false);
    setIsCustomModalOpen(false);
  }

  function setDockButtonRef(id: string, node: HTMLButtonElement | null) {
    if (!node) {
      dockButtonRefs.current.delete(id);
      return;
    }

    dockButtonRefs.current.set(id, node);
  }

  function getDockMotion(id: string) {
    const button = dockButtonRefs.current.get(id);
    if (!button || dockPointerX === null) {
      return { lift: 0, scale: 1 };
    }

    const rect = button.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const distance = Math.abs(dockPointerX - centerX);
    const influence = Math.max(0, 1 - (distance / 150));

    return {
      lift: Math.round(influence * 15),
      scale: Number((1 + (influence * 0.68)).toFixed(3)),
    };
  }

  function getBookmarkFolderPathLabel(folderId?: string | null) {
    if (!folderId) {
      return t("launchpadUnsorted");
    }

    const names: string[] = [];
    let cursor = bookmarkFolderById.get(folderId) ?? null;
    let guard = 0;

    while (cursor && guard < 64) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? bookmarkFolderById.get(cursor.parentId) ?? null : null;
      guard += 1;
    }

    return names.length > 0 ? names.join(" / ") : t("launchpadUnsorted");
  }

  function snapshotLaunchpadBookmark(bookmark: BookmarkRecord): LaunchpadBookmarkSnapshot {
    return {
      favicon: bookmark.favicon,
      folderId: bookmark.folderId ?? null,
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
    };
  }

  function clearLaunchpadPressState() {
    if (launchpadLongPressTimerRef.current !== null) {
      clearTimeout(launchpadLongPressTimerRef.current);
      launchpadLongPressTimerRef.current = null;
    }
    launchpadPointerDownRef.current = null;
  }

  function clearLaunchpadDragState() {
    setLaunchpadDragState(null);
    setLaunchpadDropTarget(null);
  }

  function stopLaunchpadEditing() {
    clearLaunchpadPressState();
    clearLaunchpadDragState();
    setIsLaunchpadEditMode(false);
  }

  function consumeSuppressedLaunchpadClick() {
    if (!launchpadSuppressClickRef.current) {
      return false;
    }

    launchpadSuppressClickRef.current = false;
    return true;
  }

  function scheduleLaunchpadSuppressClickReset() {
    window.setTimeout(() => {
      launchpadSuppressClickRef.current = false;
    }, 0);
  }

  function beginLaunchpadEditMode() {
    cancelLaunchpadFolderRename();
    setIsLaunchpadEditMode(true);
  }

  function startLaunchpadBookmarkDrag(
    bookmark: LaunchpadBookmarkSnapshot,
    sourceFolderId: string | null,
    pointerId: number,
    clientX: number,
    clientY: number,
    offsetX: number,
    offsetY: number,
  ) {
    beginLaunchpadEditMode();
    clearLaunchpadPressState();
    launchpadSuppressClickRef.current = true;
    setLaunchpadDragState({
      ...bookmark,
      currentX: clientX,
      currentY: clientY,
      offsetX,
      offsetY,
      pointerId,
      sourceFolderId,
    });
    setLaunchpadDropTarget(null);
  }

  function resolveLaunchpadDropTarget(
    pointerX: number,
    pointerY: number,
    sourceFolderId: string | null,
  ) {
    const folderTargets = document.querySelectorAll<HTMLElement>("[data-launchpad-folder-drop-target]");
    for (const folderTarget of folderTargets) {
      const folderId = folderTarget.getAttribute("data-launchpad-folder-drop-target");
      if (!folderId || folderId === sourceFolderId) {
        continue;
      }

      if (isPointInsideRect(pointerX, pointerY, folderTarget.getBoundingClientRect())) {
        return { kind: "folder", folderId } satisfies LaunchpadDropTarget;
      }
    }

    if (!sourceFolderId) {
      return null;
    }

    const dialogPanel = document.querySelector<HTMLElement>("[data-launchpad-folder-dialog-panel]");
    if (dialogPanel && isPointInsideRect(pointerX, pointerY, dialogPanel.getBoundingClientRect())) {
      return null;
    }

    const launchpadOverlay = document.querySelector<HTMLElement>(".launchpad-overlay");
    if (!launchpadOverlay || !isPointInsideRect(pointerX, pointerY, launchpadOverlay.getBoundingClientRect())) {
      return null;
    }

    return { kind: "root" } satisfies LaunchpadDropTarget;
  }

  async function removeLaunchpadBookmark(bookmarkId: string) {
    clearLaunchpadPressState();
    clearLaunchpadDragState();

    const browserShell = window.browserShell;
    if (!browserShell?.bookmarksRemove) {
      return;
    }

    try {
      const nextBookmarks = await browserShell.bookmarksRemove(bookmarkId);
      startTransition(() => {
        setBookmarks(nextBookmarks);
      });
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : t("launchpadBookmarkRemoveFailed"),
      );
    }
  }

  async function moveLaunchpadBookmark(
    bookmark: LaunchpadBookmarkSnapshot,
    target: LaunchpadDropTarget,
    sourceFolderId: string | null,
  ) {
    const browserShell = window.browserShell;
    if (!browserShell?.bookmarksUpdate) {
      return;
    }

    const nextFolderId = target.kind === "folder" ? target.folderId : null;
    if (nextFolderId === sourceFolderId) {
      return;
    }

    try {
      const nextBookmarks = await browserShell.bookmarksUpdate(bookmark.id, {
        title: bookmark.title,
        url: bookmark.url,
        favicon: bookmark.favicon,
        folderId: nextFolderId,
      });

      startTransition(() => {
        setBookmarks(nextBookmarks);
      });

      if (sourceFolderId && expandedFolderId === sourceFolderId) {
        setExpandedFolderId(null);
      }
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : t("launchpadBookmarkMoveFailed"),
      );
    }
  }

  function handleLaunchpadBookmarkPointerDown(
    bookmark: BookmarkRecord,
    sourceFolderId: string | null,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0 || event.ctrlKey) {
      clearLaunchpadPressState();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    clearLaunchpadPressState();

    const nextPointerDown: LaunchpadPointerDownState = {
      kind: "bookmark",
      bookmark: snapshotLaunchpadBookmark(bookmark),
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      sourceFolderId,
      startX: event.clientX,
      startY: event.clientY,
    };
    launchpadPointerDownRef.current = nextPointerDown;

    if (isLaunchpadEditMode) {
      return;
    }

    launchpadLongPressTimerRef.current = setTimeout(() => {
      const pending = launchpadPointerDownRef.current;
      if (!pending || pending.kind !== "bookmark" || pending.bookmark.id !== bookmark.id) {
        return;
      }

      startLaunchpadBookmarkDrag(
        pending.bookmark,
        pending.sourceFolderId,
        pending.pointerId,
        pending.startX,
        pending.startY,
        pending.offsetX,
        pending.offsetY,
      );
    }, 420);
  }

  function handleLaunchpadFolderPointerDown(
    folderId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    if (isLaunchpadEditMode || event.button !== 0 || event.ctrlKey) {
      clearLaunchpadPressState();
      return;
    }

    clearLaunchpadPressState();
    launchpadPointerDownRef.current = {
      kind: "folder",
      folderId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };

    launchpadLongPressTimerRef.current = setTimeout(() => {
      const pending = launchpadPointerDownRef.current;
      if (!pending || pending.kind !== "folder" || pending.folderId !== folderId) {
        return;
      }

      launchpadSuppressClickRef.current = true;
      beginLaunchpadEditMode();
      clearLaunchpadPressState();
    }, 420);
  }

  function beginLaunchpadFolderRename(folderId: string) {
    const folder = bookmarkFolderById.get(folderId);
    if (!folder) {
      return;
    }

    setLaunchpadFolderRename({
      folderId,
      pending: false,
      value: folder.name,
    });
  }

  function cancelLaunchpadFolderRename() {
    setLaunchpadFolderRename(null);
  }

  async function submitLaunchpadFolderRename() {
    if (!launchpadFolderRename || launchpadFolderRename.pending) {
      return;
    }

    const browserShell = window.browserShell;
    const folder = bookmarkFolderById.get(launchpadFolderRename.folderId);
    if (!browserShell?.bookmarksFolderUpdate || !folder) {
      setLaunchpadFolderRename(null);
      return;
    }

    const nextName = launchpadFolderRename.value.trim();
    if (!nextName) {
      setLaunchpadFolderRename(null);
      return;
    }

    if (nextName === folder.name.trim()) {
      setLaunchpadFolderRename(null);
      return;
    }

    setLaunchpadFolderRename((current) =>
      current && current.folderId === folder.id
        ? { ...current, pending: true }
        : current);

    try {
      const result = await browserShell.bookmarksFolderUpdate(folder.id, { name: nextName });
      startTransition(() => {
        setBookmarks(result.bookmarks);
        setBookmarkFolders(result.folders);
      });
      setLaunchpadFolderRename(null);
    } catch (error) {
      setLaunchpadFolderRename((current) =>
        current && current.folderId === folder.id
          ? { ...current, pending: false }
          : current);
      window.alert(
        error instanceof Error ? error.message : t("launchpadFolderRenameFailed"),
      );
    }
  }

  function closeLaunchpad() {
    stopLaunchpadEditing();
    setIsLaunchpadOpen(false);
    setLaunchpadQuery("");
    setExpandedFolderId(null);
    setLaunchpadFolderRename(null);
  }

  function toggleLaunchpad() {
    setDockItemMenu(null);
    setIsAddMenuOpen(false);
    setHoveredDockId(null);
    setDockPointerX(null);
    setLaunchpadQuery("");
    setExpandedFolderId(null);
    setLaunchpadFolderRename(null);
    stopLaunchpadEditing();
    setIsLaunchpadOpen((current) => !current);
  }

  async function openDockItem(item: StartPageDockItem) {
    closeLaunchpad();
    setIsAddMenuOpen(false);
    setDockItemMenu(null);

    const browserShell = window.browserShell;
    if (!browserShell) {
      window.location.href = item.url;
      return;
    }

    try {
      const bootstrap = await browserShell.getBootstrapData();
      await browserShell.tabCreate(bootstrap.currentWindow.id, item.url);
    } catch {
      window.location.href = item.url;
    }
  }

  async function openLaunchpadBookmark(bookmark: BookmarkRecord) {
    closeLaunchpad();
    setDockItemMenu(null);
    setIsAddMenuOpen(false);

    const browserShell = window.browserShell;
    if (!browserShell) {
      window.location.href = bookmark.url;
      return;
    }

    try {
      const bootstrap = await browserShell.getBootstrapData();
      await browserShell.tabCreate(bootstrap.currentWindow.id, bookmark.url);
    } catch {
      window.location.href = bookmark.url;
    }
  }

  async function handleRemoveDockItem(itemId: string) {
    setDockItemMenu(null);
    setHoveredDockId(null);

    const browserShell = window.browserShell;
    if (!browserShell?.startPageRemoveDockItem) {
      return;
    }

    try {
      const items = await browserShell.startPageRemoveDockItem(itemId);
      startTransition(() => {
        setDockItems(items);
      });
    } catch {
      // Ignore Dock removal failures and keep the current state.
    }
  }

  function getAgentStatusText(status: AgentSessionStatus) {
    switch (status) {
      case "running":
        return t("agentStatusRunning");
      case "waiting_event":
        return t("agentStatusWaitingEvent");
      case "queued":
        return t("agentStatusQueued");
      case "error":
        return t("agentStatusError");
      case "interrupted":
        return t("agentStatusInterrupted");
      case "idle":
      default:
        return t("agentStatusIdle");
    }
  }

  function getAgentActivityText() {
    switch (agentSession?.status) {
      case "running":
        return t("agentExecuting");
      case "waiting_event":
        return t("agentWaitingEvent");
      case "queued":
        return t("agentQueued");
      case "error":
        return t("agentErrorState");
      case "interrupted":
        return t("agentInterrupted");
      case "idle":
      default:
        return t("agentWaiting");
    }
  }

  function formatAgentBackendTitleSuffix() {
    const backend = agentSession?.backend;
    const model = backend?.model?.trim();
    if (!backend?.configured || !model) {
      return "";
    }

    const providerLabel =
      backend.providerName?.trim()
      || backend.providerId?.trim()
      || (backend.source === "env" ? "env" : "")
      || (backend.source === "translation-settings" ? "translation" : "")
      || backend.provider;

    return providerLabel ? `${providerLabel}/${model}` : model;
  }

  function toAgentSessionListItem(snapshot: AgentSessionSnapshot): AgentSessionListItem {
    return {
      sessionId: snapshot.sessionId,
      workspaceId: snapshot.workspaceId,
      windowId: snapshot.windowId,
      privacyMode: snapshot.privacyMode,
      automationWorkspaceBound: snapshot.automationWorkspaceBound,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      title: snapshot.title,
      preview: snapshot.preview,
      status: snapshot.status,
      messageCount: snapshot.messages.length,
      context: { ...snapshot.context },
      ...(snapshot.schedule ? { schedule: { ...snapshot.schedule } } : {}),
      ...(snapshot.eventTrigger ? { eventTrigger: { ...snapshot.eventTrigger } } : {}),
      ...(snapshot.plan ? { plan: { ...snapshot.plan, items: snapshot.plan.items.map((item) => ({ ...item })) } } : {}),
      ...(snapshot.lastError ? { lastError: snapshot.lastError } : {}),
    };
  }

  function syncAgentSessionSnapshot(snapshot: AgentSessionSnapshot) {
    setAgentSessions((current) => {
      const nextItem = toAgentSessionListItem(snapshot);
      const nextItems = [
        nextItem,
        ...current.filter((session) => session.sessionId !== snapshot.sessionId),
      ].sort((left, right) => right.updatedAt - left.updatedAt);
      return nextItems;
    });

    if (agentSessionIdRef.current === snapshot.sessionId) {
      setAgentSession((current) =>
        shouldReplaceAgentSessionSnapshot(current, snapshot) ? snapshot : current,
      );
    }
  }

  function removeAgentSessionSnapshot(sessionId: string) {
    setAgentSessions((current) =>
      current.filter((session) => session.sessionId !== sessionId));
    setSelectedAgentSessionId((current) => current === sessionId ? null : current);
    setAgentSession((current) => current?.sessionId === sessionId ? null : current);
  }

  function formatAgentTaskTime(timestamp: number) {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(timestamp);
  }

  function getEventTriggerStatusText(status: AgentSessionEventTriggerStatus | undefined) {
    switch (status) {
      case "skipped":
        return t("agentTaskManagerTriggerStatusSkipped");
      case "failed":
        return t("agentTaskManagerTriggerStatusFailed");
      case "triggered":
      default:
        return t("agentTaskManagerTriggerStatusTriggered");
    }
  }

  function formatEventTriggerMatch(trigger: AgentSessionEventTriggerSnapshot) {
    const match = trigger.match;
    if (!match) {
      return t("agentTaskManagerEventAnyMatch");
    }

    const parts = [
      ...(match.kinds?.length ? [`kind=${match.kinds.join(",")}`] : []),
      ...(match.source ? [`source=${match.source}`] : []),
      ...(match.urlMatches ? [`url~${match.urlMatches}`] : []),
      ...(match.titleMatches ? [`title~${match.titleMatches}`] : []),
      ...(match.summaryMatches ? [`summary~${match.summaryMatches}`] : []),
    ];
    return parts.join(" · ") || t("agentTaskManagerEventAnyMatch");
  }

  async function getCurrentAgentWindowContext() {
    const browserShell = window.browserShell;
    if (!browserShell) {
      throw new Error("Browser shell API is not available.");
    }

    const bootstrap = await browserShell.getBootstrapData();
    return {
      workspaceId: bootstrap.currentWorkspace.id,
      windowId: bootstrap.currentWindow.id,
    };
  }

  function navigateToSurface(nextSurface: SurfaceView, sessionId?: string | null) {
    window.location.href = buildSurfacePageUrl(nextSurface, sessionId);
  }

  function openAgentWorkspace(sessionId?: string | null) {
    closeStartPageChrome();
    if (surface === "agent" && (!sessionId || sessionId === selectedAgentSessionId)) {
      return;
    }
    navigateToSurface("agent", sessionId);
  }

  function openTaskManager() {
    closeStartPageChrome();
    if (surface === "tasks") {
      return;
    }
    navigateToSurface("tasks", selectedAgentSessionId);
  }

  async function handleOpenAgentWorkspaceWindow() {
    const browserShell = window.browserShell;
    if (!browserShell || !selectedAgentWorkspaceId || openingAgentWorkspaceWindow) {
      return;
    }

    setOpeningAgentWorkspaceWindow(true);
    try {
      await browserShell.openWorkspaceWindow(selectedAgentWorkspaceId);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : t("agentOpenWorkspaceWindowFailed"),
      );
    } finally {
      setOpeningAgentWorkspaceWindow(false);
    }
  }

  async function loadAgentSessionsForCurrentWindow() {
    const browserShell = window.browserShell;
    if (!browserShell) {
      throw new Error("Browser shell API is not available.");
    }

    const context = await getCurrentAgentWindowContext();
    const sessions = await browserShell.agentListSessions(context);

    startTransition(() => {
      setAgentSessions(sessions);
      setSelectedAgentSessionId((current) =>
        current && sessions.some((session) => session.sessionId === current)
          ? current
          : current ? null : current,
      );
    });

    return sessions;
  }

  async function loadAgentSessionById(sessionId: string) {
    const browserShell = window.browserShell;
    if (!browserShell) {
      throw new Error("Browser shell API is not available.");
    }

    const snapshot = await browserShell.agentGetSession(sessionId);
    if (!snapshot) {
      startTransition(() => {
        removeAgentSessionSnapshot(sessionId);
      });
      return null;
    }

    startTransition(() => {
      setSelectedAgentSessionId(sessionId);
      setAgentSession(snapshot);
      syncAgentSessionSnapshot(snapshot);
    });

    return snapshot;
  }

  async function sendToAgent(
    prompt: string,
    options?: {
      sessionId?: string | null;
      forceNewTask?: boolean;
      privacyMode?: boolean;
      profile?: "default" | "organizer" | "widget-builder";
    },
  ) {
    const value = prompt.trim();
    if (!value) {
      return;
    }

    try {
      const browserShell = window.browserShell;
      if (!browserShell) {
        return;
      }

      setSearchValue("");
      const targetSessionId = options?.forceNewTask ? null : options?.sessionId ?? null;
      const requestedProfile = options?.profile ?? pendingAgentProfile;
      const updated = targetSessionId
        ? await browserShell.agentSendMessage({
          sessionId: targetSessionId,
          content: value,
        })
        : await browserShell.agentCreateSession({
          ...(await getCurrentAgentWindowContext()),
          content: value,
          privacyMode: options?.privacyMode,
          ...(requestedProfile !== "default" ? { profile: requestedProfile } : {}),
        });
      startTransition(() => {
        setSelectedAgentSessionId(updated.sessionId);
        setAgentSession(updated);
        syncAgentSessionSnapshot(updated);
        setPendingAgentProfile("default");
      });
      openAgentWorkspace(updated.sessionId);
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      startTransition(() => {
        setAgentSession((current) => {
          const fallbackSession = current ?? {
            backend: {
              configured: false,
              endpoint: null,
              model: null,
              provider: "openai-compatible",
              providerId: null,
              providerName: null,
              source: "missing" as const,
            },
            context: {
              browserSessionCount: 0,
              recentEventCount: 0,
              subscriptionCount: 0,
            },
            createdAt: Date.now(),
            title: t("agentTaskManagerTitle"),
            preview: content,
            messages: [],
            sessionId: createLocalId("agent-session"),
            status: "error" as const,
            updatedAt: Date.now(),
            windowId: 0,
            workspaceId: "unknown",
            privacyMode: true,
            automationWorkspaceBound: false,
          };

          return {
            ...fallbackSession,
            status: "error",
            updatedAt: Date.now(),
            lastError: content,
            messages: [
              ...fallbackSession.messages,
              {
                content,
                createdAt: Date.now(),
                id: createLocalId("agent-error"),
                kind: "error",
                role: "system",
                state: "failed",
              },
            ],
          };
        });
      });
      openAgentWorkspace();
    }
  }

  function handleAgentInputSend() {
    const value = agentInput.trim();
    if (!value) return;
    agentChatForceScrollRef.current = true;
    setAgentInput("");
    void sendToAgent(value, {
      sessionId: selectedAgentSessionId,
      ...(!selectedAgentSessionId ? { privacyMode: agentPrivacyEnabled } : {}),
    });
  }

  function handleAgentInputKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleAgentInputSend();
    }
  }

  function handleAgentReset() {
    setSelectedAgentSessionId(null);
    setAgentSession(null);
    setAgentInput("");
    setPendingAgentProfile("default");
    openAgentWorkspace();
  }

  async function handleOpenAgentSession(sessionId: string) {
    try {
      const browserShell = window.browserShell;
      if (!browserShell) {
        openAgentWorkspace(sessionId);
        return;
      }

      const context = await getCurrentAgentWindowContext();
      await browserShell.tabCreate(
        context.windowId,
        buildSurfacePageUrl("agent", sessionId),
      );
    } catch (error) {
      console.error(`Failed to open agent session ${sessionId} in a new tab.`, error);
      openAgentWorkspace(sessionId);
    }
  }

  async function handleInterruptAgentSession(sessionId: string) {
    const browserShell = window.browserShell;
    const targetSession = agentSessions.find((session) => session.sessionId === sessionId) ?? null;
    if (
      !browserShell
      || interruptingAgentSessionId === sessionId
      || !canInterruptAgentSession(
        (sessionId === selectedAgentSessionId ? currentAgentSessionStatus : null)
        ?? targetSession?.status,
        Boolean((sessionId === selectedAgentSessionId ? agentSession?.eventTrigger : null) ?? targetSession?.eventTrigger),
      )
    ) {
      return;
    }

    setInterruptingAgentSessionId(sessionId);

    try {
      const snapshot = await browserShell.agentInterruptSession(sessionId);
      startTransition(() => {
        syncAgentSessionSnapshot(snapshot);
        if (selectedAgentSessionId === sessionId) {
          setAgentSession(snapshot);
        }
      });
    } catch (error) {
      console.error(`Failed to interrupt agent session ${sessionId}.`, error);
    } finally {
      setInterruptingAgentSessionId((current) => current === sessionId ? null : current);
    }
  }

  async function handleResumeAgentSession(sessionId: string) {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    const snapshot = await browserShell.agentResumeSession(sessionId);
    startTransition(() => {
      setSelectedAgentSessionId(sessionId);
      setAgentSession(snapshot);
      syncAgentSessionSnapshot(snapshot);
    });
    openAgentWorkspace(sessionId);
  }

  async function handleDeleteAgentSession(sessionId: string) {
    const browserShell = window.browserShell;
    if (!browserShell) {
      return;
    }

    await browserShell.agentDeleteSession(sessionId);
    startTransition(() => {
      removeAgentSessionSnapshot(sessionId);
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = searchValue.trim();
    if (!value) {
      return;
    }

    if (searchMode === "agent") {
      void sendToAgent(value, {
        forceNewTask: true,
        privacyMode: agentPrivacyEnabled,
      });
      return;
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
      window.location.href = value;
      return;
    }

    if (
      /^([\w.-]+\.[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(
        value,
      )
    ) {
      window.location.href = `https://${value}`;
      return;
    }

    window.location.href = resolveSearchUrl(customization, value);
  }

  function appendWidgetToSettings(nextWidget: Widget) {
    setSettings((current) => ({
      ...current,
      widgets: [
        ...current.widgets,
        applyWidgetRect(
          nextWidget,
          findFirstAvailableLayoutRect(
            getOccupiedLayoutEntries(current.customization, current.widgets),
            nextWidget.gridW,
            nextWidget.gridH,
          ),
        ),
      ],
    }));
  }

  async function resolveInitialProtocolWidgetSize(
    parsed: StartPageProtocolWidgetParseResult,
  ) {
    const fallbackSize =
      parsed.kind === "iframe"
        ? { gridH: 6, gridW: 6 }
        : { gridH: 4, gridW: 4 };

    if (parsed.kind !== "package") {
      return fallbackSize;
    }

    const cachedPackage = widgetPackages.find((widgetPackage) => widgetPackage.id === parsed.packageId);
    const browserShell = window.browserShell;
    const widgetPackage = cachedPackage
      ?? await browserShell?.widgetRegistryGetPackage?.(parsed.packageId).catch(() => null);
    if (!widgetPackage) {
      return fallbackSize;
    }

    return {
      gridH: clampWidgetGridSpan(widgetPackage.defaultSize.h, WIDGET_GRID_SCAN_LIMIT),
      gridW: clampWidgetGridSpan(widgetPackage.defaultSize.w, WIDGET_GRID_COLUMNS),
    };
  }

  async function appendProtocolWidgetFromSource(
    sourceInput: string,
    titleInput?: string | null,
    options?: { skipIfExists?: boolean },
  ) {
    const source = sourceInput.trim();
    const parsed = parseStartPageProtocolWidgetSource(source);
    if (parsed.kind === "error") {
      return {
        errorCode: parsed.code,
        ok: false as const,
      };
    }

    const title = typeof titleInput === "string" && titleInput.trim()
      ? titleInput.trim()
      : parsed.defaultTitle;
    const initialSize = await resolveInitialProtocolWidgetSize(parsed);
    const widgetId = createWidgetId("protocol");
    const skipIfExists = options?.skipIfExists !== false;
    let resolvedWidgetId = widgetId;
    let wasAdded = false;

    setSettings((current) => {
      if (skipIfExists) {
        const existingWidget = current.widgets.find((widget) =>
          widget.type === "protocol" && widget.source === source);
        if (existingWidget) {
          resolvedWidgetId = existingWidget.id;
          return current;
        }
      }

      wasAdded = true;
      return {
        ...current,
        widgets: [
          ...current.widgets,
          applyWidgetRect(
            {
              gridH: initialSize.gridH,
              gridW: initialSize.gridW,
              gridX: 0,
              gridY: 0,
              id: widgetId,
              source,
              title,
              type: "protocol",
            },
            findFirstAvailableLayoutRect(
              getOccupiedLayoutEntries(current.customization, current.widgets),
              initialSize.gridW,
              initialSize.gridH,
            ),
          ),
        ],
      };
    });

    return {
      added: wasAdded,
      ok: true as const,
      title,
      widgetId: resolvedWidgetId,
    };
  }

  async function refreshWidgetPackages() {
    const browserShell = window.browserShell;
    if (!browserShell?.widgetRegistryListPackages) {
      setWidgetPackages([]);
      return [];
    }

    const packages = await browserShell.widgetRegistryListPackages();
    setWidgetPackages(packages);
    return packages;
  }

  function openEmbedModal() {
    closeLaunchpad();
    setIsAddMenuOpen(false);
    setDockItemMenu(null);
    setEmbedForm({ title: "", url: "" });
    setIsEmbedModalOpen(true);
  }

  function closeEmbedModal() {
    setIsEmbedModalOpen(false);
  }

  function openProtocolModal() {
    closeLaunchpad();
    setIsAddMenuOpen(false);
    setDockItemMenu(null);
    setProtocolForm({ source: "", title: "" });
    setIsProtocolModalOpen(true);
  }

  function closeProtocolModal() {
    setIsProtocolModalOpen(false);
  }

  function getProtocolWidgetErrorMessage(code: StartPageProtocolWidgetErrorCode) {
    switch (code) {
      case "missing_source":
        return t("widgetProtocolMissingSource");
      case "unsupported_widget":
        return t("widgetProtocolUnsupported");
      case "invalid_source":
      default:
        return t("widgetProtocolInvalid");
    }
  }

  async function handleRevealWidgetDirectory() {
    const browserShell = window.browserShell;
    if (!browserShell?.widgetRegistryRevealRootDirectory) {
      window.alert(t("openWidgetDirectoryFailed"));
      return;
    }

    try {
      await browserShell.widgetRegistryRevealRootDirectory();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("openWidgetDirectoryFailed"));
    }
  }

  async function handleOpenWidgetManager() {
    const browserShell = window.browserShell;
    if (!browserShell?.getBootstrapData || !browserShell.tabCreate) {
      window.location.href = WIDGETS_PAGE_URL;
      return;
    }

    try {
      const bootstrap = await browserShell.getBootstrapData();
      await browserShell.tabCreate(bootstrap.currentWindow.id, WIDGETS_PAGE_URL);
      closeProtocolModal();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("openWidgetManagerFailed"));
    }
  }

  function applyProtocolPackageSource(widgetPackage: WidgetPackageSummary) {
    setProtocolForm((current) => ({
      ...current,
      source: `widget://package/${widgetPackage.id}`,
      title: current.title.trim() ? current.title : widgetPackage.defaultTitle,
    }));
  }

  async function handleInstallWidgetPackage() {
    const browserShell = window.browserShell;
    if (
      !browserShell?.widgetRegistryPickPackageDirectory
      || !browserShell.widgetRegistryInspectPackageDirectory
      || !browserShell.widgetRegistryInstallPackageFromDirectory
    ) {
      window.alert(t("installWidgetPackageFailed"));
      return;
    }

    setIsWidgetPackageInstalling(true);
    try {
      const selectedPath = await browserShell.widgetRegistryPickPackageDirectory();
      if (!selectedPath) {
        return;
      }

      const inspectedPackage = await browserShell.widgetRegistryInspectPackageDirectory(selectedPath);
      const existingPackage = widgetPackages.find((entry) => entry.id === inspectedPackage.id);
      if (existingPackage) {
        const confirmed = window.confirm(
          tf("installWidgetPackageReplaceConfirm", {
            id: existingPackage.id,
            name: existingPackage.name,
          }),
        );
        if (!confirmed) {
          return;
        }
      }

      const installedPackage = await browserShell.widgetRegistryInstallPackageFromDirectory(selectedPath);
      const packages = await refreshWidgetPackages();
      if (!packages.some((entry) => entry.id === installedPackage.id)) {
        setWidgetPackages((current) => {
          const nextPackages = [...current, installedPackage];
          return nextPackages.sort((left, right) => left.name.localeCompare(right.name));
        });
      }
      applyProtocolPackageSource(installedPackage);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("installWidgetPackageFailed"));
    } finally {
      setIsWidgetPackageInstalling(false);
    }
  }

  function handleEmbedSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = embedForm.title.trim();
    let url = embedForm.url.trim();
    if (!title || !url) {
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    appendWidgetToSettings({
      gridH: 3,
      gridW: 6,
      gridX: 0,
      gridY: 0,
      id: createWidgetId("embed"),
      title,
      type: "embed",
      url,
    });

    closeEmbedModal();
  }

  async function handleProtocolSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = await appendProtocolWidgetFromSource(protocolForm.source, protocolForm.title);
    if (!result.ok) {
      window.alert(getProtocolWidgetErrorMessage(result.errorCode));
      return;
    }

    closeProtocolModal();
  }

  function openCustomModal() {
    closeLaunchpad();
    setIsAddMenuOpen(false);
    setDockItemMenu(null);
    setCustomForm({ ...settings.customization });
    setCustomTheme(settings.theme);
    setCustomBackgroundImage(settings.backgroundImage);
    setBackgroundUploadError(null);
    setIsBackgroundUploading(false);
    setSettingsSection("general");
    setIsCustomModalOpen(true);
  }

  function closeCustomModal() {
    setIsCustomModalOpen(false);
    setBackgroundUploadError(null);
  }

  function openBackgroundImagePicker() {
    backgroundImageInputRef.current?.click();
  }

  async function handleBackgroundImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    setBackgroundUploadError(null);
    setIsBackgroundUploading(true);

    try {
      const nextBackgroundImage = await serializeBackgroundImageFile(file);
      setCustomBackgroundImage(nextBackgroundImage);
      setSettings((current) =>
        current.backgroundImage === nextBackgroundImage
          ? current
          : {
            ...current,
            backgroundImage: nextBackgroundImage,
          });
    } catch {
      setBackgroundUploadError(t("appearanceBackgroundUploadError"));
    } finally {
      setIsBackgroundUploading(false);
    }
  }

  function handleReset() {
    clearWidgetInteraction();
    setSelectedWidgetId(null);
    setIsEditing(false);
    closeLaunchpad();
    setIsAddMenuOpen(false);
    setHoveredDockId(null);
    setDockPointerX(null);
    setDockItemMenu(null);
    setIsEmbedModalOpen(false);
    setIsCustomModalOpen(false);
    setSettings({
      backgroundImage: null,
      customization: createDefaultCustomization(locale),
      theme: "default",
      widgets: createDefaultWidgets(locale),
    });

    const browserShell = window.browserShell;
    if (!browserShell?.startPageClearDockItems) {
      setDockItems([]);
      return;
    }

    void browserShell.startPageClearDockItems()
      .then((items) => {
        startTransition(() => {
          setDockItems(items);
        });
      })
      .catch(() => {
        // Ignore Dock reset failures and keep the updated page settings.
      });
  }

  function handleResetPreferences() {
    const defaults = createDefaultCustomization(locale);
    setCustomForm(defaults);
    setCustomTheme("default");
    setCustomBackgroundImage(null);
    setBackgroundUploadError(null);
    setSettings((current) => ({
      ...current,
      backgroundImage: null,
      customization: defaults,
      theme: "default",
    }));
  }

  function handleResetWidgets() {
    setSettings((current) => ({
      ...current,
      widgets: createDefaultWidgets(locale),
    }));
    setSelectedWidgetId(null);
    clearWidgetInteraction();
    setIsEditing(false);
  }

  async function handleClearDockItems() {
    setDockItemMenu(null);

    const browserShell = window.browserShell;
    if (!browserShell?.startPageClearDockItems) {
      setDockItems([]);
      return;
    }

    try {
      const items = await browserShell.startPageClearDockItems();
      startTransition(() => {
        setDockItems(items);
      });
    } catch {
      // Ignore Dock reset failures and keep the current state.
    }
  }

  function handleAddNotesWidget() {
    setIsAddMenuOpen(false);
    setDockItemMenu(null);

    setSettings((current) => {
      const widget: NotesWidget = {
        content: "",
        gridH: 6,
        gridW: 6,
        gridX: 0,
        gridY: 0,
        id: createWidgetId("notes"),
        title: t("notesTitle"),
        type: "notes",
      };

      return {
        ...current,
        widgets: [
          ...current.widgets,
          applyWidgetRect(
            widget,
            findFirstAvailableLayoutRect(
              getOccupiedLayoutEntries(current.customization, current.widgets),
              widget.gridW,
              widget.gridH,
            ),
          ),
        ],
      };
    });

    if (!isEditing) {
      setIsEditing(true);
    }
  }

  function handleWidgetMouseDown(
    widgetId: string,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!isEditing) {
      return;
    }

    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(".widget-delete") ||
      target.closest(".widget-edit-toolbar") ||
      target.closest(".widget-move-handle") ||
      target.closest(".notes-text")
    ) {
      return;
    }

    setSelectedWidgetId(widgetId);
  }

  function handleSurfaceItemMouseDown(
    itemId: "clock" | "search",
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!isEditing) {
      return;
    }

    const target = event.target;
    if (
      !(target instanceof Element)
      || target.closest(".widget-delete")
      || target.closest(".widget-edit-toolbar")
      || target.closest(".widget-move-handle")
      || target.closest(".widget-resize-handle")
    ) {
      return;
    }

    setSelectedWidgetId(itemId);
  }

  function setSurfaceItemVisibility(itemId: "clock" | "search", visible: boolean) {
    const customizationKey = itemId === "clock" ? "showClock" : "showSearch";

    setCustomForm((current) =>
      current[customizationKey] === visible ? current : { ...current, [customizationKey]: visible });
    setSettings((current) =>
      current.customization[customizationKey] === visible
        ? current
        : {
          ...current,
          customization: {
            ...current.customization,
            [customizationKey]: visible,
          },
        });
  }

  function beginWidgetInteraction(
    widgetId: SurfaceItemId,
    mode: WidgetInteractionMode,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!isEditing || widgetGridMetrics.cellSize <= 0) {
      return;
    }

    const target = event.target;
    if (
      target instanceof Element &&
      (
        target.closest(".widget-delete")
        || (mode === "move" && target.closest(".widget-resize-handle"))
      )
    ) {
      return;
    }

    const currentRect = getCurrentSurfaceItemRect(widgetId);
    if (!currentRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedWidgetId(widgetId);
    widgetInteractionRef.current = {
      isActive: false,
      mode,
      previewRect: currentRect,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: currentRect,
      widgetId,
    };
    document.body.style.setProperty("cursor", mode === "move" ? "grabbing" : "nwse-resize");
    document.body.style.setProperty("user-select", "none");
  }

  function removeWidget(widgetId: string) {
    updateWidgets((widgets) =>
      widgets.filter((widget) => widget.id !== widgetId),
    );
  }

  function updateNotesWidget(widgetId: string, content: string) {
    updateWidgets((widgets) =>
      widgets.map((widget) =>
        widget.id === widgetId && widget.type === "notes"
          ? { ...widget, content }
          : widget,
      ),
    );
  }

  const pageShellClassName = [
    "page-shell",
    surface === "start" ? "start-page-shell" : "agent-page-shell",
    surface === "start" && isEditing ? "is-editing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const renderedClockRect = widgetDraftState?.widgetId === "clock"
    ? widgetDraftState.rect
    : getSurfaceBlockRect(customization.clockLayout);
  const renderedSearchRect = widgetDraftState?.widgetId === "search"
    ? widgetDraftState.rect
    : getSurfaceBlockRect(customization.searchLayout);
  const renderedWidgets = settings.widgets.map((widget) =>
    widgetDraftState?.widgetId === widget.id
      ? applyWidgetRect(widget, widgetDraftState.rect)
      : widget);
  const widgetGridRowCount = Math.max(
    6,
    customization.showClock ? renderedClockRect.y + renderedClockRect.h : 0,
    customization.showSearch ? renderedSearchRect.y + renderedSearchRect.h : 0,
    ...renderedWidgets.map((widget) => widget.gridY + widget.gridH),
  );
  const widgetGridStyle = widgetGridMetrics.cellSize > 0
    ? ({
      "--widget-grid-cell-size": `${widgetGridMetrics.cellSize}px`,
      "--widget-grid-row-count": `${widgetGridRowCount}`,
    } as CSSProperties)
    : undefined;
  const dockMenuPosition = dockItemMenu
    ? {
      left:
        typeof window === "undefined"
          ? dockItemMenu.x
          : Math.max(12, Math.min(dockItemMenu.x, window.innerWidth - 196)),
      top:
        typeof window === "undefined"
          ? dockItemMenu.y
          : Math.max(12, Math.min(dockItemMenu.y, window.innerHeight - 76)),
    }
    : null;
  const settingsSections = [
    {
      description: t("settingsGeneralDesc"),
      icon: SlidersHorizontal,
      id: "general" as const,
      label: t("settingsGeneral"),
    },
    {
      description: t("settingsAppearanceDesc"),
      icon: Palette,
      id: "appearance" as const,
      label: t("settingsAppearance"),
    },
    {
      description: t("settingsDockDesc"),
      icon: PanelBottom,
      id: "dock" as const,
      label: t("settingsDock"),
    },
    {
      description: t("settingsDataDesc"),
      icon: Database,
      id: "data" as const,
      label: t("settingsData"),
    },
  ];
  const activeSettingsSection = settingsSections.find((section) => section.id === settingsSection)
    ?? settingsSections[0]!;
  const activeTheme = themes.find((theme) => theme.id === customTheme) ?? themes[0]!;
  const activeThemeGradient = getThemeGradient(activeTheme, isLight);
  const agentBackendTitleSuffix = formatAgentBackendTitleSuffix();
  const settingsPanelContent = (() => {
    switch (settingsSection) {
      case "appearance":
        return (
          <>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("appearanceThemeTitle")}</h4>
                  <p>{t("appearanceThemeDesc")}</p>
                </div>
                <span className="settings-pill">{activeTheme.id}</span>
              </div>
              <div className="settings-theme-grid">
                {themes.map((theme) => (
                  <button
                    className={`settings-theme-card${theme.id === customTheme ? " is-active" : ""}`}
                    key={theme.id}
                    onClick={() => {
                      setCustomTheme(theme.id);
                    }}
                    type="button"
                  >
                    <span
                      className="settings-theme-preview"
                      style={{ background: getThemeGradient(theme, isLight) }}
                    />
                    <span className="settings-theme-name">{theme.id}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("appearanceBackgroundTitle")}</h4>
                  <p>{t("appearanceBackgroundDesc")}</p>
                </div>
              </div>
              <div className="settings-background-card">
                <div
                  className={`settings-background-preview${customBackgroundImage ? " has-image" : ""}`}
                  style={{
                    backgroundColor: getStartPageBackgroundBaseColor(isLight),
                    backgroundImage: customBackgroundImage
                      ? `${
                        isLight
                          ? "linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.38))"
                          : "linear-gradient(180deg, rgba(4, 7, 15, 0.18), rgba(4, 7, 15, 0.52))"
                      }, url("${customBackgroundImage}")`
                      : activeThemeGradient,
                  }}
                >
                  <span className="settings-background-badge">
                    {customBackgroundImage
                      ? t("appearanceBackgroundActive")
                      : t("appearanceBackgroundEmpty")}
                  </span>
                </div>
                <p className="settings-background-hint">
                  {backgroundUploadError ?? t("appearanceBackgroundHint")}
                </p>
                <div className="settings-background-actions">
                  <input
                    accept="image/*"
                    className="settings-file-input"
                    onChange={(event) => {
                      void handleBackgroundImageChange(event);
                    }}
                    ref={backgroundImageInputRef}
                    type="file"
                  />
                  <button
                    className="settings-inline-button"
                    disabled={isBackgroundUploading}
                    onClick={openBackgroundImagePicker}
                    type="button"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>
                      {isBackgroundUploading
                        ? t("appearanceBackgroundProcessing")
                        : customBackgroundImage
                          ? t("appearanceBackgroundReplace")
                          : t("appearanceBackgroundUpload")}
                    </span>
                  </button>
                  <button
                    className="settings-inline-button danger"
                    disabled={!customBackgroundImage || isBackgroundUploading}
                    onClick={() => {
                      setCustomBackgroundImage(null);
                      setBackgroundUploadError(null);
                    }}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t("appearanceBackgroundRemove")}</span>
                  </button>
                </div>
              </div>
            </section>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("appearanceClockTitle")}</h4>
                  <p>{t("appearanceClockDesc")}</p>
                </div>
              </div>
              <div className="settings-control-stack">
                <label className="settings-toggle-row" htmlFor="cfShowSeconds">
                  <div>
                    <span className="settings-row-title">{t("showSeconds")}</span>
                  </div>
                  <span className="settings-toggle">
                    <input
                      checked={customForm.showSeconds}
                      id="cfShowSeconds"
                      onChange={(event) => {
                        setCustomForm((current) => ({
                          ...current,
                          showSeconds: event.target.checked,
                        }));
                      }}
                      type="checkbox"
                    />
                    <span className="settings-toggle-track">
                      <span className="settings-toggle-thumb" />
                    </span>
                  </span>
                </label>
                <div className="settings-split-grid">
                  <div className="modal-field settings-field">
                    <label htmlFor="cfTimeFormat">{t("timeFormat")}</label>
                    <select
                      id="cfTimeFormat"
                      onChange={(event) => {
                        setCustomForm((current) => ({
                          ...current,
                          timeFormat: event.target.value === "12h" ? "12h" : "24h",
                        }));
                      }}
                      value={customForm.timeFormat}
                    >
                      <option value="24h">{t("timeFormat24")}</option>
                      <option value="12h">{t("timeFormat12")}</option>
                    </select>
                  </div>
                  <div className="modal-field settings-field">
                    <label htmlFor="cfDateStyle">{t("dateStyle")}</label>
                    <select
                      id="cfDateStyle"
                      onChange={(event) => {
                        setCustomForm((current) => ({
                          ...current,
                          dateStyle:
                            event.target.value === "zh" || event.target.value === "iso"
                              ? event.target.value
                              : "en",
                        }));
                      }}
                      value={customForm.dateStyle}
                    >
                      <option value="en">{t("dateStyleEnSample")}</option>
                      <option value="zh">{t("dateStyleZhSample")}</option>
                      <option value="iso">{t("dateStyleIsoSample")}</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </>
        );
      case "dock":
        return (
          <section className="settings-panel-card">
            <div className="settings-card-header">
              <div>
                <h4>{t("dockManageTitle")}</h4>
                <p>{t("dockManageDesc")}</p>
              </div>
              <div className="settings-card-actions">
                <span className="settings-pill">{dockItems.length}</span>
                <button
                  className="settings-inline-button danger"
                  disabled={dockItems.length === 0}
                  onClick={() => {
                    void handleClearDockItems();
                  }}
                  type="button"
                >
                  {t("dockClearAll")}
                </button>
              </div>
            </div>
            {dockItems.length === 0 ? (
              <div className="settings-empty-state">
                <PanelBottom className="settings-empty-icon" />
                <h5>{t("dockEmptyTitle")}</h5>
                <p>{t("dockEmptyDesc")}</p>
              </div>
            ) : (
              <div className="settings-dock-list">
                {dockItems.map((item) => (
                  <div className="settings-dock-item" key={item.id}>
                    <span className="settings-dock-icon">
                      <DockItemIcon item={item} />
                    </span>
                    <div className="settings-dock-meta">
                      <span className="settings-row-title">{item.title}</span>
                      <span className="settings-row-subtitle">{item.url}</span>
                    </div>
                    <div className="settings-dock-actions">
                      <button
                        className="settings-inline-button"
                        onClick={() => {
                          void openDockItem(item);
                        }}
                        type="button"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>{t("dockOpenItem")}</span>
                      </button>
                      <button
                        className="settings-inline-button danger"
                        onClick={() => {
                          void handleRemoveDockItem(item.id);
                        }}
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{t("dockRemoveItem")}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      case "data":
        return (
          <>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("dataOverviewTitle")}</h4>
                  <p>{t("dataOverviewDesc")}</p>
                </div>
              </div>
              <div className="settings-overview-grid">
                <div className="settings-overview-card">
                  <span className="settings-overview-label">{t("dataWidgetsCount")}</span>
                  <strong>{settings.widgets.length}</strong>
                </div>
                <div className="settings-overview-card">
                  <span className="settings-overview-label">{t("dataDockCount")}</span>
                  <strong>{dockItems.length}</strong>
                </div>
                <div className="settings-overview-card">
                  <span className="settings-overview-label">{t("dataThemeValue")}</span>
                  <strong>{activeTheme.id}</strong>
                </div>
              </div>
            </section>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("dataActionsTitle")}</h4>
                  <p>{t("dataActionsDesc")}</p>
                </div>
              </div>
              <div className="settings-action-list">
                <div className="settings-action-row">
                  <div className="settings-action-copy">
                    <span className="settings-row-title">{t("dataResetPreferences")}</span>
                    <p>{t("dataResetPreferencesDesc")}</p>
                  </div>
                  <button className="settings-inline-button" onClick={handleResetPreferences} type="button">
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>{t("dataResetPreferences")}</span>
                  </button>
                </div>
                <div className="settings-action-row">
                  <div className="settings-action-copy">
                    <span className="settings-row-title">{t("dataResetWidgets")}</span>
                    <p>{t("dataResetWidgetsDesc")}</p>
                  </div>
                  <button className="settings-inline-button" onClick={handleResetWidgets} type="button">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span>{t("dataResetWidgets")}</span>
                  </button>
                </div>
                <div className="settings-action-row">
                  <div className="settings-action-copy">
                    <span className="settings-row-title">{t("dockClearAll")}</span>
                    <p>{t("dockManageDesc")}</p>
                  </div>
                  <button
                    className="settings-inline-button"
                    onClick={() => {
                      void handleClearDockItems();
                    }}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t("dockClearAll")}</span>
                  </button>
                </div>
                <div className="settings-action-row danger">
                  <div className="settings-action-copy">
                    <span className="settings-row-title">{t("dataResetAll")}</span>
                    <p>{t("dataResetAllDesc")}</p>
                  </div>
                  <button className="settings-inline-button danger" onClick={handleReset} type="button">
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>{t("dataResetAll")}</span>
                  </button>
                </div>
              </div>
            </section>
          </>
        );
      case "general":
      default:
        return (
          <>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("generalModulesTitle")}</h4>
                  <p>{t("generalModulesDesc")}</p>
                </div>
              </div>
              <div className="settings-control-stack">
                <label className="settings-toggle-row" htmlFor="cfShowClock">
                  <div>
                    <span className="settings-row-title">{t("showTime")}</span>
                  </div>
                  <span className="settings-toggle">
                    <input
                      checked={customForm.showClock}
                      id="cfShowClock"
                      onChange={(event) => {
                        setCustomForm((current) => ({
                          ...current,
                          showClock: event.target.checked,
                        }));
                      }}
                      type="checkbox"
                    />
                    <span className="settings-toggle-track">
                      <span className="settings-toggle-thumb" />
                    </span>
                  </span>
                </label>
                <label className="settings-toggle-row" htmlFor="cfShowDate">
                  <div>
                    <span className="settings-row-title">{t("showDate")}</span>
                  </div>
                  <span className="settings-toggle">
                    <input
                      checked={customForm.showDate}
                      id="cfShowDate"
                      onChange={(event) => {
                        setCustomForm((current) => ({
                          ...current,
                          showDate: event.target.checked,
                        }));
                      }}
                      type="checkbox"
                    />
                    <span className="settings-toggle-track">
                      <span className="settings-toggle-thumb" />
                    </span>
                  </span>
                </label>
                <label className="settings-toggle-row" htmlFor="cfShowSearch">
                  <div>
                    <span className="settings-row-title">{t("showSearchBox")}</span>
                  </div>
                  <span className="settings-toggle">
                    <input
                      checked={customForm.showSearch}
                      id="cfShowSearch"
                      onChange={(event) => {
                        setCustomForm((current) => ({
                          ...current,
                          showSearch: event.target.checked,
                        }));
                      }}
                      type="checkbox"
                    />
                    <span className="settings-toggle-track">
                      <span className="settings-toggle-thumb" />
                    </span>
                  </span>
                </label>
              </div>
            </section>
            <section className="settings-panel-card">
              <div className="settings-card-header">
                <div>
                  <h4>{t("generalSearchTitle")}</h4>
                  <p>{t("generalSearchDesc")}</p>
                </div>
              </div>
              <div className="settings-form-grid">
                <div className="modal-field settings-field">
                  <label htmlFor="cfSearchPlaceholder">{t("searchPlaceholderLabel")}</label>
                  <input
                    id="cfSearchPlaceholder"
                    onChange={(event) => {
                      setCustomForm((current) => ({
                        ...current,
                        searchPlaceholder: event.target.value,
                      }));
                    }}
                    placeholder={t("searchPlaceholder")}
                    ref={customSearchPlaceholderRef}
                    type="text"
                    value={customForm.searchPlaceholder}
                  />
                </div>
                <div className="modal-field settings-field">
                  <label htmlFor="cfSearchBase">{t("searchUrlTemplateLabel")}</label>
                  <input
                    id="cfSearchBase"
                    onChange={(event) => {
                      setCustomForm((current) => ({
                        ...current,
                        searchBaseUrl: event.target.value,
                      }));
                    }}
                    placeholder={t("searchUrlTemplatePlaceholder")}
                    type="text"
                    value={customForm.searchBaseUrl}
                  />
                </div>
              </div>
            </section>
          </>
        );
    }
  })();

  function renderDockButton({
    active = false,
    buttonRef,
    children,
    id,
    indicator = "none",
    label,
    onClick,
    onContextMenu,
    panel,
    variant = "default",
  }: {
    active?: boolean;
    buttonRef?: (node: HTMLButtonElement | null) => void;
    children: ReactNode;
    id: string;
    indicator?: "active" | "none" | "pinned";
    label: string;
    onClick: () => void;
    onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
    panel?: ReactNode;
    variant?: "danger" | "default";
  }) {
    const { lift, scale } = getDockMotion(id);
    const slotWidth = Math.round(54 + (Math.max(0, scale - 1) * 46));
    const buttonClassName = [
      "dock-button",
      active ? "is-active" : "",
      variant === "danger" ? "is-danger" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const indicatorClassName = [
      "dock-indicator",
      indicator === "active"
        ? "is-active"
        : indicator === "pinned"
          ? "is-pinned"
          : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        className="dock-slot"
        key={id}
        style={{
          transform: `translateY(-${lift}px)`,
          width: `${slotWidth}px`,
        }}
      >
        <AnimatePresence initial={false}>
          {hoveredDockId === id ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="dock-tooltip"
              exit={{ opacity: 0, y: 6 }}
              initial={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            >
              {label}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <button
          className={buttonClassName}
          data-dock-item-button={indicator === "pinned" ? "true" : undefined}
          onClick={onClick}
          onContextMenu={onContextMenu}
          onFocus={() => {
            setHoveredDockId(id);
          }}
          onBlur={() => {
            setHoveredDockId((current) => current === id ? null : current);
          }}
          onMouseEnter={() => {
            setHoveredDockId(id);
          }}
          onMouseLeave={() => {
            setHoveredDockId((current) => current === id ? null : current);
          }}
          ref={(node) => {
            setDockButtonRef(id, node);
            buttonRef?.(node);
          }}
          style={{ transform: `scale(${scale})` }}
          title={label}
          type="button"
        >
          {children}
        </button>
        <span className={indicatorClassName} />
        {panel}
      </div>
    );
  }

  function renderLaunchpadBookmarkButton(
    bookmark: BookmarkRecord,
    idx: number,
    options: {
      editEnabled?: boolean;
      showSubtitle?: boolean;
      sourceFolderId: string | null;
      transitionDelayCap?: number;
    },
  ) {
    const itemLabel = bookmark.title.trim() || getUrlHostLabel(bookmark.url) || bookmark.url;
    const canEdit = options.editEnabled !== false;
    const className = [
      "launchpad-item",
      isLaunchpadEditMode && canEdit ? "is-editing" : "",
      launchpadDragState?.id === bookmark.id ? "is-drag-source" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = isLaunchpadEditMode && canEdit
      ? { ["--launchpad-jiggle-delay" as string]: `${(idx % 6) * 36}ms` } as CSSProperties
      : undefined;

    return (
      <div className="launchpad-item-shell" key={bookmark.id}>
        {isLaunchpadEditMode && canEdit ? (
          <button
            aria-label={t("removeWidget")}
            className="launchpad-item-remove"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              launchpadSuppressClickRef.current = true;
              void removeLaunchpadBookmark(bookmark.id);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              launchpadSuppressClickRef.current = true;
              clearLaunchpadPressState();
            }}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <motion.button
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className={className}
          data-launchpad-bookmark-id={bookmark.id}
          initial={{ opacity: 1, scale: 1, y: 0 }}
          onClick={(event) => {
            event.stopPropagation();
            if (consumeSuppressedLaunchpadClick()) {
              return;
            }

            if (isLaunchpadEditMode && canEdit) {
              return;
            }

            void openLaunchpadBookmark(bookmark);
          }}
          onPointerDown={canEdit
            ? (event: ReactPointerEvent<HTMLButtonElement>) => {
              handleLaunchpadBookmarkPointerDown(bookmark, options.sourceFolderId, event);
            }
            : undefined}
          style={style}
          title={itemLabel}
          transition={{
            delay: Math.min(idx * 0.03, options.transitionDelayCap ?? 0.36),
            duration: 0.45,
            ease: [0.34, 1.56, 0.64, 1],
          }}
          type="button"
        >
          <span className="launchpad-item-icon">
            <LaunchpadTileIcon
              bookmarkId={bookmark.id}
              favicon={bookmark.favicon}
              onResolve={queueLaunchpadBookmarkFavicon}
              title={bookmark.title}
              url={bookmark.url}
            />
          </span>
          <span className="launchpad-item-title">{itemLabel}</span>
          {options.showSubtitle ? (
            <span className="launchpad-item-subtitle">
              {getUrlHostLabel(bookmark.url) || bookmark.url}
            </span>
          ) : null}
        </motion.button>
      </div>
    );
  }

  function renderLaunchpadFolderButton(
    section: { id: string; items: BookmarkRecord[]; label: string },
    idx: number,
  ) {
    const className = [
      "launchpad-item",
      isLaunchpadEditMode ? "is-editing" : "",
      launchpadDropTarget?.kind === "folder" && launchpadDropTarget.folderId === section.id
        ? "is-folder-drop-target"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = isLaunchpadEditMode
      ? { ["--launchpad-jiggle-delay" as string]: `${(idx % 6) * 36}ms` } as CSSProperties
      : undefined;

    return (
      <motion.button
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={className}
        data-launchpad-folder-drop-target={section.id}
        initial={{ opacity: 1, scale: 1, y: 0 }}
        key={section.id}
        onClick={(event) => {
          event.stopPropagation();
          if (consumeSuppressedLaunchpadClick()) {
            return;
          }

          setExpandedFolderId(section.id);
        }}
        onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
          handleLaunchpadFolderPointerDown(section.id, event);
        }}
        style={style}
        title={section.label}
        transition={{ delay: Math.min(idx * 0.03, 0.36), duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
        type="button"
      >
        <span className="launchpad-item-icon launchpad-folder-icon-wrapper">
          <LaunchpadFolderIcon
            items={section.items}
            onResolveFavicon={queueLaunchpadBookmarkFavicon}
          />
        </span>
        <span className="launchpad-item-title">{section.label}</span>
      </motion.button>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950 font-sans text-neutral-100">
      <NexusHeader
        activeTab={activeNexusTab}
        onSelectTab={setActiveNexusTab}
        user={nexusUser}
        isConnected={wsConnected}
        pendingApprovalsCount={pendingApprovalsCount}
        onLogout={handleNexusLogout}
        onToggleAiPanel={() => setShowAiPanel((prev) => !prev)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
      />

      {activeNexusTab === "dashboard" && <NexusDashboard onNavigate={(tab) => setActiveNexusTab(tab)} />}
      {activeNexusTab === "agent" && <NexusAgentView />}
      {activeNexusTab === "research" && <NexusResearchView />}
      {activeNexusTab === "workflows" && <NexusWorkflowsView />}
      {activeNexusTab === "memory" && <NexusMemoryView />}
      {activeNexusTab === "skills" && <NexusSkillsView />}
      {activeNexusTab === "activity" && <NexusActivityView />}
      {activeNexusTab === "settings" && <NexusSettingsView />}
      {activeNexusTab === "approvals" && <NexusApprovalsView />}

      <div className={`flex-1 overflow-hidden relative ${activeNexusTab === "browser" ? "flex flex-col" : "hidden"}`}>
        <div
          className={pageShellClassName}
          data-context-menu-boundary="true"
          onContextMenu={handlePageShellContextMenu}
        >
          {surface === "start" ? (
            <NexusBrowserView
              onNavigate={(tab) => setActiveNexusTab(tab)}
              user={nexusUser}
            />
          ) : surface === "tasks" ? (
        <div className="agent-shell task-manager-shell">
          <header className="agent-header">
            <div className="agent-header-left">
              <div className="agent-header-info">
                <h2 className="agent-header-title">{t("agentTaskManagerTitle")}</h2>
                <p className="agent-header-subtitle">{t("agentTaskManagerSubtitle")}</p>
              </div>
            </div>
            <button
              className="agent-reset-button"
              onClick={handleAgentReset}
              type="button"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t("agentResetSession")}</span>
            </button>
          </header>

          <div className="task-manager-grid">
            {agentSessions.length === 0 ? (
              <div className="task-manager-empty">
                <div className="agent-empty-icon">
                  <Terminal className="w-8 h-8" />
                </div>
                <h3 className="agent-empty-title">{t("agentTaskManagerEmptyTitle")}</h3>
                <p className="agent-empty-subtitle">{t("agentTaskManagerEmptySubtitle")}</p>
              </div>
            ) : (
              agentSessions.map((session) => {
                const canInterrupt = canInterruptAgentSession(session.status, Boolean(session.eventTrigger));
                const isInterrupting = interruptingAgentSessionId === session.sessionId;

                return (
                  <article
                    className="task-manager-card"
                    data-status={session.status}
                    key={session.sessionId}
                  >
                    <div className="task-manager-card-header">
                      <div className="task-manager-copy">
                        <div className="task-manager-title-row">
                          <h3>{session.title}</h3>
                        </div>
                        <p>{session.preview}</p>
                      </div>
                      <span className={`task-manager-status-pill ${session.status}`}>
                        <span className="task-manager-status-dot" />
                        {getAgentStatusText(session.status)}
                      </span>
                    </div>

                    <div className="task-manager-meta">
                      <span className="task-manager-meta-item">
                        <Clock />
                        {t("agentTaskManagerUpdated")} {formatAgentTaskTime(session.updatedAt)}
                      </span>
                      <span className="task-manager-meta-item">
                        <MessageSquare />
                        {session.messageCount} {t("agentTaskManagerMessages")}
                      </span>
                    </div>

                    <div className="task-manager-session-block">
                      <span className="task-manager-session-label">
                        <Monitor />
                        {t("agentTaskManagerSession")}
                      </span>
                      <code className="task-manager-session-id">{session.sessionId}</code>
                    </div>

                    {session.eventTrigger ? (
                      <div className="task-manager-trigger-panel">
                        <div className="task-manager-trigger-header">
                          <span className="task-manager-trigger-badge">
                            <Zap />
                            {t("agentTaskManagerEventTrigger")}
                          </span>
                          <span className="task-manager-trigger-detail">
                            {t("agentTaskManagerEventChannels")} {session.eventTrigger.channels.join(", ")}
                          </span>
                        </div>
                        <code className="task-manager-trigger-expression">
                          {t("agentTaskManagerEventMatcher")} {formatEventTriggerMatch(session.eventTrigger)}
                        </code>
                        <p className="task-manager-trigger-prompt">{session.eventTrigger.prompt}</p>
                        <div className="task-manager-meta task-manager-trigger-meta">
                          <span className="task-manager-meta-item">
                            <Clock />
                            {t("agentTaskManagerEventAwaitWindow")} {formatDurationMs(session.eventTrigger.awaitTimeoutMs)}
                          </span>
                          <span className="task-manager-meta-item">
                            <Clock />
                            {t("agentTaskManagerEventCooldown")} {formatDurationMs(session.eventTrigger.cooldownMs)}
                          </span>
                          {session.eventTrigger.lastTriggeredAt ? (
                            <span className="task-manager-meta-item">
                              <Zap />
                              {t("agentTaskManagerTriggerLastTrigger")} {formatAgentTaskTime(session.eventTrigger.lastTriggeredAt)}
                              {" · "}
                              {getEventTriggerStatusText(session.eventTrigger.lastTriggerStatus)}
                            </span>
                          ) : null}
                        </div>
                        {session.eventTrigger.lastEvent ? (
                          <div className="task-manager-trigger-note">
                            <Terminal />
                            <span>
                              {t("agentTaskManagerEventLastEvent")} {session.eventTrigger.lastEvent.kind}
                              {session.eventTrigger.lastEvent.summary ? ` · ${session.eventTrigger.lastEvent.summary}` : ""}
                            </span>
                          </div>
                        ) : null}
                        {session.eventTrigger.lastTriggerError ? (
                          <div className="task-manager-trigger-note">
                            <Terminal />
                            <span>{session.eventTrigger.lastTriggerError}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {session.lastError ? (
                      <div className="task-manager-error">
                        <Terminal />
                        <span>{session.lastError}</span>
                      </div>
                    ) : null}

                    <div className="task-manager-actions">
                      <button
                        className="task-manager-action is-primary"
                        onClick={() => void handleOpenAgentSession(session.sessionId)}
                        type="button"
                      >
                        <ExternalLink />
                        {t("agentTaskManagerOpen")}
                      </button>
                      {canInterrupt && (
                        <button
                          className="task-manager-action is-warning"
                          disabled={isInterrupting}
                          onClick={() => void handleInterruptAgentSession(session.sessionId)}
                          type="button"
                        >
                          <Pause />
                          {t("agentTaskManagerInterrupt")}
                        </button>
                      )}
                      <button
                        className="task-manager-action is-danger"
                        onClick={() => {
                          if (!window.confirm(t("agentTaskManagerDeleteConfirm"))) return;
                          void handleDeleteAgentSession(session.sessionId);
                        }}
                        type="button"
                      >
                        <Trash2 />
                        {t("agentTaskManagerDelete")}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>

        </div>
      ) : (
        <div className="agent-shell">
          <header className="agent-header">
            <div className="agent-header-left">
              <div className="agent-header-info">
                <h2 className="agent-header-title">
                  {t("agentTitle")}
                  <span className={`agent-status-pill ${agentSession?.status ?? "idle"}`}>
                    {getAgentStatusText(agentSession?.status ?? "idle")}
                  </span>
                </h2>
                <p className="agent-header-subtitle">{getAgentActivityText()}</p>
              </div>
            </div>
            <div className="agent-header-actions">
              {selectedAgentWorkspaceId ? (
                <button
                  aria-label={t("agentOpenWorkspaceWindow")}
                  className="agent-secondary-button icon-only py-2"
                  disabled={openingAgentWorkspaceWindow}
                  onClick={() => {
                    void handleOpenAgentWorkspaceWindow();
                  }}
                  title={t("agentOpenWorkspaceWindow")}
                  type="button"
                >
                  <Monitor className="w-3 h-3" />
                </button>
              ) : null}
              <button
                className="agent-secondary-button"
                onClick={openTaskManager}
                type="button"
              >
                <span>{t("agentOpenTaskManager")}</span>
              </button>
              <button
                className="agent-reset-button"
                onClick={handleAgentReset}
                type="button"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t("agentResetSession")}</span>
              </button>
            </div>
          </header>

          <div className="agent-main">
            <section className="agent-chat">
              <div className="agent-chat-messages" ref={agentChatMessagesRef}>
                {agentMessages.length === 0 ? (
                  <div className="agent-empty-state">
                    <div className="agent-empty-icon">
                      <motion.div
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                      >
                        <Terminal className="w-8 h-8" />
                      </motion.div>
                    </div>
                    <h3 className="agent-empty-title">{t("agentEmptyTitle")}</h3>
                    <div className="agent-suggestions">
                      {[
                        {
                          text: t("agentSuggestion1"),
                          icon: <Globe className="w-4 h-4 shrink-0 text-indigo-400" />,
                          profile: "default" as const,
                        },
                        {
                          text: t("agentSuggestion2"),
                          icon: <Bot className="w-4 h-4 shrink-0 text-indigo-400" />,
                          profile: "default" as const,
                        },
                        {
                          text: t("agentSuggestion3"),
                          icon: <Zap className="w-4 h-4 shrink-0 text-indigo-400" />,
                          profile: "default" as const,
                        },
                        {
                          text: t("agentSuggestion4"),
                          icon: <Bookmark className="w-4 h-4 shrink-0 text-indigo-400" />,
                          profile: "organizer" as const,
                        },
                        {
                          text: t("agentSuggestion5"),
                          icon: <LayoutGrid className="w-4 h-4 shrink-0 text-indigo-400" />,
                          profile: "widget-builder" as const,
                        },
                      ].map((suggestion, i) => (
                        <button
                          className="agent-suggestion-card"
                          key={i}
                          onClick={() => {
                            setAgentInput(suggestion.text);
                            setPendingAgentProfile(suggestion.profile);
                          }}
                          type="button"
                        >
                          <span className="flex items-center gap-3">
                            {suggestion.icon}
                            {suggestion.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="agent-messages-list">
                    <AnimatePresence initial={false}>
                      {agentMessages.map((message) => (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0, x: message.role === "user" ? 20 : -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3 }}
                          className={`agent-msg-row ${message.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div className={`agent-msg-content ${message.role === "user" ? "agent-msg-full-right" : "agent-msg-full-left"}`}>
                            {message.role !== "user" && (
                              <div className="agent-msg-label">
                                {message.role === "assistant"
                                  ? (
                                    agentBackendTitleSuffix
                                      ? `${t("agentAssistantLabel")}(${agentBackendTitleSuffix})`
                                      : t("agentAssistantLabel")
                                  )
                                  : t("agentSystemLabel")}
                                {message.toolName ? ` · ${message.toolName}` : ""}
                              </div>
                            )}
                            <div className={`agent-msg-bubble ${message.role}${message.state ? ` is-${message.state}` : ""}`}>
                              {message.thinkingContent ? (
                                <details className="agent-thinking-details">
                                  <summary>{t("agentThinkingLabel")}</summary>
                                  <AgentMessageMarkdown
                                    className="agent-thinking-markdown"
                                    content={message.thinkingContent}
                                  />
                                </details>
                              ) : null}
                              {message.content.trim() ? (
                                <AgentMessageMarkdown content={message.content} />
                              ) : null}
                              {message.subAgentDetails ? (
                                <AgentSubAgentDetailsBlock
                                  classPrefix="agent-subagent"
                                  details={message.subAgentDetails}
                                  labels={SubAgentLabels({ locale, t })}
                                  locale={locale}
                                />
                              ) : null}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {(agentSession?.status === "running" || agentSession?.status === "waiting_event") && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="agent-msg-row justify-start"
                      >
                        <div className="agent-msg-content agent-msg-full-left">
                          <div className="agent-msg-label">
                            {agentBackendTitleSuffix
                              ? `${t("agentAssistantLabel")}(${agentBackendTitleSuffix})`
                              : t("agentAssistantLabel")}
                          </div>
                          <div className="agent-loading-bubble">
                            <div className="agent-loading-dots">
                              <motion.div
                                animate={{ scale: [1, 1.5, 1] }}
                                transition={{ repeat: Infinity, duration: 1 }}
                                className="agent-dot"
                              />
                              <motion.div
                                animate={{ scale: [1, 1.5, 1] }}
                                transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                                className="agent-dot"
                              />
                              <motion.div
                                animate={{ scale: [1, 1.5, 1] }}
                                transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                                className="agent-dot"
                              />
                            </div>
                            <span className="agent-loading-text">{getAgentActivityText()}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>

              <div className="agent-input-area">
                <div className="agent-input-wrapper">
                  <textarea
                    className="agent-input"
                    onChange={(event) => setAgentInput(event.target.value)}
                    onKeyDown={handleAgentInputKeyDown}
                    placeholder={selectedAgentSessionId ? t("agentInputPlaceholder") : t("agentSearchPlaceholder")}
                    ref={agentInputRef}
                    rows={1}
                    value={agentInput}
                  />
                  <button
                    aria-label={agentInputPrivacyTooltip}
                    aria-pressed={selectedAgentPrivacyEnabled}
                    className={`agent-secondary-button icon-only agent-privacy-toggle${selectedAgentPrivacyEnabled ? " is-active" : ""}`}
                    disabled={isAgentPrivacyToggleLocked}
                    onClick={() => {
                      setAgentPrivacyEnabled((current) => !current);
                    }}
                    title={agentInputPrivacyTooltip}
                    type="button"
                  >
                    {selectedAgentPrivacyEnabled ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                  </button>
                  {canInterruptCurrentAgentSession && selectedAgentSessionId ? (
                    <button
                      aria-label={t("agentTaskManagerInterrupt")}
                      className="agent-secondary-button is-warning icon-only"
                      disabled={isInterruptingCurrentAgentSession}
                      onClick={() => void handleInterruptAgentSession(selectedAgentSessionId)}
                      title={t("agentTaskManagerInterrupt")}
                      type="button"
                    >
                      <Pause className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                  <button
                    aria-label={t("send")}
                    className="agent-send-button"
                    disabled={
                      !agentInput.trim()
                      || agentSession?.status === "running"
                      || agentSession?.status === "waiting_event"
                      || agentSession?.status === "queued"
                    }
                    onClick={handleAgentInputSend}
                    title={t("send")}
                    type="button"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
        </div>
      </div>

      <NexusApprovalsBanner />
      <NexusAuthModal
        isOpen={showAuthModal}
        onSuccess={(u) => {
          setNexusUser(u);
          setShowAuthModal(false);
        }}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
