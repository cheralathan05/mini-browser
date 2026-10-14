export type UserScriptRunAt = "document-idle";

export interface UserScriptRecord {
  id: string;
  profileId: string;
  name: string;
  description?: string;
  enabled: boolean;
  matches: string[];
  excludes: string[];
  runAt: UserScriptRunAt;
  code: string;
  testCode?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastMatchedUrl?: string;
  lastError?: string;
}

export interface UserScriptCreateInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  runAt?: UserScriptRunAt;
  code?: string;
  testCode?: string;
}

export interface UserScriptUpdateInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  runAt?: UserScriptRunAt;
  code?: string;
  testCode?: string | null;
}

export interface UserScriptRunResult {
  scriptId: string;
  name: string;
  url: string;
  success: boolean;
  ranAt: number;
  error?: string;
}

export interface UserScriptTestAssertion {
  ok: boolean;
  message: string;
}

export interface UserScriptTestResult {
  scriptId: string;
  name: string;
  url: string;
  success: boolean;
  ranAt: number;
  assertions: UserScriptTestAssertion[];
  error?: string;
}

export type UserScriptAgentMode = "script" | "test" | "script-and-test";

export interface UserScriptAgentGenerateInput {
  mode: UserScriptAgentMode;
  instruction: string;
  targetUrl?: string;
  pageTitle?: string;
  existingScript?: {
    name?: string;
    description?: string;
    matches?: string[];
    excludes?: string[];
    code?: string;
    testCode?: string;
  };
}

export interface UserScriptAgentGenerateResult {
  name: string;
  description?: string;
  matches: string[];
  excludes: string[];
  code: string;
  testCode: string;
  notes?: string;
}
