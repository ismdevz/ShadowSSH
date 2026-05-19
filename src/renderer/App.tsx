import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  AppSettings,
  AuthMethod,
  ConnectSSHInput,
  HostInput,
  HostLatencyResult,
  HostOS,
  HostRecord,
  SFTPEntry,
  SFTPSyncEvent,
  SSHDataEvent,
  SSHStateEvent
} from "../types/shared.js";
import type { SecureApi } from "../preload/preload.js";

declare global {
  interface Window {
    api: SecureApi;
  }
  const __APP_VERSION__: string;
}

type SessionStatus = SSHStateEvent["status"];
type SessionView = "terminal" | "sftp";
type NavView = "hosts" | "settings" | "backup" | "editor" | "connections" | "keys" | "info";

interface SessionMeta {
  sessionId: string;
  title: string;
  hostLabel: string;
  hostId?: string;
  profileName: string;
  view: SessionView;
  status: SessionStatus;
  statusMessage?: string;
}

interface TerminalRuntime {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
}

interface HostStats {
  cpu: string;
  cpus: string;
  mem: string;
  disk: string;
  net: string;
  fetchedAt: number;
  cpuPct: number;
  memPct: number;
  diskPct: number;
  cpuIdleTicks: number;
  cpuTotalTicks: number;
  coreIdleTicks: number[];
  coreTotalTicks: number[];
  coreUsage: number[];
  rxBytes: number;
  txBytes: number;
}

interface ConnectFormState {
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  sftpStartPath: string;
  saveHost: boolean;
  useProxy: boolean;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyAuthMethod: AuthMethod;
  proxyPassword: string;
  proxyPrivateKeyPath: string;
}

interface BackupHostRecord extends HostRecord {
  password?: string;
  proxyPassword?: string;
  privateKeyData?: string;  // base64 encoded private key file
}

type TerminalTheme = NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"];

const terminalThemes: Record<AppSettings["terminalTheme"], TerminalTheme> = {
  oceanic: {
    background: "#0b0f14",
    foreground: "#c5d1e5",
    cursor: "#6fd3ff",
    black: "#171c24",
    red: "#f27c7c",
    green: "#9fd480",
    yellow: "#f4d88a",
    blue: "#78a8ff",
    magenta: "#b290ff",
    cyan: "#6fd3ff",
    white: "#dbe6ff",
    brightBlack: "#3a465b",
    brightRed: "#ff9f9f",
    brightGreen: "#b7f29b",
    brightYellow: "#ffedab",
    brightBlue: "#9bc0ff",
    brightMagenta: "#cfb7ff",
    brightCyan: "#96e8ff",
    brightWhite: "#eef4ff"
  },
  matrix: {
    background: "#050805",
    foreground: "#9eff9e",
    cursor: "#ccffcc",
    black: "#0f1a0f",
    red: "#5f9f5f",
    green: "#9eff9e",
    yellow: "#c8ff91",
    blue: "#7ee57e",
    magenta: "#8cd88c",
    cyan: "#92f392",
    white: "#dcffdc",
    brightBlack: "#2a3b2a",
    brightRed: "#71bb71",
    brightGreen: "#b8ffb8",
    brightYellow: "#ddffb3",
    brightBlue: "#a8f8a8",
    brightMagenta: "#a8e9a8",
    brightCyan: "#b6ffb6",
    brightWhite: "#f1fff1"
  },
  amber: {
    background: "#1a1208",
    foreground: "#ffd28a",
    cursor: "#ffe0af",
    black: "#2a1c0f",
    red: "#b9784b",
    green: "#d6b265",
    yellow: "#ffd08a",
    blue: "#d09a58",
    magenta: "#e0b07a",
    cyan: "#e9c38f",
    white: "#ffe7c1",
    brightBlack: "#5e3f1f",
    brightRed: "#d18d5a",
    brightGreen: "#e7c177",
    brightYellow: "#ffdb9e",
    brightBlue: "#e0ae73",
    brightMagenta: "#efc694",
    brightCyan: "#f8d8aa",
    brightWhite: "#fff0d5"
  },
  nord: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#88c0d0",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#d08770",
    brightGreen: "#b5d19a",
    brightYellow: "#f0d49a",
    brightBlue: "#8fb2d0",
    brightMagenta: "#c6a7c0",
    brightCyan: "#9dd4df",
    brightWhite: "#eceff4"
  },
  dracula: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#ff79c6",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff"
  },
  solarized: {
    background: "#002b36",
    foreground: "#93a1a1",
    cursor: "#b58900",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#93a1a1",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3"
  },
  green: {
    background: "#030a03",
    foreground: "#a9f5a9",
    cursor: "#d5ffd5",
    black: "#0b160b",
    red: "#5da15d",
    green: "#8df58d",
    yellow: "#bbf0a1",
    blue: "#72cf72",
    magenta: "#8edb8e",
    cyan: "#9cf29c",
    white: "#d8ffd8",
    brightBlack: "#2d4a2d",
    brightRed: "#74bf74",
    brightGreen: "#b7ffb7",
    brightYellow: "#d0ffc0",
    brightBlue: "#9cf79c",
    brightMagenta: "#a9e9a9",
    brightCyan: "#beffbe",
    brightWhite: "#f0fff0"
  },
  white: {
    background: "#f7f7f7",
    foreground: "#1f1f1f",
    cursor: "#3b82f6",
    black: "#1f1f1f",
    red: "#b42318",
    green: "#067647",
    yellow: "#b54708",
    blue: "#175cd3",
    magenta: "#9e3f9f",
    cyan: "#0f6f8f",
    white: "#f4f4f5",
    brightBlack: "#525252",
    brightRed: "#d92d20",
    brightGreen: "#039855",
    brightYellow: "#dc6803",
    brightBlue: "#1570ef",
    brightMagenta: "#b04db0",
    brightCyan: "#0891b2",
    brightWhite: "#ffffff"
  }
};

const fontChoices = [
  "JetBrains Mono",
  "Fira Code",
  "Hack",
  "Cascadia Code",
  "Source Code Pro",
  "IBM Plex Mono",
  "Inconsolata",
  "Roboto Mono",
  "Space Mono",
  "Courier Prime",
  "Ubuntu Mono"
];

function FolderIcon(): ReactElement {
  return (
    <svg className="sftp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 4l2 2h8a2 2 0 012 2v2H2V6a2 2 0 012-2h6zm12 8v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6h20z"
      />
    </svg>
  );
}

function FileIcon(): ReactElement {
  return (
    <svg className="sftp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5z"
      />
    </svg>
  );
}

function HostsNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="8" rx="2"/>
      <rect x="2" y="14" width="20" height="8" rx="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/>
      <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  );
}

function SettingsNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  );
}

function BackupNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

function EditorNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>
  );
}

function ConnectionsNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}

function KeysNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5"/>
      <path d="M21 2l-9.6 9.6"/>
      <path d="M15.5 7.5l3 3L22 7l-3-3"/>
    </svg>
  );
}

function InfoNavIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

const defaultFormState: ConnectFormState = {
  name: "",
  host: "",
  port: 22,
  username: "",
  authMethod: "password",
  password: "",
  privateKeyPath: "",
  passphrase: "",
  sftpStartPath: "/",
  saveHost: true,
  useProxy: false,
  proxyHost: "",
  proxyPort: 22,
  proxyUsername: "",
  proxyAuthMethod: "password",
  proxyPassword: "",
  proxyPrivateKeyPath: ""
};

const defaultSettings: AppSettings = {
  appTheme: "dark",
  terminalTheme: "oceanic",
  terminalFontSize: 13,
  terminalFontFamily: "JetBrains Mono",
  editorCommand: "code",
  connectionTimeout: 30,
  keepAliveInterval: 10,
  autoReconnect: false,
  autoReconnectDelay: 15,
  cursorBlink: true,
  scrollbackLines: 1000
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function sanitizeSettings(input: AppSettings): AppSettings {
  return {
    ...input,
    terminalFontSize: clampInt(input.terminalFontSize, defaultSettings.terminalFontSize, 10, 28),
    connectionTimeout: clampInt(input.connectionTimeout, defaultSettings.connectionTimeout, 0, 300),
    keepAliveInterval: clampInt(input.keepAliveInterval, defaultSettings.keepAliveInterval, 0, 300),
    autoReconnectDelay: clampInt(input.autoReconnectDelay ?? 15, 15, 5, 300),
    scrollbackLines: clampInt(input.scrollbackLines, defaultSettings.scrollbackLines, 100, 50000)
  };
}

const iconBasePath = new URL("./os-icons/", window.location.href).toString();
const appLogoPath = `${iconBasePath}shadowssh-logo.png`;

const hostOsIconMap: Record<HostOS, { icon: string; label: string }> = {
  ubuntu: { icon: `${iconBasePath}ubuntu.svg`, label: "Ubuntu" },
  debian: { icon: `${iconBasePath}debian.svg`, label: "Debian" },
  archlinux: { icon: `${iconBasePath}archlinux.svg`, label: "Arch Linux" },
  fedora: { icon: `${iconBasePath}fedora.svg`, label: "Fedora" },
  opensuse: { icon: `${iconBasePath}opensuse.svg`, label: "openSUSE" },
  manjaro: { icon: `${iconBasePath}manjaro.svg`, label: "Manjaro" },
  kali: { icon: `${iconBasePath}kali.svg`, label: "Kali Linux" },
  linuxmint: { icon: `${iconBasePath}linuxmint.svg`, label: "Linux Mint" },
  popos: { icon: `${iconBasePath}popos.svg`, label: "Pop!_OS" },
  rhel: { icon: `${iconBasePath}rhel.svg`, label: "RHEL" },
  centos: { icon: `${iconBasePath}centos.svg`, label: "CentOS" },
  rocky: { icon: `${iconBasePath}rocky.svg`, label: "Rocky Linux" },
  almalinux: { icon: `${iconBasePath}almalinux.svg`, label: "AlmaLinux" },
  alpine: { icon: `${iconBasePath}alpine.svg`, label: "Alpine Linux" },
  gentoo: { icon: `${iconBasePath}gentoo.svg`, label: "Gentoo" },
  nixos: { icon: `${iconBasePath}nixos.svg`, label: "NixOS" },
  void: { icon: `${iconBasePath}void.svg`, label: "Void Linux" },
  zorin: { icon: `${iconBasePath}zorin.svg`, label: "Zorin OS" },
  endeavouros: { icon: `${iconBasePath}endeavouros.svg`, label: "EndeavourOS" },
  parrot: { icon: `${iconBasePath}parrot.svg`, label: "Parrot OS" },
  mx: { icon: `${iconBasePath}mx.svg`, label: "MX Linux" },
  linux: { icon: `${iconBasePath}linux.svg`, label: "Linux" },
  unknown: { icon: `${iconBasePath}linux.svg`, label: "Unknown Linux" }
};

function hostOsIcon(os?: HostOS): { icon: string; label: string } {
  if (!os) {
    return hostOsIconMap.unknown;
  }

  return hostOsIconMap[os] ?? hostOsIconMap.unknown;
}

function getParentPath(path: string): string {
  const clean = path.trim();
  if (!clean || clean === "." || clean === "/") {
    return clean || ".";
  }

  if (!clean.includes("/")) {
    return ".";
  }

  const normalized = clean.endsWith("/") ? clean.slice(0, -1) : clean;
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash <= 0) {
    return "/";
  }

  return normalized.slice(0, lastSlash);
}

function getHostLabel(input: ConnectSSHInput): string {
  return `${input.username}@${input.host}:${input.port}`;
}

function getSessionTitle(profileName: string, view: SessionView): string {
  return `${profileName} (${view === "sftp" ? "SFTP" : "Terminal"})`;
}

function formatModTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const date = new Date(unixSeconds * 1000);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 365) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return date.toLocaleDateString("en-US", { year: "2-digit", month: "short", day: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${(bytes / 1073741824).toFixed(1)}GB`;
}

function formatNetworkBandwidth(bytes: number): string {
  if (bytes < 1024) return `${bytes}B/s`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB/s`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB/s`;
  return `${(bytes / 1073741824).toFixed(1)}GB/s`;
}

function parseHostStats(output: string): HostStats {
  const lines = output.split("\n");
  const get = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    return line ? line.slice(key.length + 1).trim() : "";
  };

  const cpuIdleTicks = parseInt(get("CPU_IDLE_TICKS") || "0");
  const cpuTotalTicks = parseInt(get("CPU_TOTAL_TICKS") || "0");
  const coreLines = lines.filter((line) => line.startsWith("CPU_CORE:"));
  const coreIdleTicks: number[] = [];
  const coreTotalTicks: number[] = [];
  for (const line of coreLines) {
    const payload = line.slice("CPU_CORE:".length);
    const [idxText, idleText, totalText] = payload.split(",");
    const idx = parseInt(idxText || "", 10);
    const idle = parseInt(idleText || "", 10);
    const total = parseInt(totalText || "", 10);
    if (!Number.isFinite(idx) || idx < 0) {
      continue;
    }
    coreIdleTicks[idx] = Number.isFinite(idle) ? idle : 0;
    coreTotalTicks[idx] = Number.isFinite(total) ? total : 0;
  }

  const cpuPct = 0;
  const cpu = "?";
  const cpus = get("CPUS") || "?";

  const memTotal = parseInt(get("MEM_TOTAL") || "0");
  const memAvailableRaw = parseInt(get("MEM_AVAILABLE") || "0");
  const memFreeRaw = parseInt(get("MEM_FREE") || "0");
  const memAvailable = memAvailableRaw > 0 ? memAvailableRaw : memFreeRaw;
  const memUsed = memTotal > 0 ? Math.max(0, memTotal - memAvailable) : 0;
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
  const mem = memTotal > 0 ? `${(memUsed / 1048576).toFixed(2)} / ${(memTotal / 1048576).toFixed(2)} GB` : "?";

  const diskUsedNum = parseInt(get("DISK_USED") || "0");
  const diskTotalNum = parseInt(get("DISK_TOTAL") || "0");
  const diskPct = diskTotalNum > 0 ? Math.round((diskUsedNum / diskTotalNum) * 100) : 0;
  const diskUsed = get("DISK_USED") || "?";
  const diskTotal = get("DISK_TOTAL") || "?";
  const disk = `${diskUsed} / ${diskTotal} GB`;

  const rxBytes = parseInt(get("NET_RX") || "0");
  const txBytes = parseInt(get("NET_TX") || "0");
  const net = "↓0B/s ↑0B/s";

  return {
    cpu,
    cpus,
    mem,
    disk,
    net,
    fetchedAt: Date.now(),
    cpuPct,
    memPct,
    diskPct,
    cpuIdleTicks,
    cpuTotalTicks,
    coreIdleTicks,
    coreTotalTicks,
    coreUsage: coreTotalTicks.map(() => 0),
    rxBytes,
    txBytes
  };
}

function buildBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  if (!path || path === ".") return [{ label: "~", path: "." }];
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

export function App() {
  const [hosts, setHosts] = useState<HostRecord[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const [isModalOpen, setModalOpen] = useState(false);
  const [showHostPassword, setShowHostPassword] = useState(false);
  const [showHostPassphrase, setShowHostPassphrase] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [formState, setFormState] = useState<ConnectFormState>(defaultFormState);
  const [formStatus, setFormStatus] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [hostActionPending, setHostActionPending] = useState<{ hostId: string; action: "connect" | "sftp" } | null>(null);
  const [hostActionStatus, setHostActionStatus] = useState("");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const settingsRef = useRef<AppSettings>(defaultSettings);
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const sessionsRef = useRef<SessionMeta[]>([]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultSettings);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "exported">("idle");
  const [activeNav, setActiveNav] = useState<NavView>("hosts");
  const [hostStats, setHostStats] = useState<Map<string, HostStats>>(new Map());
  const [activeLatency, setActiveLatency] = useState<HostLatencyResult | null>(null);
  const [isFetchingActiveLatency, setFetchingActiveLatency] = useState(false);
  const [expandedCpuHostIds, setExpandedCpuHostIds] = useState<Set<string>>(new Set());
  const [fetchingStatsHostIds, setFetchingStatsHostIds] = useState<Set<string>>(new Set());
  const [openStatsHostIds, setOpenStatsHostIds] = useState<Set<string>>(new Set());
  const [isEncryptModalOpen, setEncryptModalOpen] = useState(false);
  const [encryptPasswordInput, setEncryptPasswordInput] = useState("");
  const [encryptMode, setEncryptMode] = useState<"export" | "import">("export");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<import("../types/shared.js").UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<{ latestVersion?: string; downloadProgress?: number; error?: string }>({});

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: "", message: "", onConfirm: () => {} });

  const showConfirm = (title: string, message: string, onConfirm: () => void): void => {
    setConfirmModal({ open: true, title, message, onConfirm });
  };

  const closeConfirm = (): void => {
    setConfirmModal((prev) => ({ ...prev, open: false }));
  };

  type KeyWizardStep = "idle" | "naming" | "generating" | "install" | "done";
  interface KeyWizardState {
    step: KeyWizardStep;
    keyName: string;
    privateKeyPath: string;
    publicKeyPath: string;
    installPassword: string;
    showInstallPass: boolean;
    installStatus: string;
    error: string;
  }
  const defaultKeyWizard: KeyWizardState = {
    step: "idle",
    keyName: "",
    privateKeyPath: "",
    publicKeyPath: "",
    installPassword: "",
    showInstallPass: false,
    installStatus: "",
    error: ""
  };
  const [keyWizard, setKeyWizard] = useState<KeyWizardState>(defaultKeyWizard);
  const patchWizard = (patch: Partial<KeyWizardState>): void => setKeyWizard((prev) => ({ ...prev, ...patch }));

  type ToastType = "success" | "error" | "info";
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: ToastType }[]>([]);
  const showToast = (msg: string, type: ToastType = "info"): void => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const [sftpPath, setSftpPath] = useState("/");
  const [sftpPathInput, setSftpPathInput] = useState("/");
  const [sftpStatus, setSftpStatus] = useState("Connect a session to use SFTP");
  const [sftpEntries, setSftpEntries] = useState<SFTPEntry[]>([]);
  const [selectedRemotePath, setSelectedRemotePath] = useState<string | null>(null);

  const editHostIdRef = useRef<string | null>(null);
  const submitModeRef = useRef<"connect" | "save">("connect");
  const backupFileRef = useRef<HTMLInputElement>(null);
  const pendingImportBufferRef = useRef<ArrayBuffer | null>(null);
  const paneRefs = useRef(new Map<string, HTMLDivElement>());
  const runtimes = useRef(new Map<string, TerminalRuntime>());
  const sftpPathBySession = useRef(new Map<string, string>());
  const fetchingStatsHostIdsRef = useRef(new Set<string>());
  const lastStatsPollAtRef = useRef(0);

  const sessionsById = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const session of sessions) {
      map.set(session.sessionId, session);
    }
    return map;
  }, [sessions]);

  const activeSession = activeSessionId ? sessionsById.get(activeSessionId) : undefined;
  const activeSessionHost = useMemo(() => {
    if (!activeSession?.hostId) {
      return null;
    }

    return hosts.find((host) => host.id === activeSession.hostId) ?? null;
  }, [activeSession, hosts]);

  const connectedHostIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.status === "connected" && session.hostId) {
        ids.add(session.hostId);
      }
    }
    return Array.from(ids);
  }, [sessions]);

  const refreshHosts = async (): Promise<void> => {
    const list = await window.api.getHosts();
    setHosts(list);
  };

  const fetchActiveLatency = useCallback(async (host: HostRecord): Promise<void> => {
    setFetchingActiveLatency(true);

    try {
      const latency = await window.api.getHostLatency(host.host, host.port, 5000);
      setActiveLatency(latency);
    } catch (error: unknown) {
      setActiveLatency({ ok: false, error: String(error instanceof Error ? error.message : error) });
    } finally {
      setFetchingActiveLatency(false);
    }
  }, []);

  const applyTerminalSettingsToRuntime = (runtime: TerminalRuntime, source: AppSettings): void => {
    const safe = sanitizeSettings(source);
    runtime.terminal.options.fontFamily = `${safe.terminalFontFamily}, ui-monospace, SFMono-Regular, Menlo, monospace`;
    runtime.terminal.options.fontSize = safe.terminalFontSize;
    runtime.terminal.options.theme = terminalThemes[safe.terminalTheme];
    runtime.terminal.options.cursorBlink = safe.cursorBlink;
    runtime.terminal.options.scrollback = safe.scrollbackLines;
    runtime.fitAddon.fit();
  };

  const refreshSftpForSession = async (sessionId: string, pathOverride?: string): Promise<void> => {
    const session = sessionsById.get(sessionId);
    if (!session) {
      setSftpStatus("Connect a session to use SFTP");
      setSftpPath(".");
      setSftpPathInput(".");
      setSftpEntries([]);
      return;
    }

    const path = (pathOverride ?? sftpPathBySession.current.get(sessionId) ?? ".").trim() || ".";
    setSftpPath(path);
    setSftpPathInput(path);
    setSftpStatus("Loading...");

    try {
      const result = await window.api.sftpList(sessionId, path);
      sftpPathBySession.current.set(sessionId, result.path);
      setSftpPath(result.path);
      setSftpPathInput(result.path);
      setSelectedRemotePath(null);
      setSftpStatus(`Path: ${result.path}`);
      setSftpEntries(result.entries);
    } catch (error: unknown) {
      setSftpStatus(`SFTP error: ${String(error instanceof Error ? error.message : error)}`);
      setSftpEntries([]);
    }
  };

  const refreshSftp = async (pathOverride?: string): Promise<void> => {
    if (!activeSessionId) {
      setSftpStatus("Connect a session to use SFTP");
      setSftpEntries([]);
      return;
    }

    await refreshSftpForSession(activeSessionId, pathOverride);
  };

  const createTerminalRuntime = (sessionId: string, element: HTMLDivElement): TerminalRuntime => {
    const safe = sanitizeSettings(settings);
    const terminal = new Terminal({
      cursorBlink: safe.cursorBlink,
      convertEol: true,
      fontFamily: `${safe.terminalFontFamily}, ui-monospace, SFMono-Regular, Menlo, monospace`,
      fontSize: safe.terminalFontSize,
      theme: terminalThemes[safe.terminalTheme],
      scrollback: safe.scrollbackLines
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    fitAddon.fit();

    terminal.onData((data: string) => {
      void window.api.sshWrite(sessionId, data).catch((error: unknown) => {
        terminal.writeln(`\r\n[shadowssh] input error: ${String(error)}`);
      });
    });

    return { terminal, fitAddon, element };
  };

  const connectWithPayload = async (
    payload: ConnectSSHInput,
    view: SessionView = "terminal",
    initialSftpPath = "/",
    profileName?: string
  ): Promise<void> => {
    const result = await window.api.connectSSH(payload);
    sftpPathBySession.current.set(result.sessionId, initialSftpPath.trim() || "/");
    const name = profileName ?? payload.host;
    const next: SessionMeta = {
      sessionId: result.sessionId,
      title: getSessionTitle(name, view),
      hostLabel: getHostLabel(payload),
      hostId: payload.hostId,
      profileName: name,
      view,
      status: "connected"
    };

    setSessions((prev) => [...prev, next]);
    setActiveSessionId(result.sessionId);
  };

  const connectToSavedHost = async (hostId: string, view: SessionView = "terminal"): Promise<void> => {
    const host = hosts.find((item) => item.id === hostId);
    if (!host) {
      return;
    }

    const payload: ConnectSSHInput = {
      hostId: host.id,
      host: host.host,
      port: host.port,
      username: host.username,
      authMethod: host.authMethod,
      privateKeyPath: host.privateKeyPath
    };

    if (host.proxyHost) {
      payload.proxyHost = host.proxyHost;
      payload.proxyPort = host.proxyPort;
      payload.proxyUsername = host.proxyUsername;
      payload.proxyAuthMethod = "password";
    }

    await connectWithPayload(payload, view, host.sftpStartPath ?? "/", host.name);
  };

  const removeSession = async (sessionId: string, disconnectRemote = true): Promise<void> => {
    const reconnectTimer = reconnectTimersRef.current.get(sessionId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimersRef.current.delete(sessionId);
    }

    if (disconnectRemote) {
      await window.api.disconnectSSH(sessionId);
    }

    const runtime = runtimes.current.get(sessionId);
    if (runtime) {
      runtime.terminal.dispose();
      runtimes.current.delete(sessionId);
    }

    paneRefs.current.delete(sessionId);
    sftpPathBySession.current.delete(sessionId);

    let nextActive: string | null = null;
    setSessions((prev) => {
      const remaining = prev.filter((item) => item.sessionId !== sessionId);
      nextActive = remaining[0]?.sessionId ?? null;
      return remaining;
    });

    setActiveSessionId((prev) => (prev === sessionId ? nextActive : prev));
  };

  const closeSessionsForHost = async (hostId: string): Promise<number> => {
    const targetSessionIds = sessionsRef.current
      .filter((session) => session.hostId === hostId)
      .map((session) => session.sessionId);

    for (const sessionId of targetSessionIds) {
      try {
        await removeSession(sessionId, true);
      } catch {
        await removeSession(sessionId, false);
      }
    }

    return targetSessionIds.length;
  };

  const handleDeleteHost = async (hostId: string): Promise<void> => {
    const host = hosts.find((item) => item.id === hostId);
    const hostName = host?.name ?? host?.host ?? "host";

    try {
      const closedSessionsCount = await closeSessionsForHost(hostId);
      await window.api.deleteHost(hostId);
      await refreshHosts();

      if (closedSessionsCount > 0) {
        showToast(`Deleted ${hostName} and closed ${closedSessionsCount} open session(s).`, "success");
      } else {
        showToast(`Deleted host profile: ${hostName}`, "success");
      }
    } catch (error: unknown) {
      const message = String(error instanceof Error ? error.message : error);
      setHostActionStatus(`Delete failed: ${message}`);
      showToast(`Delete failed: ${message}`, "error");
    }
  };

  const checkForUpdates = async (): Promise<void> => {
    if (updateStatus === "checking" || updateStatus === "downloading") {
      return;
    }

    setUpdateStatus("checking");
    setUpdateInfo({});

    try {
      const result = await window.api.checkForUpdates();
      if (!result.ok && result.error) {
        setUpdateStatus("error");
        setUpdateInfo({ error: result.error });
        showToast(`Update check failed: ${result.error}`, "error");
      }
      // success: status will be updated by onUpdateEvent listener
    } catch (error: unknown) {
      const message = String(error instanceof Error ? error.message : error);
      setUpdateStatus("error");
      setUpdateInfo({ error: message });
      showToast(`Update check failed: ${message}`, "error");
    }
  };

  const downloadUpdate = async (): Promise<void> => {
    try {
      setUpdateStatus("downloading");
      await window.api.downloadUpdate();
    } catch (error: unknown) {
      const message = String(error instanceof Error ? error.message : error);
      setUpdateStatus("error");
      setUpdateInfo((prev) => ({ ...prev, error: message }));
      showToast(`Download failed: ${message}`, "error");
    }
  };

  const installUpdate = (): void => {
    window.api.installUpdate();
  };

  useEffect(() => {
    void refreshHosts();
  }, []);

  useEffect(() => {
    const unlisten = window.api.onUpdateEvent((event) => {
      setUpdateStatus(event.status);
      setUpdateInfo({
        latestVersion: event.latestVersion,
        downloadProgress: event.downloadProgress,
        error: event.error
      });

      if (event.status === "available" && event.latestVersion) {
        showToast(`Update available: Version ${event.latestVersion.split(".")[0] ?? event.latestVersion}`, "info");
      } else if (event.status === "not-available") {
        showToast("You're up to date.", "success");
      } else if (event.status === "downloaded") {
        showToast("Update downloaded. Restart to install.", "success");
      } else if (event.status === "error" && event.error) {
        showToast(`Update error: ${event.error}`, "error");
      }
    });
    return unlisten;
  }, []);

  useEffect(() => {
    if (!activeSessionHost) {
      setActiveLatency(null);
      return;
    }

    void fetchActiveLatency(activeSessionHost);
    const timer = window.setInterval(() => {
      void fetchActiveLatency(activeSessionHost);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeSessionHost, fetchActiveLatency]);

  useEffect(() => {
    void window.api.getSettings().then((loaded: AppSettings) => {
      const safe = sanitizeSettings(loaded);
      setSettings(safe);
      setSettingsDraft(safe);
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.appTheme);
  }, [settings.appTheme]);

  useEffect(() => {
    if (sessions.length === 0) {
      if (activeSessionId !== null) {
        setActiveSessionId(null);
      }
      return;
    }

    if (!activeSessionId || !sessionsById.has(activeSessionId)) {
      setActiveSessionId(sessions[0].sessionId);
    }
  }, [activeSessionId, sessions, sessionsById]);

  useEffect(() => {
    for (const session of sessions) {
      if (runtimes.current.has(session.sessionId)) {
        continue;
      }

      const element = paneRefs.current.get(session.sessionId);
      if (!element) {
        continue;
      }

      const runtime = createTerminalRuntime(session.sessionId, element);
      applyTerminalSettingsToRuntime(runtime, settings);
      runtimes.current.set(session.sessionId, runtime);
      runtime.terminal.writeln(`[shadowssh] connecting to ${session.hostLabel}...`);
    }
  }, [sessions, settings]);

  useEffect(() => {
    for (const runtime of runtimes.current.values()) {
      applyTerminalSettingsToRuntime(runtime, settings);
    }
  }, [settings]);

  useEffect(() => {
    for (const session of sessions) {
      const runtime = runtimes.current.get(session.sessionId);
      if (!runtime) {
        continue;
      }

      if (session.sessionId === activeSessionId) {
        runtime.fitAddon.fit();
        void window.api.sshResize(session.sessionId, runtime.terminal.cols, runtime.terminal.rows);
      }
    }

    if (activeSession?.view === "sftp") {
      void refreshSftp();
    }
  }, [activeSessionId, activeSession?.view]);

  useEffect(() => {
    const offSync = window.api.onSFTPSync((event: SFTPSyncEvent) => {
      if (event.sessionId !== activeSessionId) {
        return;
      }

      if (activeSession?.view !== "sftp") {
        return;
      }

      setSftpStatus(event.message ?? `SFTP sync: ${event.status}`);
    });

    return () => {
      offSync();
    };
  }, [activeSessionId, activeSession?.view]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const offData = window.api.onSSHData((event: SSHDataEvent) => {
      const runtime = runtimes.current.get(event.sessionId);
      if (!runtime) {
        return;
      }

      runtime.terminal.write(event.data);
    });

    const offState = window.api.onSSHState((event: SSHStateEvent) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.sessionId !== event.sessionId) {
            return session;
          }

          return {
            ...session,
            status: event.status,
            statusMessage: event.message
          };
        })
      );

      const runtime = runtimes.current.get(event.sessionId);
      if (!runtime) {
        return;
      }

      if (event.status === "connected") {
        runtime.terminal.writeln("\r\n[shadowssh] connected.");
        void window.api.sshResize(event.sessionId, runtime.terminal.cols, runtime.terminal.rows);
        if (activeSessionId === event.sessionId && activeSession?.view === "sftp") {
          void refreshSftp();
        }
      }

      if (event.status === "error") {
        runtime.terminal.writeln(`\r\n[shadowssh] ${event.message ?? "unknown connection error"}`);
      }

      if (event.status === "disconnected") {
        runtime.terminal.writeln(`\r\n[shadowssh] disconnected${event.message ? `: ${event.message}` : ""}`);
      }

      // Auto-reconnect logic
      if (event.status === "error" || event.status === "disconnected") {
        const session = sessionsRef.current.find(s => s.sessionId === event.sessionId);
        if (session && session.hostId && settingsRef.current.autoReconnect) {
          const delay = (settingsRef.current.autoReconnectDelay ?? 15) * 1000;
          runtime.terminal.writeln(`\r\n[shadowssh] Auto-reconnecting in ${delay / 1000}s...`);
          
          if (reconnectTimersRef.current.has(event.sessionId)) {
            clearTimeout(reconnectTimersRef.current.get(event.sessionId));
          }
          
          const timerId = setTimeout(() => {
            reconnectTimersRef.current.delete(event.sessionId);
            runtime.terminal.writeln(`\r\n[shadowssh] Attempting reconnect...`);
            void window.api.reconnectSSH(event.sessionId);
          }, delay);
          reconnectTimersRef.current.set(event.sessionId, timerId);
        }
      }
    });

    return () => {
      offData();
      offState();
    };
  }, [activeSessionId, activeSession?.view]);

  useEffect(() => {
    const onResize = (): void => {
      for (const [sessionId, runtime] of runtimes.current) {
        runtime.fitAddon.fit();
        void window.api.sshResize(sessionId, runtime.terminal.cols, runtime.terminal.rows);
      }
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const openCreateModal = (): void => {
    editHostIdRef.current = null;
    setFormState(defaultFormState);
    setShowHostPassword(false);
    setShowHostPassphrase(false);
    setShowProxyPassword(false);
    setFormStatus("");
    setKeyWizard(defaultKeyWizard);
    setModalOpen(true);
  };

  const openEditModal = async (host: HostRecord): Promise<void> => {
    editHostIdRef.current = host.id;
    const password = host.authMethod === "password" ? await window.api.getPassword(host.id) : "";
    const proxyPassword = await window.api.getPassword(`${host.id}-proxy`);

    setFormState({
      name: host.name,
      host: host.host,
      port: host.port,
      username: host.username,
      authMethod: host.authMethod,
      password: password ?? "",
      privateKeyPath: host.privateKeyPath ?? "",
      passphrase: "",
      sftpStartPath: host.sftpStartPath ?? "/",
      saveHost: true,
      useProxy: Boolean(host.proxyHost),
      proxyHost: host.proxyHost ?? "",
      proxyPort: host.proxyPort ?? 22,
      proxyUsername: host.proxyUsername ?? "",
      proxyAuthMethod: "password",
      proxyPassword: proxyPassword ?? "",
      proxyPrivateKeyPath: ""
    });
    setShowHostPassword(false);
    setShowHostPassphrase(false);
    setShowProxyPassword(false);
    setFormStatus("");
    setKeyWizard(defaultKeyWizard);
    setModalOpen(true);
  };

  const updateForm = (patch: Partial<ConnectFormState>): void => {
    setFormState((prev) => ({ ...prev, ...patch }));
  };

  const handlePickKey = async (target: "host" | "proxy" = "host"): Promise<void> => {
    const file = await window.api.pickPrivateKey();
    if (!file) {
      return;
    }

    updateForm(target === "proxy" ? { proxyPrivateKeyPath: file } : { privateKeyPath: file });
  };

  const openKeyWizard = (): void => {
    setKeyWizard({ ...defaultKeyWizard, step: "naming", keyName: formState.name.trim() || "" });
  };

  const runKeyGeneration = async (): Promise<void> => {
    patchWizard({ step: "generating", error: "" });
    try {
      const name = keyWizard.keyName.trim() || undefined;
      const generated = await window.api.generatePrivateKey(name, formState.privateKeyPath || undefined);
      updateForm({ authMethod: "privateKey", privateKeyPath: generated.privateKeyPath });
      patchWizard({
        step: "install",
        privateKeyPath: generated.privateKeyPath,
        publicKeyPath: generated.publicKeyPath,
        installPassword: formState.password || ""
      });
    } catch (error: unknown) {
      patchWizard({ step: "naming", error: String(error instanceof Error ? error.message : error) });
    }
  };

  const runInstallPublicKey = async (): Promise<void> => {
    if (!formState.host || !formState.username) {
      patchWizard({ installStatus: "No host/username configured — skipping install.", step: "done" });
      return;
    }
    patchWizard({ installStatus: "Connecting and installing key...", error: "" });
    try {
      await window.api.installPublicKey(
        formState.host,
        formState.port || 22,
        formState.username,
        keyWizard.installPassword,
        keyWizard.publicKeyPath
      );
      updateForm({ password: "" });
      patchWizard({ step: "done", installStatus: "Public key installed successfully! You can now connect with the private key." });
    } catch (error: unknown) {
      patchWizard({ installStatus: "", error: String(error instanceof Error ? error.message : error) });
    }
  };

  const handleGenerateKeyForNewHost = (): void => {
    const base = { ...defaultFormState, authMethod: "privateKey" as AuthMethod };
    setFormState(base);
    setModalOpen(true);
    setKeyWizard({ ...defaultKeyWizard, step: "naming" });
  };

  const submitModal = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    try {
      setSubmitting(true);
      setFormStatus("");
      const isEditing = Boolean(editHostIdRef.current);

      const hostInput: HostInput = {
        id: editHostIdRef.current ?? undefined,
        name: formState.name.trim(),
        host: formState.host.trim(),
        port: formState.port,
        username: formState.username.trim(),
        authMethod: formState.authMethod,
        privateKeyPath: formState.privateKeyPath.trim() || undefined,
        sftpStartPath: formState.sftpStartPath.trim() || "/",
        password: formState.authMethod === "password" ? formState.password : undefined,
        proxyHost: formState.useProxy ? formState.proxyHost.trim() : undefined,
        proxyPort: formState.useProxy ? formState.proxyPort : undefined,
        proxyUsername: formState.useProxy ? formState.proxyUsername.trim() : undefined,
        proxyAuthMethod: formState.useProxy ? "password" : undefined,
        proxyPassword: formState.useProxy ? formState.proxyPassword : undefined,
        proxyPrivateKeyPath: undefined
      };

      let connectHostId: string | undefined;
      if (isEditing || formState.saveHost) {
        const saved = await window.api.saveHost(hostInput);
        connectHostId = saved.host.id;
        await refreshHosts();

        if (isEditing) {
          setModalOpen(false);
          return;
        }
      }

      const payload: ConnectSSHInput = {
        hostId: connectHostId,
        host: formState.host.trim(),
        port: formState.port,
        username: formState.username.trim(),
        authMethod: formState.authMethod
      };

      if (payload.authMethod === "password") {
        payload.password = formState.password;
      } else {
        payload.privateKeyPath = formState.privateKeyPath.trim();
        if (formState.passphrase.trim()) {
          payload.passphrase = formState.passphrase;
        }
      }

      if (formState.useProxy && formState.proxyHost.trim()) {
        payload.proxyHost = formState.proxyHost.trim();
        payload.proxyPort = formState.proxyPort;
        payload.proxyUsername = formState.proxyUsername.trim();
        payload.proxyAuthMethod = "password";
        payload.proxyPassword = formState.proxyPassword;
      }

      await connectWithPayload(
        payload,
        "terminal",
        formState.sftpStartPath.trim() || "/",
        formState.name.trim() || formState.host.trim()
      );
      setModalOpen(false);
    } catch (error: unknown) {
      setFormStatus(String(error instanceof Error ? error.message : error));
    } finally {
      setSubmitting(false);
    }
  };

  const onHostAction = async (action: "connect" | "sftp" | "delete", hostId: string): Promise<void> => {
    if (action === "delete") {
      const host = hosts.find((item) => item.id === hostId);
      const hostName = host?.name ?? host?.host ?? "this host";
      showConfirm(
        "Delete Host",
        `Delete \"${hostName}\" and its stored credentials? Any open sessions for this host will be closed.`,
        () => {
          void handleDeleteHost(hostId);
        }
      );
      return;
    }

    try {
      const host = hosts.find((item) => item.id === hostId);
      const hostName = host?.name ?? host?.host ?? "host";
      setHostActionPending({ hostId, action });
      setHostActionStatus(
        action === "sftp" ? `Connecting to SFTP on ${hostName}...` : `Connecting to ${hostName}...`
      );

      await connectToSavedHost(hostId, action === "sftp" ? "sftp" : "terminal");
      setHostActionStatus(`Connected: ${hostName}`);
    } catch (error: unknown) {
      const message = String(error instanceof Error ? error.message : error);
      showToast(`${action.toUpperCase()} failed: ${message}`, "error");
      setHostActionStatus(`Connection failed: ${message}`);
    } finally {
      setHostActionPending(null);
    }
  };

  const saveSettings = async (): Promise<void> => {
    try {
      setSaveStatus("saving");
      const payload = sanitizeSettings(settingsDraft);
      const saved = sanitizeSettings(await window.api.updateSettings(payload));
      setSettings(saved);
      setSettingsDraft(saved);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  };

  const switchSessionView = (sessionId: string, view: SessionView): void => {
    setActiveSessionId(sessionId);
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId
          ? { ...s, view, title: getSessionTitle(s.profileName, view) }
          : s
      )
    );
    if (view === "sftp") {
      void refreshSftpForSession(sessionId);
    }
  };

  const fetchHostStats = useCallback(async (hostId: string): Promise<void> => {
    if (fetchingStatsHostIdsRef.current.has(hostId)) {
      return;
    }

    const connected = sessions.find((s) => s.hostId === hostId && s.status === "connected");
    if (!connected) return;

    setFetchingStatsHostIds((prev) => {
      const next = new Set(prev);
      next.add(hostId);
      fetchingStatsHostIdsRef.current = next;
      return next;
    });
    try {
      const cmd = [
        'echo "CPUS:$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)"',
        'awk \'/^cpu /{idle=$5+$6;total=0;for(i=2;i<=9;i++)total+=$i;printf "CPU_IDLE_TICKS:%.0f\\nCPU_TOTAL_TICKS:%.0f\\n",idle,total;exit}\' /proc/stat 2>/dev/null',
        'awk \'/^cpu[0-9]+ /{idx=substr($1,4);idle=$5+$6;total=0;for(i=2;i<=9;i++)total+=$i;printf "CPU_CORE:%s,%.0f,%.0f\\n",idx,idle,total}\' /proc/stat 2>/dev/null',
        'awk \'/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}/^MemFree:/{f=$2}END{if(a=="")a=f;printf "MEM_TOTAL:%d\\nMEM_AVAILABLE:%d\\nMEM_FREE:%d\\n",t,a,f}\' /proc/meminfo 2>/dev/null',
        'df -BG / 2>/dev/null | awk \'NR==2{sub(/G/,"",$3);sub(/G/,"",$2);printf "DISK_USED:%s\\nDISK_TOTAL:%s\\n",$3,$2}\'',
        'cat /proc/net/dev 2>/dev/null | awk \'NR>2&&$1!="lo:"{rx+=$2;tx+=$10}END{printf "NET_RX:%.0f\\nNET_TX:%.0f\\n",rx,tx}\''
      ].join("; ");

      const { output } = await window.api.sshExec(connected.sessionId, cmd);
      const parsed = parseHostStats(output);
      setHostStats((prev) => {
        const next = new Map(prev);
        const previous = prev.get(hostId);
        const stats = { ...parsed };

        if (previous) {
          const elapsedSec = Math.max(0.001, (stats.fetchedAt - previous.fetchedAt) / 1000);

          const totalDelta = Math.max(0, stats.cpuTotalTicks - previous.cpuTotalTicks);
          const idleDelta = Math.max(0, stats.cpuIdleTicks - previous.cpuIdleTicks);
          if (totalDelta > 0) {
            const pct = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
            stats.cpuPct = pct;
            stats.cpu = `${pct.toFixed(1)}%`;
          }

          const coreLen = Math.max(stats.coreTotalTicks.length, previous.coreTotalTicks.length);
          const coreUsage: number[] = [];
          for (let i = 0; i < coreLen; i += 1) {
            const totalNow = stats.coreTotalTicks[i] ?? 0;
            const totalPrev = previous.coreTotalTicks[i] ?? 0;
            const idleNow = stats.coreIdleTicks[i] ?? 0;
            const idlePrev = previous.coreIdleTicks[i] ?? 0;
            const total = Math.max(0, totalNow - totalPrev);
            const idle = Math.max(0, idleNow - idlePrev);
            const pct = total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0;
            coreUsage[i] = pct;
          }
          stats.coreUsage = coreUsage;

          const rxDelta = Math.max(0, stats.rxBytes - previous.rxBytes);
          const txDelta = Math.max(0, stats.txBytes - previous.txBytes);
          stats.net = `↓${formatNetworkBandwidth(rxDelta / elapsedSec)} ↑${formatNetworkBandwidth(txDelta / elapsedSec)}`;
        }

        next.set(hostId, stats);
        return next;
      });
    } catch {
      // ignore stat failures silently
    } finally {
      setFetchingStatsHostIds((prev) => {
        const next = new Set(prev);
        next.delete(hostId);
        fetchingStatsHostIdsRef.current = next;
        return next;
      });
    }
  }, [sessions]);

  useEffect(() => {
    setOpenStatsHostIds((prev) => {
      const connected = new Set(connectedHostIds);
      const next = new Set(Array.from(prev).filter((hostId) => connected.has(hostId)));
      return next.size === prev.size ? prev : next;
    });
  }, [connectedHostIds]);

  useEffect(() => {
    setExpandedCpuHostIds((prev) => {
      const connected = new Set(connectedHostIds);
      const next = new Set(Array.from(prev).filter((hostId) => connected.has(hostId)));
      return next.size === prev.size ? prev : next;
    });
  }, [connectedHostIds]);

  useEffect(() => {
    const activeHosts = connectedHostIds.filter((hostId) => openStatsHostIds.has(hostId));
    if (activeHosts.length === 0) {
      return;
    }

    // Use an animation-frame scheduler instead of setInterval.
    lastStatsPollAtRef.current = 0;
    let rafId = 0;

    const tick = (now: number): void => {
      if (now - lastStatsPollAtRef.current >= 1000) {
        lastStatsPollAtRef.current = now;
        for (const hostId of activeHosts) {
          void fetchHostStats(hostId);
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [connectedHostIds, openStatsHostIds, fetchHostStats]);

  const exportBackup = (): void => {
    setEncryptMode("export");
    setEncryptPasswordInput("");
    setEncryptModalOpen(true);
  };

  const buildBackupHosts = async (list: HostRecord[]): Promise<BackupHostRecord[]> => {
    return Promise.all(
      list.map(async (host) => {
        const item: BackupHostRecord = { ...host };

        if (host.authMethod === "password") {
          const password = await window.api.getPassword(host.id);
          if (password) {
            item.password = password;
          }
        }

        if (host.authMethod === "privateKey" && host.privateKeyPath) {
          try {
            item.privateKeyData = await window.api.readFileAsBase64(host.privateKeyPath);
          } catch {
            // key file may not exist, skip silently
          }
        }

        if (host.proxyHost && host.proxyAuthMethod === "password") {
          const proxyPassword = await window.api.getPassword(`${host.id}-proxy`);
          if (proxyPassword) {
            item.proxyPassword = proxyPassword;
          }
        }

        return item;
      })
    );
  };

  const importBackupHosts = async (imported: BackupHostRecord[]): Promise<void> => {
    for (const h of imported) {
      await window.api.saveHost({
        id: h.id,
        name: h.name,
        host: h.host,
        port: h.port,
        username: h.username,
        authMethod: h.authMethod,
        privateKeyPath: h.privateKeyPath,
        sftpStartPath: h.sftpStartPath,
        password: h.authMethod === "password" ? h.password : undefined,
        proxyHost: h.proxyHost,
        proxyPort: h.proxyPort,
        proxyUsername: h.proxyUsername,
        proxyAuthMethod: h.proxyAuthMethod,
        proxyPrivateKeyPath: h.proxyPrivateKeyPath,
        proxyPassword: h.proxyAuthMethod === "password" ? h.proxyPassword : undefined
      });
      if (h.authMethod === "privateKey" && h.privateKeyPath && h.privateKeyData) {
        try {
          await window.api.writeFileFromBase64(h.privateKeyPath, h.privateKeyData);
        } catch {
          // best-effort key restore
        }
      }
    }
  };

  const doExportBackup = async (password: string): Promise<void> => {
    try {
      setExportStatus("exporting");
      const list = await window.api.getHosts();
      const backupHosts = await buildBackupHosts(list);
      const data = JSON.stringify({ version: 3, hosts: backupHosts }, null, 2);
      const enc = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(data));
      const result = new Uint8Array(4 + 16 + 12 + encrypted.byteLength);
      result.set([0x53, 0x53, 0x48, 0x45]);
      result.set(salt, 4);
      result.set(iv, 20);
      result.set(new Uint8Array(encrypted), 32);
      const blob = new Blob([result.buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shadowssh-backup-${new Date().toISOString().slice(0, 10)}.enc`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Exported and encrypted successfully", "success");
      setExportStatus("exported");
      setTimeout(() => setExportStatus("idle"), 2000);
    } catch (err: unknown) {
      showToast(`Export failed: ${String(err instanceof Error ? err.message : err)}`, "error");
      setExportStatus("idle");
    }
  };

  const doImportBackup = async (password: string): Promise<void> => {
    const buffer = pendingImportBufferRef.current;
    if (!buffer) return;
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x53 || bytes[1] !== 0x53 || bytes[2] !== 0x48 || bytes[3] !== 0x45) {
      showToast("Invalid encrypted backup file", "error");
      return;
    }
    try {
      const salt = bytes.slice(4, 20);
      const iv = bytes.slice(20, 32);
      const data = bytes.slice(32);
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
      const text = new TextDecoder().decode(decrypted);
      const parsed = JSON.parse(text) as { version?: number; hosts?: BackupHostRecord[] };
      const imported: BackupHostRecord[] = Array.isArray(parsed) ? parsed : (parsed.hosts ?? []);
      await importBackupHosts(imported);
      await refreshHosts();
      showToast(`Imported ${imported.length} host${imported.length !== 1 ? "s" : ""} from encrypted backup`, "success");
      pendingImportBufferRef.current = null;
    } catch {
      showToast("Decryption failed: wrong password or corrupt file", "error");
    }
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isEncrypted = file.name.endsWith(".enc");

    if (isEncrypted) {
      const reader = new FileReader();
      reader.onload = (e): void => {
        pendingImportBufferRef.current = e.target?.result as ArrayBuffer;
        setEncryptMode("import");
        setEncryptPasswordInput("");
        setEncryptModalOpen(true);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = async (e): Promise<void> => {
        try {
          const text = e.target?.result as string;
          const parsed = JSON.parse(text) as { version?: number; hosts?: BackupHostRecord[] };
          const imported: BackupHostRecord[] = Array.isArray(parsed) ? parsed : (parsed.hosts ?? []);
          await importBackupHosts(imported);
          await refreshHosts();
          showToast(`Imported ${imported.length} host${imported.length !== 1 ? "s" : ""}`, "success");
        } catch (err: unknown) {
          showToast(`Import failed: ${String(err instanceof Error ? err.message : err)}`, "error");
        }
      };
      reader.readAsText(file);
    }
    event.target.value = "";
  };

  const saveHostOnly = async (): Promise<void> => {
    const n = formState.name.trim();
    const h = formState.host.trim();
    const u = formState.username.trim();
    if (!n || !h || !u) {
      setFormStatus("Name, host, and username are required");
      return;
    }
    if (formState.authMethod === "password" && !formState.password) {
      setFormStatus("Password is required");
      return;
    }
    if (formState.authMethod === "privateKey" && !formState.privateKeyPath.trim()) {
      setFormStatus("Private key path is required");
      return;
    }
    try {
      setSubmitting(true);
      setFormStatus("");
      await window.api.saveHost({
        id: editHostIdRef.current ?? undefined,
        name: n,
        host: h,
        port: formState.port,
        username: u,
        authMethod: formState.authMethod,
        privateKeyPath: formState.privateKeyPath.trim() || undefined,
        sftpStartPath: formState.sftpStartPath.trim() || "/",
        password: formState.authMethod === "password" ? formState.password : undefined
      });
      await refreshHosts();
      setModalOpen(false);
    } catch (err: unknown) {
      setFormStatus(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  const onSftpDownload = async (remotePath: string): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Downloading...");
    try {
      const result = await window.api.sftpDownload(activeSessionId, remotePath);
      if (!result.saved) {
        setSftpStatus("Download cancelled");
        return;
      }

      setSftpStatus(`Downloaded to: ${result.localPath ?? "local path"}`);
    } catch (error: unknown) {
      setSftpStatus(`Download failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  };

  const onSftpUpload = async (): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    const remoteDir = (sftpPathBySession.current.get(activeSessionId) ?? ".").trim() || ".";
    setSftpStatus("Uploading...");

    try {
      const result = await window.api.sftpUpload(activeSessionId, remoteDir);
      if (!result.uploaded) {
        setSftpStatus("Upload cancelled");
        return;
      }

      setSftpStatus(`Uploaded: ${result.remotePath ?? "file"}`);
      await refreshSftp(remoteDir);
    } catch (error: unknown) {
      setSftpStatus(`Upload failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  };

  const onSftpEditFile = async (remotePath: string): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Opening in editor...");
    try {
      const result = await window.api.sftpEditInVSCode(activeSessionId, remotePath);
      if (!result.opened) {
        setSftpStatus("Open cancelled");
        return;
      }

      setSftpStatus(`Opened in editor: ${result.localPath ?? "temp file"}`);
    } catch (error: unknown) {
      setSftpStatus(`Open failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  };

  const onSftpExtractZip = async (remotePath: string): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Extracting ZIP...");
    try {
      const result = await window.api.sftpExtractZip(activeSessionId, remotePath);
      if (!result.extracted) {
        setSftpStatus("Extraction cancelled");
        return;
      }

      setSftpStatus(`Extracted to: ${result.extractedPath ?? "current directory"}`);
      const remoteDir = (sftpPathBySession.current.get(activeSessionId) ?? ".").trim() || ".";
      await refreshSftp(remoteDir);
    } catch (error: unknown) {
      setSftpStatus(`Extraction failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  };

  const navItems: Array<{ id: NavView; label: string; icon: ReactElement }> = [
    { id: "hosts", label: "Hosts", icon: <HostsNavIcon /> },
    { id: "connections", label: "Sessions", icon: <ConnectionsNavIcon /> },
    { id: "settings", label: "Settings", icon: <SettingsNavIcon /> },
    { id: "backup", label: "Backup", icon: <BackupNavIcon /> },
    { id: "editor", label: "Editor", icon: <EditorNavIcon /> },
    { id: "keys", label: "Keys", icon: <KeysNavIcon /> },
    { id: "info", label: "Info", icon: <InfoNavIcon /> }
  ];

  return (
    <div className={`shell ${isSidebarOpen ? "" : "sidebar-closed"}`}>
      <nav className="nav-rail">
        <div className="nav-brand" title="ShadowSSH">
          <span className="nav-brand-fallback">S</span>
          <img
            className="nav-brand-logo"
            src={appLogoPath}
            alt="ShadowSSH"
          />
        </div>
        {navItems.map(({ id, label, icon }) => (
          <button
            type="button"
            key={id}
            className={`nav-item ${activeNav === id ? "active" : ""}`}
            onClick={() => setActiveNav(id)}
            title={label}
          >
            {icon}
            <span className="nav-item-label">{label}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="nav-item"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          title="Toggle Sidebar"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </nav>

      {isSidebarOpen && (
        <aside className="sidebar">
        {activeNav === "hosts" && (
          <>
            <div className="sidebar-top">
              <h1 className="app-title">
                <img
                  className="app-title-logo"
                  src={appLogoPath}
                  alt="ShadowSSH"
                />
                <span>ShadowSSH</span>
              </h1>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" className="ghost-btn small" onClick={openCreateModal}>+ New</button>
                <button type="button" className="ghost-btn small" title="Refresh" onClick={() => void refreshHosts()}>↻</button>
              </div>
            </div>
            <div className="sidebar-subtitle">Saved Hosts</div>
            <div id="hosts-list" className="hosts-list">
          {hosts.length === 0 ? (
            <div className="host-empty">No saved hosts yet</div>
          ) : (
            hosts.map((host) => {
              const osInfo = hostOsIcon(host.osType);
              const isConnected = sessions.some((s) => s.hostId === host.id && s.status === "connected");
              const isFetchingStats = fetchingStatsHostIds.has(host.id);
              const isStatsOpen = openStatsHostIds.has(host.id);
              const isCpuExpanded = expandedCpuHostIds.has(host.id);
              const stats = hostStats.get(host.id);

              return (
                <div className="host-item" key={host.id}>
                  <div className="host-main">
                    <div className="host-name">
                      <img
                        className="os-dot"
                        src={osInfo.icon}
                        alt={osInfo.label}
                        title={osInfo.label}
                        onError={(event) => {
                          event.currentTarget.src = hostOsIconMap.linux.icon;
                        }}
                      />
                      {host.name}
                    </div>
                    <div className="host-meta">{host.username}@{host.host}:{host.port}</div>
                  </div>
                  <div className="host-actions">
                  <button
                    type="button"
                    className={`ghost-btn small ${
                      hostActionPending?.hostId === host.id && hostActionPending.action === "connect" ? "is-working" : ""
                    }`}
                    disabled={Boolean(hostActionPending)}
                    onClick={() => void onHostAction("connect", host.id)}
                  >
                    {hostActionPending?.hostId === host.id && hostActionPending.action === "connect"
                      ? `Connecting ${host.name}...`
                      : "Connect"}
                  </button>
                  <button
                    type="button"
                    className={`ghost-btn small ${
                      hostActionPending?.hostId === host.id && hostActionPending.action === "sftp" ? "is-working" : ""
                    }`}
                    disabled={Boolean(hostActionPending)}
                    onClick={() => void onHostAction("sftp", host.id)}
                  >
                    {hostActionPending?.hostId === host.id && hostActionPending.action === "sftp"
                      ? `Connecting SFTP...`
                      : "SFTP"}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn small"
                    disabled={Boolean(hostActionPending)}
                    onClick={() => void openEditModal(host)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost-btn small danger"
                    disabled={Boolean(hostActionPending)}
                    onClick={() => void onHostAction("delete", host.id)}
                  >
                    Del
                  </button>
                  {isConnected && (
                    <>
                      <button
                        type="button"
                        className={`ghost-btn small host-stats-toggle ${isFetchingStats ? "is-working" : ""}`}
                        onClick={() => {
                          if (isStatsOpen) {
                            setOpenStatsHostIds((prev) => {
                              const next = new Set(prev);
                              next.delete(host.id);
                              return next;
                            });
                            return;
                          }

                          setOpenStatsHostIds((prev) => {
                            const next = new Set(prev);
                            next.add(host.id);
                            return next;
                          });
                          void fetchHostStats(host.id);
                        }}
                      >
                        {isStatsOpen ? "Close" : "Stats"}
                      </button>
                      <span className="stats-live-pill">Real-time</span>
                    </>
                  )}
                  </div>
                  {isStatsOpen && !stats ? (
                    <div className="host-stats">
                      <div className="stat-item stat-item-placeholder">Loading metrics…</div>
                    </div>
                  ) : null}
                  {isStatsOpen && stats ? (
                    <div className="host-stats">
                      {[
                        { id: "cpu", label: `CPU (${stats.cpus} cores)`, value: stats.cpu, pct: stats.cpuPct, icon: "⚡" },
                        { id: "ram", label: "RAM", value: stats.mem, pct: stats.memPct, icon: "💾" },
                        { id: "disk", label: "Disk /", value: stats.disk, pct: stats.diskPct, icon: "💿" },
                        { id: "net", label: "Net I/O", value: stats.net, pct: null as number | null, icon: "🌐" }
                      ].map(({ id, label, value, pct, icon }) => (
                        <div
                          key={id}
                          className={`stat-item ${id === "cpu" ? "stat-item-clickable" : ""}`}
                          onClick={() => {
                            if (id !== "cpu") {
                              return;
                            }
                            setExpandedCpuHostIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(host.id)) {
                                next.delete(host.id);
                              } else {
                                next.add(host.id);
                              }
                              return next;
                            });
                          }}
                          role={id === "cpu" ? "button" : undefined}
                          tabIndex={id === "cpu" ? 0 : undefined}
                          onKeyDown={(event) => {
                            if (id !== "cpu") {
                              return;
                            }
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setExpandedCpuHostIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(host.id)) {
                                  next.delete(host.id);
                                } else {
                                  next.add(host.id);
                                }
                                return next;
                              });
                            }
                          }}
                        >
                          <div className="stat-row">
                            <span className="stat-label"><span className="stat-icon">{icon}</span> {label}</span>
                            <span className="stat-value">{value}</span>
                          </div>
                          {pct !== null && (
                            <div className="stat-bar-track">
                              <div
                                className={`stat-bar-fill ${pct > 90 ? "danger" : pct > 70 ? "warn" : ""}`}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                          )}
                          {id === "cpu" && isCpuExpanded && stats.coreUsage.length > 0 ? (
                            <div className="core-usage-list">
                              {stats.coreUsage.map((corePct, coreIdx) => (
                                <div key={coreIdx} className="core-usage-item">
                                  <div className="stat-row">
                                    <span className="core-usage-label">Core {coreIdx}</span>
                                    <span className="core-usage-value">{corePct.toFixed(1)}%</span>
                                  </div>
                                  <div className="stat-bar-track">
                                    <div
                                      className={`stat-bar-fill ${corePct > 90 ? "danger" : corePct > 70 ? "warn" : ""}`}
                                      style={{ width: `${Math.min(100, corePct)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
            </div>
          </>
        )}

        {activeNav === "settings" && (
          <>
            <div className="sidebar-section-title">App Settings</div>
            <div className="settings-grid">
              <label>
                App Theme
                <select
                  value={settingsDraft.appTheme}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, appTheme: e.target.value as AppSettings["appTheme"] }))}
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="onyx">Onyx</option>
                </select>
              </label>
              <label>
                Terminal Theme
                <select
                  value={settingsDraft.terminalTheme}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, terminalTheme: e.target.value as AppSettings["terminalTheme"] }))}
                >
                  <option value="oceanic">Oceanic</option>
                  <option value="matrix">Matrix</option>
                  <option value="amber">Amber</option>
                  <option value="nord">Nord</option>
                  <option value="dracula">Dracula</option>
                  <option value="solarized">Solarized</option>
                  <option value="green">Green</option>
                  <option value="white">White</option>
                </select>
              </label>
              <label>
                Font Size
                <input
                  type="number"
                  min={10}
                  max={28}
                  value={settingsDraft.terminalFontSize}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      terminalFontSize: clampInt(e.target.value, prev.terminalFontSize, 10, 28)
                    }))
                  }
                />
              </label>
              <label>
                Font Family
                <select
                  value={settingsDraft.terminalFontFamily}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, terminalFontFamily: e.target.value }))}
                >
                  {fontChoices.map((font) => (
                    <option key={font} value={font}>{font}</option>
                  ))}
                </select>
              </label>
              <label>
                Cursor Blink
                <select
                  value={settingsDraft.cursorBlink ? "true" : "false"}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, cursorBlink: e.target.value === "true" }))}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label>
                Scrollback Lines
                <input
                  type="number"
                  min={100}
                  max={50000}
                  value={settingsDraft.scrollbackLines}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      scrollbackLines: clampInt(e.target.value, prev.scrollbackLines, 100, 50000)
                    }))
                  }
                />
              </label>
              <label>
                Connection Timeout (s)
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={settingsDraft.connectionTimeout}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      connectionTimeout: clampInt(e.target.value, prev.connectionTimeout, 0, 300)
                    }))
                  }
                />
              </label>
              <label>
                Keep-Alive Interval (s)
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={settingsDraft.keepAliveInterval}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      keepAliveInterval: clampInt(e.target.value, prev.keepAliveInterval, 0, 300)
                    }))
                  }
                />
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={settingsDraft.autoReconnect}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, autoReconnect: e.target.checked }))}
                />
                Auto-Reconnect on Drop
              </label>
              {settingsDraft.autoReconnect && (
                <label>
                  Reconnect Delay (seconds)
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={settingsDraft.autoReconnectDelay ?? 15}
                    onChange={(e) =>
                      setSettingsDraft((prev) => ({
                        ...prev,
                        autoReconnectDelay: clampInt(e.target.value, 15, 5, 300)
                      }))
                    }
                  />
                </label>
              )}
            </div>
            <div className="sidebar-actions">
              <button type="button" className={`primary-btn ${saveStatus === 'saved' ? 'is-saved' : ''}`} disabled={saveStatus === 'saving'} onClick={() => void saveSettings()}>
                {saveStatus === 'saving' ? "Saving…" : saveStatus === 'saved' ? "✓ Saved!" : "Save Settings"}
              </button>
            </div>
          </>
        )}

        {activeNav === "backup" && (
          <>
            <div className="sidebar-section-title">Backup Profiles</div>
            <div className="backup-panel">
              <div className="backup-action">
                <h3>Export</h3>
                <p>Download all host profiles as an AES-256 encrypted file. Host IPs are protected by your password.</p>
                <button type="button" className={`primary-btn ${exportStatus === 'exported' ? 'is-saved' : ''}`} disabled={exportStatus === 'exporting'} onClick={() => exportBackup()}>
                  {exportStatus === 'exporting' ? "Exporting…" : exportStatus === 'exported' ? "✓ Exported!" : "Export Encrypted Backup"}
                </button>
              </div>
              <div className="backup-sep" />
              <div className="backup-action">
                <h3>Import</h3>
                <p>Restore host profiles from an encrypted <code>.enc</code> or plain <code>.json</code> backup file.</p>
                <input
                  ref={backupFileRef}
                  type="file"
                  accept=".enc,.json"
                  style={{ display: "none" }}
                  onChange={handleImportFile}
                />
                <button type="button" className="ghost-btn" onClick={() => backupFileRef.current?.click()}>
                  Choose File…
                </button>
              </div>
            </div>
          </>
        )}

        {activeNav === "connections" && (
          <>
            <div className="sidebar-section-title">Active Sessions</div>
            <div className="connections-panel">
              {sessions.length === 0 ? (
                <div className="conn-empty">No active sessions. Connect to a host to begin.</div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.sessionId}
                    className={`conn-item ${session.sessionId === activeSessionId ? "active" : ""}`}
                  >
                    <div className="conn-header">
                      <span className={`dot dot-${session.status}`} />
                      <span className="conn-name">{session.profileName || session.hostLabel}</span>
                    </div>
                    <div className="conn-host">{session.hostLabel}</div>
                    <div className="conn-status-row">
                      <span className={`conn-badge conn-badge-${session.status}`}>{session.status}</span>
                      <span className="conn-view-badge">{session.view}</span>
                    </div>
                    <div className="conn-actions">
                      <button
                        type="button"
                        className="ghost-btn small"
                        onClick={() => {
                          setActiveSessionId(session.sessionId);
                          setActiveNav("hosts");
                        }}
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        className="ghost-btn small"
                        onClick={() => switchSessionView(session.sessionId, "terminal")}
                      >
                        Terminal
                      </button>
                      <button
                        type="button"
                        className="ghost-btn small"
                        onClick={() => switchSessionView(session.sessionId, "sftp")}
                      >
                        SFTP
                      </button>
                      <button
                        type="button"
                        className="ghost-btn small danger"
                        onClick={() => void removeSession(session.sessionId, true)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
              {sessions.length > 0 && (
                <div className="conn-summary">
                  {sessions.filter((s) => s.status === "connected").length} connected · {sessions.length} total
                </div>
              )}
            </div>
          </>
        )}

        {activeNav === "keys" && (
          <>
            <div className="sidebar-section-title">SSH Keys</div>
            <div className="keys-panel">
              {(() => {
                const keyHosts = hosts.filter((h) => h.authMethod === "privateKey" && h.privateKeyPath);
                if (keyHosts.length === 0) {
                  return (
                    <div className="keys-empty">
                      No private key hosts configured yet. Add a host using key-based auth.
                    </div>
                  );
                }
                return keyHosts.map((h) => (
                  <div key={h.id} className="key-item">
                    <div className="key-item-header">
                      <span className="key-host-name">{h.name}</span>
                      <button
                        type="button"
                        className="ghost-btn small danger"
                        title="Delete this host's private key file"
                        onClick={() => {
                          showConfirm(
                            "Delete Private Key",
                            `Delete the private key file for "${h.name}"?\n\n${h.privateKeyPath ?? ""}\n\nThis cannot be undone.`,
                            () => {
                              void window.api.deleteFile(h.privateKeyPath!)
                                .then(() => window.api.saveHost({
                                  id: h.id,
                                  name: h.name,
                                  host: h.host,
                                  port: h.port,
                                  username: h.username,
                                  authMethod: "password",
                                  privateKeyPath: undefined,
                                  sftpStartPath: h.sftpStartPath
                                }))
                                .then(() => refreshHosts())
                                .catch(() => {});
                            }
                          );
                        }}
                      >
                        🗑
                      </button>
                    </div>
                    <div className="key-path">{h.privateKeyPath}</div>
                  </div>
                ));
              })()}
            </div>
          </>
        )}
          {activeNav === "editor" && (
            <>
              <div className="sidebar-section-title">File Editor</div>
              <div className="editor-panel">
                <p className="editor-desc">
                  Select an application to open remote files for editing via SFTP. The file is downloaded to a temp location and synced back on save.
                </p>
                <label>
                  Editor Application
                  <select
                    value={settingsDraft.editorCommand ?? "code"}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, editorCommand: e.target.value }))}
                  >
                    <optgroup label="GUI Editors">
                      <option value="code">Visual Studio Code</option>
                      <option value="subl">Sublime Text</option>
                      <option value="gedit">GNOME Text Editor</option>
                      <option value="kate">KDE Kate</option>
                      <option value="pluma">MATE Pluma</option>
                      <option value="xed">Xed</option>
                      <option value="notepad">Windows Notepad</option>
                      <option value="notepad++">Notepad++</option>
                    </optgroup>
                  </select>
                </label>
                <div className="sidebar-actions">
                  <button type="button" className={`primary-btn ${saveStatus === 'saved' ? 'is-saved' : ''}`} disabled={saveStatus === 'saving'} onClick={() => void saveSettings()}>
                    {saveStatus === 'saving' ? "Saving…" : saveStatus === 'saved' ? "✓ Saved!" : "Save Settings"}
                  </button>
                </div>
              </div>
            </>
        )}

        {activeNav === "info" && (
          <>
            <div className="sidebar-section-title">App Info</div>
            <div className="settings-grid" style={{ padding: '12px' }}>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <img src={appLogoPath} alt="Logo" style={{ width: 80, height: 80, borderRadius: 20 }} />
                <h2 style={{ margin: '12px 0 4px', fontSize: '1.4rem' }}>ShadowSSH</h2>
                <p style={{ color: 'var(--muted)', margin: 0, fontSize: '0.85rem' }}>Version {Number.parseInt(__APP_VERSION__, 10)}</p>
              </div>
              <div className="backup-sep" />
              <div style={{ marginTop: '12px', fontSize: '0.85rem', lineHeight: 1.6 }}>
                <p><strong>Credits:</strong> Built with ❤️ by ismdevx.</p>
                <p><strong>Open Source:</strong> ShadowSSH is an open source project.</p>
                <div style={{ marginTop: '16px' }}>
                  <button type="button" className="ghost-btn" onClick={() => window.open('https://github.com/ismdevx', '_blank')}>
                    View Developer on GitHub
                  </button>
                </div>
                <div style={{ marginTop: '10px' }}>
                  {updateStatus === "idle" || updateStatus === "not-available" || updateStatus === "error" ? (
                    <button type="button" className="primary-btn" onClick={() => void checkForUpdates()}>
                      Check for Updates
                    </button>
                  ) : updateStatus === "checking" ? (
                    <button type="button" className="primary-btn" disabled>Checking...</button>
                  ) : updateStatus === "available" ? (
                    <button type="button" className="primary-btn" onClick={() => void downloadUpdate()}>
                      Download Update {updateInfo.latestVersion ? `(v${updateInfo.latestVersion})` : ""}
                    </button>
                  ) : updateStatus === "downloading" ? (
                    <button type="button" className="primary-btn" disabled>
                      Downloading... {updateInfo.downloadProgress != null ? `${updateInfo.downloadProgress}%` : ""}
                    </button>
                  ) : updateStatus === "downloaded" ? (
                    <button type="button" className="primary-btn" onClick={installUpdate}>
                      Restart &amp; Install Update
                    </button>
                  ) : null}
                </div>
                {updateStatus === "not-available" && (
                  <p style={{ marginTop: '8px', color: 'var(--muted)' }}>You're up to date.</p>
                )}
                {updateStatus === "available" && updateInfo.latestVersion && (
                  <p style={{ marginTop: '8px', color: 'var(--muted)' }}>
                    Version {Number.parseInt(updateInfo.latestVersion, 10)} is available.
                  </p>
                )}
                {updateStatus === "downloaded" && (
                  <p style={{ marginTop: '8px', color: 'var(--muted)' }}>Update ready. Click to restart and install.</p>
                )}
                {updateStatus === "error" && updateInfo.error && (
                  <p style={{ marginTop: '8px', color: 'var(--error, #e05353)' }}>{updateInfo.error}</p>
                )}
              </div>
            </div>
          </>
        )}
      </aside>
      )}

      <main className="workspace">
        <header className="tabbar-wrap">
          <div id="tabs" className="tabs">
            {sessions.length === 0 ? (
              <div className="tab-empty">No active sessions</div>
            ) : (
              sessions.map((session) => (
                <div
                  className={`tab ${session.sessionId === activeSessionId ? "active" : ""}`}
                  key={session.sessionId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSessionId(session.sessionId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveSessionId(session.sessionId);
                    }
                  }}
                >
                  <span className={`dot dot-${session.status}`} />
                  <span className="tab-title">{session.title}</span>
                  <button
                    type="button"
                    className="tab-close"
                    title="Disconnect and close"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeSession(session.sessionId, true);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
          {activeSession && (
            <div className="top-right-tools">
              {(() => {
                const latencyMs = activeLatency?.ok ? (activeLatency.latencyMs ?? null) : null;
                const latencyTone = latencyMs === null ? "red" : latencyMs <= 100 ? "green" : latencyMs <= 300 ? "yellow" : "red";
                const latencyText = isFetchingActiveLatency ? "..." : latencyMs === null ? "ERR" : `${latencyMs}ms`;

                return (
                  <div className={`latency-indicator ${latencyTone}`} title="Ping latency">
                    <span className="latency-icon">◉</span>
                    <span className="latency-ms">{latencyText}</span>
                  </div>
                );
              })()}
              <div className="view-switcher">
                <button
                  type="button"
                  className={`vs-btn ${activeSession.view === "terminal" ? "active" : ""}`}
                  onClick={() => switchSessionView(activeSession.sessionId, "terminal")}
                >
                  Terminal
                </button>
                <button
                  type="button"
                  className={`vs-btn ${activeSession.view === "sftp" ? "active" : ""}`}
                  onClick={() => switchSessionView(activeSession.sessionId, "sftp")}
                >
                  SFTP
                </button>
              </div>
            </div>
          )}
        </header>

        <section id="terminal-stage" className="terminal-stage">
          {activeSession ? (
            <div className="session-statusbar-static">
              <span className={`dot dot-${activeSession.status}`} />
              {activeSession.profileName ? (
                <span className="statusbar-name">{activeSession.profileName}</span>
              ) : null}
              <span className="statusbar-sep">·</span>
              <span className="statusbar-host">{activeSession.hostLabel}</span>
              <span className="statusbar-status">
                {activeSession.status === "connecting"
                  ? "Connecting…"
                  : activeSession.status === "connected"
                  ? "Connected"
                  : activeSession.status === "disconnected"
                  ? "Disconnected"
                  : activeSession.statusMessage ?? activeSession.status}
              </span>
            </div>
          ) : null}

          <div className="terminal-content-wrapper">
          {sessions.length === 0 ? (
            <div className="empty-state">
              <h2>Ready to Connect</h2>
              <p>Create a host or click an existing one to open a session.</p>
            </div>
          ) : null}

          {sessions.length > 0 && !activeSession ? (
            <div className="empty-state">
              <h2>Recovering Session View</h2>
              <p>Selecting an active session...</p>
            </div>
          ) : null}

          {sessions.map((session) => (
            <div
              className={`terminal-container ${session.sessionId === activeSessionId && session.view === "terminal" ? "active" : ""}`}
              key={session.sessionId}
              ref={(node) => {
                if (node) {
                  paneRefs.current.set(session.sessionId, node);
                }
              }}
            />
          ))}

          {activeSession?.view === "sftp" ? (
            <aside id="sftp-panel" className="sftp-panel sftp-tab-panel">
              <div className="sftp-breadcrumb-row">
                {buildBreadcrumbs(sftpPath).map((crumb, idx, arr) => (
                  <span key={crumb.path}>
                    <span
                      className={`sftp-breadcrumb-part ${idx === arr.length - 1 ? "current" : ""}`}
                      onClick={() => {
                        if (idx < arr.length - 1) void refreshSftp(crumb.path);
                      }}
                    >
                      {crumb.label}
                    </span>
                    {idx < arr.length - 1 && <span className="sftp-breadcrumb-sep"> / </span>}
                  </span>
                ))}
              </div>
              <div className="sftp-controls">
                <button type="button" className="ghost-btn small" title="Go back" onClick={() => {
                  const parentPath = getParentPath(sftpPath);
                  void refreshSftp(parentPath === sftpPath ? "." : parentPath);
                }}>← Back</button>
                <button type="button" className="ghost-btn small" onClick={() => void refreshSftp(sftpPathInput)}>↻</button>
                <button type="button" className="ghost-btn small" onClick={() => void refreshSftp(getParentPath(sftpPath))}>↑</button>
                <input
                  type="text"
                  value={sftpPathInput}
                  onChange={(event) => setSftpPathInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void refreshSftp(sftpPathInput);
                    }
                  }}
                  placeholder="Remote path (., /var/www, /home/user)"
                />
                <button type="button" className="ghost-btn small" onClick={() => void refreshSftp(sftpPathInput)}>Go</button>
                <button
                  type="button"
                  className="ghost-btn small"
                  disabled={!activeSession}
                  onClick={() => void onSftpUpload()}
                >
                  Upload
                </button>
              </div>
              <div id="sftp-status" className="sftp-status">{sftpStatus}</div>
              <div className="sftp-header">
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Actions</span>
              </div>
              <div id="sftp-list" className="sftp-list">
                {sftpEntries.length === 0 ? (
                  <div className="sftp-empty">Directory is empty</div>
                ) : (
                  sftpEntries.map((entry) => (
                    <div
                      className={`sftp-item ${selectedRemotePath === entry.path ? "active" : ""}`}
                      key={entry.path}
                      onClick={() => setSelectedRemotePath(entry.path)}
                      onDoubleClick={() => {
                        if (!entry.isDirectory) void onSftpEditFile(entry.path);
                      }}
                    >
                      <div
                        className="sftp-main"
                        onClick={() => {
                          if (entry.isDirectory) void refreshSftp(entry.path);
                        }}
                      >
                        <span className="sftp-type">{entry.isDirectory ? <FolderIcon /> : <FileIcon />}</span>
                        <span className="sftp-name">{entry.name}</span>
                      </div>
                      <span className="sftp-size">{entry.isDirectory ? "—" : formatBytes(entry.size)}</span>
                      <span className="sftp-mtime">{formatModTime(entry.modifyTime)}</span>
                      <div className="sftp-actions">
                        {entry.isDirectory ? (
                          <button type="button" className="ghost-btn small" onClick={() => void refreshSftp(entry.path)}>Open</button>
                        ) : (
                          <>
                            {entry.name.toLowerCase().endsWith('.zip') && (
                              <button type="button" className="ghost-btn small sftp-action-extract" onClick={() => void onSftpExtractZip(entry.path)}>Extract</button>
                            )}
                            <button type="button" className="ghost-btn small" onClick={() => void onSftpDownload(entry.path)}>↓</button>
                            <button type="button" className="ghost-btn small" onClick={() => void onSftpEditFile(entry.path)}>Edit</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          ) : null}
          </div>
        </section>
      </main>

      <div className={`modal ${isModalOpen ? "" : "hidden"}`} aria-hidden={!isModalOpen}>
        <div className="modal-card">
          <div className="modal-header">
            <h2>{editHostIdRef.current ? "Edit Host" : "New Host"}</h2>
            <button type="button" className="modal-close" onClick={() => { setModalOpen(false); setKeyWizard(defaultKeyWizard); }}>×</button>
          </div>
          <form id="host-form" onSubmit={(event) => void submitModal(event)}>
            <label>
              Name
              <input
                name="name"
                type="text"
                required
                maxLength={128}
                value={formState.name}
                onChange={(event) => updateForm({ name: event.target.value })}
              />
            </label>
            <label>
              Host
              <input
                name="host"
                type="text"
                required
                maxLength={255}
                value={formState.host}
                onChange={(event) => updateForm({ host: event.target.value })}
              />
            </label>
            <div className="grid-2">
              <label>
                Port
                <input
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={formState.port}
                  onChange={(event) => updateForm({ port: Number(event.target.value) })}
                />
              </label>
              <label>
                Username
                <input
                  name="username"
                  type="text"
                  required
                  maxLength={128}
                  value={formState.username}
                  onChange={(event) => updateForm({ username: event.target.value })}
                />
              </label>
            </div>
            <label>
              Auth Method
              <select
                name="authMethod"
                value={formState.authMethod}
                onChange={(event) => updateForm({ authMethod: event.target.value as AuthMethod })}
              >
                <option value="password">Password</option>
                <option value="privateKey">Private Key</option>
              </select>
            </label>

            {formState.authMethod === "password" ? (
              <label>
                Password
                <div className="keypicker">
                  <input
                    name="password"
                    type={showHostPassword ? "text" : "password"}
                    maxLength={4096}
                    required
                    value={formState.password}
                    onChange={(event) => updateForm({ password: event.target.value })}
                  />
                  <button type="button" className="ghost-btn" onClick={() => setShowHostPassword((prev) => !prev)}>
                    {showHostPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            ) : (
              <>
                <label>
                  Private Key
                  <div className="keypicker">
                    <input
                      name="privateKeyPath"
                      type="text"
                      required
                      placeholder="/home/user/.ssh/id_ed25519"
                      value={formState.privateKeyPath}
                      onChange={(event) => updateForm({ privateKeyPath: event.target.value })}
                    />
                    <button type="button" className="ghost-btn" onClick={() => void handlePickKey("host")}>
                      Browse
                    </button>
                  </div>
                </label>
                <button
                  type="button"
                  className="primary-btn keygen-wizard-btn"
                  onClick={() => openKeyWizard()}
                >
                  {formState.privateKeyPath ? "🔄 Regenerate Key & Install" : "✦ Generate New Key & Install"}
                </button>
              </>
            )}

            {keyWizard.step !== "idle" && (
              <div className="key-wizard-overlay" role="dialog" aria-modal="true" aria-label="Generate SSH Key">
                <div className="key-wizard-box">
                  <button type="button" className="modal-close" onClick={() => setKeyWizard(defaultKeyWizard)}>×</button>

                  {keyWizard.step === "naming" && (
                    <>
                      <div className="key-wizard-icon">🔑</div>
                      <h3 className="key-wizard-title">Generate SSH Key</h3>
                      <p className="key-wizard-desc">Choose a name for your new ED25519 key. It will be saved in <code>~/.ssh/</code>.</p>
                      <input
                        className="key-wizard-input"
                        type="text"
                        placeholder={`e.g. ${formState.name.trim() || "my-server"}`}
                        value={keyWizard.keyName}
                        onChange={(e) => patchWizard({ keyName: e.target.value })}
                        autoFocus
                      />
                      {keyWizard.error && <div className="key-wizard-error">{keyWizard.error}</div>}
                      <div className="key-wizard-actions">
                        <button type="button" className="ghost-btn" onClick={() => setKeyWizard(defaultKeyWizard)}>Cancel</button>
                        <button type="button" className="primary-btn" onClick={() => void runKeyGeneration()}>Generate →</button>
                      </div>
                    </>
                  )}

                  {keyWizard.step === "generating" && (
                    <>
                      <div className="key-wizard-icon spinning">⚙</div>
                      <h3 className="key-wizard-title">Generating Key…</h3>
                      <p className="key-wizard-desc">Creating a new ED25519 key pair. This only takes a moment.</p>
                    </>
                  )}

                  {keyWizard.step === "install" && (
                    <>
                      <div className="key-wizard-icon">📋</div>
                      <h3 className="key-wizard-title">Key Ready — Install on Server?</h3>
                      <div className="key-wizard-path">
                        <span className="key-wizard-path-label">Private key:</span>
                        <code>{keyWizard.privateKeyPath}</code>
                      </div>
                      <p className="key-wizard-desc">
                        Enter your VPS password once to install the public key on the server (<code>ssh-copy-id</code>). After this, you will no longer need a password.
                      </p>
                      {formState.host && formState.username ? (
                        <>
                          <div className="key-wizard-install-target">
                            <span>Installing to:</span> <strong>{formState.username}@{formState.host}:{formState.port || 22}</strong>
                          </div>
                          <div className="keypicker">
                            <input
                              className="key-wizard-input"
                              type={keyWizard.showInstallPass ? "text" : "password"}
                              placeholder="VPS password"
                              value={keyWizard.installPassword}
                              onChange={(e) => patchWizard({ installPassword: e.target.value })}
                            />
                            <button type="button" className="ghost-btn" onClick={() => patchWizard({ showInstallPass: !keyWizard.showInstallPass })}>
                              {keyWizard.showInstallPass ? "Hide" : "Show"}
                            </button>
                          </div>
                          {keyWizard.error && <div className="key-wizard-error">{keyWizard.error}</div>}
                          {keyWizard.installStatus && <div className="key-wizard-status">{keyWizard.installStatus}</div>}
                          <div className="key-wizard-actions">
                            <button type="button" className="ghost-btn" onClick={() => patchWizard({ step: "done", installStatus: "Skipped — copy the .pub file manually." })}>Skip</button>
                            <button type="button" className="primary-btn" disabled={!keyWizard.installPassword} onClick={() => void runInstallPublicKey()}>Install Key →</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="key-wizard-desc" style={{color: "var(--warning)"}}>Fill in the Host and Username fields first to enable auto-install.</p>
                          <div className="key-wizard-actions">
                            <button type="button" className="primary-btn" onClick={() => setKeyWizard(defaultKeyWizard)}>Done</button>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {keyWizard.step === "done" && (
                    <>
                      <div className="key-wizard-icon">✅</div>
                      <h3 className="key-wizard-title">All Done!</h3>
                      <div className="key-wizard-path">
                        <span className="key-wizard-path-label">Key:</span>
                        <code>{keyWizard.privateKeyPath}</code>
                      </div>
                      {keyWizard.installStatus && <p className="key-wizard-desc" style={{color: "var(--success)"}}>{keyWizard.installStatus}</p>}
                      <div className="key-wizard-actions">
                        <button type="button" className="primary-btn" onClick={() => setKeyWizard(defaultKeyWizard)}>Close</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <label>
              SFTP Start Path
              <input
                name="sftpStartPath"
                type="text"
                value={formState.sftpStartPath}
                onChange={(event) => updateForm({ sftpStartPath: event.target.value })}
                placeholder=". or /var/www"
              />
            </label>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={formState.useProxy}
                onChange={(event) => updateForm({ useProxy: event.target.checked, proxyAuthMethod: "password" })}
              />
              Connect through Proxy/Bastion Host
            </label>

            {formState.useProxy && (
              <>
                <label>
                  Proxy Host
                  <input
                    name="proxyHost"
                    type="text"
                    required
                    maxLength={255}
                    value={formState.proxyHost}
                    onChange={(event) => updateForm({ proxyHost: event.target.value })}
                    placeholder="proxy.example.com"
                  />
                </label>
                <div className="grid-2">
                  <label>
                    Proxy Port
                    <input
                      name="proxyPort"
                      type="number"
                      min={1}
                      max={65535}
                      required
                      value={formState.proxyPort}
                      onChange={(event) => updateForm({ proxyPort: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Proxy Username
                    <input
                      name="proxyUsername"
                      type="text"
                      required
                      maxLength={128}
                      value={formState.proxyUsername}
                      onChange={(event) => updateForm({ proxyUsername: event.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Proxy Password
                  <div className="keypicker">
                    <input
                      name="proxyPassword"
                      type={showProxyPassword ? "text" : "password"}
                      maxLength={4096}
                      required
                      value={formState.proxyPassword}
                      onChange={(event) => updateForm({ proxyPassword: event.target.value })}
                    />
                    <button type="button" className="ghost-btn" onClick={() => setShowProxyPassword((prev) => !prev)}>
                      {showProxyPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
              </>
            )}

            <div className="form-actions">
              <span className="form-status">{formStatus}</span>
            </div>

            <div className="form-buttons">
              {editHostIdRef.current ? (
                <>
                  <button type="button" className="ghost-btn" onClick={() => setModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-btn" disabled={isSubmitting}>
                    {isSubmitting ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ghost-btn" disabled={isSubmitting} onClick={() => void saveHostOnly()}>
                    Save Profile
                  </button>
                  <button type="submit" className="primary-btn" disabled={isSubmitting}>
                    {isSubmitting ? "Connecting…" : "Connect"}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>

      {isEncryptModalOpen && (
        <div className="modal">
          <div className="modal-card modal-sm">
            <div className="modal-header">
              <h2>{encryptMode === "export" ? "Encrypt Backup" : "Decrypt Backup"}</h2>
              <button type="button" className="modal-close" onClick={() => setEncryptModalOpen(false)}>×</button>
            </div>
            <div className="encrypt-modal-body">
              <p className="encrypt-modal-desc">
                {encryptMode === "export"
                  ? "Enter a password to encrypt your backup. You will need this password to restore it. Host IPs and names will be protected."
                  : "Enter the password to decrypt and restore this backup file."}
              </p>
              <label>
                Password
                <input
                  type="password"
                  value={encryptPasswordInput}
                  onChange={(e) => setEncryptPasswordInput(e.target.value)}
                  placeholder="Enter encryption password"
                  autoFocus
                />
              </label>
              <div className="form-buttons">
                <button className="ghost-btn" onClick={() => setEncryptModalOpen(false)}>Cancel</button>
                <button
                  className="primary-btn"
                  disabled={!encryptPasswordInput.trim()}
                  onClick={() => {
                    const pw = encryptPasswordInput;
                    setEncryptModalOpen(false);
                    if (encryptMode === "export") {
                      void doExportBackup(pw);
                    } else {
                      void doImportBackup(pw);
                    }
                  }}
                >
                  {encryptMode === "export" ? "Encrypt & Export" : "Decrypt & Import"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmModal.open && (
        <div className="modal" style={{ zIndex: 9999 }} onClick={closeConfirm}>
          <div
            className="confirm-modal-box"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-modal-icon">⚠️</div>
            <h3 className="confirm-modal-title">{confirmModal.title}</h3>
            <p className="confirm-modal-message">{confirmModal.message}</p>
            <div className="confirm-modal-actions">
              <button type="button" className="ghost-btn" onClick={closeConfirm}>Cancel</button>
              <button
                type="button"
                className="primary-btn danger-btn"
                onClick={() => { confirmModal.onConfirm(); closeConfirm(); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
            </span>
            <span className="toast-msg">{t.msg}</span>
            <button type="button" className="toast-close" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
