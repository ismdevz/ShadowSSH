import { contextBridge, ipcRenderer } from "electron";
import type {
  AppUpdateEvent,
  AppSettings,
  ConnectSSHInput,
  GeneratedKeyResult,
  HostInput,
  HostLatencyResult,
  HostRecord,
  SaveHostResult,
  SFTPListResult,
  SFTPSyncEvent,
  SshExecResult,
  SSHDataEvent,
  SSHStateEvent,
  SmdCheckResult,
  SmdExecResult
} from "../types/shared.js";

export interface SecureApi {
  connectSSH: (input: ConnectSSHInput) => Promise<{ sessionId: string }>;
  saveHost: (host: HostInput) => Promise<SaveHostResult>;
  getHosts: () => Promise<HostRecord[]>;
  getHostById: (hostId: string) => Promise<HostRecord | null>;
  deleteHost: (hostId: string) => Promise<{ ok: boolean }>;
  getHostLatency: (host: string, port: number, timeoutMs?: number) => Promise<HostLatencyResult>;
  getPassword: (hostId: string) => Promise<string | null>;
  pickPrivateKey: () => Promise<string | null>;
  generatePrivateKey: (name?: string, replaceExistingPath?: string) => Promise<GeneratedKeyResult>;
  installPublicKey: (host: string, port: number, username: string, password: string | undefined, publicKeyPath: string) => Promise<{ ok: boolean }>;
  readFileAsBase64: (path: string) => Promise<string>;
  writeFileFromBase64: (path: string, data: string) => Promise<{ ok: boolean }>;
  deleteFile: (path: string) => Promise<{ ok: boolean }>;
  sshWrite: (sessionId: string, data: string) => Promise<{ ok: boolean }>;
  sshResize: (sessionId: string, cols: number, rows: number) => Promise<{ ok: boolean }>;
  sshExec: (sessionId: string, command: string) => Promise<SshExecResult>;
  sshWriteFile: (sessionId: string, remotePath: string, content: string) => Promise<{ ok: boolean }>;
  disconnectSSH: (sessionId: string) => Promise<{ ok: boolean }>;
  reconnectSSH: (sessionId: string) => Promise<{ ok: boolean }>;
  sftpList: (sessionId: string, path: string) => Promise<SFTPListResult>;
  sftpUpload: (sessionId: string, remoteDir: string) => Promise<{ uploaded: boolean; remotePath?: string }>;
  sftpDownload: (sessionId: string, remotePath: string) => Promise<{ saved: boolean; localPath?: string }>;
  sftpEditInVSCode: (sessionId: string, remotePath: string) => Promise<{ opened: boolean; localPath?: string }>;
  sftpOpenWorkspace: (sessionId: string, remotePath: string) => Promise<{ opened: boolean }>;
  sftpListWorkspaces: (sessionId: string) => Promise<Array<{ path: string; updatedAt: string }>>;
  sftpDeleteWorkspace: (sessionId: string, remotePath: string) => Promise<{ success: boolean }>;
  sftpOpenGuiConnection: (sessionId: string, guiType: "vnc" | "nomachine", guiPort: number, vncViewer?: "auto" | "remmina" | "tigervnc", vncQuality?: { qualityLevel?: number; compressLevel?: number; encoding?: "Tight" | "ZRLE" | "Hextile" | "Raw" }) => Promise<{ opened: boolean; localPort: number }>;
  sftpCloseGuiConnection: (sessionId: string, guiType: "vnc" | "nomachine") => Promise<{ ok: boolean }>;
  sftpExtractZip: (sessionId: string, remotePath: string) => Promise<{ extracted: boolean; extractedPath?: string }>;
  sftpDelete: (sessionId: string, remotePath: string) => Promise<{ ok: boolean }>;
  sftpMkdir: (sessionId: string, remotePath: string) => Promise<{ ok: boolean }>;
  sftpRename: (sessionId: string, oldPath: string, newPath: string) => Promise<{ ok: boolean }>;
  sftpCreateFile: (sessionId: string, remotePath: string) => Promise<{ ok: boolean }>;
  sftpCopy: (sessionId: string, sourcePath: string, destPath: string) => Promise<{ ok: boolean }>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettings) => Promise<AppSettings>;
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
  downloadUpdate: () => Promise<{ ok: boolean }>;
  installUpdate: () => void;
  onUpdateEvent: (listener: (event: AppUpdateEvent) => void) => () => void;
  onSFTPSync: (listener: (event: SFTPSyncEvent) => void) => () => void;
  onSSHData: (listener: (event: SSHDataEvent) => void) => () => void;
  onSSHState: (listener: (event: SSHStateEvent) => void) => () => void;
  smdCheckStatus: (sessionId: string) => Promise<SmdCheckResult>;
  smdInstall: (sessionId: string, target: string) => Promise<SmdExecResult>;
  smdUninstall: (sessionId: string, target: string) => Promise<SmdExecResult>;
  smdSetDefaultDe: (sessionId: string, de: string) => Promise<SmdExecResult>;
}

const api: SecureApi = {
  connectSSH: (input) => ipcRenderer.invoke("connectSSH", input),
  saveHost: (host) => ipcRenderer.invoke("saveHost", host),
  getHosts: () => ipcRenderer.invoke("getHosts"),
  getHostById: (hostId) => ipcRenderer.invoke("getHostById", { hostId }),
  deleteHost: (hostId) => ipcRenderer.invoke("deleteHost", { hostId }),
  getHostLatency: (host, port, timeoutMs = 5000) => ipcRenderer.invoke("host:latency", { host, port, timeoutMs }),
  getPassword: (hostId) => ipcRenderer.invoke("getPassword", { hostId }),
  pickPrivateKey: () => ipcRenderer.invoke("pickPrivateKey"),
  generatePrivateKey: (name, replaceExistingPath) => ipcRenderer.invoke("generatePrivateKey", { name, replaceExistingPath }),
  installPublicKey: (host, port, username, password, publicKeyPath) => ipcRenderer.invoke("installPublicKey", { host, port, username, password, publicKeyPath }),
  readFileAsBase64: (path) => ipcRenderer.invoke("readFileAsBase64", { path }),
  writeFileFromBase64: (path, data) => ipcRenderer.invoke("writeFileFromBase64", { path, data }),
  deleteFile: (path) => ipcRenderer.invoke("deleteFile", { path }),
  sshWrite: (sessionId, data) => ipcRenderer.invoke("ssh:write", { sessionId, data }),
  sshResize: (sessionId, cols, rows) => ipcRenderer.invoke("ssh:resize", { sessionId, cols, rows }),
  sshExec: (sessionId, command) => ipcRenderer.invoke("ssh:exec", { sessionId, command }),
  sshWriteFile: (sessionId, remotePath, content) => ipcRenderer.invoke("ssh:writeFile", { sessionId, remotePath, content }),
  disconnectSSH: (sessionId) => ipcRenderer.invoke("ssh:disconnect", { sessionId }),
  reconnectSSH: (sessionId) => ipcRenderer.invoke("ssh:reconnect", { sessionId }),
  sftpList: (sessionId, path) => ipcRenderer.invoke("sftp:list", { sessionId, path }),
  sftpUpload: (sessionId, remoteDir) => ipcRenderer.invoke("sftp:upload", { sessionId, remoteDir }),
  sftpDownload: (sessionId, remotePath) => ipcRenderer.invoke("sftp:download", { sessionId, remotePath }),
  sftpEditInVSCode: (sessionId, remotePath) => ipcRenderer.invoke("sftp:editInVSCode", { sessionId, remotePath }),
  sftpOpenWorkspace: (sessionId, remotePath) => ipcRenderer.invoke("sftp:openWorkspace", { sessionId, remotePath }),
  sftpListWorkspaces: (sessionId) => ipcRenderer.invoke("sftp:listWorkspaces", { sessionId }),
  sftpDeleteWorkspace: (sessionId, remotePath) => ipcRenderer.invoke("sftp:deleteWorkspace", { sessionId, remotePath }),
  sftpOpenGuiConnection: (sessionId, guiType, guiPort, vncViewer, vncQuality) => ipcRenderer.invoke("sftp:openGuiConnection", { sessionId, guiType, guiPort, vncViewer, vncQuality }),
  sftpCloseGuiConnection: (sessionId, guiType) => ipcRenderer.invoke("sftp:closeGuiConnection", { sessionId, guiType }),
  sftpExtractZip: (sessionId, remotePath) => ipcRenderer.invoke("sftp:extractZip", { sessionId, remotePath }),
  sftpDelete: (sessionId, remotePath) => ipcRenderer.invoke("sftp:delete", { sessionId, remotePath }),
  sftpMkdir: (sessionId, remotePath) => ipcRenderer.invoke("sftp:mkdir", { sessionId, remotePath }),
  sftpRename: (sessionId, oldPath, newPath) => ipcRenderer.invoke("sftp:rename", { sessionId, oldPath, newPath }),
  sftpCreateFile: (sessionId, remotePath) => ipcRenderer.invoke("sftp:createFile", { sessionId, remotePath }),
  sftpCopy: (sessionId, sourcePath, destPath) => ipcRenderer.invoke("sftp:copy", { sessionId, sourcePath, destPath }),
  smdCheckStatus: (sessionId) => ipcRenderer.invoke("smd:checkStatus", { sessionId }),
  smdInstall: (sessionId, target) => ipcRenderer.invoke("smd:install", { sessionId, target }),
  smdUninstall: (sessionId, target) => ipcRenderer.invoke("smd:uninstall", { sessionId, target }),
  smdSetDefaultDe: (sessionId, de) => ipcRenderer.invoke("smd:setDefaultDe", { sessionId, de }),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings) => ipcRenderer.invoke("settings:update", settings),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  downloadUpdate: () => ipcRenderer.invoke("app:downloadUpdate"),
  installUpdate: () => ipcRenderer.send("app:installUpdate"),
  onUpdateEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppUpdateEvent): void => {
      listener(payload);
    };
    ipcRenderer.on("update:event", wrapped);
    return () => ipcRenderer.removeListener("update:event", wrapped);
  },
  onSFTPSync: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: SFTPSyncEvent): void => {
      listener(payload);
    };

    ipcRenderer.on("sftp:sync", wrapped);
    return () => ipcRenderer.removeListener("sftp:sync", wrapped);
  },
  onSSHData: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: SSHDataEvent): void => {
      listener(payload);
    };
    ipcRenderer.on("ssh:data", wrapped);
    return () => ipcRenderer.removeListener("ssh:data", wrapped);
  },
  onSSHState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: SSHStateEvent): void => {
      listener(payload);
    };
    ipcRenderer.on("ssh:state", wrapped);
    return () => ipcRenderer.removeListener("ssh:state", wrapped);
  }
};

contextBridge.exposeInMainWorld("api", api);
