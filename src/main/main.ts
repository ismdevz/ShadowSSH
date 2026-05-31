import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { registerIpcHandlers } from "./ipc.js";
import type { AppUpdateEvent } from "../types/shared.js";

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Robust icon path detection for dev vs prod
const getIconPath = () => {
  const isWindows = process.platform === 'win32';
  const iconExt = isWindows ? 'ico' : 'png';
  
  // Try multiple common locations
  const paths = [
    join(__dirname, "..", "..", "public", `icon.${iconExt}`),
    join(__dirname, "..", "..", "public", "icons", `icon.${iconExt}`),
    join(__dirname, "..", "..", "build", `icon.${iconExt}`)
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }
  
  // Fallback to the logo
  return join(__dirname, "..", "..", "public", "os-icons", "shadowssh-logo.png");
};

const appIconPath = getIconPath();

process.title = "ShadowSSH";
if (process.platform === 'linux') {
  app.commandLine.appendSwitch("ozone-platform", "wayland");
  app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
  (app as unknown as { setDesktopName?: (name: string) => void }).setDesktopName?.("shadowssh");
  app.setAppUserModelId("ShadowSSH");
}

app.disableHardwareAcceleration();
app.setName("ShadowSSH");

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "ShadowSSH",
    icon: appIconPath,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0b0f14",
    show: true,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false
    }
  });

  window.once("ready-to-show", () => {
    window.setIcon(nativeImage.createFromPath(appIconPath));
    window.show();
    window.focus();
  });

  window.webContents.on("did-finish-load", () => {
    if (!window.isVisible()) {
      window.show();
    }

    window.focus();
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Renderer failed to load", {
      errorCode,
      errorDescription,
      validatedURL
    });

    if (!window.isVisible()) {
      window.show();
    }

    window.focus();
  });

  setTimeout(() => {
    if (!window.isVisible()) {
      window.show();
    }
    window.focus();
  }, 1500);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void import('electron').then(({ shell }) => shell.openExternal(url));
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    // The renderer is a single-page app; block all runtime top-level navigations.
    // This prevents accidental form/link navigations that can present as a blank page.
    console.warn("Blocked renderer navigation", { url });
    event.preventDefault();
  });

  window.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process exited", details);

    if (!window.isDestroyed()) {
      void window.webContents.reloadIgnoringCache();
    }
  });

  window.webContents.on("unresponsive", () => {
    console.error("Renderer became unresponsive");
  });

  window.webContents.on("console-message", (event) => {
    const { level, message, lineNumber, sourceId } = event;

    if (level === "error" || level === "warning") {
      console.error("Renderer console", { level, message, line: lineNumber, sourceId });
    }
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL).catch((error: unknown) => {
      console.error("Failed to load dev renderer URL", error);
      if (!window.isVisible()) {
        window.show();
      }
    });
  } else {
    void window.loadFile(join(__dirname, "../../dist/renderer/index.html")).catch((error: unknown) => {
      console.error("Failed to load production renderer file", error);
      if (!window.isVisible()) {
        window.show();
      }
    });
  }

  registerIpcHandlers(window);
  return window;
}

app.whenReady().then(() => {
  // Configure autoUpdater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const mainWindow = createMainWindow();

  const emitUpdate = (payload: AppUpdateEvent): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:event", payload);
    }
  };

  autoUpdater.on("checking-for-update", () => {
    emitUpdate({ status: "checking", currentVersion: app.getVersion() });
  });

  autoUpdater.on("update-available", (info) => {
    emitUpdate({
      status: "available",
      currentVersion: app.getVersion(),
      latestVersion: String(info.version ?? ""),
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined
    });
  });

  autoUpdater.on("update-not-available", () => {
    emitUpdate({ status: "not-available", currentVersion: app.getVersion() });
  });

  autoUpdater.on("download-progress", (progress) => {
    emitUpdate({
      status: "downloading",
      currentVersion: app.getVersion(),
      downloadProgress: Math.round(progress.percent)
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    emitUpdate({
      status: "downloaded",
      currentVersion: app.getVersion(),
      latestVersion: String(info.version ?? "")
    });
  });

  autoUpdater.on("error", (error: Error) => {
    // A 404 from the releases feed means no releases have been published yet — treat as up-to-date
    if (error.message.includes("404")) {
      emitUpdate({ status: "not-available", currentVersion: app.getVersion() });
      return;
    }
    emitUpdate({ status: "error", currentVersion: app.getVersion(), error: error.message });
  });

  // IPC handlers that need access to autoUpdater
  ipcMain.handle("app:checkForUpdates", async () => {
    if (!app.isPackaged) {
      // Emit checking, then wait 1 second and emit not-available
      emitUpdate({ status: "checking", currentVersion: app.getVersion() });
      setTimeout(() => {
        emitUpdate({ status: "not-available", currentVersion: app.getVersion() });
      }, 1000);
      return { ok: true };
    }

    try {
      // Fire-and-forget to prevent any promise hanging, relying on updater events
      autoUpdater.checkForUpdates().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("404")) {
          emitUpdate({ status: "not-available", currentVersion: app.getVersion() });
        } else {
          emitUpdate({ status: "error", currentVersion: app.getVersion(), error: message });
        }
      });
      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("404")) {
        emitUpdate({ status: "not-available", currentVersion: app.getVersion() });
        return { ok: true };
      }
      emitUpdate({ status: "error", currentVersion: app.getVersion(), error: message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("app:downloadUpdate", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });

  ipcMain.on("app:installUpdate", () => {
    autoUpdater.quitAndInstall();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
