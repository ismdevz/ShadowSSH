export type AuthMethod = "password" | "privateKey";
export type HostOS =
  | "ubuntu"
  | "debian"
  | "archlinux"
  | "fedora"
  | "opensuse"
  | "manjaro"
  | "kali"
  | "linuxmint"
  | "popos"
  | "rhel"
  | "centos"
  | "rocky"
  | "almalinux"
  | "alpine"
  | "gentoo"
  | "nixos"
  | "void"
  | "zorin"
  | "endeavouros"
  | "parrot"
  | "mx"
  | "linux"
  | "unknown";
export type AppTheme = "dark" | "light" | "onyx";
export type TerminalThemePreset = "oceanic" | "matrix" | "amber" | "nord" | "dracula" | "solarized" | "green" | "white";

export interface HostRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  sftpStartPath?: string;
  osType?: HostOS;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyAuthMethod?: AuthMethod;
  proxyPrivateKeyPath?: string;
  proxyPassword?: string;
  guiEnabled?: boolean;
  guiType?: "vnc" | "nomachine";
  guiPort?: number;
}

export interface HostInput {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  sftpStartPath?: string;
  password?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyAuthMethod?: AuthMethod;
  proxyPrivateKeyPath?: string;
  proxyPassword?: string;
  guiEnabled?: boolean;
  guiType?: "vnc" | "nomachine";
  guiPort?: number;
}

export interface ConnectSSHInput {
  hostId?: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyAuthMethod?: AuthMethod;
  proxyPassword?: string;
  proxyPrivateKeyPath?: string;
}

export interface SaveHostResult {
  host: HostRecord;
  savedCredential: boolean;
}

export interface SSHDataEvent {
  sessionId: string;
  data: string;
}

export interface SSHStateEvent {
  sessionId: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  message?: string;
}

export interface SFTPEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
}

export interface SFTPListResult {
  path: string;
  entries: SFTPEntry[];
}

export interface SFTPSyncEvent {
  sessionId: string;
  remotePath: string;
  localPath?: string;
  status: "watching" | "syncing" | "synced" | "error";
  message?: string;
}

export interface AppSettings {
  appTheme: AppTheme;
  terminalTheme: TerminalThemePreset;
  terminalFontSize: number;
  terminalFontFamily: string;
  editorCommand: string;
  workspaceEditorCommand: string;
  connectionTimeout: number;
  keepAliveInterval: number;
  autoReconnect: boolean;
  autoReconnectDelay: number;
  cursorBlink: boolean;
  scrollbackLines: number;
}

export interface GeneratedKeyResult {
  privateKeyPath: string;
  publicKeyPath: string;
}

export interface AppUpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  error?: string;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdateEvent {
  status: UpdateStatus;
  currentVersion?: string;
  latestVersion?: string;
  downloadProgress?: number;
  releaseNotes?: string;
  releaseUrl?: string;
  error?: string;
}

export interface HostLatencyResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface SshExecResult {
  output: string;
}

export interface SmdCheckResult {
  deType: string;
  deList?: string[];
  ramMB: number;
  vncInstalled: boolean;
  nxInstalled: boolean;
  hasGui: boolean;
  distro: string;
  packageManager: string;
}

export interface SmdExecResult {
  success: boolean;
  output: string;
}
