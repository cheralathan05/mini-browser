import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Download, Eye, EyeOff } from "lucide-react";
import {
  formatSettingsMessage,
  resolveSettingsLocale,
  type SettingsMessageKey,
} from "./settings-i18n";
import {
  DEFAULT_SETTINGS,
  buildAgentPreferencesInput,
  applyThemeSetting,
  buildDownloadPreferencesInput,
  buildLlmProvidersInput,
  buildImageAgentPreferencesInput,
  buildLearningPreferencesInput,
  buildTranslationPreferencesInput,
  isValidLlmProviderExtraBodyText,
  mergeAgentPreferences,
  mergeDownloadPreferences,
  mergeLlmProviders,
  mergeImageAgentPreferences,
  mergeLearningPreferences,
  mergeTranslationPreferences,
  normalizeLearningSummary,
  normalizeSettingValue,
  normalizeSettings,
  normalizeThemeSetting,
  readStoredSettings,
  writeStoredSettings,
  type LearningSummary,
  type LlmProvider,
  type LlmProviderModelSettings,
  type SettingsKey,
  type SettingsState,
} from "./settings-state";

type ToastTone = "ok" | "err";

type DefaultBrowserStatusReason =
  | "ready"
  | "packaged_build_required"
  | "manual_confirmation_required";

interface DefaultBrowserStatus {
  http: boolean;
  https: boolean;
  isDefaultBrowser: boolean;
  canSetAsDefaultBrowser: boolean;
  manualActionRequired: boolean;
  reason: DefaultBrowserStatusReason;
}

interface DefaultBrowserRegistrationResult extends DefaultBrowserStatus {
  updated: boolean;
}

interface ProviderDialogState {
  mode: "create" | "edit";
  draft: LlmProvider;
}

type SettingSectionId = "general" | "appearance" | "providers" | "agent" | "translation" | "downloads";

const SETTINGS_SECTION_SEARCH_KEYS: Record<SettingSectionId, SettingsMessageKey[]> = {
  general: [
    "sectionGeneral", "sectionGeneralDesc", "restoreSessionTitle", "restoreSessionDesc",
    "searchEngineTitle", "searchEngineDesc", "newTabUrlTitle", "newTabUrlDesc",
    "defaultBrowserTitle", "defaultBrowserDesc",
  ],
  appearance: [
    "sectionAppearance", "sectionAppearanceDesc", "themeTitle", "themeDesc",
    "languageTitle", "languageDesc", "compactTabsTitle", "showBookmarksSectionTitle",
  ],
  providers: [
    "sectionProviders", "sectionProvidersDesc", "llmProvidersTitle", "llmProvidersDesc",
    "llmProviderApiKeyTitle", "llmProviderModelsTitle", "llmProviderExtraHeadersTitle",
  ],
  agent: [
    "sectionAgent", "sectionAgentDesc", "mainAgentTitle", "mainAgentProfileTitle",
    "mainAgentMcpToolExportTitle", "imageAgentTitle", "learningModeTitle",
    "learningProviderTitle", "learningClearStateTitle", "doNotTrackTitle",
    "blockThirdPartyCookiesTitle", "debugHintsTitle", "allowInsecureCertsTitle",
  ],
  translation: [
    "sectionTranslation", "sectionTranslationDesc", "translationProviderTitle",
    "translationOpenAIProviderTitle", "translationGoogleApiKeyTitle",
    "translationBaiduApiKeyTitle", "translationTargetLanguageTitle",
  ],
  downloads: [
    "sectionDownloads", "sectionDownloadsDesc", "downloadDefaultDirectoryTitle",
    "downloadThreadCountTitle", "downloadHeadersTextTitle",
  ],
};

function createLlmProviderId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `provider-${globalThis.crypto.randomUUID()}`;
  }

  return `provider-${Math.random().toString(36).slice(2, 10)}`;
}

function getConfiguredProviderModels(provider: Pick<LlmProvider, "modelsText">) {
  const models: string[] = [];
  for (const model of provider.modelsText
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    if (!models.includes(model)) {
      models.push(model);
    }
  }
  return models;
}

function NavItem({
  href,
  label,
  active = false,
  hidden = false,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <a className={active ? "active" : undefined} hidden={hidden} href={href}>
      {children}
      <span>{label}</span>
    </a>
  );
}

function SettingMeta({ title, description }: { title: string; description: string }) {
  return (
    <div className="setting-meta">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function SettingRow({
  title,
  description,
  stacked = false,
  children,
}: {
  title: string;
  description: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div
      aria-labelledby={titleId}
      className={stacked ? "setting-row setting-row-stack" : "setting-row"}
      role="group"
    >
      <div className="setting-meta">
        <h3 id={titleId}>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

function SwitchControl({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="slider" />
    </label>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(() => readStoredSettings());
  const [learningSummary, setLearningSummary] = useState<LearningSummary | null>(null);
  const [defaultBrowserStatus, setDefaultBrowserStatus] = useState<DefaultBrowserStatus | null>(null);
  const [agentMcpHttpAddress, setAgentMcpHttpAddress] = useState<string | null>(null);
  const [providerDialog, setProviderDialog] = useState<ProviderDialogState | null>(null);
  const [providerApiKeyVisible, setProviderApiKeyVisible] = useState(false);
  const [defaultBrowserBusy, setDefaultBrowserBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<ToastTone | null>(null);
  const [activeSection, setActiveSection] = useState(() => window.location.hash || "#general");
  const [downloadThreadCountInput, setDownloadThreadCountInput] = useState(() =>
    String(readStoredSettings().downloadThreadCount),
  );
  const [learningRetentionDaysInput, setLearningRetentionDaysInput] = useState(() =>
    String(readStoredSettings().learningRetentionDays),
  );
  const [translationRequestConcurrencyInput, setTranslationRequestConcurrencyInput] = useState(() =>
    String(readStoredSettings().translationRequestConcurrency),
  );

  const settingsRef = useRef(settings);
  const persistedSettingsRef = useRef(settings);
  const downloadSyncVersionRef = useRef(0);
  const providerSyncVersionRef = useRef(0);
  const agentSyncVersionRef = useRef(0);
  const imageAgentSyncVersionRef = useRef(0);
  const learningSyncVersionRef = useRef(0);
  const translationSyncVersionRef = useRef(0);
  const themeSyncVersionRef = useRef(0);
  const languageSyncVersionRef = useRef(0);

  const systemLanguage = typeof navigator !== "undefined" ? navigator.language : "en-US";
  const locale = resolveSettingsLocale(settings.language, systemLanguage);
  const t = (key: SettingsMessageKey, vars?: Record<string, string | number>) =>
    formatSettingsMessage(locale, key, vars);
  const normalizedSettingsQuery = settingsQuery.trim().toLocaleLowerCase(locale);
  const visibleSectionIds = new Set<SettingSectionId>(
    (Object.keys(SETTINGS_SECTION_SEARCH_KEYS) as SettingSectionId[]).filter((sectionId) =>
      !normalizedSettingsQuery
      || SETTINGS_SECTION_SEARCH_KEYS[sectionId]
        .map((key) => t(key))
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedSettingsQuery)),
  );
  const learningModeEnabled = settings.learningMode === "on";
  const isTestingPhase = import.meta.env.DEV;
  const mainAgentMcpDescription = settings.agentMcpToolExportEnabled
    ? t("mainAgentMcpHttpAddressSubtitle", {
        address: agentMcpHttpAddress ?? t("mainAgentMcpHttpAddressLoading"),
      })
    : t("mainAgentMcpToolExportDesc");
  const agentModelOptions = getProviderModelOptions(settings.agentProviderId, settings.agentModel);
  const imageAgentModelOptions = getProviderModelOptions(
    settings.imageAgentProviderId,
    settings.imageAgentModel,
  );
  const learningModelOptions = getProviderModelOptions(
    settings.learningProviderId,
    settings.learningModel,
  );
  const translationOpenAIAssignmentGroups = getTranslationOpenAIAssignmentGroups(
    settings.translationOpenAIProviderId,
    settings.translationOpenAIModel,
  );
  const translationOpenAIAssignmentOptionsCount = translationOpenAIAssignmentGroups.reduce(
    (count, group) => count + group.options.length,
    0,
  );
  const translationOpenAIAssignmentValue =
    translationOpenAIAssignmentOptionsCount > 0 && settings.translationOpenAIModel.trim()
      ? serializeTranslationOpenAIAssignment(
          settings.translationOpenAIProviderId,
          settings.translationOpenAIModel,
        )
      : "";

  function messageForLanguage(
    language: SettingsState["language"],
    key: SettingsMessageKey,
    vars?: Record<string, string | number>,
  ) {
    return formatSettingsMessage(resolveSettingsLocale(language, systemLanguage), key, vars);
  }

  function currentMessage(key: SettingsMessageKey, vars?: Record<string, string | number>) {
    return messageForLanguage(settingsRef.current.language, key, vars);
  }

  function getProviderLabel(provider: LlmProvider, fallbackIndex?: number) {
    const name = provider.name.trim();
    if (name) {
      return name;
    }

    const resolvedIndex =
      typeof fallbackIndex === "number"
        ? fallbackIndex
        : settingsRef.current.llmProviders.findIndex((entry) => entry.id === provider.id);

    return t("llmProviderNameDefault", {
      index: resolvedIndex >= 0 ? resolvedIndex + 1 : 1,
    });
  }

  function getProviderModelOptions(providerId: string, currentModel = "") {
    const provider = settingsRef.current.llmProviders.find((entry) => entry.id === providerId);
    const models = provider ? getConfiguredProviderModels(provider) : [];

    if (currentModel.trim() && !models.includes(currentModel.trim())) {
      return [currentModel.trim(), ...models];
    }

    return models;
  }

  function serializeTranslationOpenAIAssignment(providerId: string, model: string) {
    return JSON.stringify([providerId.trim(), model.trim()]);
  }

  function parseTranslationOpenAIAssignment(value: string) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== 2) {
        return null;
      }

      const providerId = typeof parsed[0] === "string" ? parsed[0].trim() : "";
      const model = typeof parsed[1] === "string" ? parsed[1].trim() : "";
      return providerId && model ? { providerId, model } : null;
    } catch {
      return null;
    }
  }

  function getTranslationOpenAIAssignmentGroups(currentProviderId = "", currentModel = "") {
    const normalizedCurrentModel = currentModel.trim();

    return settingsRef.current.llmProviders
      .map((provider, index) => {
        const providerLabel = getProviderLabel(provider, index);
        const models = getConfiguredProviderModels(provider);
        const options = models.map((model) => ({
          label: model,
          value: serializeTranslationOpenAIAssignment(provider.id, model),
        }));

        if (
          provider.id === currentProviderId
          && normalizedCurrentModel
          && !models.includes(normalizedCurrentModel)
        ) {
          options.unshift({
            label: normalizedCurrentModel,
            value: serializeTranslationOpenAIAssignment(provider.id, normalizedCurrentModel),
          });
        }

        return options.length > 0
          ? {
              providerId: provider.id,
              providerLabel,
              options,
            }
          : null;
      })
      .filter((group): group is {
        providerId: string;
        providerLabel: string;
        options: Array<{ label: string; value: string }>;
      } => group !== null);
  }

  function resolveNextModelForProvider(providerId: string, currentModel = "") {
    const models = getProviderModelOptions(providerId, currentModel);
    if (models.length === 0) {
      return "";
    }
    if (currentModel.trim() && models.includes(currentModel.trim())) {
      return currentModel.trim();
    }
    return models[0] ?? "";
  }

  function createProviderDraft(index: number): LlmProvider {
    return {
      id: createLlmProviderId(),
      name: t("llmProviderNameDefault", { index: index + 1 }),
      baseUrl: DEFAULT_SETTINGS.llmProviders[0]?.baseUrl ?? "",
      apiKey: "",
      modelsText: "",
      extraBodyEnabled: false,
      extraBodyText: "",
      extraHeadersEnabled: false,
      extraHeadersText: "",
      extractThinkingContent: false,
      thinkingContentTagName: "think",
      interleavedThinkingEnabled: false,
      interleavedThinkingFieldName: "reasoning_content",
      modelSettings: {},
    };
  }

  function openCreateProviderDialog() {
    setProviderApiKeyVisible(false);
    setProviderDialog({
      mode: "create",
      draft: createProviderDraft(settingsRef.current.llmProviders.length),
    });
  }

  function openEditProviderDialog(providerId: string) {
    const provider = settingsRef.current.llmProviders.find((entry) => entry.id === providerId);
    if (!provider) {
      return;
    }

    setProviderApiKeyVisible(false);
    setProviderDialog({
      mode: "edit",
      draft: { ...provider },
    });
  }

  function closeProviderDialog() {
    setProviderApiKeyVisible(false);
    setProviderDialog(null);
  }

  function updateProviderDialogDraft(patch: Partial<LlmProvider>) {
    setProviderDialog((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              ...patch,
            },
          }
        : current,
    );
  }

  function createProviderDefaultModelSettings(provider: LlmProvider): LlmProviderModelSettings {
    return {
      extraBodyEnabled: provider.extraBodyEnabled,
      extraBodyText: provider.extraBodyText,
      extraHeadersEnabled: provider.extraHeadersEnabled,
      extraHeadersText: provider.extraHeadersText,
      extractThinkingContent: provider.extractThinkingContent,
      thinkingContentTagName: provider.thinkingContentTagName,
      interleavedThinkingEnabled: provider.interleavedThinkingEnabled,
      interleavedThinkingFieldName: provider.interleavedThinkingFieldName,
    };
  }

  function getProviderDialogModelSettings(provider: LlmProvider, model: string): LlmProviderModelSettings {
    return provider.modelSettings[model] ?? createProviderDefaultModelSettings(provider);
  }

  function updateProviderDialogModelSettings(model: string, patch: Partial<LlmProviderModelSettings>) {
    if (!model.trim()) {
      return;
    }

    setProviderDialog((current) => {
      if (!current) {
        return current;
      }

      const currentSettings = getProviderDialogModelSettings(current.draft, model);
      return {
        ...current,
        draft: {
          ...current.draft,
          modelSettings: {
            ...current.draft.modelSettings,
            [model]: {
              ...currentSettings,
              ...patch,
            },
          },
        },
      };
    });
  }

  function renderProviderModelSettingsControls(
    settings: LlmProviderModelSettings,
    update: (patch: Partial<LlmProviderModelSettings>) => void,
  ): ReactNode {
    return (
      <>
        <div className="llm-provider-field llm-provider-field-wide llm-provider-toggle-card">
          <div className="llm-provider-toggle-row">
            <div>
              <span>{t("llmProviderExtraBodyTitle")}</span>
              <small>{t("llmProviderExtraBodyDesc")}</small>
            </div>
            <SwitchControl
              checked={settings.extraBodyEnabled}
              label={t("llmProviderExtraBodyTitle")}
              onChange={(value) => update({ extraBodyEnabled: value })}
            />
          </div>

          {settings.extraBodyEnabled ? (
            <label className="llm-provider-field llm-provider-toggle-panel">
              <textarea
                aria-label={t("llmProviderExtraBodyTitle")}
                onChange={(event) => update({ extraBodyText: event.target.value })}
                placeholder={t("llmProviderExtraBodyPlaceholder")}
                value={settings.extraBodyText}
              />
            </label>
          ) : null}
        </div>

        <div className="llm-provider-field llm-provider-field-wide llm-provider-toggle-card">
          <div className="llm-provider-toggle-row">
            <div>
              <span>{t("llmProviderExtraHeadersTitle")}</span>
              <small>{t("llmProviderExtraHeadersDesc")}</small>
            </div>
            <SwitchControl
              checked={settings.extraHeadersEnabled}
              label={t("llmProviderExtraHeadersTitle")}
              onChange={(value) => update({ extraHeadersEnabled: value })}
            />
          </div>

          {settings.extraHeadersEnabled ? (
            <label className="llm-provider-field llm-provider-toggle-panel">
              <textarea
                aria-label={t("llmProviderExtraHeadersTitle")}
                onChange={(event) => update({ extraHeadersText: event.target.value })}
                placeholder={t("llmProviderExtraHeadersPlaceholder")}
                value={settings.extraHeadersText}
              />
            </label>
          ) : null}
        </div>

        <div className="llm-provider-field llm-provider-field-wide llm-provider-toggle-card">
          <div className="llm-provider-toggle-row">
            <div>
              <span>{t("llmProviderThinkingExtractTitle")}</span>
              <small>{t("llmProviderThinkingExtractDesc")}</small>
            </div>
            <SwitchControl
              checked={settings.extractThinkingContent}
              label={t("llmProviderThinkingExtractTitle")}
              onChange={(value) => update({ extractThinkingContent: value })}
            />
          </div>

          {settings.extractThinkingContent ? (
            <label className="llm-provider-field llm-provider-toggle-panel">
              <span>{t("llmProviderThinkingTagTitle")}</span>
              <input
                onChange={(event) => update({ thinkingContentTagName: event.target.value })}
                placeholder={t("llmProviderThinkingTagPlaceholder")}
                type="text"
                value={settings.thinkingContentTagName}
              />
              <small>{t("llmProviderThinkingTagDesc")}</small>
            </label>
          ) : null}
        </div>

        <div className="llm-provider-field llm-provider-field-wide llm-provider-toggle-card">
          <div className="llm-provider-toggle-row">
            <div>
              <span>{t("llmProviderInterleavedThinkingTitle")}</span>
              <small>{t("llmProviderInterleavedThinkingDesc")}</small>
            </div>
            <SwitchControl
              checked={settings.interleavedThinkingEnabled}
              label={t("llmProviderInterleavedThinkingTitle")}
              onChange={(value) => update({ interleavedThinkingEnabled: value })}
            />
          </div>

          {settings.interleavedThinkingEnabled ? (
            <label className="llm-provider-field llm-provider-toggle-panel">
              <span>{t("llmProviderThinkingFieldTitle")}</span>
              <input
                onChange={(event) => update({ interleavedThinkingFieldName: event.target.value })}
                placeholder={t("llmProviderThinkingFieldPlaceholder")}
                type="text"
                value={settings.interleavedThinkingFieldName}
              />
              <small>{t("llmProviderThinkingFieldDesc")}</small>
            </label>
          ) : null}
        </div>
      </>
    );
  }

  async function handleProviderDialogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!providerDialog) {
      return;
    }

    if (
      providerDialog.draft.extraBodyEnabled
      && !isValidLlmProviderExtraBodyText(providerDialog.draft.extraBodyText)
    ) {
      showToast(currentMessage("llmProviderExtraBodyInvalid"), "err");
      return;
    }

    const configuredModels = new Set(getConfiguredProviderModels(providerDialog.draft));
    const invalidModelExtraBody = Object.entries(providerDialog.draft.modelSettings)
      .some(([model, settings]) =>
        configuredModels.has(model)
        && settings.extraBodyEnabled
        && !isValidLlmProviderExtraBodyText(settings.extraBodyText));
    if (invalidModelExtraBody) {
      showToast(currentMessage("llmProviderExtraBodyInvalid"), "err");
      return;
    }

    const nextProviders =
      providerDialog.mode === "create"
        ? [...settingsRef.current.llmProviders, providerDialog.draft]
        : settingsRef.current.llmProviders.map((provider) =>
            provider.id === providerDialog.draft.id ? providerDialog.draft : provider,
          );

    await persistLlmProviders(nextProviders);
    setProviderDialog(null);
  }

  async function handleDeleteProvider(providerId: string) {
    const providerIndex = settingsRef.current.llmProviders.findIndex((entry) => entry.id === providerId);
    if (providerIndex < 0 || settingsRef.current.llmProviders.length <= 1) {
      return;
    }

    const provider = settingsRef.current.llmProviders[providerIndex];
    const confirmed = window.confirm(
      currentMessage("llmProviderDeleteConfirm", {
        name: getProviderLabel(provider, providerIndex),
      }),
    );

    if (!confirmed) {
      return;
    }

    const nextProviders = settingsRef.current.llmProviders.filter((entry) => entry.id !== providerId);
    await persistLlmProviders(nextProviders);
    setProviderDialog((current) => (current?.draft.id === providerId ? null : current));
  }


  async function refreshLearningSummary() {
    const browserShell = window.browserShell;
    if (!browserShell?.learningGetSummary) {
      setLearningSummary(null);
      return;
    }

    try {
      const summary = await browserShell.learningGetSummary();
      setLearningSummary(normalizeLearningSummary(summary));
    } catch (error) {
      console.error("Failed to read learning summary:", error);
    }
  }

  async function refreshDefaultBrowserStatus() {
    const browserShell = window.browserShell;
    if (!browserShell?.settingsGetDefaultBrowserStatus) {
      setDefaultBrowserStatus(null);
      return;
    }

    try {
      setDefaultBrowserStatus(await browserShell.settingsGetDefaultBrowserStatus());
    } catch (error) {
      console.error("Failed to read default browser status:", error);
    }
  }

  async function refreshAgentMcpHttpAddress(enabled = settingsRef.current.agentMcpToolExportEnabled) {
    const browserShell = window.browserShell;
    if (!enabled || !browserShell?.agentGetMcpHttpAddress) {
      setAgentMcpHttpAddress(null);
      return;
    }

    try {
      setAgentMcpHttpAddress(await browserShell.agentGetMcpHttpAddress());
    } catch (error) {
      setAgentMcpHttpAddress(null);
      console.error("Failed to read agent MCP HTTP address:", error);
    }
  }

  async function handleExportAllData() {
    const browserShell = window.browserShell;
    if (!browserShell?.settingsExportAllData) {
      showToast(currentMessage("exportAllDataFailed"), "err");
      return;
    }

    if (!window.confirm(currentMessage("exportAllDataConfirm"))) {
      return;
    }

    setExportBusy(true);
    try {
      const result = await browserShell.settingsExportAllData({
        rendererSettings: settingsRef.current as unknown as Record<string, unknown>,
      });
      if (!result?.canceled) {
        showToast(currentMessage("exportAllDataSuccess"), "ok");
      }
    } catch (error) {
      showToast(
        error instanceof Error && error.message
          ? error.message
          : currentMessage("exportAllDataFailed"),
        "err",
      );
    } finally {
      setExportBusy(false);
    }
  }

  function getDefaultBrowserStatusLabel() {
    if (!defaultBrowserStatus) {
      return t("defaultBrowserStatusChecking");
    }

    return defaultBrowserStatus.isDefaultBrowser
      ? t("defaultBrowserStatusDefault")
      : t("defaultBrowserStatusNotDefault");
  }

  function replaceAllSettings(nextInput: SettingsState | Partial<Record<SettingsKey, unknown>>) {
    const next = normalizeSettings(nextInput);
    settingsRef.current = next;
    persistedSettingsRef.current = next;
    writeStoredSettings(next);
    setSettings(next);
    return next;
  }

  function updateDraftPatch(patch: Partial<SettingsState>) {
    const next = {
      ...settingsRef.current,
      ...patch,
    };

    settingsRef.current = next;
    setSettings(next);
    return next;
  }

  function updateDraftSetting<K extends SettingsKey>(key: K, value: SettingsState[K]) {
    updateDraftPatch({ [key]: value } as Pick<SettingsState, K>);
  }

  function applyPersistedPatch(patch: Partial<Record<SettingsKey, unknown>>) {
    const nextPersisted = normalizeSettings({
      ...persistedSettingsRef.current,
      ...patch,
    });

    persistedSettingsRef.current = nextPersisted;
    writeStoredSettings(nextPersisted);

    const nextDraft: SettingsState = {
      ...settingsRef.current,
    };

    (Object.keys(patch) as SettingsKey[]).forEach((key) => {
      (nextDraft as Record<SettingsKey, SettingsState[SettingsKey]>)[key] = nextPersisted[key];
    });

    settingsRef.current = nextDraft;
    setSettings(nextDraft);

    return nextPersisted;
  }

  function showToast(message: string, tone: ToastTone) {
    setToastMessage(message);
    setToastTone(tone);
  }

  function getErrorMessage(error: unknown) {
    return error instanceof Error && error.message
      ? error.message
      : currentMessage("saveFailed");
  }

  async function persistLlmProviders(nextProviders: LlmProvider[]) {
    const normalizedProviders = normalizeSettingValue("llmProviders", nextProviders);

    if (settingsRef.current.llmProviders !== normalizedProviders) {
      updateDraftSetting("llmProviders", normalizedProviders);
    }

    const browserShell = window.browserShell;
    let nextPersisted = applyPersistedPatch({ llmProviders: normalizedProviders });

    try {
      if (browserShell?.llmSetProviders) {
        const version = ++providerSyncVersionRef.current;
        const providers = await browserShell.llmSetProviders(
          buildLlmProvidersInput(nextPersisted),
        );

        if (version === providerSyncVersionRef.current) {
          const syncedSettings = mergeLlmProviders(nextPersisted, providers);
          nextPersisted = applyPersistedPatch({
            llmProviders: syncedSettings.llmProviders,
          });
        }
      }

      if (browserShell?.agentGetPreferences) {
        const preferences = await browserShell.agentGetPreferences();
        const syncedSettings = mergeAgentPreferences(nextPersisted, preferences);
        nextPersisted = applyPersistedPatch({
          agentProviderId: syncedSettings.agentProviderId,
          agentModel: syncedSettings.agentModel,
          agentMcpToolExportEnabled: syncedSettings.agentMcpToolExportEnabled,
          agentProfileInstructions: syncedSettings.agentProfileInstructions,
          agentInteractionBlacklistDomainsText: syncedSettings.agentInteractionBlacklistDomainsText,
        });
      }

      if (browserShell?.imageAgentGetPreferences) {
        const preferences = await browserShell.imageAgentGetPreferences();
        const syncedSettings = mergeImageAgentPreferences(nextPersisted, preferences);
        nextPersisted = applyPersistedPatch({
          imageAgentProviderId: syncedSettings.imageAgentProviderId,
          imageAgentModel: syncedSettings.imageAgentModel,
        });
      }

      if (browserShell?.learningGetPreferences) {
        const preferences = await browserShell.learningGetPreferences();
        const syncedSettings = mergeLearningPreferences(nextPersisted, preferences);
        nextPersisted = applyPersistedPatch({
          learningProviderId: syncedSettings.learningProviderId,
          learningModel: syncedSettings.learningModel,
          learningMode: syncedSettings.learningMode,
          learningRedactTextInput: syncedSettings.learningRedactTextInput,
          learningRetentionDays: syncedSettings.learningRetentionDays,
          learningBlacklistDomainsText: syncedSettings.learningBlacklistDomainsText,
        });
      }

      if (browserShell?.translationGetPreferences) {
        const preferences = await browserShell.translationGetPreferences();
        const syncedSettings = mergeTranslationPreferences(nextPersisted, preferences);
        nextPersisted = applyPersistedPatch({
          translationProvider: syncedSettings.translationProvider,
          translationOpenAIProviderId: syncedSettings.translationOpenAIProviderId,
          translationOpenAIModel: syncedSettings.translationOpenAIModel,
          translationGoogleEndpoint: syncedSettings.translationGoogleEndpoint,
          translationGoogleApiKey: syncedSettings.translationGoogleApiKey,
          translationBaiduEndpoint: syncedSettings.translationBaiduEndpoint,
          translationBaiduAppId: syncedSettings.translationBaiduAppId,
          translationBaiduApiKey: syncedSettings.translationBaiduApiKey,
          translationTargetLanguage: syncedSettings.translationTargetLanguage,
          translationRequestConcurrency: syncedSettings.translationRequestConcurrency,
        });
      }

      showToast(messageForLanguage(nextPersisted.language, "saved"), "ok");
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    }
  }

  async function persistAgentPreferences(
    patch: Pick<
      SettingsState,
      | "agentModel"
      | "agentProviderId"
      | "agentMcpToolExportEnabled"
      | "agentProfileInstructions"
      | "agentInteractionBlacklistDomainsText"
    >,
  ) {
    const nextDraft = normalizeSettings({
      ...settingsRef.current,
      ...patch,
    });
    settingsRef.current = nextDraft;
    setSettings(nextDraft);
    if (!nextDraft.agentMcpToolExportEnabled) {
      setAgentMcpHttpAddress(null);
    }

    const browserShell = window.browserShell;
    let nextPersisted = applyPersistedPatch({
      agentProviderId: nextDraft.agentProviderId,
      agentModel: nextDraft.agentModel,
      agentMcpToolExportEnabled: nextDraft.agentMcpToolExportEnabled,
      agentProfileInstructions: nextDraft.agentProfileInstructions,
      agentInteractionBlacklistDomainsText: nextDraft.agentInteractionBlacklistDomainsText,
    });

    try {
      if (browserShell?.agentSetPreferences) {
        const version = ++agentSyncVersionRef.current;
        const preferences = await browserShell.agentSetPreferences(
          buildAgentPreferencesInput(nextPersisted),
        );

        if (version === agentSyncVersionRef.current) {
          const syncedSettings = mergeAgentPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch({
            agentProviderId: syncedSettings.agentProviderId,
            agentModel: syncedSettings.agentModel,
            agentMcpToolExportEnabled: syncedSettings.agentMcpToolExportEnabled,
            agentProfileInstructions: syncedSettings.agentProfileInstructions,
            agentInteractionBlacklistDomainsText: syncedSettings.agentInteractionBlacklistDomainsText,
          });
        }
      }

      if (browserShell?.learningGetPreferences) {
        const learningPreferences = await browserShell.learningGetPreferences();
        const syncedSettings = mergeLearningPreferences(nextPersisted, learningPreferences);
        nextPersisted = applyPersistedPatch({
          learningProviderId: syncedSettings.learningProviderId,
          learningModel: syncedSettings.learningModel,
          learningMode: syncedSettings.learningMode,
          learningRedactTextInput: syncedSettings.learningRedactTextInput,
          learningRetentionDays: syncedSettings.learningRetentionDays,
          learningBlacklistDomainsText: syncedSettings.learningBlacklistDomainsText,
        });
      }

      await refreshAgentMcpHttpAddress(nextPersisted.agentMcpToolExportEnabled);

      showToast(messageForLanguage(nextPersisted.language, "saved"), "ok");
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    }
  }

  async function persistImageAgentAssignment(
    patch: Pick<SettingsState, "imageAgentModel" | "imageAgentProviderId">,
  ) {
    const nextDraft = normalizeSettings({
      ...settingsRef.current,
      ...patch,
    });
    settingsRef.current = nextDraft;
    setSettings(nextDraft);

    const browserShell = window.browserShell;
    let nextPersisted = applyPersistedPatch({
      imageAgentProviderId: nextDraft.imageAgentProviderId,
      imageAgentModel: nextDraft.imageAgentModel,
    });

    try {
      if (browserShell?.imageAgentSetPreferences) {
        const version = ++imageAgentSyncVersionRef.current;
        const preferences = await browserShell.imageAgentSetPreferences(
          buildImageAgentPreferencesInput(nextPersisted),
        );

        if (version === imageAgentSyncVersionRef.current) {
          const syncedSettings = mergeImageAgentPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch({
            imageAgentProviderId: syncedSettings.imageAgentProviderId,
            imageAgentModel: syncedSettings.imageAgentModel,
          });
        }
      }

      showToast(messageForLanguage(nextPersisted.language, "saved"), "ok");
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    }
  }

  async function persistLearningAssignment(
    patch: Pick<SettingsState, "learningModel" | "learningProviderId">,
  ) {
    const nextDraft = normalizeSettings({
      ...settingsRef.current,
      ...patch,
    });
    settingsRef.current = nextDraft;
    setSettings(nextDraft);

    const browserShell = window.browserShell;
    let nextPersisted = applyPersistedPatch({
      learningProviderId: nextDraft.learningProviderId,
      learningModel: nextDraft.learningModel,
    });

    try {
      if (browserShell?.learningSetPreferences) {
        const version = ++learningSyncVersionRef.current;
        const preferences = await browserShell.learningSetPreferences(
          buildLearningPreferencesInput(nextPersisted),
        );

        if (version === learningSyncVersionRef.current) {
          const syncedSettings = mergeLearningPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch({
            learningProviderId: syncedSettings.learningProviderId,
            learningModel: syncedSettings.learningModel,
            learningMode: syncedSettings.learningMode,
            learningRedactTextInput: syncedSettings.learningRedactTextInput,
            learningRetentionDays: syncedSettings.learningRetentionDays,
            learningBlacklistDomainsText: syncedSettings.learningBlacklistDomainsText,
          });
        }
      }

      await refreshLearningSummary();
      showToast(messageForLanguage(nextPersisted.language, "saved"), "ok");
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    }
  }

  function buildTranslationSettingsPatch(settingsState: SettingsState) {
    return {
      translationProvider: settingsState.translationProvider,
      translationOpenAIProviderId: settingsState.translationOpenAIProviderId,
      translationOpenAIModel: settingsState.translationOpenAIModel,
      translationGoogleEndpoint: settingsState.translationGoogleEndpoint,
      translationGoogleApiKey: settingsState.translationGoogleApiKey,
      translationBaiduEndpoint: settingsState.translationBaiduEndpoint,
      translationBaiduAppId: settingsState.translationBaiduAppId,
      translationBaiduApiKey: settingsState.translationBaiduApiKey,
      translationTargetLanguage: settingsState.translationTargetLanguage,
      translationRequestConcurrency: settingsState.translationRequestConcurrency,
    } satisfies Partial<Record<SettingsKey, unknown>>;
  }

  async function persistTranslationOpenAIAssignment(
    patch: Pick<SettingsState, "translationOpenAIModel" | "translationOpenAIProviderId">,
  ) {
    const nextDraft = normalizeSettings({
      ...settingsRef.current,
      ...patch,
    });
    settingsRef.current = nextDraft;
    setSettings(nextDraft);

    const browserShell = window.browserShell;
    let nextPersisted = applyPersistedPatch(buildTranslationSettingsPatch(nextDraft));

    try {
      if (browserShell?.translationSetPreferences) {
        const version = ++translationSyncVersionRef.current;
        const preferences = await browserShell.translationSetPreferences(
          buildTranslationPreferencesInput(nextPersisted),
        );

        if (version === translationSyncVersionRef.current) {
          const syncedSettings = mergeTranslationPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch(buildTranslationSettingsPatch(syncedSettings));
        }
      }

      showToast(messageForLanguage(nextPersisted.language, "saved"), "ok");
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    }
  }

  async function persistSetting<K extends SettingsKey>(key: K, value: SettingsState[K]) {
    if (key === "llmProviders") {
      await persistLlmProviders(value as SettingsState["llmProviders"]);
      return;
    }

    if (
      key === "agentProviderId"
      || key === "agentModel"
      || key === "agentMcpToolExportEnabled"
      || key === "agentProfileInstructions"
      || key === "agentInteractionBlacklistDomainsText"
    ) {
      const patch = normalizeSettings({
        ...settingsRef.current,
        [key]: value,
      });
      await persistAgentPreferences({
        agentProviderId: patch.agentProviderId,
        agentModel: patch.agentModel,
        agentMcpToolExportEnabled: patch.agentMcpToolExportEnabled,
        agentProfileInstructions: patch.agentProfileInstructions,
        agentInteractionBlacklistDomainsText: patch.agentInteractionBlacklistDomainsText,
      });
      return;
    }

    if (key === "imageAgentProviderId" || key === "imageAgentModel") {
      const patch = normalizeSettings({
        ...settingsRef.current,
        [key]: value,
      });
      await persistImageAgentAssignment({
        imageAgentProviderId: patch.imageAgentProviderId,
        imageAgentModel: patch.imageAgentModel,
      });
      return;
    }

    if (key === "learningProviderId" || key === "learningModel") {
      const patch = normalizeSettings({
        ...settingsRef.current,
        [key]: value,
      });
      await persistLearningAssignment({
        learningProviderId: patch.learningProviderId,
        learningModel: patch.learningModel,
      });
      return;
    }

    if (key === "translationOpenAIProviderId" || key === "translationOpenAIModel") {
      const patch = normalizeSettings({
        ...settingsRef.current,
        [key]: value,
      });
      await persistTranslationOpenAIAssignment({
        translationOpenAIProviderId: patch.translationOpenAIProviderId,
        translationOpenAIModel: patch.translationOpenAIModel,
      });
      return;
    }

    const normalizedValue = normalizeSettingValue(key, value);

    if (settingsRef.current[key] !== normalizedValue) {
      updateDraftPatch({ [key]: normalizedValue } as Pick<SettingsState, K>);
    }

    if (persistedSettingsRef.current[key] === normalizedValue) {
      return;
    }

    const browserShell = window.browserShell;
    let nextPersisted = applyPersistedPatch({ [key]: normalizedValue });

    try {
      if (key === "theme" && browserShell?.settingsSetTheme) {
        const version = ++themeSyncVersionRef.current;
        const nextTheme = await browserShell.settingsSetTheme(nextPersisted.theme);

        if (version === themeSyncVersionRef.current) {
          nextPersisted = applyPersistedPatch({
            theme: normalizeThemeSetting(nextTheme),
          });
        }
      }

      if (key === "language" && browserShell?.settingsSetLanguage) {
        const version = ++languageSyncVersionRef.current;
        const nextLanguage = await browserShell.settingsSetLanguage(nextPersisted.language);

        if (version === languageSyncVersionRef.current) {
          nextPersisted = applyPersistedPatch({
            language: nextLanguage,
          });
        }
      }

      if (
        (key === "downloadDefaultDirectory"
          || key === "downloadThreadCount"
          || key === "downloadHeadersText")
        && browserShell?.downloadsSetPreferences
      ) {
        const version = ++downloadSyncVersionRef.current;
        const preferences = await browserShell.downloadsSetPreferences(
          buildDownloadPreferencesInput(nextPersisted),
        );

        if (version === downloadSyncVersionRef.current) {
          const syncedSettings = mergeDownloadPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch({
            downloadDefaultDirectory: syncedSettings.downloadDefaultDirectory,
            downloadThreadCount: syncedSettings.downloadThreadCount,
            downloadHeadersText: syncedSettings.downloadHeadersText,
          });
        }
      }

      if (
        (key === "learningMode"
          || key === "learningProviderId"
          || key === "learningModel"
          || key === "learningRedactTextInput"
          || key === "learningRetentionDays"
          || key === "learningBlacklistDomainsText")
        && browserShell?.learningSetPreferences
      ) {
        const version = ++learningSyncVersionRef.current;
        const preferences = await browserShell.learningSetPreferences(
          buildLearningPreferencesInput(nextPersisted),
        );

        if (version === learningSyncVersionRef.current) {
          const syncedSettings = mergeLearningPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch({
            learningProviderId: syncedSettings.learningProviderId,
            learningMode: syncedSettings.learningMode,
            learningModel: syncedSettings.learningModel,
            learningRedactTextInput: syncedSettings.learningRedactTextInput,
            learningRetentionDays: syncedSettings.learningRetentionDays,
            learningBlacklistDomainsText: syncedSettings.learningBlacklistDomainsText,
          });
        }

        await refreshLearningSummary();
      }

      if (
        (key === "translationProvider"
          || key === "translationOpenAIProviderId"
          || key === "translationOpenAIModel"
          || key === "translationGoogleEndpoint"
          || key === "translationGoogleApiKey"
          || key === "translationBaiduEndpoint"
          || key === "translationBaiduAppId"
          || key === "translationBaiduApiKey"
          || key === "translationTargetLanguage"
          || key === "translationRequestConcurrency")
        && browserShell?.translationSetPreferences
      ) {
        const version = ++translationSyncVersionRef.current;
        const preferences = await browserShell.translationSetPreferences(
          buildTranslationPreferencesInput(nextPersisted),
        );

        if (version === translationSyncVersionRef.current) {
          const syncedSettings = mergeTranslationPreferences(nextPersisted, preferences);
          nextPersisted = applyPersistedPatch(buildTranslationSettingsPatch(syncedSettings));
        }
      }

      showToast(messageForLanguage(nextPersisted.language, "saved"), "ok");
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    }
  }

  async function persistCurrentSetting<K extends SettingsKey>(key: K) {
    const normalizedValue = normalizeSettingValue(key, settingsRef.current[key]);
    if (settingsRef.current[key] !== normalizedValue) {
      updateDraftPatch({ [key]: normalizedValue } as Pick<SettingsState, K>);
    }
    await persistSetting(key, normalizedValue);
  }

  async function handleChooseDownloadDirectory() {
    const browserShell = window.browserShell;
    if (!browserShell?.downloadsShowDirectoryDialog) {
      return;
    }

    try {
      const selectedDirectory = await browserShell.downloadsShowDirectoryDialog({
        defaultPath: settingsRef.current.downloadDefaultDirectory,
      });

      if (!selectedDirectory) {
        return;
      }

      await persistSetting("downloadDefaultDirectory", selectedDirectory);
    } catch (error) {
      showToast(
        error instanceof Error && error.message
          ? error.message
          : currentMessage("chooseDownloadDirectoryFailed"),
        "err",
      );
    }
  }

  async function handleSetDefaultBrowser() {
    const browserShell = window.browserShell;
    if (!browserShell?.settingsSetDefaultBrowser) {
      return;
    }

    setDefaultBrowserBusy(true);

    try {
      const result: DefaultBrowserRegistrationResult = await browserShell.settingsSetDefaultBrowser();
      setDefaultBrowserStatus(result);

      if (result.isDefaultBrowser) {
        showToast(currentMessage("defaultBrowserSetSuccess"), "ok");
      } else if (result.reason === "packaged_build_required") {
        showToast(currentMessage("defaultBrowserPackagedOnly"), "err");
      } else {
        showToast(currentMessage("defaultBrowserNeedsManualAction"), "err");
      }
    } catch (error) {
      showToast(getErrorMessage(error), "err");
    } finally {
      setDefaultBrowserBusy(false);
    }
  }

  async function syncSettingsSnapshot(input: SettingsState) {
    const browserShell = window.browserShell;
    let nextPersisted = normalizeSettings(input);

    if (browserShell?.settingsSetTheme) {
      const nextTheme = await browserShell.settingsSetTheme(nextPersisted.theme);
      nextPersisted = normalizeSettings({
        ...nextPersisted,
        theme: normalizeThemeSetting(nextTheme),
      });
    }

    if (browserShell?.settingsSetLanguage) {
      const nextLanguage = await browserShell.settingsSetLanguage(nextPersisted.language);
      nextPersisted = normalizeSettings({ ...nextPersisted, language: nextLanguage });
    }

    if (browserShell?.downloadsSetPreferences) {
      nextPersisted = mergeDownloadPreferences(
        nextPersisted,
        await browserShell.downloadsSetPreferences(buildDownloadPreferencesInput(nextPersisted)),
      );
    }

    if (browserShell?.llmSetProviders) {
      nextPersisted = mergeLlmProviders(
        nextPersisted,
        await browserShell.llmSetProviders(buildLlmProvidersInput(nextPersisted)),
      );
    }

    if (browserShell?.agentSetPreferences) {
      nextPersisted = mergeAgentPreferences(
        nextPersisted,
        await browserShell.agentSetPreferences(buildAgentPreferencesInput(nextPersisted)),
      );
    }

    if (browserShell?.imageAgentSetPreferences) {
      nextPersisted = mergeImageAgentPreferences(
        nextPersisted,
        await browserShell.imageAgentSetPreferences(buildImageAgentPreferencesInput(nextPersisted)),
      );
    }

    if (browserShell?.learningSetPreferences) {
      nextPersisted = mergeLearningPreferences(
        nextPersisted,
        await browserShell.learningSetPreferences(buildLearningPreferencesInput(nextPersisted)),
      );
    }

    if (browserShell?.translationSetPreferences) {
      nextPersisted = mergeTranslationPreferences(
        nextPersisted,
        await browserShell.translationSetPreferences(buildTranslationPreferencesInput(nextPersisted)),
      );
    }

    return normalizeSettings(nextPersisted);
  }

  async function handleResetDefaults() {
    if (!window.confirm(currentMessage("resetDefaultsConfirm"))) {
      return;
    }

    const previousSettings = normalizeSettings(persistedSettingsRef.current);
    setProviderDialog(null);
    setResetBusy(true);

    try {
      const nextPersisted = await syncSettingsSnapshot(DEFAULT_SETTINGS);
      replaceAllSettings(nextPersisted);
      await refreshLearningSummary();
      showToast(messageForLanguage(nextPersisted.language, "defaultsRestored"), "ok");
    } catch (error) {
      try {
        await syncSettingsSnapshot(previousSettings);
      } catch (rollbackError) {
        console.error("Failed to roll back settings after reset failure:", rollbackError);
      }
      replaceAllSettings(previousSettings);
      showToast(currentMessage("resetDefaultsFailedRolledBack"), "err");
    } finally {
      setResetBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("pageTitle");
  }, [locale]);

  useEffect(() => {
    applyThemeSetting(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    setDownloadThreadCountInput(String(settings.downloadThreadCount));
  }, [settings.downloadThreadCount]);

  useEffect(() => {
    setLearningRetentionDaysInput(String(settings.learningRetentionDays));
  }, [settings.learningRetentionDays]);

  useEffect(() => {
    setTranslationRequestConcurrencyInput(String(settings.translationRequestConcurrency));
  }, [settings.translationRequestConcurrency]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToastMessage("");
      setToastTone(null);
    }, 4200);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!providerDialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProviderDialog(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [providerDialog]);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveSection(window.location.hash || "#general");
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const browserShell = window.browserShell;
    let disposed = false;

    const handleThemePreferenceChange = () => {
      if (settingsRef.current.theme === "system") {
        applyThemeSetting("system");
      }
    };

    const hydrate = async () => {
      let nextSettings = readStoredSettings();

      if (browserShell?.settingsGetTheme) {
        try {
          nextSettings = normalizeSettings({
            ...nextSettings,
            theme: await browserShell.settingsGetTheme(),
          });
        } catch (error) {
          console.error("Failed to read app theme setting:", error);
        }
      }

      if (browserShell?.settingsGetLanguage) {
        try {
          nextSettings = normalizeSettings({
            ...nextSettings,
            language: await browserShell.settingsGetLanguage(),
          });
        } catch (error) {
          console.error("Failed to read app language setting:", error);
        }
      }

      if (browserShell?.downloadsGetPreferences) {
        try {
          const downloadPreferences = await browserShell.downloadsGetPreferences();
          nextSettings = mergeDownloadPreferences(nextSettings, downloadPreferences);
        } catch (error) {
          console.error("Failed to read download preferences:", error);
        }
      }

      if (browserShell?.llmGetProviders) {
        try {
          const llmProviders = await browserShell.llmGetProviders();
          nextSettings = mergeLlmProviders(nextSettings, llmProviders);
        } catch (error) {
          console.error("Failed to read LLM providers:", error);
        }
      }

      if (browserShell?.agentGetPreferences) {
        try {
          const agentPreferences = await browserShell.agentGetPreferences();
          nextSettings = mergeAgentPreferences(nextSettings, agentPreferences);
        } catch (error) {
          console.error("Failed to read agent preferences:", error);
        }
      }

      if (browserShell?.imageAgentGetPreferences) {
        try {
          const imageAgentPreferences = await browserShell.imageAgentGetPreferences();
          nextSettings = mergeImageAgentPreferences(nextSettings, imageAgentPreferences);
        } catch (error) {
          console.error("Failed to read image agent preferences:", error);
        }
      }

      if (browserShell?.learningGetPreferences) {
        try {
          const learningPreferences = await browserShell.learningGetPreferences();
          nextSettings = mergeLearningPreferences(nextSettings, learningPreferences);
        } catch (error) {
          console.error("Failed to read learning preferences:", error);
        }
      }

      if (browserShell?.translationGetPreferences) {
        try {
          const translationPreferences = await browserShell.translationGetPreferences();
          nextSettings = mergeTranslationPreferences(nextSettings, translationPreferences);
        } catch (error) {
          console.error("Failed to read translation preferences:", error);
        }
      }

      if (!disposed) {
        replaceAllSettings(nextSettings);
      }

      if (!disposed) {
        await refreshAgentMcpHttpAddress(nextSettings.agentMcpToolExportEnabled);
        await refreshLearningSummary();
        await refreshDefaultBrowserStatus();
      }
    };

    const handleWindowFocus = () => {
      void refreshDefaultBrowserStatus();
    };

    mediaQuery.addEventListener("change", handleThemePreferenceChange);
    window.addEventListener("focus", handleWindowFocus);

    const disposeTheme = browserShell?.onThemeChanged?.((theme) => {
      if (!disposed) {
        applyPersistedPatch({
          theme: normalizeThemeSetting(theme),
        });
      }
    });

    const disposeLanguage = browserShell?.onLanguageChanged?.((language) => {
      if (!disposed) {
        applyPersistedPatch({
          language,
        });
      }
    });

    void hydrate();

    return () => {
      disposed = true;
      mediaQuery.removeEventListener("change", handleThemePreferenceChange);
      window.removeEventListener("focus", handleWindowFocus);
      disposeTheme?.();
      disposeLanguage?.();
    };
  }, []);

  const providerDialogModelOptions = providerDialog
    ? getConfiguredProviderModels(providerDialog.draft)
    : [];

  return (
    <div className="page">
      <aside className="sidebar custom-scrollbar">
        <div className="sidebar-head">
          <div className="header-left">
            <svg
              fill="none"
              height="24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="24"
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" />
              <line x1="21.17" x2="12" y1="8" y2="8" />
              <line x1="3.95" x2="8.54" y1="6.06" y2="14" />
              <line x1="10.88" x2="15.46" y1="21.94" y2="14" />
            </svg>
            <span>{t("pageTitle")}</span>
          </div>
          <div className="brand">{t("brand")}</div>
        </div>

        <div className="sidebar-nav">
          <nav className="nav">
            <NavItem
              active={activeSection === "#general"}
              hidden={!visibleSectionIds.has("general")}
              href="#general"
              label={t("navGeneral")}
            >
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </NavItem>

            <NavItem
              active={activeSection === "#appearance"}
              hidden={!visibleSectionIds.has("appearance")}
              href="#appearance"
              label={t("navAppearance")}
            >
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <circle cx="13.5" cy="6.5" fill="currentColor" r=".5" />
                <circle cx="17.5" cy="10.5" fill="currentColor" r=".5" />
                <circle cx="8.5" cy="7.5" fill="currentColor" r=".5" />
                <circle cx="6.5" cy="12.5" fill="currentColor" r=".5" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
              </svg>
            </NavItem>

            <NavItem
              active={activeSection === "#providers"}
              hidden={!visibleSectionIds.has("providers")}
              href="#providers"
              label={t("navProviders")}
            >
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <path d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3Z" />
                <path d="M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3" />
                <path d="M4 17c0 1.657 3.582 3 8 3s8-1.343 8-3" />
                <path d="M4 7v10" />
                <path d="M20 7v10" />
              </svg>
            </NavItem>

            <NavItem
              active={activeSection === "#agent"}
              hidden={!visibleSectionIds.has("agent")}
              href="#agent"
              label={t("navAgent")}
            >
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <path d="M12 2v4" />
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M8 6h8l4 7-4 5H8l-4-5 4-7Z" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </NavItem>

            <NavItem
              active={activeSection === "#translation"}
              hidden={!visibleSectionIds.has("translation")}
              href="#translation"
              label={t("navTranslation")}
            >
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            </NavItem>

            <NavItem
              active={activeSection === "#downloads"}
              hidden={!visibleSectionIds.has("downloads")}
              href="#downloads"
              label={t("navDownloads")}
            >
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
            </NavItem>

          </nav>
        </div>
      </aside>

      <div className="main-panel">
        <header className="page-header">
          <div className="header-search">
            <div className="search-bar">
              <svg
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                aria-label={t("searchPlaceholder")}
                className="ring-0 bg-transparent"
                onChange={(event) => setSettingsQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSettingsQuery("");
                }}
                placeholder={t("searchPlaceholder")}
                type="search"
                value={settingsQuery}
              />
            </div>
          </div>
        </header>

        <main className="content custom-scrollbar">
          <div className="content-inner">
            <div className="hero">
              <div className="hero-head">
                <h1>{t("heroTitle")}</h1>
                <div className="hero-actions">
                  <button
                    className="reset-btn"
                    disabled={exportBusy || resetBusy}
                    onClick={() => void handleExportAllData()}
                    type="button"
                  >
                    <Download aria-hidden="true" size={14} />
                    <span>{exportBusy ? t("exportAllDataBusy") : t("exportAllDataAction")}</span>
                  </button>
                  <button
                    className="reset-btn"
                    disabled={resetBusy || exportBusy}
                    onClick={() => void handleResetDefaults()}
                    type="button"
                  >
                    {resetBusy ? t("resetDefaultsBusy") : t("resetDefaults")}
                  </button>
                </div>
              </div>
            </div>

            {visibleSectionIds.size === 0 ? (
              <div className="settings-search-empty" role="status">{t("searchNoResults")}</div>
            ) : null}

            <section
              className="card"
              hidden={!visibleSectionIds.has("general")}
              id="general"
              style={{ marginTop: 16 }}
            >
              <h2>{t("sectionGeneral")}</h2>
              <p className="desc">{t("sectionGeneralDesc")}</p>

              <SettingRow
                description={t("restoreSessionDesc")}
                title={t("restoreSessionTitle")}
              >
                <SwitchControl
                  checked={settings.restoreSession}
                  label={t("restoreSessionTitle")}
                  onChange={(value) => void persistSetting("restoreSession", value)}
                />
              </SettingRow>

              <SettingRow
                description={t("searchEngineDesc")}
                title={t("searchEngineTitle")}
              >
                <select
                  aria-label={t("searchEngineTitle")}
                  onChange={(event) =>
                    void persistSetting("searchEngine", event.target.value as SettingsState["searchEngine"])}
                  value={settings.searchEngine}
                >
                  <option value="google">Google</option>
                  <option value="bing">Bing</option>
                  <option value="duckduckgo">DuckDuckGo</option>
                </select>
              </SettingRow>

              <SettingRow
                description={t("newTabUrlDesc")}
                title={t("newTabUrlTitle")}
              >
                <input
                  aria-label={t("newTabUrlTitle")}
                  onBlur={() => void persistCurrentSetting("newTabUrl")}
                  onChange={(event) => updateDraftSetting("newTabUrl", event.target.value)}
                  placeholder={t("newTabUrlPlaceholder")}
                  type="text"
                  value={settings.newTabUrl}
                />
              </SettingRow>

              <SettingRow
                description={getDefaultBrowserStatusLabel()}
                title={t("defaultBrowserTitle")}
              >
                {defaultBrowserStatus && !defaultBrowserStatus.isDefaultBrowser ? (
                  <button
                    className="inline-action-btn primary"
                    disabled={
                      defaultBrowserBusy
                      || defaultBrowserStatus.canSetAsDefaultBrowser === false
                    }
                    onClick={() => void handleSetDefaultBrowser()}
                    type="button"
                  >
                    {defaultBrowserBusy
                      ? t("defaultBrowserSetActionBusy")
                      : t("defaultBrowserSetAction")}
                  </button>
                ) : null}
              </SettingRow>
            </section>

            <section className="card" hidden={!visibleSectionIds.has("appearance")} id="appearance" style={{ marginTop: 12 }}>
              <h2>{t("sectionAppearance")}</h2>
              <p className="desc">{t("sectionAppearanceDesc")}</p>

              <SettingRow
                description={t("languageDesc")}
                title={t("languageTitle")}
              >
                <select
                  aria-label={t("languageTitle")}
                  onChange={(event) =>
                    void persistSetting("language", event.target.value as SettingsState["language"])}
                  value={settings.language}
                >
                  <option value="system">{t("languageSystem")}</option>
                  <option value="en-US">{t("languageEnglish")}</option>
                  <option value="zh-CN">{t("languageChinese")}</option>
                </select>
              </SettingRow>

              <SettingRow
                description={t("themeDesc")}
                title={t("themeTitle")}
              >
                <select
                  aria-label={t("themeTitle")}
                  onChange={(event) =>
                    void persistSetting("theme", event.target.value as SettingsState["theme"])}
                  value={settings.theme}
                >
                  <option value="system">{t("themeSystem")}</option>
                  <option value="light">{t("themeLight")}</option>
                  <option value="dark">{t("themeDark")}</option>
                </select>
              </SettingRow>

            </section>

            <section className="card" hidden={!visibleSectionIds.has("providers")} id="providers" style={{ marginTop: 12 }}>
              <div className="card-header-row">
                <h2>{t("sectionProviders")}</h2>
                <button
                  aria-label={t("llmProviderAddAction")}
                  className="icon-action-btn"
                  onClick={openCreateProviderDialog}
                  title={t("llmProviderAddAction")}
                  type="button"
                >
                  <svg
                    fill="none"
                    height="16"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="16"
                  >
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>
              <p className="desc" style={{ marginTop: -4 }}>{t("sectionProvidersDesc")}</p>

              <div className="llm-provider-section-body">
                <div className="llm-provider-panel">
                  <div className="llm-provider-list">
                    {settings.llmProviders.map((provider, index) => {
                      const configuredModels = getConfiguredProviderModels(provider);

                      return (
                        <div className="llm-provider-item" key={provider.id}>
                          <div className="llm-provider-item-meta">
                            <strong>{getProviderLabel(provider, index)}</strong>
                            <span>{provider.baseUrl || t("llmProviderBaseUrlPlaceholder")}</span>
                            <div className="llm-provider-item-badges">
                              <span className="llm-provider-item-badge">
                                {configuredModels.length > 0
                                  ? t("llmProviderModelsCount", { count: configuredModels.length })
                                  : t("llmProviderNoModels")}
                              </span>
                            </div>
                          </div>

                          <div className="llm-provider-item-actions">
                            <button
                              aria-label={t("llmProviderEditAction")}
                              className="icon-action-btn"
                              onClick={() => openEditProviderDialog(provider.id)}
                              title={t("llmProviderEditAction")}
                              type="button"
                            >
                              <svg
                                fill="none"
                                height="16"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                                width="16"
                              >
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                            <button
                              aria-label={t("llmProviderRemoveAction")}
                              className="icon-action-btn danger"
                              disabled={settings.llmProviders.length <= 1}
                              onClick={() => void handleDeleteProvider(provider.id)}
                              title={t("llmProviderRemoveAction")}
                              type="button"
                            >
                              <svg
                                fill="none"
                                height="16"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                                width="16"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="m19 6-1 14H6L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section className="card" hidden={!visibleSectionIds.has("agent")} id="agent" style={{ marginTop: 12 }}>
              <h2>{t("sectionAgent")}</h2>
              <p className="desc">{t("sectionAgentDesc")}</p>

              <SettingRow
                description={t("mainAgentDesc")}
                title={t("mainAgentTitle")}
              >
                <div className="setting-select-pair">
                  <label className="setting-select-field">
                    <span>{t("providerFieldLabel")}</span>
                    <select
                      aria-label={t("providerFieldLabel")}
                      onChange={(event) => {
                        const providerId = event.target.value;
                        void persistAgentPreferences({
                          agentProviderId: providerId,
                          agentModel: resolveNextModelForProvider(providerId, settings.agentModel),
                          agentMcpToolExportEnabled: settings.agentMcpToolExportEnabled,
                          agentProfileInstructions: settings.agentProfileInstructions,
                          agentInteractionBlacklistDomainsText: settings.agentInteractionBlacklistDomainsText,
                        });
                      }}
                      value={settings.agentProviderId}
                    >
                      {settings.llmProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {getProviderLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="setting-select-field">
                    <span>{t("modelFieldLabel")}</span>
                    <select
                      aria-label={t("modelFieldLabel")}
                      disabled={agentModelOptions.length === 0}
                      onChange={(event) => {
                        void persistAgentPreferences({
                          agentProviderId: settings.agentProviderId,
                          agentModel: event.target.value,
                          agentMcpToolExportEnabled: settings.agentMcpToolExportEnabled,
                          agentProfileInstructions: settings.agentProfileInstructions,
                          agentInteractionBlacklistDomainsText: settings.agentInteractionBlacklistDomainsText,
                        });
                      }}
                      value={settings.agentModel}
                    >
                      {agentModelOptions.length === 0 ? (
                        <option value="">{t("llmProviderNoModels")}</option>
                      ) : !settings.agentModel ? (
                        <option value="">{t("llmProviderSelectModel")}</option>
                      ) : null}
                      {agentModelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </SettingRow>

              <div className="setting-row agent-profile-setting">
                <SettingMeta
                  description={t("mainAgentProfileDesc")}
                  title={t("mainAgentProfileTitle")}
                />
                <div className="setting-control-group agent-profile-panel">
                  <textarea
                    aria-label={t("mainAgentProfileTitle")}
                    className="agent-profile-input"
                    maxLength={4000}
                    onBlur={() => void persistCurrentSetting("agentProfileInstructions")}
                    onChange={(event) =>
                      updateDraftSetting("agentProfileInstructions", event.target.value)}
                    placeholder={t("mainAgentProfilePlaceholder")}
                    value={settings.agentProfileInstructions}
                  />
                </div>
              </div>

              <SettingRow
                description={t("agentInteractionBlacklistDomainsDesc")}
                stacked
                title={t("agentInteractionBlacklistDomainsTitle")}
              >
                <div className="setting-control-group learning-blacklist-panel">
                  <textarea
                    aria-label={t("agentInteractionBlacklistDomainsTitle")}
                    className="learning-blacklist-input"
                    onBlur={() => void persistCurrentSetting("agentInteractionBlacklistDomainsText")}
                    onChange={(event) =>
                      updateDraftSetting("agentInteractionBlacklistDomainsText", event.target.value)}
                    placeholder={t("agentInteractionBlacklistDomainsPlaceholder")}
                    value={settings.agentInteractionBlacklistDomainsText}
                  />
                </div>
              </SettingRow>

              <SettingRow
                description={t("imageAgentDesc")}
                title={t("imageAgentTitle")}
              >
                <div className="setting-select-pair">
                  <label className="setting-select-field">
                    <span>{t("providerFieldLabel")}</span>
                    <select
                      aria-label={t("providerFieldLabel")}
                      onChange={(event) => {
                        const providerId = event.target.value;
                        void persistImageAgentAssignment({
                          imageAgentProviderId: providerId,
                          imageAgentModel: resolveNextModelForProvider(providerId, settings.imageAgentModel),
                        });
                      }}
                      value={settings.imageAgentProviderId}
                    >
                      {settings.llmProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {getProviderLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="setting-select-field">
                    <span>{t("modelFieldLabel")}</span>
                    <select
                      aria-label={t("modelFieldLabel")}
                      disabled={imageAgentModelOptions.length === 0}
                      onChange={(event) => {
                        void persistImageAgentAssignment({
                          imageAgentProviderId: settings.imageAgentProviderId,
                          imageAgentModel: event.target.value,
                        });
                      }}
                      value={settings.imageAgentModel}
                    >
                      {imageAgentModelOptions.length === 0 ? (
                        <option value="">{t("llmProviderNoModels")}</option>
                      ) : !settings.imageAgentModel ? (
                        <option value="">{t("llmProviderSelectModel")}</option>
                      ) : null}
                      {imageAgentModelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </SettingRow>

              <SettingRow
                description={t("learningProviderDesc")}
                title={t("learningProviderTitle")}
              >
                <div className="setting-select-pair">
                  <label className="setting-select-field">
                    <span>{t("providerFieldLabel")}</span>
                    <select
                      aria-label={t("providerFieldLabel")}
                      onChange={(event) => {
                        const providerId = event.target.value;
                        void persistLearningAssignment({
                          learningProviderId: providerId,
                          learningModel: resolveNextModelForProvider(providerId, settings.learningModel),
                        });
                      }}
                      value={settings.learningProviderId}
                    >
                      {settings.llmProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {getProviderLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="setting-select-field">
                    <span>{t("modelFieldLabel")}</span>
                    <select
                      aria-label={t("modelFieldLabel")}
                      disabled={learningModelOptions.length === 0}
                      onChange={(event) => {
                        void persistLearningAssignment({
                          learningProviderId: settings.learningProviderId,
                          learningModel: event.target.value,
                        });
                      }}
                      value={settings.learningModel}
                    >
                      {learningModelOptions.length === 0 ? (
                        <option value="">{t("llmProviderNoModels")}</option>
                      ) : !settings.learningModel ? (
                        <option value="">{t("llmProviderSelectModel")}</option>
                      ) : null}
                      {learningModelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </SettingRow>

              <SettingRow
                description={t("learningModeDesc")}
                title={t("learningModeTitle")}
              >
                <SwitchControl
                  checked={learningModeEnabled}
                  label={t("learningModeTitle")}
                  onChange={(value) => void persistSetting("learningMode", value ? "on" : "off")}
                />
              </SettingRow>

              {learningModeEnabled ? (
                <>
                  <SettingRow
                    description={t("learningRedactTextInputDesc")}
                    title={t("learningRedactTextInputTitle")}
                  >
                    <SwitchControl
                      checked={settings.learningRedactTextInput}
                      label={t("learningRedactTextInputTitle")}
                      onChange={(value) => void persistSetting("learningRedactTextInput", value)}
                    />
                  </SettingRow>

                  <SettingRow
                    description={t("learningRetentionDaysDesc")}
                    title={t("learningRetentionDaysTitle")}
                  >
                    <input
                      aria-label={t("learningRetentionDaysTitle")}
                      max="365"
                      min="1"
                      onBlur={() => {
                        const parsed = Number.parseInt(learningRetentionDaysInput, 10);
                        const normalizedValue = Number.isFinite(parsed)
                          ? parsed
                          : DEFAULT_SETTINGS.learningRetentionDays;
                        setLearningRetentionDaysInput(String(normalizedValue));
                        void persistSetting("learningRetentionDays", normalizedValue);
                      }}
                      onChange={(event) => setLearningRetentionDaysInput(event.target.value)}
                      type="number"
                      value={learningRetentionDaysInput}
                    />
                  </SettingRow>

                  <SettingRow
                    description={t("learningBlacklistDomainsDesc")}
                    stacked
                    title={t("learningBlacklistDomainsTitle")}
                  >
                    <div className="setting-control-group learning-blacklist-panel">
                      <textarea
                        aria-label={t("learningBlacklistDomainsTitle")}
                        className="learning-blacklist-input"
                        onBlur={() => void persistCurrentSetting("learningBlacklistDomainsText")}
                        onChange={(event) =>
                          updateDraftSetting("learningBlacklistDomainsText", event.target.value)}
                        placeholder={t("learningBlacklistDomainsPlaceholder")}
                        value={settings.learningBlacklistDomainsText}
                      />
                    </div>
                  </SettingRow>
                </>
              ) : null}

              <SettingRow
                description={mainAgentMcpDescription}
                title={t("mainAgentMcpToolExportTitle")}
              >
                <div className="setting-inline-switch">
                  <SwitchControl
                    checked={settings.agentMcpToolExportEnabled}
                    label={t("mainAgentMcpToolExportTitle")}
                    onChange={(value) => void persistSetting("agentMcpToolExportEnabled", value)}
                  />
                </div>
              </SettingRow>

            </section>

            <section className="card" hidden={!visibleSectionIds.has("translation")} id="translation" style={{ marginTop: 12 }}>
              <h2>{t("sectionTranslation")}</h2>
              <p className="desc">{t("sectionTranslationDesc")}</p>

              <SettingRow
                description={t("translationProviderDesc")}
                title={t("translationProviderTitle")}
              >
                <select
                  aria-label={t("translationProviderTitle")}
                  onChange={(event) =>
                    void persistSetting(
                      "translationProvider",
                      event.target.value as SettingsState["translationProvider"],
                    )}
                  value={settings.translationProvider}
                >
                  <option value="openai-compatible">{t("translationProviderOpenAICompatible")}</option>
                  <option value="google-basic">{t("translationProviderGoogleBasic")}</option>
                  <option value="google-system">{t("translationProviderGoogleSystem")}</option>
                  <option value="baidu-standard">{t("translationProviderBaiduStandard")}</option>
                </select>
              </SettingRow>

              {settings.translationProvider === "openai-compatible" ? (
                <SettingRow
                  description={t("translationOpenAIModelDesc")}
                  title={t("translationOpenAIModelTitle")}
                >
                  <select
                    aria-label={t("translationOpenAIModelTitle")}
                    disabled={translationOpenAIAssignmentOptionsCount === 0}
                    onChange={(event) => {
                      const assignment = parseTranslationOpenAIAssignment(event.target.value);
                      if (!assignment) {
                        return;
                      }

                      void persistTranslationOpenAIAssignment({
                        translationOpenAIProviderId: assignment.providerId,
                        translationOpenAIModel: assignment.model,
                      });
                    }}
                    value={translationOpenAIAssignmentValue}
                  >
                    {translationOpenAIAssignmentOptionsCount === 0 ? (
                      <option value="">{t("translationOpenAIModelNoOptions")}</option>
                    ) : !settings.translationOpenAIModel ? (
                      <option value="">{t("translationOpenAIModelSelectPair")}</option>
                    ) : null}
                    {translationOpenAIAssignmentGroups.map((group) => (
                      <optgroup key={group.providerId} label={group.providerLabel}>
                        {group.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </SettingRow>
              ) : null}

              {settings.translationProvider === "google-basic" ? (
                <>
                  <SettingRow
                    description={t("translationGoogleEndpointDesc")}
                    title={t("translationGoogleEndpointTitle")}
                  >
                    <input
                      aria-label={t("translationGoogleEndpointTitle")}
                      onBlur={() => void persistCurrentSetting("translationGoogleEndpoint")}
                      onChange={(event) =>
                        updateDraftSetting("translationGoogleEndpoint", event.target.value)}
                      placeholder={t("translationGoogleEndpointPlaceholder")}
                      type="text"
                      value={settings.translationGoogleEndpoint}
                    />
                  </SettingRow>

                  <SettingRow
                    description={t("translationGoogleApiKeyDesc")}
                    title={t("translationGoogleApiKeyTitle")}
                  >
                    <input
                      aria-label={t("translationGoogleApiKeyTitle")}
                      autoComplete="off"
                      onBlur={() => void persistCurrentSetting("translationGoogleApiKey")}
                      onChange={(event) =>
                        updateDraftSetting("translationGoogleApiKey", event.target.value)}
                      placeholder={t("translationGoogleApiKeyPlaceholder")}
                      type="password"
                      value={settings.translationGoogleApiKey}
                    />
                  </SettingRow>
                </>
              ) : null}

              {settings.translationProvider === "baidu-standard" ? (
                <>
                  <SettingRow
                    description={t("translationBaiduEndpointDesc")}
                    title={t("translationBaiduEndpointTitle")}
                  >
                    <input
                      aria-label={t("translationBaiduEndpointTitle")}
                      onBlur={() => void persistCurrentSetting("translationBaiduEndpoint")}
                      onChange={(event) =>
                        updateDraftSetting("translationBaiduEndpoint", event.target.value)}
                      placeholder={t("translationBaiduEndpointPlaceholder")}
                      type="text"
                      value={settings.translationBaiduEndpoint}
                    />
                  </SettingRow>

                  <SettingRow
                    description={t("translationBaiduAppIdDesc")}
                    title={t("translationBaiduAppIdTitle")}
                  >
                    <input
                      aria-label={t("translationBaiduAppIdTitle")}
                      autoComplete="off"
                      onBlur={() => void persistCurrentSetting("translationBaiduAppId")}
                      onChange={(event) =>
                        updateDraftSetting("translationBaiduAppId", event.target.value)}
                      placeholder={t("translationBaiduAppIdPlaceholder")}
                      type="text"
                      value={settings.translationBaiduAppId}
                    />
                  </SettingRow>

                  <SettingRow
                    description={t("translationBaiduApiKeyDesc")}
                    title={t("translationBaiduApiKeyTitle")}
                  >
                    <input
                      aria-label={t("translationBaiduApiKeyTitle")}
                      autoComplete="off"
                      onBlur={() => void persistCurrentSetting("translationBaiduApiKey")}
                      onChange={(event) =>
                        updateDraftSetting("translationBaiduApiKey", event.target.value)}
                      placeholder={t("translationBaiduApiKeyPlaceholder")}
                      type="password"
                      value={settings.translationBaiduApiKey}
                    />
                  </SettingRow>
                </>
              ) : null}

              <SettingRow
                description={t("translationTargetLanguageDesc")}
                title={t("translationTargetLanguageTitle")}
              >
                <select
                  aria-label={t("translationTargetLanguageTitle")}
                  onChange={(event) =>
                    void persistSetting(
                      "translationTargetLanguage",
                      event.target.value as SettingsState["translationTargetLanguage"],
                    )}
                  value={settings.translationTargetLanguage}
                >
                  <option value="system">{t("translationTargetLanguageSystem")}</option>
                  <option value="en-US">{t("translationTargetLanguageEnglish")}</option>
                  <option value="zh-CN">{t("translationTargetLanguageChinese")}</option>
                </select>
              </SettingRow>

              <SettingRow
                description={t("translationRequestConcurrencyDesc")}
                title={t("translationRequestConcurrencyTitle")}
              >
                <input
                  aria-label={t("translationRequestConcurrencyTitle")}
                  max="8"
                  min="1"
                  onBlur={() => {
                    const parsed = Number.parseInt(translationRequestConcurrencyInput, 10);
                    const normalizedValue = Number.isFinite(parsed)
                      ? parsed
                      : DEFAULT_SETTINGS.translationRequestConcurrency;
                    setTranslationRequestConcurrencyInput(String(normalizedValue));
                    void persistSetting("translationRequestConcurrency", normalizedValue);
                  }}
                  onChange={(event) => setTranslationRequestConcurrencyInput(event.target.value)}
                  type="number"
                  value={translationRequestConcurrencyInput}
                />
              </SettingRow>
            </section>

            <section className="card" hidden={!visibleSectionIds.has("downloads")} id="downloads" style={{ marginTop: 12 }}>
              <h2>{t("sectionDownloads")}</h2>
              <p className="desc">{t("sectionDownloadsDesc")}</p>

              <SettingRow
                description={t("downloadDefaultDirectoryDesc")}
                stacked
                title={t("downloadDefaultDirectoryTitle")}
              >
                <div className="setting-control-group">
                  <div className="inline-field-row">
                    <input
                      aria-label={t("downloadDefaultDirectoryTitle")}
                      placeholder={t("downloadDefaultDirectoryPlaceholder")}
                      readOnly
                      type="text"
                      value={settings.downloadDefaultDirectory}
                    />
                    <button
                      className="inline-action-btn"
                      onClick={() => void handleChooseDownloadDirectory()}
                      type="button"
                    >
                      {t("chooseDownloadDirectory")}
                    </button>
                  </div>
                </div>
              </SettingRow>

              <SettingRow
                description={t("downloadThreadCountDesc")}
                title={t("downloadThreadCountTitle")}
              >
                <input
                  aria-label={t("downloadThreadCountTitle")}
                  max="16"
                  min="1"
                  onBlur={() => {
                    const parsed = Number.parseInt(downloadThreadCountInput, 10);
                    const normalizedValue = Number.isFinite(parsed)
                      ? parsed
                      : DEFAULT_SETTINGS.downloadThreadCount;
                    setDownloadThreadCountInput(String(normalizedValue));
                    void persistSetting("downloadThreadCount", normalizedValue);
                  }}
                  onChange={(event) => setDownloadThreadCountInput(event.target.value)}
                  type="number"
                  value={downloadThreadCountInput}
                />
              </SettingRow>

              <SettingRow
                description={t("downloadHeadersTextDesc")}
                stacked
                title={t("downloadHeadersTextTitle")}
              >
                <div className="setting-control-group">
                  <textarea
                    aria-label={t("downloadHeadersTextTitle")}
                    onBlur={() => void persistCurrentSetting("downloadHeadersText")}
                    onChange={(event) => updateDraftSetting("downloadHeadersText", event.target.value)}
                    placeholder={t("downloadHeadersTextPlaceholder")}
                    value={settings.downloadHeadersText}
                  />
                </div>
              </SettingRow>
            </section>
          </div>
        </main>
      </div>

      {providerDialog ? (
        <div
          aria-describedby="llm-provider-dialog-description"
          aria-labelledby="llm-provider-dialog-title"
          aria-modal="true"
          className="llm-provider-dialog-backdrop"
          role="dialog"
        >
          <div className="llm-provider-dialog">
            <div className="llm-provider-dialog-head">
              <div>
                <h3 id="llm-provider-dialog-title">
                  {providerDialog.mode === "create"
                    ? t("llmProviderDialogCreateTitle")
                    : t("llmProviderDialogEditTitle")}
                </h3>
                <p id="llm-provider-dialog-description">{t("llmProviderDialogDesc")}</p>
              </div>

              <button
                aria-label={t("llmProviderDialogCancelAction")}
                className="llm-provider-dialog-close"
                onClick={closeProviderDialog}
                type="button"
              >
                ×
              </button>
            </div>

            <form className="llm-provider-dialog-form" onSubmit={handleProviderDialogSubmit}>
              <div className="llm-provider-grid">
                <label className="llm-provider-field">
                  <span>{t("llmProviderNameTitle")}</span>
                  <input
                    onChange={(event) => updateProviderDialogDraft({ name: event.target.value })}
                    placeholder={t("llmProviderNamePlaceholder")}
                    type="text"
                    value={providerDialog.draft.name}
                  />
                  <small>{t("llmProviderNameDesc")}</small>
                </label>

                <label className="llm-provider-field">
                  <span>{t("llmProviderBaseUrlTitle")}</span>
                  <input
                    onChange={(event) => updateProviderDialogDraft({ baseUrl: event.target.value })}
                    placeholder={t("llmProviderBaseUrlPlaceholder")}
                    type="text"
                    value={providerDialog.draft.baseUrl}
                  />
                  <small>{t("llmProviderBaseUrlDesc")}</small>
                </label>

                <label className="llm-provider-field llm-provider-field-wide">
                  <span>{t("llmProviderApiKeyTitle")}</span>
                  <div className="llm-provider-secret-field">
                    <input
                      autoComplete="off"
                      onChange={(event) => updateProviderDialogDraft({ apiKey: event.target.value })}
                      placeholder={t("llmProviderApiKeyPlaceholder")}
                      type={providerApiKeyVisible ? "text" : "password"}
                      value={providerDialog.draft.apiKey}
                    />
                    <button
                      aria-label={providerApiKeyVisible
                        ? t("llmProviderApiKeyHideAction")
                        : t("llmProviderApiKeyShowAction")}
                      className="llm-provider-secret-toggle"
                      onClick={() => setProviderApiKeyVisible((visible) => !visible)}
                      title={providerApiKeyVisible
                        ? t("llmProviderApiKeyHideAction")
                        : t("llmProviderApiKeyShowAction")}
                      type="button"
                    >
                      {providerApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <small>{t("llmProviderApiKeyDesc")}</small>
                </label>

                <label className="llm-provider-field llm-provider-field-wide">
                  <span>{t("llmProviderModelsTitle")}</span>
                  <textarea
                    onChange={(event) => updateProviderDialogDraft({ modelsText: event.target.value })}
                    placeholder={t("llmProviderModelsPlaceholder")}
                    value={providerDialog.draft.modelsText}
                  />
                  <small>{t("llmProviderModelsDesc")}</small>
                </label>

                <div className="llm-provider-settings-section llm-provider-field-wide">
                  <div className="llm-provider-settings-section-head">
                    <span>{t("llmProviderDefaultSettingsTitle")}</span>
                    <small>{t("llmProviderDefaultSettingsDesc")}</small>
                  </div>

                  {renderProviderModelSettingsControls(
                    createProviderDefaultModelSettings(providerDialog.draft),
                    (patch) => updateProviderDialogDraft(patch),
                  )}
                </div>

                <div className="llm-provider-settings-section llm-provider-field-wide">
                  <div className="llm-provider-settings-section-head">
                    <span>{t("llmProviderModelSettingsTitle")}</span>
                    <small>{t("llmProviderModelSettingsDesc")}</small>
                  </div>

                  {providerDialogModelOptions.length > 0 ? (
                    <div className="llm-provider-model-settings-list">
                      {providerDialogModelOptions.map((model) => (
                        <details
                          className="llm-provider-model-settings-card"
                          key={model}
                        >
                          <summary>
                            <span>{model}</span>
                          </summary>
                          <div className="llm-provider-model-settings-body">
                            {renderProviderModelSettingsControls(
                              getProviderDialogModelSettings(providerDialog.draft, model),
                              (patch) => updateProviderDialogModelSettings(model, patch),
                            )}
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <div className="llm-provider-empty-model-settings">
                      {t("llmProviderModelSettingsEmpty")}
                    </div>
                  )}
                </div>
              </div>

              <div className="llm-provider-dialog-actions">
                <div className="llm-provider-dialog-actions-end">
                  <button
                    className="inline-action-btn ghost"
                    onClick={closeProviderDialog}
                    type="button"
                  >
                    {t("llmProviderDialogCancelAction")}
                  </button>
                  <button className="inline-action-btn primary" type="submit">
                    {t("llmProviderDialogSaveAction")}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div aria-live="polite" className="page-toast-host">
          <div className={["page-toast", toastTone === "err" ? "err" : "ok"].join(" ")}>
            {toastMessage}
          </div>
        </div>
      ) : null}
    </div>
  );
}
