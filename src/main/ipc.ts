import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { Client } from "ssh2";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { existsSync, watch, type FSWatcher } from "node:fs";
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
  proxyPrivateKeyPath: z.string().max(4096).optional()
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
  proxyPrivateKeyPath: z.string().max(4096).optional()
});

const settingsSchema = z.object({
  appTheme: z.enum(["dark", "light", "onyx"]),
  terminalTheme: z.enum(["oceanic", "matrix", "amber", "nord", "dracula", "solarized", "green", "white"]),
  terminalFontSize: z.number().int().min(10).max(28),
  terminalFontFamily: z.string().min(1).max(128),
  editorCommand: z.string().min(1).max(256).default("code"),
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
    proxyPassword: undefined
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

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sessions = new Map<string, SSHSession>();
  const syncWatchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>();

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
    return getHosts();
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
    command: z.string().min(1).max(2000)
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
            stream.on("data", () => {});
            stream.stderr.on("data", () => {});
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
      try { await unlink(`${parsed.data.path}.pub`); } catch {}
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
}
