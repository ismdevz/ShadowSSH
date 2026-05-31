import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { Client } from "ssh2";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { existsSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { SSHSession } from "../ssh/ssh-session.js";
import { deleteHost, findHost, getHosts, saveHost } from "../store/host-store.js";
import { getAppSettings, setAppSettings } from "../store/settings-store.js";
import type {
  AppSettings,
  ConnectSSHInput,
  HostLatencyResult,
  HostRecord,
  SaveHostResult,
  SFTPListResult,
  SFTPSyncEvent,
  SSHDataEvent,
  SSHStateEvent
} from "../types/shared.js";

const SHADOW_SERVICE = "ShadowSSH";

interface KeytarClient {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
}

interface SecretStoreSchema {
  secrets: Record<string, string>;
}

type SecretStoreAccess = {
  get: (key: "secrets", defaultValue: Record<string, string>) => Record<string, string>;
  set: (key: "secrets", value: Record<string, string>) => void;
};

let keytarPromise: Promise<KeytarClient | null> | null = null;
let keytarLoadWarningShown = false;
let fallbackSecretStorePromise: Promise<SecretStoreAccess> | null = null;

async function getKeytarClient(): Promise<KeytarClient | null> {
  if (!keytarPromise) {
    keytarPromise = (async () => {
      try {
        const keytarModuleName = "keytar";
        const imported = await import(keytarModuleName);
        return imported.default as unknown as KeytarClient;
      } catch (error) {
        if (!keytarLoadWarningShown) {
          keytarLoadWarningShown = true;
          console.warn("keytar unavailable; using encrypted local credential fallback", error);
        }
        return null;
      }
    })();
  }

  return keytarPromise;
}

async function getFallbackSecretStore(): Promise<SecretStoreAccess> {
  if (!fallbackSecretStorePromise) {
    fallbackSecretStorePromise = (async () => {
      const { default: Store } = await import("electron-store");
      const store = new Store<SecretStoreSchema>({
        name: "shadowssh-secrets",
        defaults: {
          secrets: {}
        }
      });
      return store as unknown as SecretStoreAccess;
    })();
  }

  return fallbackSecretStorePromise;
}

function encodeSecret(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString("base64")}`;
  }

  return `plain:${value}`;
}

function decodeSecret(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  if (raw.startsWith("enc:")) {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return undefined;
      }

      return safeStorage.decryptString(Buffer.from(raw.slice(4), "base64"));
    } catch {
      return undefined;
    }
  }

  if (raw.startsWith("plain:")) {
    return raw.slice(6);
  }

  return raw;
}

async function setFallbackSecret(account: string, value: string): Promise<void> {
  const store = await getFallbackSecretStore();
  const secrets = store.get("secrets", {});
  store.set("secrets", {
    ...secrets,
    [account]: encodeSecret(value)
  });
}

async function getFallbackSecret(account: string): Promise<string | null> {
  const store = await getFallbackSecretStore();
  const secrets = store.get("secrets", {});
  return decodeSecret(secrets[account]) ?? null;
}

async function deleteFallbackSecret(account: string): Promise<void> {
  const store = await getFallbackSecretStore();
  const secrets = store.get("secrets", {});
  if (!(account in secrets)) {
    return;
  }

  const { [account]: _removed, ...rest } = secrets;
  store.set("secrets", rest);
}

async function getCredential(account: string): Promise<string | null> {
  const keytarClient = await getKeytarClient();
  if (keytarClient) {
    try {
      return await keytarClient.getPassword(SHADOW_SERVICE, account);
    } catch {
      // fall back to local encrypted store
    }
  }

  return getFallbackSecret(account);
}

async function setCredential(account: string, value: string): Promise<void> {
  const keytarClient = await getKeytarClient();
  if (keytarClient) {
    try {
      await keytarClient.setPassword(SHADOW_SERVICE, account, value);
      return;
    } catch {
      // fall back to local encrypted store
    }
  }

  await setFallbackSecret(account, value);
}

async function deleteCredential(account: string): Promise<void> {
  const keytarClient = await getKeytarClient();
  if (keytarClient) {
    try {
      await keytarClient.deletePassword(SHADOW_SERVICE, account);
    } catch {
      // continue cleanup in fallback store
    }
  }

  await deleteFallbackSecret(account);
}

const authMethodSchema = z.enum(["password", "privateKey"]);

const connectSchema = z.object({
  hostId: z.string().optional(),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(128),
  authMethod: authMethodSchema,
  password: z.string().max(4096).optional(),
  privateKeyPath: z.string().max(4096).optional(),
  passphrase: z.string().max(4096).optional(),
  proxyHost: z.string().max(255).optional(),
  proxyPort: z.number().int().min(1).max(65535).optional(),
  proxyUsername: z.string().max(128).optional(),
  proxyAuthMethod: authMethodSchema.optional(),
  proxyPassword: z.string().max(4096).optional(),
  proxyPrivateKeyPath: z.string().max(4096).optional(),
  guiEnabled: z.boolean().optional(),
  guiType: z.enum(["vnc", "nomachine"]).optional(),
  guiPort: z.number().int().min(1).max(65535).optional()
});

const saveHostSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(128),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(128),
  authMethod: authMethodSchema,
  privateKeyPath: z.string().max(4096).optional(),
  sftpStartPath: z.string().max(4096).optional(),
  password: z.string().max(4096).optional(),
  proxyHost: z.string().max(255).optional(),
  proxyPort: z.number().int().min(1).max(65535).optional(),
  proxyUsername: z.string().max(128).optional(),
  proxyAuthMethod: authMethodSchema.optional(),
  proxyPassword: z.string().max(4096).optional(),
  proxyPrivateKeyPath: z.string().max(4096).optional(),
  guiEnabled: z.boolean().optional(),
  guiType: z.enum(["vnc", "nomachine"]).optional(),
  guiPort: z.number().int().min(1).max(65535).optional()
});

const settingsSchema = z.object({
  appTheme: z.enum(["dark", "light", "onyx"]),
  terminalTheme: z.enum(["oceanic", "matrix", "amber", "nord", "dracula", "solarized", "green", "white"]),
  terminalFontSize: z.number().int().min(10).max(28),
  terminalFontFamily: z.string().min(1).max(128),
  editorCommand: z.string().min(1).max(256).default("code"),
  workspaceEditorCommand: z.string().min(1).max(256).default("code"),
  connectionTimeout: z.number().int().min(0).max(300).default(30),
  keepAliveInterval: z.number().int().min(0).max(300).default(10),
  autoReconnect: z.boolean().default(false),
  autoReconnectDelay: z.number().int().min(5).max(300).default(15),
  cursorBlink: z.boolean().default(true),
  scrollbackLines: z.number().int().min(100).max(50000).default(1000)
});

const sessionWriteSchema = z.object({
  sessionId: z.string().uuid(),
  data: z.string().max(100000)
});

const sessionResizeSchema = z.object({
  sessionId: z.string().uuid(),
  cols: z.number().int().min(10).max(500),
  rows: z.number().int().min(5).max(500)
});

const sessionControlSchema = z.object({
  sessionId: z.string().uuid()
});

const hostIdSchema = z.object({
  hostId: z.string().min(1).max(256)
});

const sftpListSchema = z.object({
  sessionId: z.string().uuid(),
  path: z.string().min(1).max(4096)
});

const sftpDownloadSchema = z.object({
  sessionId: z.string().uuid(),
  remotePath: z.string().min(1).max(4096)
});

const sftpUploadSchema = z.object({
  sessionId: z.string().uuid(),
  remoteDir: z.string().min(1).max(4096)
});

const sftpEditSchema = z.object({
  sessionId: z.string().uuid(),
  remotePath: z.string().min(1).max(4096)
});
const sftpExtractZipSchema = z.object({
  sessionId: z.string().uuid(),
  remotePath: z.string().min(1).max(4096)
});

const sftpDeleteSchema = z.object({
  sessionId: z.string().uuid(),
  remotePath: z.string().min(1).max(4096)
});

const sftpMkdirSchema = z.object({
  sessionId: z.string().uuid(),
  remotePath: z.string().min(1).max(4096)
});

const sftpRenameSchema = z.object({
  sessionId: z.string().uuid(),
  oldPath: z.string().min(1).max(4096),
  newPath: z.string().min(1).max(4096)
});

const sftpCreateFileSchema = z.object({
  sessionId: z.string().uuid(),
  remotePath: z.string().min(1).max(4096)
});

const sftpCopySchema = z.object({
  sessionId: z.string().uuid(),
  sourcePath: z.string().min(1).max(4096),
  destPath: z.string().min(1).max(4096)
});

const hostLatencySchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  timeoutMs: z.number().int().min(500).max(20000).default(5000)
});

const generateKeySchema = z.object({
  name: z.string().max(128).optional(),
  replaceExistingPath: z.string().max(4096).optional()
});

const installKeySchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(128),
  password: z.string().optional(),
  publicKeyPath: z.string().min(1).max(4096)
});

// Additional schemas can be added here
// Ensure to validate the schemas before use

const smdCheckStatusSchema = z.object({
  sessionId: z.string().min(1)
});

const smdInstallSchema = z.object({
  sessionId: z.string().min(1),
  target: z.string().min(1)
});

const smdUninstallSchema = z.object({
  sessionId: z.string().min(1),
  target: z.string().min(1)
});

const sftpOpenGuiSchema = z.object({
  sessionId: z.string().min(1),
  guiType: z.enum(["vnc", "nomachine"]),
  guiPort: z.number().int().min(1).max(65535),
  vncViewer: z.enum(["auto", "remmina", "tigervnc"]).optional(),
  vncQuality: z.object({
    qualityLevel: z.number().int().min(0).max(9).optional(),
    compressLevel: z.number().int().min(0).max(9).optional(),
    encoding: z.enum(["Tight", "ZRLE", "Hextile", "Raw"]).optional(),
  }).optional(),
});

const sftpCloseGuiSchema = z.object({
  sessionId: z.string().min(1),
  guiType: z.enum(["vnc", "nomachine"])
});

function sanitizeHostForStore(payload: z.infer<typeof saveHostSchema>): HostRecord {
  return {
    id: payload.id ?? randomUUID(),
    name: payload.name.trim(),
    host: payload.host.trim(),
    port: payload.port,
    username: payload.username.trim(),
    authMethod: payload.authMethod,
    privateKeyPath: payload.privateKeyPath?.trim() || undefined,
    sftpStartPath: payload.sftpStartPath?.trim() || undefined,
    proxyHost: payload.proxyHost?.trim() || undefined,
    proxyPort: payload.proxyPort,
    proxyUsername: payload.proxyUsername?.trim() || undefined,
    proxyAuthMethod: payload.proxyAuthMethod,
    proxyPrivateKeyPath: payload.proxyPrivateKeyPath?.trim() || undefined,
    proxyPassword: undefined,
    guiEnabled: payload.guiEnabled,
    guiType: payload.guiType,
    guiPort: payload.guiPort
  };
}

async function resolveConnectInput(input: z.infer<typeof connectSchema>): Promise<ConnectSSHInput> {
  const clean: ConnectSSHInput = {
    hostId: input.hostId,
    host: input.host.trim(),
    port: input.port,
    username: input.username.trim(),
    authMethod: input.authMethod,
    privateKeyPath: input.privateKeyPath?.trim(),
    passphrase: input.passphrase,
    proxyHost: input.proxyHost?.trim(),
    proxyPort: input.proxyPort,
    proxyUsername: input.proxyUsername?.trim(),
    proxyAuthMethod: input.proxyAuthMethod,
    proxyPassword: input.proxyPassword,
    proxyPrivateKeyPath: input.proxyPrivateKeyPath?.trim()
  };

  if (clean.authMethod === "password") {
    let password = input.password;

    if (!password && clean.hostId) {
      const storedPassword = await getCredential(clean.hostId);
      password = storedPassword ?? undefined;
    }

    if (!password && clean.hostId) {
      const legacyHost = await findHost(clean.hostId);
      const legacyPassword = (legacyHost as unknown as { password?: string } | undefined)?.password;
      if (legacyPassword) {
        password = legacyPassword;
        await setCredential(clean.hostId, legacyPassword);
      }
    }

    if (!password) {
      throw new Error("Password authentication requires a password. Edit host and save password again.");
    }

    clean.password = password;
  }

  if (clean.proxyHost && clean.proxyAuthMethod === "password") {
    let proxyPassword = input.proxyPassword;

    if (!proxyPassword && clean.hostId) {
      const storedProxyPassword = await getCredential(`${clean.hostId}-proxy`);
      proxyPassword = storedProxyPassword ?? undefined;
    }

    if (!proxyPassword) {
      throw new Error("Proxy password authentication requires a proxy password.");
    }

    clean.proxyPassword = proxyPassword;
  }

  return clean;
}

async function cleanStaleSshConfigs(hosts: HostRecord[]): Promise<void> {
  try {
    const { readFile, writeFile, readdir, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");

    const homeDir = app.getPath("home");
    const sshConfigPath = join(homeDir, ".ssh", "config");
    let configContent = "";
    try {
      configContent = await readFile(sshConfigPath, "utf-8");
    } catch {
      return; // No config file exists
    }

    // Generate valid hashes from existing hosts
    const activeHashes = new Set<string>();
    for (const host of hosts) {
      const port = host.port ?? 22;
      const hostKey = `${host.username}@${host.host}:${port}`;
      const hostHash = createHash("sha256").update(hostKey).digest("hex").slice(0, 8);
      activeHashes.add(hostHash);
    }

    // Find all blocks of the form:
    // # shadowssh-begin-shadowssh-ws-<hash>
    // ...
    // # shadowssh-end-shadowssh-ws-<hash>
    const regex = /# shadowssh-begin-shadowssh-ws-([a-f0-9]{8})[\s\S]*?# shadowssh-end-shadowssh-ws-\1\n?/g;

    let modified = false;
    const newContent = configContent.replace(regex, (block: string, hash: string) => {
      if (!hash || !activeHashes.has(hash)) {
        modified = true;
        return ""; // Remove stale block
      }
      return block; // Keep active block
    });

    if (modified) {
      await writeFile(sshConfigPath, newContent.trimEnd() + "\n", { mode: 0o600 });
    }

    // Also clean up associated stale socket files under ~/.shadowssh/sockets/
    const socketDir = join(homeDir, ".shadowssh", "sockets");
    try {
      const files = await readdir(socketDir);
      for (const file of files) {
        const matchHash = file.match(/^([a-f0-9]{8})\.sock$/);
        if (matchHash) {
          const hash = matchHash[1];
          if (hash && !activeHashes.has(hash)) {
            await unlink(join(socketDir, file)).catch(() => { });
          }
        }
      }
    } catch { }
  } catch (e) {
    console.error("Failed to clean stale SSH configurations:", e);
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessions = new Map<string, SSHSession>();
  const syncWatchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>();
  const workspaceConfigCleanups = new Map<string, () => Promise<void>>();

  const emitSftpSync = (payload: SFTPSyncEvent): void => {
    mainWindow.webContents.send("sftp:sync", payload);
  };

  const watcherKey = (sessionId: string, remotePath: string): string => `${sessionId}:${remotePath}`;

  const clearSyncWatcher = (key: string): void => {
    const entry = syncWatchers.get(key);
    if (!entry) {
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    entry.watcher.close();
    syncWatchers.delete(key);
  };

  const clearSyncWatchersForSession = (sessionId: string): void => {
    for (const key of syncWatchers.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        clearSyncWatcher(key);
      }
    }
    // Clean up any SSH config entries written for workspace editor access
    const wsCleanup = workspaceConfigCleanups.get(sessionId);
    if (wsCleanup) {
      workspaceConfigCleanups.delete(sessionId);
      void wsCleanup();
    }
  };

  ipcMain.handle("connectSSH", async (_event, rawInput: unknown) => {
    const parsed = connectSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid connect input: ${parsed.error.message}`);
    }

    const connectInput = await resolveConnectInput(parsed.data);
    const sessionId = randomUUID();

    const session = new SSHSession(sessionId, connectInput, {
      onData: (data) => {
        const payload: SSHDataEvent = { sessionId, data };
        mainWindow.webContents.send("ssh:data", payload);
      },
      onState: (status, message) => {
        const payload: SSHStateEvent = { sessionId, status, message };
        mainWindow.webContents.send("ssh:state", payload);

        if (status === "disconnected" || status === "error") {
          clearSyncWatchersForSession(sessionId);
        }
      }
    });

    sessions.set(sessionId, session);

    try {
      await session.connect();

      if (connectInput.hostId) {
        const existingHost = await findHost(connectInput.hostId);
        if (existingHost && (!existingHost.osType || existingHost.osType === "unknown")) {
          try {
            const osType = await session.detectRemoteOS();
            await saveHost({
              ...existingHost,
              osType
            });
          } catch {
            // Keep session connected even if metadata detection fails.
          }
        }
      }

      return { sessionId };
    } catch (error) {
      sessions.delete(sessionId);
      throw error;
    }
  });

  ipcMain.handle("saveHost", async (_event, rawInput: unknown): Promise<SaveHostResult> => {
    const parsed = saveHostSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid host payload: ${parsed.error.message}`);
    }

    const host = sanitizeHostForStore(parsed.data);
    if (host.id) {
      const existing = await findHost(host.id);
      if (existing?.osType) {
        host.osType = existing.osType;
      }
    }
    const saved = await saveHost(host);

    let savedCredential = false;

    if (host.authMethod === "password" && parsed.data.password) {
      await setCredential(host.id, parsed.data.password);
      savedCredential = true;
    }

    if (host.authMethod !== "password") {
      await deleteCredential(host.id);
    }

    if (host.proxyHost && host.proxyAuthMethod === "password" && parsed.data.proxyPassword) {
      await setCredential(`${host.id}-proxy`, parsed.data.proxyPassword);
    }

    if (!host.proxyHost || host.proxyAuthMethod !== "password") {
      await deleteCredential(`${host.id}-proxy`);
    }

    return { host: saved, savedCredential };
  });

  ipcMain.handle("getHosts", async () => {
    const hosts = await getHosts();
    void cleanStaleSshConfigs(hosts);
    return hosts;
  });

  ipcMain.handle("getPassword", async (_event, rawInput: unknown) => {
    const parsed = hostIdSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid host id payload: ${parsed.error.message}`);
    }

    return getCredential(parsed.data.hostId);
  });

  ipcMain.handle("deleteHost", async (_event, rawInput: unknown) => {
    const parsed = hostIdSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid host id payload: ${parsed.error.message}`);
    }

    // Delete associated private key files if the host has one
    const hostRecord = await findHost(parsed.data.hostId);
    if (hostRecord?.privateKeyPath) {
      const { unlink } = await import("node:fs/promises");
      const privateKeyPath = hostRecord.privateKeyPath;
      const publicKeyPath = `${privateKeyPath}.pub`;
      try { await unlink(privateKeyPath); } catch { /* ignore if already gone */ }
      try { await unlink(publicKeyPath); } catch { /* ignore if already gone */ }
    }

    await deleteHost(parsed.data.hostId);
    await deleteCredential(parsed.data.hostId);
    await deleteCredential(`${parsed.data.hostId}-proxy`);

    const hosts = await getHosts();
    void cleanStaleSshConfigs(hosts);

    return { ok: true };
  });

  ipcMain.handle("host:latency", async (_event, rawInput: unknown): Promise<HostLatencyResult> => {
    const parsed = hostLatencySchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid host latency payload: ${parsed.error.message}`);
    }

    const { host, port, timeoutMs } = parsed.data;

    return new Promise<HostLatencyResult>((resolve) => {
      const startedAt = process.hrtime.bigint();
      const socket = net.createConnection({ host, port });
      let finished = false;

      const finish = (result: HostLatencyResult): void => {
        if (finished) {
          return;
        }

        finished = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);

      socket.once("connect", () => {
        const endedAt = process.hrtime.bigint();
        const latencyMs = Number(endedAt - startedAt) / 1_000_000;
        finish({ ok: true, latencyMs: Math.max(1, Math.round(latencyMs)) });
      });

      socket.once("timeout", () => {
        finish({ ok: false, error: "timeout" });
      });

      socket.once("error", (error: Error) => {
        finish({ ok: false, error: error.message || "connection failed" });
      });
    });
  });

  ipcMain.handle("ssh:write", (_event, rawInput: unknown) => {
    const parsed = sessionWriteSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SSH write payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    session.write(parsed.data.data);
    return { ok: true };
  });

  ipcMain.handle("ssh:resize", (_event, rawInput: unknown) => {
    const parsed = sessionResizeSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SSH resize payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    session.resize(parsed.data.cols, parsed.data.rows);
    return { ok: true };
  });

  ipcMain.handle("ssh:disconnect", (_event, rawInput: unknown) => {
    const parsed = sessionControlSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SSH control payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      return { ok: true };
    }

    session.disconnect();
    clearSyncWatchersForSession(parsed.data.sessionId);
    sessions.delete(parsed.data.sessionId);
    return { ok: true };
  });

  ipcMain.handle("ssh:reconnect", async (_event, rawInput: unknown) => {
    const parsed = sessionControlSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SSH control payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.reconnect();
    return { ok: true };
  });

  const sshExecSchema = z.object({
    sessionId: z.string().uuid(),
    command: z.string().min(1).max(50000)
  });

  ipcMain.handle("ssh:exec", async (_event, rawInput: unknown) => {
    const parsed = sshExecSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid exec payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const output = await session.exec(parsed.data.command);
    return { output };
  });

  const sshWriteFileSchema = z.object({
    sessionId: z.string().uuid(),
    remotePath: z.string().min(1),
    content: z.string()
  });

  ipcMain.handle("ssh:writeFile", async (_event, rawInput: unknown) => {
    const parsed = sshWriteFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid ssh:writeFile payload: ${parsed.error.message}`);
    }
    const session = sessions.get(parsed.data.sessionId);
    if (!session) throw new Error("Session not found");
    await session.writeFileContent(parsed.data.remotePath, parsed.data.content);
    return { ok: true };
  });

  ipcMain.handle("pickPrivateKey", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Private Key",
      properties: ["openFile"],
      filters: [
        { name: "PEM / OpenSSH Keys", extensions: ["pem", "key", "pub", ""] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("generatePrivateKey", async (_event, rawInput: unknown) => {
    const parsed = generateKeySchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid key generation payload: ${parsed.error.message}`);
    }

    const homeDir = app.getPath("home");
    const sshDir = join(homeDir, ".ssh");
    await mkdir(sshDir, { recursive: true });

    const normalizedName = parsed.data.name?.trim().replace(/\.pub$/i, "");
    const baseName = normalizedName?.replace(/[^a-zA-Z0-9._-]/g, "-") || `shadowssh-${Date.now()}`;
    const privateKeyPath = join(sshDir, baseName);
    const replaceExistingPath = parsed.data.replaceExistingPath?.trim();
    const canReplaceTarget = replaceExistingPath === privateKeyPath;

    if (existsSync(privateKeyPath) && !canReplaceTarget) {
      throw new Error(`A key named "${baseName}" already exists. Please choose a different name.`);
    }

    if (replaceExistingPath) {
      try {
        await unlink(replaceExistingPath);
      } catch {
        // Ignore missing files when replacing an existing key pair.
      }

      try {
        await unlink(`${replaceExistingPath}.pub`);
      } catch {
        // Ignore missing files when replacing an existing key pair.
      }
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn("ssh-keygen", ["-t", "ed25519", "-f", privateKeyPath, "-N", "", "-C", "shadowssh-generated"], {
        stdio: "ignore"
      });

      child.once("error", () => {
        reject(new Error("Failed to run ssh-keygen. Install openssh-client and try again."));
      });

      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ssh-keygen failed with code ${code ?? -1}`));
        }
      });
    });

    return {
      privateKeyPath,
      publicKeyPath: `${privateKeyPath}.pub`
    };
  });

  ipcMain.handle("installPublicKey", async (_event, rawInput: unknown) => {
    const parsed = installKeySchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid install public key payload: ${parsed.error.message}`);
    }

    const { host, port, username, password, publicKeyPath } = parsed.data;

    if (!password) {
      throw new Error("Password is required to install the public key.");
    }

    const pubKeyBuffer = await readFile(publicKeyPath);
    const pubKey = pubKeyBuffer.toString("utf-8").trim();

    return new Promise<{ ok: boolean }>((resolve, reject) => {
      const client = new Client();
      client
        .on("ready", () => {
          const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${pubKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
          client.exec(cmd, (err, stream) => {
            if (err) {
              client.end();
              return reject(new Error(`Failed to execute copy ID command: ${err.message}`));
            }
            stream.on("close", (code: number) => {
              client.end();
              if (code !== 0) {
                return reject(new Error(`Server returned code ${code} when installing key.`));
              }
              resolve({ ok: true });
            });
            stream.on("data", () => { });
            stream.stderr.on("data", () => { });
          });
        })
        .on("error", (err) => {
          reject(new Error(`SSH connection failed: ${err.message}`));
        })
        .connect({ host, port, username, password });
    });
  });

  ipcMain.handle("readFileAsBase64", async (_event, rawInput: unknown) => {
    const parsed = z.object({ path: z.string().min(1).max(4096) }).safeParse(rawInput);
    if (!parsed.success) throw new Error("Invalid path");
    const buf = await readFile(parsed.data.path);
    return buf.toString("base64");
  });

  ipcMain.handle("writeFileFromBase64", async (_event, rawInput: unknown) => {
    const parsed = z.object({ path: z.string().min(1).max(4096), data: z.string() }).safeParse(rawInput);
    if (!parsed.success) throw new Error("Invalid payload");
    const { writeFile: fsWriteFile, chmod } = await import("node:fs/promises");
    const buf = Buffer.from(parsed.data.data, "base64");
    await fsWriteFile(parsed.data.path, buf, { mode: 0o600 });
    await chmod(parsed.data.path, 0o600);
    return { ok: true };
  });

  ipcMain.handle("deleteFile", async (_event, rawInput: unknown) => {
    const parsed = z.object({ path: z.string().min(1).max(4096) }).safeParse(rawInput);
    if (!parsed.success) throw new Error("Invalid path");
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(parsed.data.path);
      // also remove .pub if it exists
      try { await unlink(`${parsed.data.path}.pub`); } catch { }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err; // ignore "file not found"
    }
    return { ok: true };
  });

  ipcMain.handle("getHostById", async (_event, rawInput: unknown) => {
    const parsed = hostIdSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid host id payload: ${parsed.error.message}`);
    }

    return (await findHost(parsed.data.hostId)) ?? null;
  });

  ipcMain.handle("settings:get", async () => {
    return getAppSettings();
  });

  ipcMain.handle("settings:update", async (_event, rawInput: unknown): Promise<AppSettings> => {
    const parsed = settingsSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid settings payload: ${parsed.error.message}`);
    }

    return setAppSettings(parsed.data);
  });

  ipcMain.handle("sftp:list", async (_event, rawInput: unknown): Promise<SFTPListResult> => {
    const parsed = sftpListSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP list payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const requestedPath = parsed.data.path.trim() || ".";

    try {
      const entries = await session.listDirectory(requestedPath);
      return {
        path: requestedPath,
        entries
      };
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== 2) {
        throw error;
      }

      try {
        const entries = await session.listDirectory(".");
        return {
          path: ".",
          entries
        };
      } catch {
        const entries = await session.listDirectory("/");
        return {
          path: "/",
          entries
        };
      }
    }
  });

  ipcMain.handle("sftp:download", async (_event, rawInput: unknown) => {
    const parsed = sftpDownloadSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP download payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const remotePath = parsed.data.remotePath.trim();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Download Remote File",
      defaultPath: basename(remotePath)
    });

    if (result.canceled || !result.filePath) {
      return { saved: false };
    }

    await session.downloadFile(remotePath, result.filePath);
    return {
      saved: true,
      localPath: result.filePath
    };
  });

  ipcMain.handle("sftp:upload", async (_event, rawInput: unknown) => {
    const parsed = sftpUploadSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP upload payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "Select File to Upload",
      properties: ["openFile"]
    });

    if (selected.canceled || selected.filePaths.length === 0) {
      return { uploaded: false };
    }

    const localPath = selected.filePaths[0];
    if (!localPath) {
      return { uploaded: false };
    }

    const remotePath = await session.uploadFile(localPath, parsed.data.remoteDir.trim());

    return {
      uploaded: true,
      remotePath
    };
  });

  ipcMain.handle("sftp:editInVSCode", async (_event, rawInput: unknown) => {
    const parsed = sftpEditSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP edit payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const remotePath = parsed.data.remotePath.trim();
    const filename = basename(remotePath) || `remote-${Date.now()}`;
    const tempDir = join(app.getPath("temp"), "shadowssh-vscode", parsed.data.sessionId);

    await mkdir(tempDir, { recursive: true });

    const localPath = join(tempDir, `${Date.now()}-${filename}`);
    await session.downloadFile(remotePath, localPath);

    const key = watcherKey(parsed.data.sessionId, remotePath);
    clearSyncWatcher(key);

    const watcher: FSWatcher = watch(localPath, { persistent: false }, () => {
      const current = syncWatchers.get(key);
      if (!current) {
        return;
      }

      if (current.timer) {
        clearTimeout(current.timer);
      }

      current.timer = setTimeout(() => {
        const activeSession = sessions.get(parsed.data.sessionId);
        if (!activeSession) {
          emitSftpSync({
            sessionId: parsed.data.sessionId,
            remotePath,
            localPath,
            status: "error",
            message: "Session closed before sync"
          });
          return;
        }

        emitSftpSync({
          sessionId: parsed.data.sessionId,
          remotePath,
          localPath,
          status: "syncing",
          message: "Syncing changes to VPS..."
        });

        void activeSession
          .uploadFileToPath(localPath, remotePath)
          .then(() => {
            emitSftpSync({
              sessionId: parsed.data.sessionId,
              remotePath,
              localPath,
              status: "synced",
              message: "Saved to VPS"
            });
          })
          .catch((error: unknown) => {
            emitSftpSync({
              sessionId: parsed.data.sessionId,
              remotePath,
              localPath,
              status: "error",
              message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`
            });
          });
      }, 250);
    });

    syncWatchers.set(key, { watcher, timer: null });

    emitSftpSync({
      sessionId: parsed.data.sessionId,
      remotePath,
      localPath,
      status: "watching",
      message: "Watching file for save-to-VPS sync"
    });

    await new Promise<void>((resolve, reject) => {
      const appSettings = getAppSettings();
      void appSettings.then(async (cfg) => {
        const configuredEditor = cfg.editorCommand?.trim() || "code";
        const fallbackEditors = [
          configuredEditor,
          "codium",
          "xdg-open",
          "gedit",
          "kate",
          "nano",
          "vi"
        ];

        // Deduplicate while preserving order
        const seen = new Set<string>();
        const uniqueEditors: string[] = [];
        for (const cmd of fallbackEditors) {
          if (!seen.has(cmd)) {
            seen.add(cmd);
            uniqueEditors.push(cmd);
          }
        }

        let lastError: Error | null = null;
        for (const editorCmd of uniqueEditors) {
          try {
            await new Promise<void>((res, rej) => {
              const editor = spawn(editorCmd, [localPath], {
                stdio: "ignore",
                detached: true
              });

              editor.once("error", (error) => {
                rej(error);
              });

              editor.once("spawn", () => {
                editor.unref();
                res();
              });
            });
            // Successfully launched an editor
            lastError = null;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            // Try next fallback
          }
        }

        if (lastError) {
          reject(new Error(
            `Failed to launch editor. Tried: ${uniqueEditors.join(", ")}. ` +
            `Configure a different editor in Settings > Editor, or ensure one of the tried editors is installed. ` +
            `(${lastError.message})`
          ));
          return;
        }

        resolve();
      });
    });

    return {
      opened: true,
      localPath
    };
  });

  const sftpOpenWorkspaceSchema = z.object({
    sessionId: z.string().uuid(),
    remotePath: z.string().min(1).max(4096)
  });

  ipcMain.handle("sftp:openWorkspace", async (_event, rawInput: unknown) => {
    const parsed = sftpOpenWorkspaceSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP open workspace payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const appSettings = await getAppSettings();
    const configuredWorkspaceEditor = appSettings.workspaceEditorCommand?.trim() || "code";

    const config = session.getConfig();

    // Resolve absolute remote path
    let targetPath = parsed.data.remotePath;
    if (!targetPath.startsWith("/")) {
      try {
        const escaped = targetPath.replace(/'/g, "'\\''");
        const absPath = await session.exec(`realpath '${escaped}' 2>/dev/null || readlink -f '${escaped}'`);
        if (absPath && absPath.trim() && absPath.trim().startsWith("/")) {
          targetPath = absPath.trim();
        } else {
          const pwd = await session.exec("pwd");
          const cleanPwd = pwd.trim();
          targetPath = cleanPwd && cleanPwd.startsWith("/") ? `${cleanPwd}/${targetPath}` : `/${targetPath}`;
        }
      } catch {
        targetPath = `/${targetPath}`;
      }
    }
    if (!targetPath.startsWith("/")) {
      targetPath = `/${targetPath}`;
    }

    // Set up SSH ControlMaster so the workspace editor can connect without re-authenticating
    const homeDir = app.getPath("home");
    const shadowSshDir = join(homeDir, ".shadowssh");
    const controlDir = join(shadowSshDir, "sockets");
    await mkdir(controlDir, { recursive: true });

    const sshPort = config.port ?? 22;

    // Use a STABLE alias derived from host+username+port so it's the same across reconnects
    const { createHash } = await import("node:crypto");
    const hostKey = `${config.username}@${config.host}:${sshPort}`;
    const hostHash = createHash("sha256").update(hostKey).digest("hex").slice(0, 8);
    const hostAlias = `shadowssh-ws-${hostHash}`;
    const controlPath = join(controlDir, `${hostHash}.sock`);

    // Persist workspace metadata to the VPS so reconnects can reopen the same workspace
    // ~/.shadowssh/<hash>.json stores the last opened path for this server
    try {
      const escapedPath = targetPath.replace(/'/g, "'\\''");
      const wsJson = JSON.stringify({ path: targetPath, updatedAt: new Date().toISOString() });
      const escapedJson = wsJson.replace(/'/g, "'\\''");
      await session.exec(
        `mkdir -p ~/.shadowssh/workspaces && echo '${escapedJson}' > ~/.shadowssh/${hostHash}.json`
      );
      const pathHash = createHash("sha256").update(targetPath).digest("hex").slice(0, 12);
      await session.exec(
        `echo '${escapedJson}' > ~/.shadowssh/workspaces/${pathHash}.json`
      );
    } catch { /* non-fatal */ }


    // Build SSH args to set up ControlMaster
    const sshArgs = [
      "-M", "-N", "-f",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", `ControlPath=${controlPath}`,
      "-o", "ControlPersist=1h",
      "-p", String(sshPort),
      `${config.username}@${config.host}`
    ];

    if (config.authMethod === "privateKey" && config.privateKeyPath) {
      sshArgs.unshift("-i", config.privateKeyPath);
    }

    // Retrieve stored password if using password auth
    let storedPassword: string | null = null;
    if (config.authMethod === "password" && config.hostId) {
      storedPassword = await getCredential(config.hostId) ?? config.password ?? null;
    } else if (config.authMethod === "password") {
      storedPassword = config.password ?? null;
    }

    // Build SSH env — use SSH_ASKPASS for cross-platform password feeding (no sshpass needed)
    const sshEnv: NodeJS.ProcessEnv = { ...process.env };
    let askpassPath: string | null = null;

    if (storedPassword) {
      const { writeFile: fsWriteAskpass, chmod: fsChmod } = await import("node:fs/promises");
      const isWindows = process.platform === "win32";

      if (!isWindows) {
        // Unix: create a tiny sh script that echoes the password
        const safePassword = storedPassword.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
        askpassPath = join(controlDir, `askpass-${parsed.data.sessionId.slice(0, 8)}.sh`);
        await fsWriteAskpass(askpassPath, `#!/bin/sh\necho '${safePassword}'\n`, { mode: 0o700 });
        await fsChmod(askpassPath, 0o700);
        sshEnv.SSH_ASKPASS = askpassPath;
        sshEnv.SSH_ASKPASS_REQUIRE = "force";
        // Keep SSH_AUTH_SOCK so agent forwarding works for extensions
      }
    }

    // Spawn ControlMaster SSH process (sshpass-free, cross-platform)
    await new Promise<void>((res) => {
      const masterProcess = spawn("ssh", sshArgs, {
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
        env: sshEnv
      });

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          // Timeout is OK — ControlMaster may be established even without explicit "spawn" event on -f
          settled = true;
          masterProcess.unref();
          res();
        }
      }, 3000);

      masterProcess.once("error", (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          // Don't fail — still attempt to open editor directly
          masterProcess.unref();
          res();
        }
      });

      masterProcess.once("spawn", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          masterProcess.unref();
          res();
        }
      });
    });

    // Inject Host alias into the real ~/.ssh/config so ALL SSH clients can resolve it
    const { readFile: fsReadFile, writeFile: fsWriteFile, mkdir: fsMkdir } = await import("node:fs/promises");
    const sshConfigPath = join(homeDir, ".ssh", "config");
    await fsMkdir(join(homeDir, ".ssh"), { recursive: true });
    const beginMarker = `# shadowssh-begin-${hostAlias}`;
    const endMarker = `# shadowssh-end-${hostAlias}`;
    const sshConfigEntry = [
      beginMarker,
      `Host ${hostAlias}`,
      `  HostName ${config.host}`,
      `  User ${config.username}`,
      `  Port ${sshPort}`,
      `  ControlMaster auto`,
      `  ControlPath ${controlPath}`,
      `  StrictHostKeyChecking no`,
      `  UserKnownHostsFile /dev/null`,
      ...(config.authMethod === "privateKey" && config.privateKeyPath
        ? [`  IdentityFile ${config.privateKeyPath}`]
        : []),
      endMarker,
      ""
    ].join("\n");

    // Write/refresh the alias (always update to get latest ControlPath/IdentityFile etc.)
    let existingConfig = "";
    try { existingConfig = await fsReadFile(sshConfigPath, "utf-8"); } catch { /* new file is fine */ }
    // Remove stale entry first, then re-append fresh
    const cleaned = existingConfig.replace(
      new RegExp(`\\n?${beginMarker}[\\s\\S]*?${endMarker}\\n?`, "g"),
      ""
    );
    await fsWriteFile(sshConfigPath, cleaned.trimEnd() + "\n\n" + sshConfigEntry, { mode: 0o600 });

    const removeHostFromSshConfig = async (): Promise<void> => {
      try {
        const current = await fsReadFile(sshConfigPath, "utf-8");
        const removedConfig = current.replace(
          new RegExp(`\\n?${beginMarker}[\\s\\S]*?${endMarker}\\n?`, "g"),
          ""
        );
        await fsWriteFile(sshConfigPath, removedConfig, { mode: 0o600 });
      } catch { /* ignore */ }
    };

    // Register cleanup — runs only when the ShadowSSH session is explicitly disconnected
    // The alias stays alive for reconnects; no auto-removal timer
    // NOTE: We intentionally do NOT call removeHostFromSshConfig on session disconnect.
    // The stable per-host alias in ~/.ssh/config must persist so the editor can reconnect
    // at any time (e.g. editor reload). It will be refreshed on next "Open Workspace" click.
    // If the user wants a clean state, they can manually remove the shadowssh-begin/end block.

    // VS Code Remote SSH URI using the named alias
    const uri = `vscode-remote://ssh-remote+${hostAlias}${targetPath}`;

    const fallbackEditors = [configuredWorkspaceEditor, "cursor", "codium", "antigravity", "code-insiders"];
    const seen = new Set<string>();
    const uniqueEditors: string[] = [];
    for (const cmd of fallbackEditors) {
      if (!seen.has(cmd)) { seen.add(cmd); uniqueEditors.push(cmd); }
    }

    return new Promise<{ opened: boolean }>((resolve, reject) => {
      let lastError: Error | null = null;

      const cleanup = (): void => {
        // Only clean up temp askpass script; SSH config alias stays alive for reconnects
        if (askpassPath) {
          unlink(askpassPath).catch(() => { /* ignore */ });
          askpassPath = null;
        }
      };

      // VSCodium with jeanp413.open-remote-ssh / jajera.vsx-remote-ssh requires
      // --enable-proposed-api to access Remote SSH APIs
      const VSCODIUM_BINARIES = new Set(["codium", "vscodium", "VSCodium"]);

      const buildEditorArgs = (cmd: string): string[] => {
        if (VSCODIUM_BINARIES.has(cmd)) {
          return [
            "--disable-extension", "ms-vscode-remote.remote-ssh",
            "--enable-proposed-api", "jeanp413.open-remote-ssh",
            "--enable-proposed-api", "jajera.vsx-remote-ssh",
            "--folder-uri", uri
          ];
        }
        return ["--folder-uri", uri];
      };

      const tryNextEditor = (index: number) => {
        if (index >= uniqueEditors.length) {
          cleanup();
          reject(new Error(
            `Failed to launch workspace editor. Tried: ${uniqueEditors.join(", ")}. ` +
            `(${lastError?.message || "Unknown error"})`
          ));
          return;
        }

        const editorCmd = uniqueEditors[index];
        if (!editorCmd) { tryNextEditor(index + 1); return; }

        const isWindows = process.platform === "win32";
        const editor = spawn(editorCmd, buildEditorArgs(editorCmd), {
          stdio: "ignore",
          detached: true,
          shell: isWindows
        });

        editor.once("error", (err) => {
          lastError = err;
          tryNextEditor(index + 1);
        });

        editor.once("spawn", () => {
          editor.unref();
          cleanup();
          resolve({ opened: true });
        });
      };

      tryNextEditor(0);
    });
  });

  async function getFreePort(): Promise<number> {
    const { createServer: netCreateServer } = await import("node:net");
    return new Promise((resolve, reject) => {
      const srv = netCreateServer();
      srv.listen(0, "127.0.0.1", () => {
        const address = srv.address();
        const port = typeof address === "string" ? 0 : address?.port ?? 0;
        srv.close(() => {
          resolve(port);
        });
      });
      srv.on("error", reject);
    });
  }

  ipcMain.handle("sftp:openGuiConnection", async (_event, rawInput: unknown) => {
    const parsed = sftpOpenGuiSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP open GUI payload: ${parsed.error.message}`);
    }

    const { sessionId, guiType, guiPort, vncViewer, vncQuality } = parsed.data;
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    let localPort = guiPort;
    try {
      const { createServer: netCreateServer } = await import("node:net");
      await new Promise<void>((resolve, reject) => {
        const srv = netCreateServer();
        srv.once("error", reject);
        srv.listen(guiPort, "127.0.0.1", () => {
          srv.close(() => resolve());
        });
      });
    } catch {
      localPort = await getFreePort();
    }

    // localPort = local port for SSH tunnel; always forward TO guiPort on the remote
    const remotePort = guiPort;
    const localForwardServer = await session.createLocalForward(localPort, "localhost", remotePort);
    session.registerForwardServer(guiType, localForwardServer);

    // Write local passwd file for VNC to automate authentication
    let localPasswdPath = "";
    if (guiType === "vnc") {
      try {
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const { writeFileSync } = await import("node:fs");
        localPasswdPath = join(tmpdir(), `vnc_passwd_${sessionId}`);

        // The VNC password is force-set to 'shadow' on the VPS during startup.
        // We write the pre-encrypted 8-byte DES value directly to avoid unreliable remote extraction.
        const buffer = Buffer.from("Bex4lXJvDCY=", "base64");
        writeFileSync(localPasswdPath, buffer);
        console.log(`[VNC-DEBUG] Successfully wrote local 8-byte VNC passwd file (shadow) to: ${localPasswdPath}`);

      } catch (err: any) {
        console.warn("[VNC-DEBUG] VNC local auth prep failed:", err.message);
        localPasswdPath = "";
      }
    }

    // Give the tunnel a moment to fully initialize
    await new Promise(r => setTimeout(r, 1200));

    return new Promise((resolve, reject) => {
      let childProcess: any = null;
      let tempNxsPath = "";

      const cleanup = async () => {
        if (tempNxsPath) {
          const { unlink } = await import("node:fs/promises");
          try {
            await unlink(tempNxsPath);
          } catch { }
        }
        if (localPasswdPath) {
          const { unlink } = await import("node:fs/promises");
          try {
            await unlink(localPasswdPath);
          } catch { }
        }
      };

      if (guiType === "nomachine") {
        console.log(`[NOMACHINE-DEBUG] Starting NoMachine launch. localPort=${localPort}, remotePort=${remotePort}`);

        const trySpawnNomachine = async () => {
          const { readFileSync, mkdirSync } = await import("node:fs");

          // Scramble password using NoMachine algorithm
          const scrambleNoMachinePassword = (pass: string): string => {
            if (!pass) return "";
            let scrambled = ":";
            for (let i = 0; i < pass.length; i++) {
              const charCode = pass.charCodeAt(i);
              scrambled += `${charCode + i + 1}:`;
            }
            return scrambled;
          };

          const sshConfig = session.getConfig();
          const username = sshConfig.username || "root";
          const password = sshConfig.password || "";
          const scrambledPassword = scrambleNoMachinePassword(password);

          const hostId = sshConfig.hostId || "default";
          const nxsDir = join(app.getPath("userData"), "nomachine");

          try {
            mkdirSync(nxsDir, { recursive: true });
          } catch { }

          const nxsPath = join(nxsDir, `connection-${hostId}.nxs`);
          console.log(`[NOMACHINE-DEBUG] NXS path: ${nxsPath}, localPort: ${localPort}`);
          let xml = "";

          if (existsSync(nxsPath)) {
            try {
              const existingXml = readFileSync(nxsPath, "utf8");

              // Replace Server port option
              xml = existingXml.replace(
                /<option\s+key="Server\s+port"\s+value="[^"]*"\s*\/>/gi,
                `<option key="Server port" value="${localPort}" />`
              );

              // Ensure host is localPort's target 127.0.0.1
              xml = xml.replace(
                /<option\s+key="Server\s+host"\s+value="[^"]*"\s*\/>/gi,
                `<option key="Server host" value="127.0.0.1" />`
              );

              // Update user option
              if (username) {
                if (xml.includes('key="User"')) {
                  xml = xml.replace(
                    /<option\s+key="User"\s+value="[^"]*"\s*\/>/gi,
                    `<option key="User" value="${username}" />`
                  );
                } else {
                  xml = xml.replace(
                    /<\/group>/i,
                    `<option key="User" value="${username}" />\n</group>`
                  );
                }
              }

              // Update auth option
              if (password) {
                if (xml.includes('key="Auth"')) {
                  xml = xml.replace(
                    /<option\s+key="Auth"\s+value="[^"]*"\s*\/>/gi,
                    `<option key="Auth" value="${scrambledPassword}" />`
                  );
                } else {
                  xml = xml.replace(
                    /<\/group>/i,
                    `<option key="Auth" value="${scrambledPassword}" />\n</group>`
                  );
                }

                if (xml.includes('key="Remember password"')) {
                  xml = xml.replace(
                    /<option\s+key="Remember\s+password"\s+value="[^"]*"\s*\/>/gi,
                    `<option key="Remember password" value="true" />`
                  );
                } else {
                  xml = xml.replace(
                    /<\/group>/i,
                    `<option key="Remember password" value="true" />\n</group>`
                  );
                }
              }
            } catch {
              xml = "";
            }
          }

          if (!xml) {
            let authOption = "";
            if (password) {
              authOption = `<option key="Auth" value="${scrambledPassword}" />\n<option key="Remember password" value="true" />`;
            }
            xml = `<!DOCTYPE NXClientSettings>
<NXClientSettings version="1.5" >
<group name="General" >
<option key="Server host" value="127.0.0.1" />
<option key="Server port" value="${localPort}" />
<option key="Connection service" value="nx" />
<option key="Server type" value="unix" />
<option key="User" value="${username}" />
${authOption}
</group>
</NXClientSettings>`;
          }

          writeFileSync(nxsPath, xml, "utf8");

          const isWindows = process.platform === "win32";
          const nxplayerPaths = isWindows
            ? ["nxplayer.exe", "C:\\Program Files (x86)\\NoMachine\\bin\\nxplayer.exe", "C:\\Program Files\\NoMachine\\bin\\nxplayer.exe"]
            : ["nxplayer", "/usr/NX/bin/nxplayer"];
          let pathIdx = 0;

          const trySpawn = () => {
            if (pathIdx >= nxplayerPaths.length) {
              cleanup();
              reject(new Error("NoMachine Player (nxplayer) not found. Please install NoMachine locally."));
              return;
            }
            const cmd = nxplayerPaths[pathIdx]!;
            childProcess = spawn(cmd, ["--session", nxsPath], {
              stdio: "ignore",
              detached: true,
              shell: isWindows // Windows needs shell to find commands in PATH sometimes
            });

            childProcess.once("error", () => {
              pathIdx++;
              trySpawn();
            });

            childProcess.once("spawn", () => {
              childProcess.unref();
              childProcess.on("exit", () => {
                cleanup();
              });
              resolve({ opened: true, localPort });
            });
          };

          trySpawn();
        };

        void trySpawnNomachine();

      } else if (guiType === "vnc") {
        // Build viewer list based on user preference
        const vncPassword = "shadow";
        const remminaEntry = { cmd: "remmina", args: ["-c", `vnc://:${vncPassword}@127.0.0.1:${localPort}`] };

        // If we successfully downloaded the VPS's encrypted passwd file, pass it directly.
        // Otherwise, fall back to spawning vncviewer normally.
        // Quality flags: -PreferredEncoding Tight (best for LAN/WAN), -QualityLevel 9 (max),
        //                -CompressLevel 1 (minimal compression = lowest latency),
        //                -FullColor, -AutoSelect 0 (disable adaptive quality degradation)
        const tigerQualityArgs = [
          "-SecurityTypes", "VncAuth",
          "-PreferredEncoding", vncQuality?.encoding ?? "Tight",
          "-QualityLevel", String(vncQuality?.qualityLevel ?? 9),
          "-CompressLevel", String(vncQuality?.compressLevel ?? 1),
          "-FullColor",
          "-AutoSelect", "0",
        ];
        const tigerEntry = localPasswdPath
          ? { cmd: "vncviewer", args: ["-passwd", localPasswdPath, ...tigerQualityArgs, `127.0.0.1::${localPort}`] }
          : { cmd: "vncviewer", args: [...tigerQualityArgs, `127.0.0.1::${localPort}`] };

        const tigerAlt = localPasswdPath
          ? { cmd: "xvncviewer", args: ["-passwd", localPasswdPath, ...tigerQualityArgs, `127.0.0.1::${localPort}`] }
          : { cmd: "xvncviewer", args: [...tigerQualityArgs, `127.0.0.1::${localPort}`] };

        const vinagreEntry = { cmd: "vinagre", args: [`127.0.0.1:${localPort}`] };

        let viewers: { cmd: string; args: string[] }[];
        if (vncViewer === "remmina") {
          viewers = [remminaEntry, tigerEntry, tigerAlt, vinagreEntry];
        } else if (vncViewer === "tigervnc") {
          viewers = [tigerEntry, tigerAlt, remminaEntry, vinagreEntry];
        } else {
          // auto: try remmina first then tigervnc
          viewers = [remminaEntry, tigerEntry, tigerAlt, vinagreEntry];
        }
        let viewerIdx = 0;

        console.log(`[VNC-DEBUG] Viewer preference: "${vncViewer}", localPort: ${localPort}`);
        console.log(`[VNC-DEBUG] Viewer list:`, viewers.map(v => `${v.cmd} ${v.args.join(" ")}`));

        const trySpawn = () => {
          if (viewerIdx >= viewers.length) {
            console.error(`[VNC-DEBUG] All viewers exhausted, none could spawn!`);
            cleanup();
            reject(new Error("No compatible VNC viewer found (remmina, vncviewer, vinagre). Please install one."));
            return;
          }
          const item = viewers[viewerIdx]!;
          console.log(`[VNC-DEBUG] Trying viewer [${viewerIdx}]: ${item.cmd} ${item.args.join(" ")}`);
          childProcess = spawn(item.cmd, item.args, { stdio: ["ignore", "pipe", "pipe"], detached: true });

          childProcess.stdout?.on("data", (d: Buffer) => console.log(`[VNC-DEBUG][${item.cmd}] stdout: ${d.toString().trim()}`));
          childProcess.stderr?.on("data", (d: Buffer) => console.log(`[VNC-DEBUG][${item.cmd}] stderr: ${d.toString().trim()}`));

          childProcess.once("error", (err: Error) => {
            console.error(`[VNC-DEBUG] Spawn error for "${item.cmd}": ${err.message}`);
            viewerIdx++;
            trySpawn();
          });

          childProcess.once("spawn", () => {
            console.log(`[VNC-DEBUG] Successfully spawned "${item.cmd}" (pid: ${childProcess.pid})`);
            childProcess.unref();
            childProcess.on("exit", (code: number | null, signal: string | null) => {
              console.log(`[VNC-DEBUG] "${item.cmd}" exited with code=${code} signal=${signal}`);
              cleanup();
            });
            resolve({ opened: true, localPort });
          });
        };

        trySpawn();
      }
    });
  });

  ipcMain.handle("sftp:closeGuiConnection", async (_event, rawInput: unknown) => {
    const parsed = sftpCloseGuiSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP close GUI payload: ${parsed.error.message}`);
    }

    const { sessionId, guiType } = parsed.data;
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    session.closeForwardServer(guiType);
    return { ok: true };
  });

  ipcMain.handle("sftp:extractZip", async (_event, rawInput: unknown) => {
    const parsed = sftpExtractZipSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP extract zip payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const remotePath = parsed.data.remotePath.trim();
    const extractDir = dirname(remotePath);

    // Run unzip remotely on the server
    const command = `unzip -o "${remotePath}" -d "${extractDir}" 2>&1`;
    await session.exec(command);

    return {
      extracted: true,
      extractedPath: extractDir
    };
  });

  ipcMain.handle("sftp:delete", async (_event, rawInput: unknown) => {
    const parsed = sftpDeleteSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP delete payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.deleteFileOrDir(parsed.data.remotePath.trim());
    return { ok: true };
  });

  ipcMain.handle("sftp:mkdir", async (_event, rawInput: unknown) => {
    const parsed = sftpMkdirSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP mkdir payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.createDirectory(parsed.data.remotePath.trim());
    return { ok: true };
  });

  ipcMain.handle("sftp:rename", async (_event, rawInput: unknown) => {
    const parsed = sftpRenameSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP rename payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.renamePath(parsed.data.oldPath.trim(), parsed.data.newPath.trim());
    return { ok: true };
  });

  ipcMain.handle("sftp:createFile", async (_event, rawInput: unknown) => {
    const parsed = sftpCreateFileSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP create file payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.createEmptyFile(parsed.data.remotePath.trim());
    return { ok: true };
  });

  ipcMain.handle("sftp:copy", async (_event, rawInput: unknown) => {
    const parsed = sftpCopySchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid SFTP copy payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    await session.copyToPath(parsed.data.sourcePath.trim(), parsed.data.destPath.trim());
    return { ok: true };
  });

  const sftpListWorkspacesSchema = z.object({
    sessionId: z.string().uuid()
  });

  const sftpDeleteWorkspaceSchema = z.object({
    sessionId: z.string().uuid(),
    remotePath: z.string().min(1).max(4096)
  });

  ipcMain.handle("sftp:listWorkspaces", async (_event, rawInput: unknown) => {
    const parsed = sftpListWorkspacesSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid sftp:listWorkspaces payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    try {
      const output = await session.exec(
        `for f in ~/.shadowssh/workspaces/*.json; do [ -f "$f" ] && cat "$f" && echo ""; done 2>/dev/null`
      );
      const workspaces: Array<{ path: string; updatedAt: string }> = [];
      const lines = output.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ws = JSON.parse(trimmed);
          if (ws && typeof ws.path === "string" && typeof ws.updatedAt === "string") {
            workspaces.push(ws);
          }
        } catch {
          // Ignore invalid JSON lines
        }
      }
      return workspaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch {
      return [];
    }
  });

  ipcMain.handle("sftp:deleteWorkspace", async (_event, rawInput: unknown) => {
    const parsed = sftpDeleteWorkspaceSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid sftp:deleteWorkspace payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const { createHash } = await import("node:crypto");
    const pathHash = createHash("sha256").update(parsed.data.remotePath).digest("hex").slice(0, 12);
    await session.exec(`rm -f "$HOME"/.shadowssh/workspaces/${pathHash}.json`);
    return { success: true };
  });

  async function ensureSmd(session: SSHSession): Promise<string> {
    const { fileURLToPath } = await import("node:url");
    const esDirname = dirname(fileURLToPath(import.meta.url));

    const possiblePaths = [
      join(process.cwd(), "smd/dist"),
      join(process.resourcesPath, "smd"),
      join(esDirname, "../../smd/dist"),
      join(esDirname, "../../../smd/dist"),
      join(esDirname, "../smd/dist")
    ];

    let localDistDir = "";
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        localDistDir = p;
        break;
      }
    }

    if (!localDistDir) {
      throw new Error("Could not find local smd build directory");
    }

    let remoteHome = "";
    try {
      const homeDirCheck = await session.exec("echo $HOME");
      remoteHome = homeDirCheck.trim();
    } catch {
      // Fallback
    }
    if (!remoteHome) {
      remoteHome = "~";
    }

    await session.exec(`mkdir -p "${remoteHome}/.shadowssh" && sudo chown -R $(whoami) "${remoteHome}/.shadowssh" 2>/dev/null || true`);
    await session.exec(`sudo rm -f "${remoteHome}/.shadowssh/smd" "${remoteHome}/.shadowssh/smd.js" 2>/dev/null || true`);

    let remoteHasNode = false;
    try {
      const nodeCheck = await session.exec("command -v node >/dev/null 2>&1 && echo YES || echo NO");
      if (nodeCheck.trim() === "YES") {
        remoteHasNode = true;
      }
    } catch (err) {
      // Ignore
    }

    if (remoteHasNode) {
      const localSmdJs = join(localDistDir, "smd.js");
      if (!existsSync(localSmdJs)) {
        throw new Error(`smd.js not found at ${localSmdJs}`);
      }
      await session.uploadFileToPath(localSmdJs, `${remoteHome}/.shadowssh/smd.js`);
      return `node "${remoteHome}/.shadowssh/smd.js"`;
    } else {
      const localSmdLinux = join(localDistDir, "smd-linux");
      if (!existsSync(localSmdLinux)) {
        throw new Error(`smd-linux not found at ${localSmdLinux}`);
      }
      await session.uploadFileToPath(localSmdLinux, `${remoteHome}/.shadowssh/smd`);
      await session.exec(`chmod +x "${remoteHome}/.shadowssh/smd"`);
      return `"${remoteHome}/.shadowssh/smd"`;
    }
  }

  ipcMain.handle("smd:checkStatus", async (_event, rawInput: unknown) => {
    const parsed = smdCheckStatusSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid smd:checkStatus payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const smdCmd = await ensureSmd(session);
    const output = await session.exec(`${smdCmd} detect --json`);

    try {
      const data = JSON.parse(output.trim());
      const deList = data.desktop ?? [];
      let deType = deList[0] ?? "";

      // Always run multi-section detection, even if deList is empty
      try {
        const checkOutput = await session.exec(
          "echo \"===PROCESSES===\"; ps -u $(whoami) -o comm 2>/dev/null || ps -eo comm 2>/dev/null; echo \"===NXCONFIG===\"; cat /usr/NX/etc/node.cfg 2>/dev/null | grep -E '^[[:space:]]*DefaultDesktopCommand'; echo \"===LINK===\"; readlink -f /usr/bin/x-session-manager 2>/dev/null; echo \"===XFILES===\"; cat ~/.xsession ~/.xsessionrc ~/.xinitrc ~/.Xclients 2>/dev/null; echo \"===ACCOUNTS===\"; cat ~/.dmrc 2>/dev/null; cat /var/lib/AccountsService/users/$(whoami) 2>/dev/null; echo \"===BINARIES===\"; for b in /usr/bin/startxfce4 /usr/bin/xfce4-session /usr/bin/mate-session /usr/bin/gnome-session /usr/bin/gnome-shell /usr/bin/cinnamon-session /usr/bin/cinnamon-session-cinnamon /usr/bin/startplasma-x11 /usr/bin/startkde; do [ -f \"$b\" ] && echo \"$b\"; done; echo \"===END===\""
        );

        console.log("[SMD-DETECTION-DEBUG] Output from VPS:\n", checkOutput);

        const sections: Record<string, string> = {};
        let currentSection = "";
        for (const line of checkOutput.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("===") && trimmed.endsWith("===")) {
            currentSection = trimmed.replace(/===/g, "");
            sections[currentSection] = "";
          } else if (currentSection) {
            sections[currentSection] += line + "\n";
          }
        }

        const binaries = sections["BINARIES"] ?? "";

        const getDeBinary = (de: string): string => {
          if (de === "xfce") {
            if (binaries.includes("startxfce4")) return "/usr/bin/startxfce4";
            if (binaries.includes("xfce4-session")) return "/usr/bin/xfce4-session";
          }
          if (de === "mate") {
            if (binaries.includes("mate-session")) return "/usr/bin/mate-session";
          }
          if (de === "gnome") {
            if (binaries.includes("gnome-session")) return "/usr/bin/gnome-session";
          }
          if (de === "cinnamon") {
            if (binaries.includes("cinnamon-session")) return "/usr/bin/cinnamon-session";
            if (binaries.includes("cinnamon-session-cinnamon")) return "/usr/bin/cinnamon-session-cinnamon";
          }
          if (de === "kde") {
            if (binaries.includes("startplasma-x11")) return "/usr/bin/startplasma-x11";
            if (binaries.includes("startkde")) return "/usr/bin/startkde";
          }
          return "";
        };

        const binaryExists = (de: string): boolean => !!getDeBinary(de);

        const findDeInText = (text: string): string | null => {
          const lower = text.toLowerCase();
          let matched: string | null = null;
          // Cinnamon: must have actual cinnamon-session or cinnamon process running
          if (/\bcinnamon\b/.test(lower) && !lower.includes("gnome")) matched = "cinnamon";
          // XFCE: must have core XFCE components
          else if (lower.includes("xfwm4") || lower.includes("xfce4-session") || lower.includes("xfdesktop") || lower.includes("startxfce4")) matched = "xfce";
          // MATE: actual mate-session or mate panel
          else if (lower.includes("mate-session") || lower.includes("mate-panel")) matched = "mate";
          // GNOME: only gnome-shell (NOT gnome-terminal, gnome-keyring, gnome-software which are Cinnamon deps)
          else if (/\bgnome-shell\b/.test(lower)) matched = "gnome";
          // KDE: core plasma/startkde
          else if (lower.includes("plasmashell") || lower.includes("startplasma") || lower.includes("startkde") || lower.includes("ksmserver")) matched = "kde";

          if (matched && !binaryExists(matched)) {
            return null;
          }
          return matched;
        };

        const matchedDefault = findDeInText(sections["PROCESSES"] ?? "") ||
          findDeInText(sections["NXCONFIG"] ?? "") ||
          findDeInText(sections["XFILES"] ?? "") ||
          findDeInText(sections["ACCOUNTS"] ?? "") ||
          findDeInText(sections["LINK"] ?? "");

        console.log("[SMD-DETECTION-DEBUG] Matched default DE:", matchedDefault);

        // Determine the source of the matched DE
        const runningDe = findDeInText(sections["PROCESSES"] ?? "");
        const nxConfigDe = findDeInText(sections["NXCONFIG"] ?? "");
        const linkDe = findDeInText(sections["LINK"] ?? "");
        const filesDe = findDeInText(sections["XFILES"] ?? "");
        const accountsDe = findDeInText(sections["ACCOUNTS"] ?? "");

        // Check if we need to auto-correct NoMachine's config
        // Only auto-correct when NXCONFIG points to a stale DE that's NOT running
        let needsCorrection = false;

        const nxConfigLine = (sections["NXCONFIG"] ?? "").trim();
        const matchQuote = nxConfigLine.match(/DefaultDesktopCommand\s+"([^"]+)"/) || nxConfigLine.match(/DefaultDesktopCommand\s+(.+)/);
        const nxConfigCmd = (matchQuote && matchQuote[1]) ? matchQuote[1].trim() : "";

        const knownBinaries = [
          "/usr/bin/startxfce4",
          "/usr/bin/xfce4-session",
          "/usr/bin/mate-session",
          "/usr/bin/gnome-session",
          "/usr/bin/gnome-shell",
          "/usr/bin/cinnamon-session",
          "/usr/bin/cinnamon-session-cinnamon",
          "/usr/bin/startplasma-x11",
          "/usr/bin/startkde"
        ];

        const configuredBinary = knownBinaries.find(b => nxConfigCmd.includes(b));

        console.log("[SMD-DETECTION-DEBUG] deList:", deList);
        console.log("[SMD-DETECTION-DEBUG] nxConfigCmd:", nxConfigCmd);
        console.log("[SMD-DETECTION-DEBUG] configuredBinary:", configuredBinary);
        console.log("[SMD-DETECTION-DEBUG] binaries:", binaries);

        if (deList.length > 0) {
          if (!nxConfigCmd) {
            needsCorrection = true;
          } else if (configuredBinary && !binaries.includes(configuredBinary)) {
            // Configured binary does not exist on disk
            needsCorrection = true;
          } else if (!configuredBinary) {
            // Unrecognized custom command or no binary matched
            needsCorrection = true;
          }
        } else {
          // No DE is installed. If any custom command is still configured, clear it
          if (nxConfigCmd) {
            needsCorrection = true;
          }
        }

        console.log("[SMD-DETECTION-DEBUG] needsCorrection:", needsCorrection);

        if (needsCorrection) {
          // Determine the correct DE to set
          let targetDe = "";

          // Priority: 1) Running process 2) First deList entry that has a valid binary 3) Last resort
          if (runningDe && deList.includes(runningDe)) {
            targetDe = runningDe;
          } else if (deList.length > 0) {
            // Pick first DE that actually has a valid session binary
            for (const de of deList) {
              if (binaryExists(de)) {
                targetDe = de;
                break;
              }
            }
            // If no DE in deList has valid binaries, leave targetDe empty to reset config
          } else {
            // Last resort: check if any DE binary exists via common paths
            const deCheckCmd = "for f in /usr/share/xsessions/*.desktop; do [ -f \"$f\" ] && basename \"$f\" .desktop; done 2>/dev/null | head -1";
            try {
              const deCheck = await session.exec(deCheckCmd);
              const detectedFromFiles = deCheck.trim().toLowerCase();
              if (detectedFromFiles === "mate" || detectedFromFiles === "xfce" ||
                detectedFromFiles === "cinnamon" || detectedFromFiles === "gnome" ||
                detectedFromFiles === "kde" || detectedFromFiles === "plasma") {
                targetDe = detectedFromFiles === "plasma" ? "kde" : detectedFromFiles;
              }
            } catch { }
          }

          console.log("[SMD-DETECTION-DEBUG] targetDe:", targetDe);

          if (targetDe) {
            const cmd = getDeBinary(targetDe);

            if (cmd) {
              const setNodeCfg = `
                echo "Updating node.cfg for ${targetDe}..."
                if [ -f /usr/NX/etc/node.cfg ]; then
                  sudo chmod 644 /usr/NX/etc/node.cfg 2>/dev/null || true
                  if grep -q 'DefaultDesktopCommand' /usr/NX/etc/node.cfg; then
                    sudo sed -i 's!^[#[:space:]]*DefaultDesktopCommand.*!DefaultDesktopCommand "${cmd}"!' /usr/NX/etc/node.cfg
                  else
                    echo 'DefaultDesktopCommand "${cmd}"' | sudo tee -a /usr/NX/etc/node.cfg >/dev/null
                  fi
                fi`;

              const deKillCmd = `
                echo "Cleaning up existing DE processes..."
                # Use -x for exact match to avoid killing this script
                for proc in xfce4-session xfwm4 xfce4-panel xfdesktop xfsettingsd Thunar xfce4-notifyd xfce4-power-man \
                            mate-session marco mate-panel caja mate-settings-daemon \
                            cinnamon cinnamon-session muffin nemo \
                            gnome-session gnome-shell \
                            startplasma-x11 plasmashell kwin_x11 ksmserver light-locker; do
                  pkill -u $(whoami) -x "$proc" 2>/dev/null || true
                done
                sleep 1
              `;

              const killNxSessions = `
                echo "Terminating NoMachine sessions..."
                if [ -x /etc/NX/nxserver ]; then
                  sudo /etc/NX/nxserver --terminate all 2>/dev/null || true
                fi
                sudo systemctl stop nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --shutdown 2>/dev/null || true
                sleep 1
                pkill -9 -u $(whoami) -f nxnode 2>/dev/null || true
                pkill -9 -f "Xorg.*nx" 2>/dev/null || true
                rm -f /tmp/.X1[0-9]-lock /tmp/.X11-unix/X1[0-9] 2>/dev/null || true
                sudo rm -rf /usr/NX/var/db/running/* 2>/dev/null || true
                sudo rm -rf /usr/NX/var/data/db/running/* 2>/dev/null || true
                sudo systemctl reset-failed nxserver.service 2>/dev/null || true
              `;

              const altTarget = (targetDe === "xfce" && binaries.includes("xfce4-session")) ? "/usr/bin/xfce4-session" : cmd;

              const setAlternatives = altTarget ? `
                if [ -f "${altTarget}" ]; then
                  sudo update-alternatives --set x-session-manager "${altTarget}" 2>/dev/null || true
                fi
              ` : "";

              console.log(`[SMD-DETECTION-DEBUG] NXCONFIG is stale/invalid. Auto-correcting to '${targetDe}'.`);
              await session.exec([
                setNodeCfg,
                deKillCmd,
                killNxSessions,
                setAlternatives,
                "sudo systemctl start nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --startup 2>/dev/null || true"
              ].join("\n"));

              // Update deType to the corrected value
              if (targetDe && !deList.includes(targetDe)) {
                deList.unshift(targetDe);
              }
              deType = targetDe;
            }
          } else {
            // No DE is installed, remove custom command and reset
            const clearNodeCfg = `
              if [ -f /usr/NX/etc/node.cfg ]; then
                sudo sed -i '/DefaultDesktopCommand/d' /usr/NX/etc/node.cfg
              fi
            `;
            const killNxSessions = `
              set -x
              if [ -x /etc/NX/nxserver ]; then
                sudo /etc/NX/nxserver --terminate all 2>/dev/null || true
              fi
              sudo systemctl stop nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --shutdown 2>/dev/null || true
              sleep 1
              pkill -9 -u $(whoami) -f nxnode 2>/dev/null || true
              pkill -9 -f "Xorg.*nx" 2>/dev/null || true
              rm -f /tmp/.X1[0-9]-lock /tmp/.X11-unix/X1[0-9] 2>/dev/null || true
              sudo rm -rf /usr/NX/var/db/running/* 2>/dev/null || true
              sudo rm -rf /usr/NX/var/data/db/running/* 2>/dev/null || true
              sudo systemctl reset-failed nxserver.service 2>/dev/null || true
            `;
            console.log(`[SMD-DETECTION-DEBUG] No DEs installed. Resetting NXCONFIG to system default.`);
            await session.exec([
              killNxSessions,
              clearNodeCfg,
              "sudo systemctl start nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --startup 2>/dev/null || true"
            ].join("\n"));
            deType = "";
          }
        } else if (runningDe) {
          // A DE is actively running → use it as the active/default display
          deType = runningDe;
          // If deList doesn't include the running DE, add it
          if (!deList.includes(runningDe)) {
            deList.unshift(runningDe);
          } else {
            // Sort running DE to front
            const index = deList.indexOf(runningDe);
            if (index > -1) {
              deList.splice(index, 1);
              deList.unshift(runningDe);
            }
          }
          console.log(`[SMD-DETECTION-DEBUG] Running DE detected: ${runningDe}. Using as active.`);
        } else if (matchedDefault && deList.includes(matchedDefault)) {
          // No running DE, but matched from other sources: sort to front
          const index = deList.indexOf(matchedDefault);
          if (index > -1) {
            deList.splice(index, 1);
            deList.unshift(matchedDefault);
            deType = matchedDefault;
          }
        }
      } catch (err) {
        console.error("[SMD-DETECTION-DEBUG] Error running detection:", err);
      }

      const remoteList = data.remote ?? [];
      const vncInstalled = remoteList.includes("tigervnc");
      const nxInstalled = remoteList.includes("nomachine");

      const ramStr = data.hardware?.ram?.total ?? "0";
      const totalGB = parseFloat(ramStr) || 0;
      const ramMB = Math.round(totalGB * 1024);

      return {
        deType,
        deList,
        ramMB,
        vncInstalled,
        nxInstalled,
        hasGui: deType !== "",
        distro: data.distro ?? "unknown",
        packageManager: data.packageManager ?? "unknown"
      };
    } catch (err) {
      throw new Error(`Failed to parse smd detect output: ${output}. Error: ${err}`);
    }
  });

  ipcMain.handle("smd:install", async (_event, rawInput: unknown) => {
    const parsed = smdInstallSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid smd:install payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const smdCmd = await ensureSmd(session);

    let installRes = "";
    let success = false;
    try {
      installRes = await session.exec(`DEBIAN_FRONTEND=noninteractive sudo -n ${smdCmd} install ${parsed.data.target} 2>&1 || sudo ${smdCmd} install ${parsed.data.target}`);
      success = !installRes.includes("Failed to install") && !installRes.toLowerCase().includes("error");

      if (parsed.data.target === "tigervnc") {
        await session.exec('mkdir -p ~/.vnc && echo "shadow" | vncpasswd -f > ~/.vnc/passwd && chmod 600 ~/.vnc/passwd || true');
      }
    } catch (err: any) {
      installRes = err.message || String(err);
      success = false;
    }

    return {
      success,
      output: installRes
    };
  });

  ipcMain.handle("smd:uninstall", async (_event, rawInput: unknown) => {
    const parsed = smdUninstallSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid smd:uninstall payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const smdCmd = await ensureSmd(session);

    let uninstallRes = "";
    let success = false;
    try {
      uninstallRes = await session.exec(`DEBIAN_FRONTEND=noninteractive sudo -n ${smdCmd} uninstall ${parsed.data.target} 2>&1 || sudo ${smdCmd} uninstall ${parsed.data.target}`);
      success = !uninstallRes.includes("Failed to uninstall") && !uninstallRes.toLowerCase().includes("error");
    } catch (err: any) {
      uninstallRes = err.message || String(err);
      success = false;
    }

    return {
      success,
      output: uninstallRes
    };
  });

  ipcMain.handle("smd:setDefaultDe", async (_event, rawInput: unknown) => {
    const schema = z.object({
      sessionId: z.string().min(1),
      de: z.string().min(1)
    });
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`Invalid smd:setDefaultDe payload: ${parsed.error.message}`);
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const de = parsed.data.de;

    // Probe for existing binaries
    const probeCmd = "for b in /usr/bin/startxfce4 /usr/bin/xfce4-session /usr/bin/mate-session /usr/bin/gnome-session /usr/bin/gnome-shell /usr/bin/cinnamon-session /usr/bin/cinnamon-session-cinnamon /usr/bin/startplasma-x11 /usr/bin/startkde; do [ -f \"$b\" ] && echo \"$b\"; done";
    const probeOut = await session.exec(probeCmd);
    const binaries = probeOut.trim();

    const getDeBinary = (targetDe: string): string => {
      if (targetDe === "xfce") {
        if (binaries.includes("startxfce4")) return "/usr/bin/startxfce4";
        if (binaries.includes("xfce4-session")) return "/usr/bin/xfce4-session";
      }
      if (targetDe === "mate") {
        if (binaries.includes("mate-session")) return "/usr/bin/mate-session";
      }
      if (targetDe === "gnome") {
        if (binaries.includes("gnome-session")) return "/usr/bin/gnome-session";
      }
      if (targetDe === "cinnamon") {
        if (binaries.includes("cinnamon-session")) return "/usr/bin/cinnamon-session";
        if (binaries.includes("cinnamon-session-cinnamon")) return "/usr/bin/cinnamon-session-cinnamon";
      }
      if (targetDe === "kde") {
        if (binaries.includes("startplasma-x11")) return "/usr/bin/startplasma-x11";
        if (binaries.includes("startkde")) return "/usr/bin/startkde";
      }
      return "";
    };

    let deToSet = de;
    let cmd = getDeBinary(de);

    if (!cmd) {
      console.warn(`[ShadowSSH] Requested DE "${de}" binary not found. Finding fallback...`);
      const smdCmd = await ensureSmd(session);
      const detectOut = await session.exec(`${smdCmd} detect --json`);
      try {
        const data = JSON.parse(detectOut.trim());
        const installedDes = data.desktop ?? [];
        if (installedDes.length > 0) {
          // Find first installed DE that actually has a binary
          for (const d of installedDes) {
            const b = getDeBinary(d);
            if (b) {
              deToSet = d;
              cmd = b;
              console.log(`[ShadowSSH] Falling back to installed DE: ${deToSet} (${cmd})`);
              break;
            }
          }
        }
      } catch (err) {
        // Ignore
      }
    }

    if (!cmd) {
      return { success: false, output: "No valid desktop environment binary found on the remote system." };
    }

    let sessionName = "";
    if (deToSet === "xfce") sessionName = "xfce";
    else if (deToSet === "cinnamon") sessionName = "cinnamon";
    else if (deToSet === "mate") sessionName = "MATE";
    else if (deToSet === "gnome") sessionName = "gnome";
    else if (deToSet === "kde") sessionName = "plasma";

    try {
      // 0. Kill any running processes from ALL desktop environments for a clean switch
      const deKillCmd = `
        set -x
        echo "Cleaning up other DE sessions..."
        # FIX OWNERSHIP: Ensure configuration/session files are owned by $(whoami) instead of root
        sudo chown -R $(whoami):$(id -gn) ~/.vnc ~/.dbus ~/.config ~/.cache ~/.local ~/.Xauthority ~/.xsession ~/.xinitrc ~/.Xclients 2>/dev/null || true

        for proc in xfce4-session xfwm4 xfce4-panel xfdesktop xfsettingsd Thunar xfce4-notifyd xfce4-power-man \
                    mate-session marco mate-panel caja mate-settings-daemon \
                    cinnamon cinnamon-session muffin nemo \
                    gnome-session gnome-shell \
                    startplasma-x11 plasmashell kwin_x11 ksmserver light-locker; do
          pkill -u $(whoami) -x "$proc" 2>/dev/null || true
        done
        sleep 1
      `;

      // 1. Write ~/.xsession — read by NoMachine, startx, xinit, and most DMs
      const xsessionContent = `#!/bin/sh
# Auto-generated by ShadowSSH — do not edit manually
export XDG_SESSION_TYPE=x11
export XDG_CURRENT_DESKTOP=${de === "kde" ? "KDE" : de.toUpperCase()}
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
if command -v dbus-run-session >/dev/null 2>&1; then
  exec dbus-run-session -- ${cmd}
elif command -v dbus-launch >/dev/null 2>&1; then
  exec dbus-launch --exit-with-session ${cmd}
else
  exec ${cmd}
fi
`;
      const writeXsession = `
        cat > ~/.xsession << 'XSESSION_EOF'
${xsessionContent}XSESSION_EOF
        chmod +x ~/.xsession
        cp -f ~/.xsession ~/.xinitrc
        cp -f ~/.xsession ~/.Xclients
        chmod +x ~/.Xclients 2>/dev/null || true
      `;

      // 2. Write ~/.dmrc — used by gdm/lightdm/AccountsService to remember last DE
      const writeDmrc = `
        cat > ~/.dmrc << 'DMRC_EOF'
[Desktop]
Session=${sessionName}
DMRC_EOF
      `;

      // 3. Update AccountsService if present (used by gdm3/lightdm)
      const writeAccountsService = `
        if [ -d /var/lib/AccountsService/users ]; then
          sudo bash -c "cat > /var/lib/AccountsService/users/$(whoami) << 'AS_EOF'
[User]
Session=${sessionName}
XSession=${sessionName}
AS_EOF"
        fi
      `;

      // 4. Update node.cfg for NoMachine — replace DefaultDesktopCommand line or append
      const setNodeCfg = `
        if [ -f /usr/NX/etc/node.cfg ]; then
          # Ensure we can write to it
          sudo chmod 644 /usr/NX/etc/node.cfg 2>/dev/null || true
          # Replace existing DefaultDesktopCommand line (even if commented), or append if not found
          # Use ! as sed delimiter because cmd contains slashes
          if grep -q 'DefaultDesktopCommand' /usr/NX/etc/node.cfg; then
            sudo sed -i 's!^[#[:space:]]*DefaultDesktopCommand.*!DefaultDesktopCommand "${cmd}"!' /usr/NX/etc/node.cfg
          else
            echo 'DefaultDesktopCommand "${cmd}"' | sudo tee -a /usr/NX/etc/node.cfg >/dev/null
          fi
          echo "[ShadowSSH] NODE_CFG_UPDATED"
          grep 'DefaultDesktopCommand' /usr/NX/etc/node.cfg
        fi
      `;
      // 5. Update update-alternatives for system-wide x-session-manager default
      let altTarget = "";
      if (deToSet === "xfce") {
        altTarget = binaries.includes("xfce4-session") ? "/usr/bin/xfce4-session" : cmd;
      } else {
        altTarget = cmd;
      }

      const setAlternatives = altTarget ? `
        if [ -f "${altTarget}" ]; then
          sudo update-alternatives --set x-session-manager "${altTarget}" 2>/dev/null || true
          echo "[ShadowSSH] update-alternatives set to: ${altTarget}"
        fi
      ` : "";

      // 6. CRITICAL: Terminate all existing NX sessions so the next connection
      // starts fresh with the new DE instead of resuming the old cached session
      const killNxSessions = `
        echo "[ShadowSSH] Terminating all existing NoMachine sessions..."
        # Stop any active display managers that block virtual display fallback on headless VPS
        sudo systemctl stop display-manager 2>/dev/null || sudo systemctl stop lightdm 2>/dev/null || sudo systemctl stop gdm3 2>/dev/null || sudo systemctl stop gdm 2>/dev/null || sudo systemctl stop sddm 2>/dev/null || true

        # Use nxserver terminate first (graceful)
        if [ -x /etc/NX/nxserver ]; then
          sudo /etc/NX/nxserver --terminate all 2>/dev/null || true
        fi
        # Stop nxserver cleanly
        sudo systemctl stop nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --shutdown 2>/dev/null || true
        sleep 1
        # Kill any remaining nxagent/nxnode processes
        pkill -9 -u $(whoami) -f nxagent 2>/dev/null || true
        pkill -9 -u $(whoami) -f nxnode 2>/dev/null || true
        pkill -9 -f "Xorg.*nx" 2>/dev/null || true
        # Remove leftover X11 display locks from NX
        rm -f /tmp/.X1[0-9]-lock /tmp/.X11-unix/X1[0-9] 2>/dev/null || true
        # CRITICAL: Wipe the NX session database so no old session can be resumed
        sudo rm -rf /usr/NX/var/db/running/* 2>/dev/null || true
        sudo rm -rf /usr/NX/var/data/db/running/* 2>/dev/null || true
        # Reset systemd so the next 'start' works (after pkill -9, systemd thinks service crashed)
        sudo systemctl reset-failed nxserver.service 2>/dev/null || true
        echo "[ShadowSSH] All NX sessions cleared. Config ready for ${de.toUpperCase()}."
        
        # Finally, restart NoMachine with the new configuration
        if [ -x /usr/NX/bin/nxserver.bin ] || [ -x /etc/NX/nxserver ]; then
          sudo systemctl start nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --startup 2>/dev/null || sudo /etc/NX/nxserver --restart 2>/dev/null || true
        fi
      `;

      const fullCmd = [deKillCmd, writeXsession, writeDmrc, writeAccountsService, setNodeCfg, setAlternatives, killNxSessions].join("\n");
      const output = await session.exec(fullCmd);
      console.log(`[NOMACHINE-DEBUG] smdSetDefaultDe fullCmd output:\n${output}`);

      // DEBUG: Verify what was set and test the command
      const debugVerify = await session.exec(
        `echo "=== NODE.CFG ===" && grep DefaultDesktopCommand /usr/NX/etc/node.cfg 2>/dev/null || echo "(empty)" && ` +
        `echo "=== TEST CMD ===" && ( [ -x "${cmd}" ] && echo "BINARY_OK" || echo "BINARY_MISSING" )`
      );
      console.log(`[NOMACHINE-DEBUG] smdSetDefaultDe verify:\n${debugVerify}`);

      return { success: true, output: output + "\n" + debugVerify };
    } catch (err: any) {
      return { success: false, output: err.message || String(err) };
    }
  });
}

