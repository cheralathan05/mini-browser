import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Ban, Globe, Pause, Play, Plus, RefreshCcw, Save, Search, Trash2, X } from "lucide-react";
import { DialogShell } from "@/components/ui/dialog-shell";
import { usePageLocale } from "@/lib/use-page-locale";
import type { SupportedLocale } from "@/lib/i18n";
import { applyThemeSetting, normalizeLearningCatalog, readStoredSettings } from "./settings-state";

type BrowserShellAPI = NonNullable<Window["browserShell"]>;
type LearningCatalog = Awaited<ReturnType<BrowserShellAPI["learningGetCatalog"]>>;
type LearningFlushResult = Awaited<ReturnType<BrowserShellAPI["learningFlushNow"]>>;
type LearningSite = LearningCatalog["sites"][number];
type LearningBehavior = LearningSite["actionStrategies"][number];
type LearningSiteSkill = LearningSite["siteSkills"][number];
type LearningHistorySite = LearningCatalog["historyTopSites"][number];
type LearningStyleProfile = LearningCatalog["styleProfiles"][number];
type LearningPreferenceProfile = LearningCatalog["preferenceProfiles"][number];
type LearningPreferenceSignal = LearningPreferenceProfile["signals"][number];
type LearningPreferenceCategory = NonNullable<LearningPreferenceSignal["category"]>;
type LearningPreferenceScope = NonNullable<LearningPreferenceSignal["scope"]>;
type LearningProgress = LearningCatalog["activeProgress"][number];
type LearningTaskStatus = LearningCatalog["taskStatus"];
type LearningResultTab = "guidance" | "site_skills" | "history" | "style" | "preference";

const MEMORY_CATEGORY_OPTIONS: LearningPreferenceCategory[] = [
  "stable_preference",
  "recent_focus",
  "workflow_preference",
  "negative_preference",
];
const MEMORY_SCOPE_OPTIONS: LearningPreferenceScope[] = ["global", "workspace", "domain"];

const I18N = {
  "en-US": {
    pageTitle: "Learning Manager",
    title: "Learning",
    subtitle:
      "Review which websites have reusable action strategies, site skills, and stable browsing-history patterns, plus how reliable each learned signal currently is.",
    backToSettings: "Back to Settings",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    pauseLearning: "Pause learning",
    pausingLearning: "Pausing…",
    resumeLearning: "Resume learning",
    resumingLearning: "Resuming…",
    flushNow: "Flush learning now",
    flushing: "Flushing now…",
    deleting: "Deleting…",
    flushNowFailed: "Failed to flush learning state.",
    toggleLearningFailed: "Failed to update learning mode.",
    searchPlaceholder: "Search sites, behaviors, or keywords...",
    empty: "No learned website strategy, site skill, browsing-history pattern, writing style, or preference profile has been captured yet.",
    unavailable: "Learning catalog is unavailable on this page. Restart the app and try again.",
    failed: "Failed to load the learning catalog.",
    deleteSite: "Delete site",
    deleteGuidance: "Delete strategy",
    deleteSiteSkill: "Delete site skill",
    deleteHistorySite: "Delete history",
    deleteStyleProfile: "Delete style profile",
    deletePreferenceProfile: "Delete preference profile",
    deleteSiteConfirm: "Delete all learned records for this site?",
    deleteGuidanceConfirm: "Delete this learned action strategy?",
    deleteSiteSkillConfirm: "Delete this learned site skill?",
    deleteHistorySiteConfirm: "Delete this learned browsing-history result?",
    deleteStyleProfileConfirm: "Delete this learned writing style profile?",
    deletePreferenceProfileConfirm: "Delete this learned preference profile?",
    deleteSiteFailed: "Failed to delete the learned site.",
    deleteGuidanceFailed: "Failed to delete the learned action strategy.",
    deleteSiteSkillFailed: "Failed to delete the learned site skill.",
    deleteHistorySiteFailed: "Failed to delete the learned browsing-history result.",
    deleteStyleProfileFailed: "Failed to delete the learned writing style profile.",
    deletePreferenceProfileFailed: "Failed to delete the learned preference profile.",
    learnedSites: "Sites",
    learnedGuidance: "Strategies",
    learnedEpisodes: "Site skills",
    learnedEvents: "Feedback",
    historySites: "History sites",
    historyVisits: "History visits",
    pendingEvents: "Pending",
    activeProgress: "In progress",
    updatedAt: "Updated",
    guidanceCount: "strategy",
    guidanceCountPlural: "strategies",
    supportCount: "support",
    supportCountPlural: "support",
    siteBehaviors: "Action strategies",
    siteSkills: "Site skills",
    bestPractice: "Best practice",
    recovery: "Recovery",
    purpose: "Purpose",
    goal: "Goal",
    preferredTargets: "Preferred targets",
    keywords: "Keywords",
    pageType: "Page type",
    support: "Support",
    successRate: "Success",
    confidence: "Confidence",
    feedback: "Feedback",
    browsingPatterns: "Browsing patterns",
    uniquePages: "Pages",
    observedDays: "Active days",
    activity: "Activity",
    revisitPattern: "Pattern",
    topPages: "Top pages",
    historySummary: "History summary",
    commonIntents: "Common intents",
    revisitDrivers: "Revisit drivers",
    activeProgressTitle: "Current learning progress",
    activeProgressEmpty: "No active learning is buffered right now.",
    taskStatusTitle: "Current task status",
    learnedAssetsTitle: "What has been learned",
    learnedResultsTitle: "Learned results",
    learnedGuidanceTitle: "Accumulated guidance",
    learnedSitesTitle: "Learned sites and guidance",
    learnedHistoryTitle: "Learned browsing history",
    resultTabGuidance: "Guidance",
    resultTabSiteSkills: "Site skills",
    resultTabHistory: "History",
    resultTabStyle: "Writing style",
    resultTabPreference: "Preferences",
    learnedGuidanceEmpty: "No learned guidance is available yet.",
    learnedSiteSkillsEmpty: "No learned site skills are available yet.",
    learnedHistoryEmpty: "No learned browsing history is available yet.",
    learnedStyleEmpty: "No learned writing style is available yet.",
    learnedPreferenceEmpty: "No learned preference profile is available yet.",
    learnedSitesEmpty: "No learned sites or guidance are available yet.",
    examples: "examples",
    signals: "signals",
    globalProfile: "Global profile",
    learningHow: "How it learns",
    learningContent: "Current content",
    currentPage: "Page",
    currentTarget: "Target",
    currentText: "Content",
    observedEvents: "Events",
    characters: "Chars",
    words: "Words",
    taskIdle: "Idle",
    taskRunning: "Running",
    taskPaused: "Paused",
    taskErrorPaused: "Paused after LLM error",
    pauseReason: "Pause reason",
    pauseStage: "Failed stage",
    pauseMessage: "Error message",
    pauseReasonManual: "Manually paused",
    pauseReasonLlmError: "Paused by LLM error",
    pauseStageGuidance: "Workflow learning",
    pauseStageHistory: "History profiling",
    pauseStageStyle: "Style refinement",
    observerCount: "Observers",
    workflowTasks: "Workflow tasks",
    writingTasks: "Writing tasks",
    guidanceQueue: "Queued workflow learning",
    guidanceRunning: "Running workflow learning",
    historyQueue: "Queued history profiling",
    historyRunning: "Running history profiling",
    styleQueue: "Queued style refinements",
    styleRunning: "Running style refinements",
    activeDomainsLabel: "Active domains",
    recentLearnedDomains: "Recent learned domains",
    learnedStyles: "Style profiles",
    learnedPreferences: "Preference profiles",
    addMemory: "Add memory",
    editMemory: "Edit memory",
    saveMemory: "Save memory",
    savingMemory: "Saving…",
    cancelEdit: "Cancel",
    memoryKey: "Key",
    memoryValue: "Value",
    memoryCategory: "Category",
    memoryScope: "Scope",
    memoryDomain: "Domain",
    memorySaved: "Memory saved.",
    memorySaveFailed: "Failed to save memory.",
    deleteMemory: "Delete memory",
    rejectMemory: "Reject inference",
    deleteMemoryConfirm: "Delete this memory item?",
    rejectMemoryConfirm: "Mark this memory item as incorrect?",
    deleteMemoryFailed: "Failed to delete memory.",
    rejectMemoryFailed: "Failed to reject memory.",
    categoryRecentFocus: "Recent focus",
    categoryStablePreference: "Stable preference",
    categoryNegativePreference: "Avoid",
    categoryWorkflowPreference: "Workflow preference",
    scopeGlobal: "Global",
    scopeWorkspace: "Workspace",
    scopeDomain: "Domain",
    statusActive: "Active",
    statusStale: "Stale",
    statusRejected: "Rejected",
    view: "View",
    close: "Close",
    learningPaused: "Learning has been paused.",
    learningResumed: "Learning has resumed.",
    noBehaviorMatch: "No learned strategy, site skill, history pattern, writing style, or preference profile matches the current search.",
    flushNowEmpty: "No active learning was ready to flush.",
  },
  "zh-CN": {
    pageTitle: "学习管理页",
    title: "学习管理",
    subtitle:
      "查看浏览器已经学会了哪些网站、每个网站沉淀了哪些可复用操作策略、站点技能和浏览历史规律，以及这些学习信号当前的可靠程度。",
    backToSettings: "返回设置",
    refresh: "刷新",
    refreshing: "刷新中…",
    pauseLearning: "暂停学习",
    pausingLearning: "暂停中…",
    resumeLearning: "继续学习",
    resumingLearning: "继续中…",
    flushNow: "立即触发学习",
    flushing: "正在触发…",
    deleting: "删除中…",
    flushNowFailed: "触发学习失败。",
    toggleLearningFailed: "更新学习状态失败。",
    searchPlaceholder: "搜索网站、行为或关键词…",
    empty: "还没有采集到可复用的网站策略、站点技能、浏览历史规律、行文风格或偏好画像。",
    unavailable: "当前页面无法访问学习目录，请重启应用后重试。",
    failed: "加载学习目录失败。",
    deleteSite: "删除网站",
    deleteGuidance: "删除策略",
    deleteSiteSkill: "删除站点技能",
    deleteHistorySite: "删除历史结果",
    deleteStyleProfile: "删除风格画像",
    deletePreferenceProfile: "删除偏好画像",
    deleteSiteConfirm: "确定删除这个网站的全部学习记录吗？",
    deleteGuidanceConfirm: "确定删除这条已学习操作策略吗？",
    deleteSiteSkillConfirm: "确定删除这条已学习站点技能吗？",
    deleteHistorySiteConfirm: "确定删除这条已学习浏览历史结果吗？",
    deleteStyleProfileConfirm: "确定删除这条已学习行文风格画像吗？",
    deletePreferenceProfileConfirm: "确定删除这条已学习偏好画像吗？",
    deleteSiteFailed: "删除已学习网站失败。",
    deleteGuidanceFailed: "删除已学习策略失败。",
    deleteSiteSkillFailed: "删除已学习站点技能失败。",
    deleteHistorySiteFailed: "删除已学习历史结果失败。",
    deleteStyleProfileFailed: "删除已学习风格画像失败。",
    deletePreferenceProfileFailed: "删除已学习偏好画像失败。",
    learnedSites: "网站",
    learnedGuidance: "策略",
    learnedEpisodes: "站点技能",
    learnedEvents: "反馈",
    historySites: "历史站点",
    historyVisits: "历史访问",
    pendingEvents: "待学习",
    activeProgress: "进行中",
    updatedAt: "更新于",
    guidanceCount: "条策略",
    guidanceCountPlural: "条策略",
    supportCount: "次支持",
    supportCountPlural: "次支持",
    siteBehaviors: "操作策略",
    siteSkills: "站点技能",
    bestPractice: "最佳实践",
    recovery: "补救策略",
    purpose: "目的",
    goal: "目标",
    preferredTargets: "优先目标",
    keywords: "关键词",
    pageType: "页面类型",
    support: "支持度",
    successRate: "成功率",
    confidence: "置信度",
    feedback: "反馈",
    browsingPatterns: "浏览规律",
    uniquePages: "页面数",
    observedDays: "活跃天数",
    activity: "活跃度",
    revisitPattern: "访问模式",
    topPages: "高频页面",
    historySummary: "历史摘要",
    commonIntents: "常见意图",
    revisitDrivers: "回访原因",
    activeProgressTitle: "当前学习进度",
    activeProgressEmpty: "当前没有正在进行的学习内容。",
    taskStatusTitle: "当前任务状态",
    learnedAssetsTitle: "当前已经学到的内容",
    learnedResultsTitle: "当前学习结果",
    learnedGuidanceTitle: "当前沉淀的指导",
    learnedSitesTitle: "已学习网站与指导",
    learnedHistoryTitle: "已学习浏览历史",
    resultTabGuidance: "指导",
    resultTabSiteSkills: "站点技能",
    resultTabHistory: "历史记录",
    resultTabStyle: "行文风格",
    resultTabPreference: "偏好",
    learnedGuidanceEmpty: "当前还没有可展示的学习指导。",
    learnedSiteSkillsEmpty: "当前还没有可展示的站点技能。",
    learnedHistoryEmpty: "当前还没有可展示的历史记录。",
    learnedStyleEmpty: "当前还没有可展示的行文风格。",
    learnedPreferenceEmpty: "当前还没有可展示的偏好画像。",
    learnedSitesEmpty: "当前还没有已学习网站或指导。",
    examples: "个示例",
    signals: "条信号",
    globalProfile: "全局画像",
    learningHow: "当前如何学习",
    learningContent: "当前学习内容",
    currentPage: "页面",
    currentTarget: "目标",
    currentText: "内容",
    observedEvents: "事件",
    characters: "字符",
    words: "词数",
    taskIdle: "空闲中",
    taskRunning: "运行中",
    taskPaused: "已暂停",
    taskErrorPaused: "因 LLM 报错已暂停",
    pauseReason: "暂停原因",
    pauseStage: "报错阶段",
    pauseMessage: "错误信息",
    pauseReasonManual: "手动暂停",
    pauseReasonLlmError: "LLM 报错后自动暂停",
    pauseStageGuidance: "页面行为学习",
    pauseStageHistory: "历史画像学习",
    pauseStageStyle: "风格精炼",
    observerCount: "观察器",
    workflowTasks: "页面工作流任务",
    writingTasks: "写作学习任务",
    guidanceQueue: "待执行页面学习",
    guidanceRunning: "执行中页面学习",
    historyQueue: "待执行历史画像学习",
    historyRunning: "执行中历史画像学习",
    styleQueue: "待执行风格精炼",
    styleRunning: "执行中风格精炼",
    activeDomainsLabel: "活跃域名",
    recentLearnedDomains: "最近学到的域名",
    learnedStyles: "风格画像",
    learnedPreferences: "偏好画像",
    addMemory: "新增记忆",
    editMemory: "编辑记忆",
    saveMemory: "保存记忆",
    savingMemory: "保存中…",
    cancelEdit: "取消",
    memoryKey: "键",
    memoryValue: "内容",
    memoryCategory: "类别",
    memoryScope: "范围",
    memoryDomain: "域名",
    memorySaved: "记忆已保存。",
    memorySaveFailed: "保存记忆失败。",
    deleteMemory: "删除记忆",
    rejectMemory: "标记不正确",
    deleteMemoryConfirm: "确定删除这条记忆吗？",
    rejectMemoryConfirm: "确定将这条记忆标记为不正确吗？",
    deleteMemoryFailed: "删除记忆失败。",
    rejectMemoryFailed: "标记记忆失败。",
    categoryRecentFocus: "近期关注",
    categoryStablePreference: "稳定偏好",
    categoryNegativePreference: "避免项",
    categoryWorkflowPreference: "流程偏好",
    scopeGlobal: "全局",
    scopeWorkspace: "工作区",
    scopeDomain: "域名",
    statusActive: "生效",
    statusStale: "过期",
    statusRejected: "已拒绝",
    view: "查看",
    close: "关闭",
    learningPaused: "学习已暂停。",
    learningResumed: "学习已继续。",
    noBehaviorMatch: "当前搜索条件下没有匹配的已学习策略、站点技能、历史规律、行文风格或偏好画像。",
    flushNowEmpty: "当前没有可立即归档的学习进度。",
  },
} as const;

type MessageKey = keyof (typeof I18N)["en-US"];

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function formatTime(value: number | undefined, locale: SupportedLocale) {
  if (!value) {
    return " - ";
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function formatPercent(value: number, digits = 0) {
  return `${Math.round(value * (10 ** digits) * 100) / (10 ** digits)}%`;
}

function translateIntentLabel(locale: SupportedLocale, intentKey: string, fallback: string) {
  if (locale === "zh-CN") {
    switch (intentKey) {
      case "sign_in":
        return "登录";
      case "download_result":
        return "下载或导出结果";
      case "structured_query":
        return "结构化查询";
      case "search_or_filter":
        return "搜索或筛选";
      case "fill_form":
        return "填写表单";
      case "navigate_site":
        return "站点流程导航";
      case "repeat_page_workflow":
        return "复用页面流程";
      default:
        return fallback;
    }
  }

  return fallback;
}

function translatePurposeLabel(locale: SupportedLocale, purposeKey: LearningBehavior["purposeKey"], fallback: string) {
  if (locale === "zh-CN") {
    switch (purposeKey) {
      case "retrieve_data":
        return "获取数据";
      case "submit_data":
        return "提交数据";
      case "authenticate":
        return "登录认证";
      case "download_export":
        return "下载或导出";
      case "navigate_workflow":
        return "导航到流程";
      case "other":
        return "其他目的";
      default:
        return fallback;
    }
  }
  return fallback;
}

function matchesBehaviorQuery(behavior: LearningBehavior, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText([
    behavior.intentKey,
    behavior.intentLabel,
    behavior.purposeKey,
    behavior.purposeLabel,
    behavior.goalSummary,
    behavior.pageType,
    ...behavior.keywords,
    ...behavior.preferredTargets,
    ...behavior.recommendedSteps,
    ...behavior.recoveryHints,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" "));

  return haystack.includes(query);
}

function matchesSiteSkillQuery(skill: LearningSiteSkill, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText([
    skill.patternKey,
    skill.patternLabel,
    skill.rule,
    skill.pageType,
    ...skill.evidence,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" "));

  return haystack.includes(query);
}

function matchesHistorySiteQuery(site: LearningHistorySite, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText([
    site.domain,
    site.activityLevel,
    site.revisitPattern,
    site.profileSummary,
    ...site.commonIntents,
    ...site.revisitDrivers,
    ...site.topPages.flatMap((page) => [page.title, page.url]),
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" "));

  return haystack.includes(query);
}

function matchesProgressQuery(progress: LearningProgress, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText([
    progress.mode,
    progress.domain,
    progress.url,
    progress.pageTitle,
    progress.pageType,
    progress.latestEventKind,
    progress.latestEventSummary,
    progress.targetSummary,
    progress.contentPreview,
    progress.contextType,
    progress.slot,
    progress.fieldHint,
    progress.recipientLabel,
    ...progress.methods,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" "));

  return haystack.includes(query);
}

function matchesStyleProfileQuery(profile: LearningStyleProfile, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText([
    profile.domain,
    profile.pageType,
    profile.contextType,
    profile.contextLabel,
    profile.slot,
    profile.slotLabel,
    profile.fieldHint,
    profile.recipientLabel,
    profile.tone,
    profile.formality,
    profile.searchStyle,
    profile.emailStyle,
    profile.forumStyle,
    profile.articleStyle,
    profile.notesStyle,
    profile.styleSummary,
    ...profile.commonPhrases,
    ...profile.exemplarSnippets,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" "));

  return haystack.includes(query);
}

function matchesPreferenceProfileQuery(profile: LearningPreferenceProfile, query: string) {
  if (!query) {
    return true;
  }

  const haystack = normalizeText(profile.signals
    .flatMap((signal) => [
      signal.key,
      signal.value,
      signal.category,
      signal.source,
      signal.scope,
      signal.domain,
      signal.status,
      ...(signal.evidenceRefs ?? []),
    ])
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(" "));

  return haystack.includes(query);
}

function translateProgressMode(locale: SupportedLocale, mode: LearningProgress["mode"]) {
  if (locale === "zh-CN") {
    return mode === "learn_writing_style" ? "写作风格学习" : "页面行为学习";
  }
  return mode === "learn_writing_style" ? "Writing style learning" : "Workflow observation";
}

function translateProgressMethod(
  locale: SupportedLocale,
  method: LearningProgress["methods"][number],
) {
  if (locale === "zh-CN") {
    switch (method) {
      case "input":
        return "输入";
      case "click":
        return "点击";
      case "scroll":
        return "滚动";
      case "navigation":
        return "跳转";
      case "dialog":
        return "弹窗";
      case "download":
        return "下载";
      case "typing":
        return "写作输入";
      default:
        return method;
    }
  }

  switch (method) {
    case "input":
      return "Input";
    case "click":
      return "Click";
    case "scroll":
      return "Scroll";
    case "navigation":
      return "Navigate";
    case "dialog":
      return "Dialog";
    case "download":
      return "Download";
    case "typing":
      return "Typing";
    default:
      return method;
  }
}

function translateWritingContextLabel(
  locale: SupportedLocale,
  contextType: LearningProgress["contextType"],
) {
  if (!contextType) {
    return undefined;
  }
  if (locale === "zh-CN") {
    switch (contextType) {
      case "email":
        return "邮件";
      case "forum":
        return "论坛";
      case "article_editor":
        return "文章编辑器";
      case "general_editor":
        return "通用编辑器";
      default:
        return contextType;
    }
  }

  switch (contextType) {
    case "article_editor":
      return "Article editor";
    case "general_editor":
      return "Editor";
    default:
      return contextType;
  }
}

function translateWritingSlotLabel(
  locale: SupportedLocale,
  slot: LearningProgress["slot"],
) {
  if (!slot) {
    return undefined;
  }
  if (locale === "zh-CN") {
    switch (slot) {
      case "subject":
        return "主题";
      case "body":
        return "正文";
      case "title":
        return "标题";
      case "comment":
        return "评论";
      case "message":
        return "消息";
      case "recipient":
        return "收件人";
      case "unknown":
        return "字段";
      default:
        return slot;
    }
  }

  switch (slot) {
    case "subject":
      return "Subject";
    case "body":
      return "Body";
    case "title":
      return "Title";
    case "comment":
      return "Comment";
    case "message":
      return "Message";
    case "recipient":
      return "Recipient";
    default:
      return "Field";
  }
}

function pickStyleSummary(profile: LearningStyleProfile) {
  return profile.styleSummary
    || profile.emailStyle
    || profile.articleStyle
    || profile.forumStyle
    || profile.notesStyle
    || profile.searchStyle
    || "";
}

function describeStyleProfileScope(locale: SupportedLocale, profile: LearningStyleProfile) {
  const context = profile.contextLabel
    || translateWritingContextLabel(locale, profile.contextType as LearningProgress["contextType"]);
  const slot = profile.slotLabel
    || translateWritingSlotLabel(locale, profile.slot as LearningProgress["slot"]);

  if (locale === "zh-CN") {
    return [
      profile.domain || "全局画像",
      context ? `场景：${context}` : undefined,
      slot ? `字段：${slot}` : undefined,
      profile.recipientLabel ? `对象：${profile.recipientLabel}` : undefined,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(" · ");
  }

  return [
    profile.domain || "Global profile",
    context ? `context: ${context}` : undefined,
    slot ? `field: ${slot}` : undefined,
    profile.recipientLabel ? `recipient: ${profile.recipientLabel}` : undefined,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" · ");
}

function translatePreferenceSignalSource(
  locale: SupportedLocale,
  source: LearningPreferenceProfile["signals"][number]["source"],
) {
  if (locale === "zh-CN") {
    switch (source) {
      case "explicit":
      case "manual":
        return "手动";
      case "agent_interaction":
        return "对话";
      case "browsing_history":
        return "历史";
      case "workflow_learning":
        return "流程";
      case "writing_style":
        return "写作";
      default:
        return "观察";
    }
  }
  switch (source) {
    case "explicit":
    case "manual":
      return "Manual";
    case "agent_interaction":
      return "Conversation";
    case "browsing_history":
      return "History";
    case "workflow_learning":
      return "Workflow";
    case "writing_style":
      return "Writing";
    default:
      return "Observed";
  }
}

function translatePreferenceCategory(locale: SupportedLocale, category: LearningPreferenceSignal["category"]) {
  const normalized = category ?? "stable_preference";
  if (locale === "zh-CN") {
    switch (normalized) {
      case "recent_focus":
        return "近期关注";
      case "negative_preference":
        return "避免项";
      case "workflow_preference":
        return "流程偏好";
      default:
        return "稳定偏好";
    }
  }
  switch (normalized) {
    case "recent_focus":
      return "Recent focus";
    case "negative_preference":
      return "Avoid";
    case "workflow_preference":
      return "Workflow preference";
    default:
      return "Stable preference";
  }
}

function translatePreferenceScope(locale: SupportedLocale, scope: LearningPreferenceSignal["scope"]) {
  const normalized = scope ?? "global";
  if (locale === "zh-CN") {
    return normalized === "domain" ? "域名" : normalized === "workspace" ? "工作区" : "全局";
  }
  return normalized === "domain" ? "Domain" : normalized === "workspace" ? "Workspace" : "Global";
}

function translatePreferenceStatus(locale: SupportedLocale, status: LearningPreferenceSignal["status"]) {
  const normalized = status ?? "active";
  if (locale === "zh-CN") {
    return normalized === "rejected" ? "已拒绝" : normalized === "stale" ? "过期" : "生效";
  }
  return normalized === "rejected" ? "Rejected" : normalized === "stale" ? "Stale" : "Active";
}

function describeProgressHow(locale: SupportedLocale, progress: LearningProgress) {
  if (progress.mode === "learn_writing_style") {
    const context = translateWritingContextLabel(locale, progress.contextType);
    const slot = translateWritingSlotLabel(locale, progress.slot);
    if (locale === "zh-CN") {
      return [
        "正在根据当前输入内容学习你的写作风格",
        context ? `场景：${context}` : undefined,
        slot ? `字段：${slot}` : undefined,
        progress.fieldHint ? `提示：${progress.fieldHint}` : undefined,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join("，");
    }
    return [
      "Learning your writing style from the current typed content",
      context ? `context: ${context}` : undefined,
      slot ? `field: ${slot}` : undefined,
      progress.fieldHint ? `hint: ${progress.fieldHint}` : undefined,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(", ");
  }

  const methods = progress.methods.map((method) => translateProgressMethod(locale, method)).join(" / ");
  if (locale === "zh-CN") {
    return `正在通过${methods || "页面观察"}采集操作轨迹，准备归纳可复用工作流。`;
  }
  return `Learning from live workflow observation via ${methods || "page observation"}.`;
}

function formatFlushFeedback(locale: SupportedLocale, result: LearningFlushResult, fallback: string) {
  if (!result.success) {
    return fallback;
  }
  if (
    result.processedEventCount <= 0
    && result.learnedEpisodeCount <= 0
    && result.learnedGuidanceCount <= 0
    && result.writingSampleCount <= 0
  ) {
    return locale === "zh-CN" ? "当前没有可立即归档的学习进度。" : "No active learning was ready to flush.";
  }
  if (locale === "zh-CN") {
    return `已立即学习 ${result.processedEventCount} 条事件，形成 ${result.learnedEpisodeCount} 个片段，新增 ${result.learnedGuidanceCount} 条策略，写作样本 ${result.writingSampleCount} 条。`;
  }
  return `Flushed ${result.processedEventCount} events into ${result.learnedEpisodeCount} episodes, ${result.learnedGuidanceCount} strategies, and ${result.writingSampleCount} writing samples.`;
}

function translateTaskState(locale: SupportedLocale, state: LearningTaskStatus["state"]) {
  if (locale === "zh-CN") {
    switch (state) {
      case "running":
        return "运行中";
      case "paused":
        return "已暂停";
      case "error_paused":
        return "因 LLM 报错已暂停";
      default:
        return "空闲中";
    }
  }

  switch (state) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "error_paused":
      return "Paused after LLM error";
    default:
      return "Idle";
  }
}

function translatePauseReason(locale: SupportedLocale, reason: LearningTaskStatus["pauseReason"]) {
  if (!reason) {
    return undefined;
  }
  if (locale === "zh-CN") {
    return reason === "llm_error" ? "LLM 报错后自动暂停" : "手动暂停";
  }
  return reason === "llm_error" ? "Paused by LLM error" : "Manually paused";
}

function translatePauseStage(locale: SupportedLocale, stage: LearningTaskStatus["pauseStage"]) {
  if (!stage) {
    return undefined;
  }
  if (locale === "zh-CN") {
    if (stage === "history_profile_refinement") {
      return "历史画像学习";
    }
    if (stage === "style_profile_refinement") {
      return "风格精炼";
    }
    if (stage === "episode_learning") {
      return "页面行为学习";
    }
    return "策略精炼";
  }
  if (stage === "history_profile_refinement") {
    return "History profiling";
  }
  if (stage === "style_profile_refinement") {
    return "Style refinement";
  }
  if (stage === "episode_learning") {
    return "Workflow learning";
  }
  return "Strategy refinement";
}

function translateHistoryActivityLabel(
  locale: SupportedLocale,
  activityLevel: LearningHistorySite["activityLevel"],
) {
  if (!activityLevel) {
    return locale === "zh-CN" ? "待学习" : "Pending";
  }
  if (locale === "zh-CN") {
    switch (activityLevel) {
      case "high":
        return "高";
      case "medium":
        return "中";
      default:
        return "低";
    }
  }

  switch (activityLevel) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    default:
      return "Low";
  }
}

function translateHistoryPatternLabel(
  locale: SupportedLocale,
  revisitPattern: LearningHistorySite["revisitPattern"],
) {
  if (!revisitPattern) {
    return locale === "zh-CN" ? "待学习" : "Pending";
  }
  if (locale === "zh-CN") {
    switch (revisitPattern) {
      case "habitual":
        return "习惯型";
      case "exploratory":
        return "探索型";
      default:
        return "均衡型";
    }
  }

  switch (revisitPattern) {
    case "habitual":
      return "Habitual";
    case "exploratory":
      return "Exploratory";
    default:
      return "Balanced";
  }
}

export function LearningPage() {
  const locale = usePageLocale();
  const messages = I18N[locale];
  const t = (key: MessageKey) => messages[key];
  const [catalog, setCatalog] = useState<LearningCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [learningModeBusy, setLearningModeBusy] = useState(false);
  const [learningFlushBusy, setLearningFlushBusy] = useState(false);
  const [resultTab, setResultTab] = useState<LearningResultTab>("guidance");
  const [selectedLearnedSiteId, setSelectedLearnedSiteId] = useState<string | null>(null);
  const [memoryForm, setMemoryForm] = useState<{
    profileId: string;
    signalId: string;
    key: string;
    value: string;
    category: LearningPreferenceCategory;
    scope: LearningPreferenceScope;
    domain: string;
  }>({
    profileId: "",
    signalId: "",
    key: "",
    value: "",
    category: "stable_preference",
    scope: "global",
    domain: "",
  });
  const isTestingPhase = import.meta.env.DEV;

  useEffect(() => {
    applyThemeSetting(readStoredSettings().theme);

    const browserShell = window.browserShell;
    if (!browserShell?.settingsGetTheme) {
      return;
    }

    let disposed = false;

    void browserShell.settingsGetTheme()
      .then((theme) => {
        if (!disposed) {
          applyThemeSetting(theme as "light" | "dark" | "system");
        }
      })
      .catch(() => undefined);

    const disposeTheme = browserShell.onThemeChanged((theme) => {
      if (!disposed) {
        applyThemeSetting(theme as "light" | "dark" | "system");
      }
    });

    return () => {
      disposed = true;
      disposeTheme?.();
    };
  }, []);

  useEffect(() => {
    document.title = t("pageTitle");
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!selectedLearnedSiteId) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setSelectedLearnedSiteId(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLearnedSiteId]);

  useEffect(() => {
    const browserShell = window.browserShell;
    if (!browserShell?.learningGetCatalog) {
      setIsLoading(false);
      setError(messages.unavailable);
      return;
    }

    let disposed = false;

    const refresh = async () => {
      try {
        if (!disposed) {
          setError("");
          setIsLoading(true);
        }
        const nextCatalog = normalizeLearningCatalog(await browserShell.learningGetCatalog());
        if (!disposed) {
          setCatalog(nextCatalog);
          setError("");
        }
      } catch (nextError) {
        if (!disposed) {
          console.error("Failed to read learning catalog:", nextError);
          setError(messages.failed);
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    };

    void refresh();

    return () => {
      disposed = true;
    };
  }, [locale, refreshToken]);

  const filteredSites = useMemo(() => {
    if (!catalog) {
      return [];
    }

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return catalog.sites;
    }

    return catalog.sites.flatMap((site) => {
      const siteMatches = normalizeText(site.domain).includes(normalizedQuery);
      const actionStrategies = siteMatches
        ? site.actionStrategies
        : site.actionStrategies.filter((behavior) => matchesBehaviorQuery(behavior, normalizedQuery));
      const siteSkills = siteMatches
        ? site.siteSkills
        : site.siteSkills.filter((skill) => matchesSiteSkillQuery(skill, normalizedQuery));
      if (actionStrategies.length === 0 && siteSkills.length === 0) {
        return [];
      }

      return [{
        ...site,
        actionStrategyCount: actionStrategies.length,
        guidanceCount: actionStrategies.length,
        siteSkillCount: siteSkills.length,
        totalSupport: actionStrategies.reduce((sum, behavior) => sum + behavior.support, 0),
        lastSeenAt: Math.max(
          actionStrategies.reduce((max, behavior) => Math.max(max, behavior.lastSeenAt), 0),
          siteSkills.reduce((max, skill) => Math.max(max, skill.lastSeenAt), 0),
        ),
        actionStrategies,
        behaviors: actionStrategies,
        siteSkills,
      }];
    });
  }, [catalog, query]);
  const filteredHistorySites = useMemo(() => {
    if (!catalog) {
      return [];
    }

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return catalog.historyTopSites;
    }

    return catalog.historyTopSites.filter((site) => matchesHistorySiteQuery(site, normalizedQuery));
  }, [catalog, query]);
  const filteredProgress = useMemo(() => {
    if (!catalog) {
      return [];
    }

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return catalog.activeProgress;
    }

    return catalog.activeProgress.filter((progress) => matchesProgressQuery(progress, normalizedQuery));
  }, [catalog, query]);
  const filteredStyleProfiles = useMemo(() => {
    if (!catalog) {
      return [];
    }

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return catalog.styleProfiles;
    }

    return catalog.styleProfiles.filter((profile) => matchesStyleProfileQuery(profile, normalizedQuery));
  }, [catalog, query]);
  const filteredPreferenceProfiles = useMemo(() => {
    if (!catalog) {
      return [];
    }

    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      return catalog.preferenceProfiles;
    }

    return catalog.preferenceProfiles.filter((profile) => matchesPreferenceProfileQuery(profile, normalizedQuery));
  }, [catalog, query]);

  const hasCatalogContent =
    (catalog?.activeProgress.length ?? 0) > 0
    || (catalog?.sites.length ?? 0) > 0
    || (catalog?.historyTopSites.length ?? 0) > 0
    || (catalog?.styleProfiles.length ?? 0) > 0
    || (catalog?.preferenceProfiles.length ?? 0) > 0;
  const hasMatchingContent =
    filteredProgress.length > 0
    || filteredSites.length > 0
    || filteredHistorySites.length > 0
    || filteredStyleProfiles.length > 0
    || filteredPreferenceProfiles.length > 0;
  const learnedDomains = useMemo(() => {
    if (!catalog) {
      return [];
    }
    return catalog.sites.map((site) => site.domain);
  }, [catalog]);
  const learnedResultGroups = useMemo(() => {
    if (!filteredSites.length) {
      return [];
    }

    return filteredSites
      .filter((site) => site.actionStrategies.length > 0)
      .sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
        || right.totalSupport - left.totalSupport
        || right.actionStrategyCount - left.actionStrategyCount
        || left.domain.localeCompare(right.domain));
  }, [filteredSites]);
  const siteSkillResultGroups = useMemo(() => {
    if (!filteredSites.length) {
      return [];
    }

    return filteredSites
      .filter((site) => site.siteSkills.length > 0)
      .sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
        || right.siteSkillCount - left.siteSkillCount
        || left.domain.localeCompare(right.domain));
  }, [filteredSites]);
  const selectedLearnedSite = useMemo(() => {
    if (!selectedLearnedSiteId) {
      return null;
    }
    return (
      filteredSites.find((site) => site.siteId === selectedLearnedSiteId)
      ?? catalog?.sites.find((site) => site.siteId === selectedLearnedSiteId)
      ?? null
    );
  }, [catalog, filteredSites, selectedLearnedSiteId]);
  const resultTabs: Array<{ id: LearningResultTab; label: string; count: number }> = [
    { id: "guidance", label: t("resultTabGuidance"), count: learnedResultGroups.length },
    { id: "site_skills", label: t("resultTabSiteSkills"), count: siteSkillResultGroups.length },
    { id: "history", label: t("resultTabHistory"), count: filteredHistorySites.length },
    { id: "style", label: t("resultTabStyle"), count: filteredStyleProfiles.length },
    { id: "preference", label: t("resultTabPreference"), count: filteredPreferenceProfiles.length },
  ];

  async function handleDeleteSite(site: LearningSite) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeleteSite) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("deleteSiteConfirm")}\n${site.domain}`)) {
      return;
    }

    const mutationKey = `site:${site.siteId}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeleteSite(site.siteId);
      if (!result?.success) {
        setError(t("deleteSiteFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete learning site:", nextError);
      setError(t("deleteSiteFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleDeleteGuidance(site: LearningSite, behavior: LearningBehavior) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeleteGuidance) {
      setError(messages.unavailable);
      return;
    }

    const label = translateIntentLabel(locale, behavior.intentKey, behavior.intentLabel);
    if (!window.confirm(`${t("deleteGuidanceConfirm")}\n${site.domain} · ${label}`)) {
      return;
    }

    const mutationKey = `guidance:${behavior.guidanceId}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeleteGuidance(behavior.guidanceId);
      if (!result?.success) {
        setError(t("deleteGuidanceFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete learning guidance:", nextError);
      setError(t("deleteGuidanceFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleDeleteSiteSkill(site: LearningSite, skill: LearningSiteSkill) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeleteSiteSkill) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("deleteSiteSkillConfirm")}\n${site.domain} · ${skill.patternLabel}`)) {
      return;
    }

    const mutationKey = `skill:${skill.skillId}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeleteSiteSkill(skill.skillId);
      if (!result?.success) {
        setError(t("deleteSiteSkillFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete learning site skill:", nextError);
      setError(t("deleteSiteSkillFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleDeleteHistorySite(site: LearningHistorySite) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeleteHistorySite) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("deleteHistorySiteConfirm")}\n${site.domain}`)) {
      return;
    }

    const mutationKey = `history:${site.siteId}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeleteHistorySite(site.domain);
      if (!result?.success) {
        setError(t("deleteHistorySiteFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete learning history site:", nextError);
      setError(t("deleteHistorySiteFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleDeleteStyleProfile(profile: LearningStyleProfile) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeleteStyleProfile) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("deleteStyleProfileConfirm")}\n${profile.domain || t("globalProfile")}`)) {
      return;
    }

    const mutationKey = `style:${profile.profileId}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeleteStyleProfile(profile.profileId);
      if (!result?.success) {
        setError(t("deleteStyleProfileFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete learning style profile:", nextError);
      setError(t("deleteStyleProfileFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleDeletePreferenceProfile(profile: LearningPreferenceProfile) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeletePreferenceProfile) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("deletePreferenceProfileConfirm")}\n${profile.profileId}`)) {
      return;
    }

    const mutationKey = `preference:${profile.profileId}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeletePreferenceProfile(profile.profileId);
      if (!result?.success) {
        setError(t("deletePreferenceProfileFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete learning preference profile:", nextError);
      setError(t("deletePreferenceProfileFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  function resetMemoryForm() {
    setMemoryForm({
      profileId: "",
      signalId: "",
      key: "",
      value: "",
      category: "stable_preference",
      scope: "global",
      domain: "",
    });
  }

  function handleEditMemory(profile: LearningPreferenceProfile, signal: LearningPreferenceSignal) {
    setResultTab("preference");
    setMemoryForm({
      profileId: profile.profileId,
      signalId: signal.id ?? "",
      key: signal.key,
      value: signal.value,
      category: signal.category ?? "stable_preference",
      scope: signal.scope ?? "global",
      domain: signal.domain ?? "",
    });
  }

  async function handleSaveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const browserShell = window.browserShell;
    if (!browserShell?.learningUpsertUserMemory) {
      setError(messages.unavailable);
      return;
    }

    const key = memoryForm.key.trim();
    const value = memoryForm.value.trim();
    if (!key || !value) {
      setError(t("memorySaveFailed"));
      return;
    }

    const mutationKey = memoryForm.signalId ? `memory:${memoryForm.signalId}` : "memory:new";
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningUpsertUserMemory({
        ...(memoryForm.profileId ? { profileId: memoryForm.profileId } : {}),
        ...(memoryForm.signalId ? { signalId: memoryForm.signalId } : {}),
        key,
        value,
        category: memoryForm.category,
        source: "manual",
        confidence: 0.95,
        strength: 1,
        scope: memoryForm.scope,
        ...(memoryForm.scope === "domain" && memoryForm.domain.trim()
          ? { domain: memoryForm.domain.trim() }
          : {}),
      });
      if (!result?.success) {
        setError(t("memorySaveFailed"));
        return;
      }
      resetMemoryForm();
      setInfoMessage(t("memorySaved"));
      setError("");
      setRefreshToken((valueToken) => valueToken + 1);
    } catch (nextError) {
      console.error("Failed to save user memory:", nextError);
      setError(t("memorySaveFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleDeleteMemory(profile: LearningPreferenceProfile, signal: LearningPreferenceSignal) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningDeleteUserMemory) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("deleteMemoryConfirm")}\n${signal.key}: ${signal.value}`)) {
      return;
    }

    const mutationKey = `memory-delete:${signal.id ?? signal.key}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningDeleteUserMemory({
        profileId: profile.profileId,
        signalId: signal.id,
        key: signal.key,
        category: signal.category,
        scope: signal.scope,
        domain: signal.domain,
      });
      if (!result?.success) {
        setError(t("deleteMemoryFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to delete user memory:", nextError);
      setError(t("deleteMemoryFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleRejectMemory(profile: LearningPreferenceProfile, signal: LearningPreferenceSignal) {
    const browserShell = window.browserShell;
    if (!browserShell?.learningRejectUserMemory) {
      setError(messages.unavailable);
      return;
    }
    if (!window.confirm(`${t("rejectMemoryConfirm")}\n${signal.key}: ${signal.value}`)) {
      return;
    }

    const mutationKey = `memory-reject:${signal.id ?? signal.key}`;
    setMutatingKey(mutationKey);
    try {
      const result = await browserShell.learningRejectUserMemory({
        profileId: profile.profileId,
        signalId: signal.id,
        key: signal.key,
        category: signal.category,
        scope: signal.scope,
        domain: signal.domain,
      });
      if (!result?.success) {
        setError(t("rejectMemoryFailed"));
        return;
      }
      setInfoMessage("");
      setError("");
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to reject user memory:", nextError);
      setError(t("rejectMemoryFailed"));
    } finally {
      setMutatingKey((current) => current === mutationKey ? null : current);
    }
  }

  async function handleToggleLearningMode() {
    const browserShell = window.browserShell;
    if (!browserShell?.learningSetPreferences || !catalog) {
      setError(messages.unavailable);
      return;
    }

    const nextMode = catalog.taskStatus.mode === "on" ? "off" : "on";
    setLearningModeBusy(true);
    setError("");
    setInfoMessage("");
    try {
      const result = await browserShell.learningSetPreferences({ mode: nextMode });
      if (result?.mode !== nextMode) {
        setError(t("toggleLearningFailed"));
        return;
      }
      setInfoMessage(nextMode === "on" ? t("learningResumed") : t("learningPaused"));
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to toggle learning mode:", nextError);
      setError(t("toggleLearningFailed"));
    } finally {
      setLearningModeBusy(false);
    }
  }

  async function handleFlushLearningNow() {
    if (!isTestingPhase) {
      return;
    }

    const browserShell = window.browserShell;
    if (!browserShell?.learningFlushNow) {
      setError(messages.unavailable);
      return;
    }

    setLearningFlushBusy(true);
    setError("");
    setInfoMessage("");
    try {
      const result = await browserShell.learningFlushNow();
      if (!result?.success) {
        setError(t("flushNowFailed"));
        return;
      }
      setInfoMessage(formatFlushFeedback(locale, result, t("flushNowFailed")));
      setRefreshToken((value) => value + 1);
    } catch (nextError) {
      console.error("Failed to flush learning state:", nextError);
      setError(t("flushNowFailed"));
    } finally {
      setLearningFlushBusy(false);
    }
  }

  return (
    <div className="learning-page">
      <header className="learning-topbar">
        <div className="learning-topline">
          <h1>{t("title")}</h1>
          <div className="learning-top-actions">
            <button
              className="action-btn"
              disabled={learningModeBusy || learningFlushBusy || Boolean(mutatingKey) || !catalog}
              onClick={() => void handleToggleLearningMode()}
              type="button"
            >
              {catalog?.taskStatus.mode === "on" ? <Pause size={16} /> : <Play size={16} />}
              {learningModeBusy
                ? (catalog?.taskStatus.mode === "on" ? t("pausingLearning") : t("resumingLearning"))
                : (catalog?.taskStatus.mode === "on" ? t("pauseLearning") : t("resumeLearning"))}
            </button>
            {isTestingPhase ? (
              <button
                className="action-btn"
                disabled={learningModeBusy || learningFlushBusy || Boolean(mutatingKey)}
                onClick={() => void handleFlushLearningNow()}
                type="button"
              >
                <RefreshCcw size={16} className={learningFlushBusy ? "spin" : undefined} />
                {learningFlushBusy ? t("flushing") : t("flushNow")}
              </button>
            ) : null}
            <button
              className="action-btn"
              disabled={learningModeBusy || Boolean(mutatingKey)}
              onClick={() => setRefreshToken((value) => value + 1)}
              type="button"
            >
              <RefreshCcw size={16} className={isLoading ? "spin" : undefined} />
              {isLoading ? t("refreshing") : mutatingKey ? t("deleting") : t("refresh")}
            </button>
          </div>
        </div>

        <div className="learning-stats-row">
          <span className="learning-stat">{t("activeProgress")} <strong>{catalog?.activeProgress.length ?? 0}</strong></span>
          <span className="learning-stat">{t("learnedSites")} <strong>{catalog?.siteCount ?? 0}</strong></span>
          <span className="learning-stat">{t("learnedGuidance")} <strong>{catalog?.actionStrategyCount ?? 0}</strong></span>
          <span className="learning-stat">{t("learnedEpisodes")} <strong>{catalog?.siteSkillCount ?? 0}</strong></span>
          <span className="learning-stat">{t("historySites")} <strong>{catalog?.historySiteCount ?? 0}</strong></span>
          <span className="learning-stat">{t("historyVisits")} <strong>{catalog?.historyVisitCount ?? 0}</strong></span>
          <span className="learning-stat">{t("pendingEvents")} <strong>{catalog?.pendingEventCount ?? 0}</strong></span>
          <span className="learning-stat">{t("learnedEvents")} <strong>{catalog?.feedbackCount ?? 0}</strong></span>
        </div>

        <div className="learning-search-row">
          <label className="search-shell">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              type="search"
              value={query}
            />
          </label>
          <span className="learning-updated">
            {t("updatedAt")} {formatTime(catalog?.lastUpdatedAt, locale)}
          </span>
        </div>
      </header>

      <section className="learning-surface custom-scrollbar" style={{ margin: "16px auto" }}>
        {error ? (
          <div className="learning-empty">{error}</div>
        ) : null}

        {!error && infoMessage ? (
          <div className="learning-notice">{infoMessage}</div>
        ) : null}

        {!error && !isLoading && !hasCatalogContent ? (
          <div className="learning-empty">{t("empty")}</div>
        ) : null}

        {!error && hasCatalogContent && !hasMatchingContent ? (
          <div className="learning-empty">{t("noBehaviorMatch")}</div>
        ) : null}

        {!error && catalog ? (
          <>
            <div className="learning-section-title">{t("taskStatusTitle")}</div>
            <article className="learning-site-card learning-status-card">
              <div className="learning-site-header">
                <div>
                  <div className="learning-site-domain">
                    {catalog.taskStatus.state === "error_paused" ? <AlertTriangle size={16} /> : <Globe size={16} />}
                    <h2>{translateTaskState(locale, catalog.taskStatus.state)}</h2>
                  </div>
                  <div className="learning-site-meta">
                    {catalog.taskStatus.mode === "on"
                      ? (locale === "zh-CN" ? "学习模式已开启" : "Learning mode is enabled")
                      : (locale === "zh-CN" ? "学习模式已关闭" : "Learning mode is disabled")}
                    {catalog.taskStatus.pauseAt ? (
                      <>
                        {" · "}
                        {t("updatedAt")} {formatTime(catalog.taskStatus.pauseAt, locale)}
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="learning-chip-row learning-progress-chip-row">
                  <span className={`learning-chip ${catalog.taskStatus.state === "error_paused" ? "warning" : ""}`}>
                    {translateTaskState(locale, catalog.taskStatus.state)}
                  </span>
                  {catalog.taskStatus.pauseReason ? (
                    <span className="learning-chip subtle">
                      {translatePauseReason(locale, catalog.taskStatus.pauseReason)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="learning-chip-row" style={{ marginTop: 12 }}>
                <span className="learning-chip">{t("observerCount")} {catalog.taskStatus.observerCount}</span>
                <span className="learning-chip">{t("workflowTasks")} {catalog.taskStatus.activeWorkflowCount}</span>
                <span className="learning-chip">{t("writingTasks")} {catalog.taskStatus.activeWritingCount}</span>
                <span className="learning-chip subtle">{t("guidanceQueue")} {catalog.taskStatus.queuedGuidanceRefinementCount}</span>
                <span className="learning-chip subtle">{t("guidanceRunning")} {catalog.taskStatus.runningGuidanceRefinementCount}</span>
                <span className="learning-chip subtle">{t("historyQueue")} {catalog.taskStatus.queuedHistoryProfileRefinementCount}</span>
                <span className="learning-chip subtle">{t("historyRunning")} {catalog.taskStatus.runningHistoryProfileRefinementCount}</span>
                <span className="learning-chip subtle">{t("styleQueue")} {catalog.taskStatus.queuedStyleProfileRefinementCount}</span>
                <span className="learning-chip subtle">{t("styleRunning")} {catalog.taskStatus.runningStyleProfileRefinementCount}</span>
              </div>

              {catalog.taskStatus.activeDomains.length > 0 ? (
                <div className="learning-detail-block">
                  <h4>{t("activeDomainsLabel")}</h4>
                  <div className="learning-chip-row">
                    {catalog.taskStatus.activeDomains.map((domain) => (
                      <span className="learning-chip subtle" key={`status-domain:${domain}`}>{domain}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {catalog.taskStatus.pauseReason ? (
                <div className="learning-detail-block">
                  <h4>{t("pauseReason")}</h4>
                  <p>{translatePauseReason(locale, catalog.taskStatus.pauseReason)}</p>
                  {catalog.taskStatus.pauseStage ? (
                    <p style={{ marginTop: 6 }}>
                      {t("pauseStage")}
                      {" · "}
                      {translatePauseStage(locale, catalog.taskStatus.pauseStage)}
                    </p>
                  ) : null}
                  {catalog.taskStatus.pauseMessage ? (
                    <p style={{ marginTop: 6 }}>{catalog.taskStatus.pauseMessage}</p>
                  ) : null}
                </div>
              ) : null}
            </article>

            <div className="learning-section-title">{t("learnedAssetsTitle")}</div>
            <article className="learning-site-card learning-status-card" style={{ marginBottom: 12 }}>
              <div className="learning-chip-row">
                <span className="learning-chip">{t("learnedSites")} {catalog.siteCount}</span>
                <span className="learning-chip">{t("learnedGuidance")} {catalog.guidanceCount}</span>
                <span className="learning-chip">{t("learnedEpisodes")} {catalog.siteSkillCount}</span>
                <span className="learning-chip">{t("learnedEvents")} {catalog.feedbackCount}</span>
                <span className="learning-chip subtle">{t("learnedStyles")} {catalog.styleProfileCount}</span>
                <span className="learning-chip subtle">{t("learnedPreferences")} {catalog.preferenceProfileCount}</span>
                <span className="learning-chip subtle">{t("historySites")} {catalog.historySiteCount}</span>
              </div>
              {learnedDomains.length > 0 ? (
                <div className="learning-detail-block">
                  <h4>{t("recentLearnedDomains")}</h4>
                  <div className="learning-chip-row">
                    {learnedDomains.map((domain) => (
                      <span className="learning-chip subtle" key={`learned-domain:${domain}`}>{domain}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>

            <div className="learning-section-title">{t("learnedResultsTitle")}</div>
            <div className="learning-result-tabs">
              {resultTabs.map((tab) => (
                <button
                  className={`learning-result-tab ${resultTab === tab.id ? "active" : ""}`}
                  key={tab.id}
                  onClick={() => setResultTab(tab.id)}
                  type="button"
                >
                  <span>{tab.label}</span>
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>

            {resultTab === "guidance" ? (
              learnedResultGroups.length > 0 ? (
                <div className="learning-result-list">
                  {learnedResultGroups.map((site) => (
                    <article className="learning-result-row" key={`preview:${site.siteId}`}>
                      <div className="learning-result-main">
                        <div className="learning-summary-domain">{site.domain}</div>
                        <div className="learning-site-meta">
                          {site.actionStrategyCount} {t("guidanceCountPlural")}
                          {" · "}
                          {site.siteSkillCount} {t("learnedEpisodes")}
                          {" · "}
                          {t("feedback")} {site.feedbackCount}
                          {" · "}
                          {t("support")} {site.totalSupport}
                          {" · "}
                          {t("updatedAt")} {formatTime(site.lastSeenAt, locale)}
                        </div>
                        <div className="learning-chip-row" style={{ marginTop: 10 }}>
                          {site.actionStrategies.map((behavior) => (
                            <span className="learning-chip subtle" key={behavior.guidanceId}>
                              {translateIntentLabel(locale, behavior.intentKey, behavior.intentLabel)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="learning-result-actions">
                        <button
                          className="row-btn danger"
                          disabled={Boolean(mutatingKey)}
                          onClick={() => void handleDeleteSite(site)}
                          type="button"
                        >
                          <Trash2 size={14} />
                          {mutatingKey === `site:${site.siteId}` ? t("deleting") : t("deleteSite")}
                        </button>
                        <button
                          className="row-btn"
                          disabled={Boolean(mutatingKey)}
                          onClick={() => setSelectedLearnedSiteId(site.siteId)}
                          type="button"
                        >
                          {t("view")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="learning-empty learning-empty-compact">{t("learnedGuidanceEmpty")}</div>
              )
            ) : null}

            {resultTab === "site_skills" ? (
              siteSkillResultGroups.length > 0 ? (
                <div className="learning-result-list">
                  {siteSkillResultGroups.map((site) => (
                    <article className="learning-result-row" key={`skills:${site.siteId}`}>
                      <div className="learning-result-main">
                        <div className="learning-summary-domain">{site.domain}</div>
                        <div className="learning-site-meta">
                          {site.siteSkillCount} {t("learnedEpisodes")}
                          {" · "}
                          {t("feedback")} {site.feedbackCount}
                          {" · "}
                          {t("updatedAt")} {formatTime(site.lastSeenAt, locale)}
                        </div>
                        <div className="learning-chip-row" style={{ marginTop: 10 }}>
                          {site.siteSkills.map((skill) => (
                            <span className="learning-chip subtle" key={skill.skillId}>
                              {skill.patternLabel}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="learning-result-actions">
                        <button
                          className="row-btn"
                          onClick={() => setSelectedLearnedSiteId(site.siteId)}
                          type="button"
                        >
                          {t("view")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="learning-empty learning-empty-compact">{t("learnedSiteSkillsEmpty")}</div>
              )
            ) : null}

            {resultTab === "history" ? (
              filteredHistorySites.length > 0 ? (
                <div className="learning-site-list" style={{ paddingTop: 0 }}>
                  {filteredHistorySites.map((site) => (
                    <article className="learning-site-card" key={`history-preview:${site.siteId}`}>
                      <div className="learning-site-header">
                        <div>
                          <div className="learning-site-domain">
                            <Globe size={16} />
                            <h2>{site.domain}</h2>
                          </div>
                          <div className="learning-site-meta">
                            {t("historyVisits")} {site.visitCount}
                            {" · "}
                            {t("uniquePages")} {site.uniquePageCount}
                            {" · "}
                            {t("observedDays")} {site.observedDayCount}
                            {" · "}
                            {t("updatedAt")} {formatTime(site.lastVisitedAt, locale)}
                          </div>
                        </div>
                        <div className="learning-result-actions">
                          <button
                            className="row-btn danger"
                            disabled={Boolean(mutatingKey)}
                            onClick={() => void handleDeleteHistorySite(site)}
                            type="button"
                          >
                            <Trash2 size={14} />
                            {mutatingKey === `history:${site.siteId}` ? t("deleting") : t("deleteHistorySite")}
                          </button>
                        </div>
                      </div>

                      <div className="learning-chip-row" style={{ marginTop: 12 }}>
                        {site.activityLevel ? (
                          <span className="learning-chip">
                            {t("activity")} · {translateHistoryActivityLabel(locale, site.activityLevel)}
                          </span>
                        ) : null}
                        {site.revisitPattern ? (
                          <span className="learning-chip subtle">
                            {t("revisitPattern")} · {translateHistoryPatternLabel(locale, site.revisitPattern)}
                          </span>
                        ) : null}
                        {typeof site.confidence === "number" ? (
                          <span className="learning-chip subtle">
                            {t("confidence")} {formatPercent(site.confidence)}
                          </span>
                        ) : null}
                      </div>

                      {site.profileSummary ? (
                        <div className="learning-detail-block">
                          <h4>{t("historySummary")}</h4>
                          <p>{site.profileSummary}</p>
                        </div>
                      ) : null}

                      {site.commonIntents.length > 0 ? (
                        <div className="learning-detail-block">
                          <h4>{t("commonIntents")}</h4>
                          <div className="learning-chip-row">
                            {site.commonIntents.map((intent) => (
                              <span className="learning-chip subtle" key={`${site.siteId}:intent:${intent}`}>{intent}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {site.revisitDrivers.length > 0 ? (
                        <div className="learning-detail-block">
                          <h4>{t("revisitDrivers")}</h4>
                          <div className="learning-chip-row">
                            {site.revisitDrivers.map((driver) => (
                              <span className="learning-chip subtle" key={`${site.siteId}:driver:${driver}`}>{driver}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {site.topPages.length > 0 ? (
                        <div className="learning-detail-block">
                          <h4>{t("topPages")}</h4>
                          <ul>
                            {site.topPages.map((page) => (
                              <li key={`${site.siteId}:${page.url}`}>
                                <strong>{page.title}</strong>
                                <span>
                                  {page.visitCount} · {formatTime(page.lastVisitedAt, locale)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="learning-empty learning-empty-compact">{t("learnedHistoryEmpty")}</div>
              )
            ) : null}

            {resultTab === "style" ? (
              filteredStyleProfiles.length > 0 ? (
                <div className="learning-site-list" style={{ paddingTop: 0 }}>
                  {filteredStyleProfiles.map((profile) => (
                    <article className="learning-site-card" key={`style:${profile.profileId}`}>
      <div className="learning-site-header">
        <div>
          <div className="learning-site-domain">
            <Globe size={16} />
            <h2>{profile.domain || t("globalProfile")}</h2>
          </div>
                          <div className="learning-site-meta">
                            {describeStyleProfileScope(locale, profile)}
                            {" · "}
                            {t("updatedAt")} {formatTime(profile.lastUpdatedAt, locale)}
                          </div>
                        </div>
                        <div className="learning-result-actions">
                          <div className="learning-chip-row learning-progress-chip-row">
                            <span className="learning-chip">{t("confidence")} {formatPercent(profile.confidence)}</span>
                            <span className="learning-chip subtle">{t("characters")} {profile.averageLength}</span>
                            <span className="learning-chip subtle">{profile.exemplarCount} {t("examples")}</span>
                          </div>
                          <button
                            className="row-btn danger"
                            disabled={Boolean(mutatingKey)}
                            onClick={() => void handleDeleteStyleProfile(profile)}
                            type="button"
                          >
                            <Trash2 size={14} />
                            {mutatingKey === `style:${profile.profileId}` ? t("deleting") : t("deleteStyleProfile")}
                          </button>
                        </div>
                      </div>

                      {pickStyleSummary(profile) ? (
                        <div className="learning-detail-block">
                          <h4>{t("learningHow")}</h4>
                          <p>{pickStyleSummary(profile)}</p>
                        </div>
                      ) : null}

                      <div className="learning-chip-row" style={{ marginTop: 12 }}>
                        {profile.tone ? <span className="learning-chip">{profile.tone}</span> : null}
                        {profile.formality ? <span className="learning-chip subtle">{profile.formality}</span> : null}
                        {profile.commonPhrases.map((phrase) => (
                          <span className="learning-chip subtle" key={`${profile.profileId}:${phrase}`}>{phrase}</span>
                        ))}
                      </div>

                      {profile.exemplarSnippets.length > 0 ? (
                        <div className="learning-detail-block">
                          <h4>{t("currentText")}</h4>
                          <ul>
                            {profile.exemplarSnippets.map((snippet) => (
                              <li key={`${profile.profileId}:${snippet}`}>{snippet}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="learning-empty learning-empty-compact">{t("learnedStyleEmpty")}</div>
              )
            ) : null}

            {resultTab === "preference" ? (
              <>
                <article className="learning-site-card learning-memory-editor">
                  <form onSubmit={(event) => void handleSaveMemory(event)}>
                    <div className="learning-site-header">
                      <div>
                        <div className="learning-site-domain">
                          <Plus size={16} />
                          <h2>{memoryForm.signalId ? t("editMemory") : t("addMemory")}</h2>
                        </div>
                      </div>
                      <div className="learning-result-actions">
                        {memoryForm.signalId ? (
                          <button className="row-btn" onClick={resetMemoryForm} type="button">
                            <X size={14} />
                            {t("cancelEdit")}
                          </button>
                        ) : null}
                        <button className="row-btn" disabled={Boolean(mutatingKey)} type="submit">
                          <Save size={14} />
                          {mutatingKey === "memory:new" || mutatingKey === `memory:${memoryForm.signalId}`
                            ? t("savingMemory")
                            : t("saveMemory")}
                        </button>
                      </div>
                    </div>

                    <div className="learning-memory-grid">
                      <label>
                        <span>{t("memoryKey")}</span>
                        <input
                          onChange={(event) => setMemoryForm((current) => ({ ...current, key: event.target.value }))}
                          placeholder="preferred_topics"
                          value={memoryForm.key}
                        />
                      </label>
                      <label>
                        <span>{t("memoryCategory")}</span>
                        <select
                          onChange={(event) => setMemoryForm((current) => ({
                            ...current,
                            category: event.target.value as LearningPreferenceCategory,
                          }))}
                          value={memoryForm.category}
                        >
                          {MEMORY_CATEGORY_OPTIONS.map((category) => (
                            <option key={category} value={category}>
                              {translatePreferenceCategory(locale, category)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{t("memoryScope")}</span>
                        <select
                          onChange={(event) => setMemoryForm((current) => ({
                            ...current,
                            scope: event.target.value as LearningPreferenceScope,
                          }))}
                          value={memoryForm.scope}
                        >
                          {MEMORY_SCOPE_OPTIONS.map((scope) => (
                            <option key={scope} value={scope}>
                              {translatePreferenceScope(locale, scope)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{t("memoryDomain")}</span>
                        <input
                          disabled={memoryForm.scope !== "domain"}
                          onChange={(event) => setMemoryForm((current) => ({ ...current, domain: event.target.value }))}
                          placeholder="example.com"
                          value={memoryForm.domain}
                        />
                      </label>
                      <label className="learning-memory-value">
                        <span>{t("memoryValue")}</span>
                        <textarea
                          onChange={(event) => setMemoryForm((current) => ({ ...current, value: event.target.value }))}
                          rows={3}
                          value={memoryForm.value}
                        />
                      </label>
                    </div>
                  </form>
                </article>

                {filteredPreferenceProfiles.length > 0 ? (
                  <div className="learning-site-list" style={{ paddingTop: 0 }}>
                    {filteredPreferenceProfiles.map((profile) => (
                      <article className="learning-site-card" key={`preference:${profile.profileId}`}>
                        <div className="learning-site-header">
                          <div>
                            <div className="learning-site-domain">
                              <Globe size={16} />
                              <h2>{t("resultTabPreference")}</h2>
                            </div>
                            <div className="learning-site-meta">
                              {profile.signals.length} {t("signals")}
                              {" · "}
                              {t("updatedAt")} {formatTime(profile.lastUpdatedAt, locale)}
                            </div>
                          </div>
                          <div className="learning-result-actions">
                            <button
                              className="row-btn danger"
                              disabled={Boolean(mutatingKey)}
                              onClick={() => void handleDeletePreferenceProfile(profile)}
                              type="button"
                            >
                              <Trash2 size={14} />
                              {mutatingKey === `preference:${profile.profileId}` ? t("deleting") : t("deletePreferenceProfile")}
                            </button>
                          </div>
                        </div>

                        <div className="learning-behavior-list" style={{ marginTop: 12 }}>
                          {profile.signals.map((signal) => (
                            <section className="learning-behavior-card" key={`${profile.profileId}:${signal.id ?? signal.key}:${signal.value}`}>
                              <div className="learning-behavior-header">
                                <div className="learning-preference-content">
                                  <h3>{signal.key}</h3>
                                  <p className="learning-preference-value">{signal.value}</p>
                                </div>
                                <div className="learning-result-actions">
                                  <button
                                    className="row-btn"
                                    disabled={Boolean(mutatingKey)}
                                    onClick={() => handleEditMemory(profile, signal)}
                                    type="button"
                                  >
                                    <Save size={14} />
                                    {t("editMemory")}
                                  </button>
                                  <button
                                    className="row-btn"
                                    disabled={Boolean(mutatingKey) || (signal.status ?? "active") === "rejected"}
                                    onClick={() => void handleRejectMemory(profile, signal)}
                                    type="button"
                                  >
                                    <Ban size={14} />
                                    {t("rejectMemory")}
                                  </button>
                                  <button
                                    className="row-btn danger"
                                    disabled={Boolean(mutatingKey)}
                                    onClick={() => void handleDeleteMemory(profile, signal)}
                                    type="button"
                                  >
                                    <Trash2 size={14} />
                                    {t("deleteMemory")}
                                  </button>
                                </div>
                              </div>
                              <div className="learning-chip-row" style={{ marginTop: 8 }}>
                                <span className="learning-chip">{translatePreferenceCategory(locale, signal.category)}</span>
                                <span className="learning-chip subtle">{translatePreferenceSignalSource(locale, signal.source)}</span>
                                <span className="learning-chip subtle">{translatePreferenceScope(locale, signal.scope)}{signal.domain ? ` · ${signal.domain}` : ""}</span>
                                <span className={`learning-chip ${(signal.status ?? "active") === "rejected" ? "warning" : (signal.status === "stale" ? "subtle" : "")}`}>{translatePreferenceStatus(locale, signal.status)}</span>
                                <span className="learning-chip subtle">{t("confidence")} {formatPercent(signal.confidence)}</span>
                              </div>
                              {signal.evidenceRefs && signal.evidenceRefs.length > 0 ? (
                                <div className="learning-chip-row" style={{ marginTop: 6 }}>
                                  {signal.evidenceRefs.map((evidence) => (
                                    <span className="learning-chip subtle" key={`${signal.id}:evidence:${evidence}`}>{evidence}</span>
                                  ))}
                                </div>
                              ) : null}
                            </section>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="learning-empty learning-empty-compact">{t("learnedPreferenceEmpty")}</div>
                )}
              </>
            ) : null}
          </>
        ) : null}

        {(filteredProgress.length > 0
          || (!error && hasCatalogContent && (catalog?.activeProgress.length ?? 0) === 0 && !isLoading)) ? (
          <>
            <div className="learning-section-title">{t("activeProgressTitle")}</div>
            {filteredProgress.length > 0 ? (
              <div className="learning-site-list" style={{ marginBottom: 20 }}>
                {filteredProgress.map((progress) => (
                  <article className="learning-site-card learning-progress-card" key={progress.progressId}>
                    <div className="learning-site-header">
                      <div>
                        <div className="learning-site-domain">
                          <Globe size={16} />
                          <h2>{progress.domain}</h2>
                        </div>
                        <div className="learning-site-meta">
                          {translateProgressMode(locale, progress.mode)}
                          {progress.pageType ? (
                            <>
                              {" · "}
                              {t("pageType")} {progress.pageType}
                            </>
                          ) : null}
                          {" · "}
                          {t("updatedAt")} {formatTime(progress.updatedAt, locale)}
                        </div>
                      </div>
                      <div className="learning-chip-row learning-progress-chip-row">
                        {progress.methods.map((method) => (
                          <span className="learning-chip" key={`${progress.progressId}:${method}`}>
                            {translateProgressMethod(locale, method)}
                          </span>
                        ))}
                        <span className="learning-chip subtle">
                          {t("observedEvents")} {progress.eventCount}
                        </span>
                        {typeof progress.charCount === "number" ? (
                          <span className="learning-chip subtle">
                            {t("characters")} {progress.charCount}
                          </span>
                        ) : null}
                        {typeof progress.wordCount === "number" ? (
                          <span className="learning-chip subtle">
                            {t("words")} {progress.wordCount}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="learning-detail-block">
                      <h4>{t("learningHow")}</h4>
                      <p>{describeProgressHow(locale, progress)}</p>
                    </div>

                    <div className="learning-detail-block">
                      <h4>{t("learningContent")}</h4>
                      <ul className="learning-progress-list">
                        {progress.pageTitle || progress.url ? (
                          <li>
                            <strong>{t("currentPage")}:</strong>
                            {" "}
                            {progress.pageTitle ?? progress.url}
                          </li>
                        ) : null}
                        {progress.targetSummary ? (
                          <li>
                            <strong>{t("currentTarget")}:</strong>
                            {" "}
                            {progress.targetSummary}
                          </li>
                        ) : null}
                        {progress.contentPreview ? (
                          <li>
                            <strong>{t("currentText")}:</strong>
                            {" "}
                            {progress.contentPreview}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="learning-empty learning-empty-compact">{t("activeProgressEmpty")}</div>
            )}
          </>
        ) : null}

      </section>

      {selectedLearnedSite ? (
        <DialogShell
          className="learning-dialog-shell"
          onClick={() => setSelectedLearnedSiteId(null)}
          surfaceProps={{
            className: "learning-dialog-surface",
            onClick: (event) => event.stopPropagation(),
          }}
          headerProps={{ className: "learning-dialog-header" }}
          contentProps={{ className: "learning-dialog-content custom-scrollbar" }}
          footerProps={{ className: "learning-dialog-footer" }}
          title={selectedLearnedSite.domain}
          description={(
            <>
              {selectedLearnedSite.actionStrategyCount} {t("guidanceCountPlural")}
              {" · "}
              {selectedLearnedSite.siteSkillCount} {t("learnedEpisodes")}
              {" · "}
              {t("feedback")} {selectedLearnedSite.feedbackCount}
              {" · "}
              {t("updatedAt")} {formatTime(selectedLearnedSite.lastSeenAt, locale)}
            </>
          )}
          trailing={(
            <button
              aria-label={t("close")}
              className="learning-dialog-close"
              onClick={() => setSelectedLearnedSiteId(null)}
              type="button"
            >
              <X size={16} />
            </button>
          )}
          footer={(
            <div className="learning-dialog-footer-actions">
              <button
                className="action-btn"
                onClick={() => setSelectedLearnedSiteId(null)}
                type="button"
              >
                {t("close")}
              </button>
            </div>
          )}
          content={(
            <div className="learning-dialog-sections">
              {selectedLearnedSite.history ? (
                <div className="learning-detail-block">
                  <h4>{t("browsingPatterns")}</h4>
                  <div className="learning-chip-row">
                    <span className="learning-chip">
                      {t("historyVisits")} {selectedLearnedSite.history.visitCount}
                    </span>
                    <span className="learning-chip subtle">
                      {t("uniquePages")} {selectedLearnedSite.history.uniquePageCount}
                    </span>
                    <span className="learning-chip subtle">
                      {t("observedDays")} {selectedLearnedSite.history.observedDayCount}
                    </span>
                    {selectedLearnedSite.history.activityLevel ? (
                      <span className="learning-chip subtle">
                        {translateHistoryActivityLabel(locale, selectedLearnedSite.history.activityLevel)}
                      </span>
                    ) : null}
                    {selectedLearnedSite.history.revisitPattern ? (
                      <span className="learning-chip subtle">
                        {translateHistoryPatternLabel(locale, selectedLearnedSite.history.revisitPattern)}
                      </span>
                    ) : null}
                    {typeof selectedLearnedSite.history.confidence === "number" ? (
                      <span className="learning-chip subtle">
                        {t("confidence")} {formatPercent(selectedLearnedSite.history.confidence)}
                      </span>
                    ) : null}
                  </div>
                  {selectedLearnedSite.history.profileSummary ? (
                    <p style={{ marginTop: 10 }}>{selectedLearnedSite.history.profileSummary}</p>
                  ) : null}
                  {selectedLearnedSite.history.commonIntents.length > 0 ? (
                    <div className="learning-chip-row" style={{ marginTop: 10 }}>
                      {selectedLearnedSite.history.commonIntents.map((intent) => (
                        <span className="learning-chip subtle" key={`dialog-history-intent:${intent}`}>{intent}</span>
                      ))}
                    </div>
                  ) : null}
                  {selectedLearnedSite.history.revisitDrivers.length > 0 ? (
                    <div className="learning-chip-row" style={{ marginTop: 10 }}>
                      {selectedLearnedSite.history.revisitDrivers.map((driver) => (
                        <span className="learning-chip subtle" key={`dialog-history-driver:${driver}`}>{driver}</span>
                      ))}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="row-btn danger"
                      disabled={Boolean(mutatingKey)}
                      onClick={() => void handleDeleteHistorySite(selectedLearnedSite.history!)}
                      type="button"
                    >
                      <Trash2 size={14} />
                      {mutatingKey === `history:${selectedLearnedSite.history.siteId}` ? t("deleting") : t("deleteHistorySite")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="learning-detail-block">
                <h4>{t("siteBehaviors")}</h4>
              </div>
              <div className="learning-behavior-list" style={{ marginTop: 0 }}>
                {selectedLearnedSite.actionStrategies.map((behavior) => (
                  <section className="learning-behavior-card" key={`dialog:${behavior.guidanceId}`}>
                    <div className="learning-behavior-header">
                      <div>
                        <h3>{translateIntentLabel(locale, behavior.intentKey, behavior.intentLabel)}</h3>
                        {behavior.purposeLabel ? (
                          <p>
                            {t("purpose")}
                            {" · "}
                            {translatePurposeLabel(locale, behavior.purposeKey, behavior.purposeLabel)}
                            {behavior.pageType ? (
                              <>
                                {" · "}
                                {t("pageType")}
                                {" · "}
                                {behavior.pageType}
                              </>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                      <div className="learning-behavior-actions">
                        <div className="learning-behavior-metrics">
                          <span>{t("support")} {behavior.support}</span>
                          <span>{t("successRate")} {formatPercent(behavior.successRate)}</span>
                          <span>{t("confidence")} {formatPercent(behavior.confidence)}</span>
                          <span>{t("feedback")} {behavior.feedbackCount}</span>
                        </div>
                        <button
                          className="row-btn danger"
                          disabled={Boolean(mutatingKey)}
                          onClick={() => void handleDeleteGuidance(selectedLearnedSite, behavior)}
                          type="button"
                        >
                          <Trash2 size={14} />
                          {mutatingKey === `guidance:${behavior.guidanceId}` ? t("deleting") : t("deleteGuidance")}
                        </button>
                      </div>
                    </div>

                    {behavior.goalSummary ? (
                      <div className="learning-detail-block">
                        <h4>{t("goal")}</h4>
                        <p>{behavior.goalSummary}</p>
                      </div>
                    ) : null}

                    {behavior.recommendedSteps.length > 0 ? (
                      <div className="learning-detail-block">
                        <h4>{t("bestPractice")}</h4>
                        <ul>
                          {behavior.recommendedSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {behavior.recoveryHints.length > 0 ? (
                      <div className="learning-detail-block">
                        <h4>{t("recovery")}</h4>
                        <ul>
                          {behavior.recoveryHints.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {behavior.preferredTargets.length > 0 ? (
                      <div className="learning-detail-block">
                        <h4>{t("preferredTargets")}</h4>
                        <div className="learning-chip-row">
                          {behavior.preferredTargets.map((target) => (
                            <span className="learning-chip" key={target}>{target}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {behavior.keywords.length > 0 ? (
                      <div className="learning-detail-block">
                        <h4>{t("keywords")}</h4>
                        <div className="learning-chip-row">
                          {behavior.keywords.map((keyword) => (
                            <span className="learning-chip subtle" key={keyword}>{keyword}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>

              {selectedLearnedSite.siteSkills.length > 0 ? (
                <>
                  <div className="learning-detail-block">
                    <h4>{t("siteSkills")}</h4>
                  </div>
                  <div className="learning-behavior-list" style={{ marginTop: 0 }}>
                    {selectedLearnedSite.siteSkills.map((skill) => (
                      <section className="learning-behavior-card" key={`dialog-skill:${skill.skillId}`}>
                        <div className="learning-behavior-header">
                          <div>
                            <h3>{skill.patternLabel}</h3>
                            <p>
                              {skill.pageType ? `${t("pageType")} · ${skill.pageType}` : selectedLearnedSite.domain}
                            </p>
                          </div>
                          <div className="learning-behavior-actions">
                            <div className="learning-behavior-metrics">
                              <span>{t("support")} {skill.support}</span>
                              <span>{t("successRate")} {formatPercent(skill.successRate)}</span>
                              <span>{t("confidence")} {formatPercent(skill.confidence)}</span>
                            </div>
                            <button
                              className="row-btn danger"
                              disabled={Boolean(mutatingKey)}
                              onClick={() => void handleDeleteSiteSkill(selectedLearnedSite, skill)}
                              type="button"
                            >
                              <Trash2 size={14} />
                              {mutatingKey === `skill:${skill.skillId}` ? t("deleting") : t("deleteSiteSkill")}
                            </button>
                          </div>
                        </div>

                        <div className="learning-detail-block">
                          <h4>{t("bestPractice")}</h4>
                          <p>{skill.rule}</p>
                        </div>

                        {skill.evidence.length > 0 ? (
                          <div className="learning-detail-block">
                            <h4>{t("keywords")}</h4>
                            <div className="learning-chip-row">
                              {skill.evidence.map((evidence) => (
                                <span className="learning-chip subtle" key={evidence}>{evidence}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </section>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}
        />
      ) : null}
    </div>
  );
}
