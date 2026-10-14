import {
  AGENT_PAGE_ENTRY,
  BOOKMARKS_PAGE_ENTRY,
  DOWNLOADS_PAGE_ENTRY,
  EXTENSIONS_PAGE_ENTRY,
  HISTORY_PAGE_ENTRY,
  HOME_PAGE_ENTRY,
  LEARNING_PAGE_ENTRY,
  MILO_AGENT_URL,
  MILO_BOOKMARKS_URL,
  MILO_DOWNLOADS_URL,
  MILO_EXTENSIONS_URL,
  MILO_HISTORY_URL,
  MILO_HOME_URL,
  MILO_LEARNING_URL,
  MILO_SETTINGS_URL,
  MILO_TASKS_URL,
  MILO_USER_SCRIPTS_URL,
  MILO_WIDGETS_URL,
  MILO_WORKSPACE_URL,
  SETTINGS_PAGE_ENTRY,
  TASKS_PAGE_ENTRY,
  USER_SCRIPTS_PAGE_ENTRY,
  WIDGETS_PAGE_ENTRY,
  WORKSPACE_PAGE_ENTRY,
} from "../protocol/milo-protocol.js";

export type AppMenuLocale = "en-US" | "zh-CN";
export type AppMenuPageGroupId = "workspace" | "automation" | "library" | "tools";

export interface AppMenuPageGroupDefinition {
  id: AppMenuPageGroupId;
  label: Record<AppMenuLocale, string>;
}

export interface AppMenuPageDefinition {
  id: string;
  groupId: AppMenuPageGroupId;
  pageEntry: string;
  url: string;
  accelerator?: string;
  label: Record<AppMenuLocale, string>;
}

export const APP_MENU_PAGE_GROUPS: AppMenuPageGroupDefinition[] = [
  {
    id: "workspace",
    label: {
      "en-US": "Workspace",
      "zh-CN": "工作区",
    },
  },
  {
    id: "automation",
    label: {
      "en-US": "Automation",
      "zh-CN": "自动化",
    },
  },
  {
    id: "library",
    label: {
      "en-US": "Library",
      "zh-CN": "资料库",
    },
  },
  {
    id: "tools",
    label: {
      "en-US": "Tools",
      "zh-CN": "工具",
    },
  },
];

export const APP_MENU_PAGE_DEFINITIONS: AppMenuPageDefinition[] = [
  {
    id: "home",
    groupId: "workspace",
    pageEntry: HOME_PAGE_ENTRY,
    url: MILO_HOME_URL,
    label: {
      "en-US": "Start",
      "zh-CN": "开始",
    },
  },
  {
    id: "agent",
    groupId: "automation",
    pageEntry: AGENT_PAGE_ENTRY,
    url: MILO_AGENT_URL,
    label: {
      "en-US": "Milo Agent",
      "zh-CN": "Milo Agent",
    },
  },
  {
    id: "tasks",
    groupId: "automation",
    pageEntry: TASKS_PAGE_ENTRY,
    url: MILO_TASKS_URL,
    label: {
      "en-US": "Task Manager",
      "zh-CN": "任务管理",
    },
  },
  {
    id: "workspace",
    groupId: "workspace",
    pageEntry: WORKSPACE_PAGE_ENTRY,
    url: MILO_WORKSPACE_URL,
    label: {
      "en-US": "Workspace Manager",
      "zh-CN": "Workspace 管理",
    },
  },
  {
    id: "bookmarks",
    groupId: "library",
    pageEntry: BOOKMARKS_PAGE_ENTRY,
    url: MILO_BOOKMARKS_URL,
    label: {
      "en-US": "Bookmarks",
      "zh-CN": "书签",
    },
  },
  {
    id: "history",
    groupId: "library",
    pageEntry: HISTORY_PAGE_ENTRY,
    url: MILO_HISTORY_URL,
    label: {
      "en-US": "History",
      "zh-CN": "历史",
    },
  },
  {
    id: "downloads",
    groupId: "library",
    pageEntry: DOWNLOADS_PAGE_ENTRY,
    url: MILO_DOWNLOADS_URL,
    accelerator: "CmdOrCtrl+J",
    label: {
      "en-US": "Downloads",
      "zh-CN": "下载内容",
    },
  },
  {
    id: "extensions",
    groupId: "tools",
    pageEntry: EXTENSIONS_PAGE_ENTRY,
    url: MILO_EXTENSIONS_URL,
    accelerator: "CmdOrCtrl+Shift+E",
    label: {
      "en-US": "Extensions",
      "zh-CN": "扩展程序",
    },
  },
  {
    id: "user-scripts",
    groupId: "tools",
    pageEntry: USER_SCRIPTS_PAGE_ENTRY,
    url: MILO_USER_SCRIPTS_URL,
    accelerator: "CmdOrCtrl+Shift+U",
    label: {
      "en-US": "User Scripts",
      "zh-CN": "用户脚本",
    },
  },
  {
    id: "widgets",
    groupId: "tools",
    pageEntry: WIDGETS_PAGE_ENTRY,
    url: MILO_WIDGETS_URL,
    label: {
      "en-US": "Widgets",
      "zh-CN": "组件",
    },
  },
  {
    id: "learning",
    groupId: "automation",
    pageEntry: LEARNING_PAGE_ENTRY,
    url: MILO_LEARNING_URL,
    label: {
      "en-US": "Learning",
      "zh-CN": "学习",
    },
  },
  {
    id: "settings",
    groupId: "tools",
    pageEntry: SETTINGS_PAGE_ENTRY,
    url: MILO_SETTINGS_URL,
    accelerator: "CmdOrCtrl+,",
    label: {
      "en-US": "Settings",
      "zh-CN": "设置",
    },
  },
];
