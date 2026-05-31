import type { AppSettings } from "../types/shared.js";

interface SettingsStoreSchema {
  settings: AppSettings;
}

type SettingsStoreAccess = {
  get: (key: "settings", defaultValue: AppSettings) => AppSettings;
  set: (key: "settings", value: AppSettings) => void;
};

const defaultSettings: AppSettings = {
  appTheme: "dark",
  terminalTheme: "oceanic",
  terminalFontSize: 13,
  terminalFontFamily: "JetBrains Mono",
  editorCommand: "code",
  workspaceEditorCommand: "code",
  connectionTimeout: 30,
  keepAliveInterval: 10,
  autoReconnect: false,
  autoReconnectDelay: 15,
  cursorBlink: true,
  scrollbackLines: 1000
};

let settingsStorePromise: Promise<SettingsStoreAccess> | null = null;

async function getSettingsStore(): Promise<SettingsStoreAccess> {
  if (!settingsStorePromise) {
    settingsStorePromise = (async () => {
      const { default: Store } = await import("electron-store");

      const store = new Store<SettingsStoreSchema>({
        name: "shadowssh-preferences",
        defaults: {
          settings: defaultSettings
        }
      });

      return store as unknown as SettingsStoreAccess;
    })();
  }

  return settingsStorePromise;
}

export async function getAppSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return store.get("settings", defaultSettings);
}

export async function setAppSettings(settings: AppSettings): Promise<AppSettings> {
  const store = await getSettingsStore();
  store.set("settings", settings);
  return settings;
}

export { defaultSettings };
