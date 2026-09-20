import type { AppSettings, AppSettingsSaveRequest } from "./env";

export type SetupTab = "connection" | "data" | "plaud" | "updates" | "diagnostics";

const panelFields: Record<SetupTab, readonly (keyof AppSettings)[]> = {
  connection: ["authMode", "apiBaseUrl", "apiModel", "relayCredentialConfigured", "codexPath", "externalAccessMode"],
  data: ["localRepositoryDir", "localLibraryDir", "localDatabasePath", "outlookCalendarEmail", "outlookCalendarEmailVerifiedAt", "outlookCalendarRecipients", "outlookCalendarTimezone"],
  plaud: ["plaudConnectionMode", "plaudBrowser"],
  updates: ["updateChannel"],
  diagnostics: []
};

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** External/partial saves may update pristine fields, never unrelated edits. */
export function mergeSetupSettings(draft: AppSettings, previous: AppSettings, next: AppSettings): AppSettings {
  const merged = { ...draft };
  for (const key of Object.keys(next) as (keyof AppSettings)[]) {
    if (sameValue(draft[key], previous[key])) Object.assign(merged, { [key]: next[key] });
  }
  return merged;
}

/** Accept canonical saved paths, unless the user edited again during the save. */
export function acknowledgeSetupSave(draft: AppSettings, request: AppSettingsSaveRequest, saved: AppSettings): AppSettings {
  const merged = { ...draft };
  for (const key of Object.keys(saved) as (keyof AppSettings)[]) {
    if (Object.prototype.hasOwnProperty.call(request, key) && sameValue(draft[key], request[key])) {
      Object.assign(merged, { [key]: saved[key] });
    }
  }
  return merged;
}

export function setupPanelRequest(draft: AppSettings, tab: SetupTab, complete = false): AppSettingsSaveRequest {
  const request: AppSettingsSaveRequest = {};
  for (const key of panelFields[tab]) Object.assign(request, { [key]: draft[key] });
  if (complete) {
    // First use needs only the verified AI connection and a local workspace.
    // Integrations remain opt-in; never downgrade an existing enabled account.
    Object.assign(request, {
      onboardingComplete: true,
      localRepositoryDir: draft.localRepositoryDir,
      localDatabasePath: draft.localDatabasePath,
      plaudConnectionMode: draft.plaudConnectionMode === "enabled" ? "enabled" : "disabled"
    });
  }
  return request;
}
