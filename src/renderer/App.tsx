import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Play, Square, Monitor, RefreshCw, Trash2, ShieldAlert, Cog, Rocket, Scale } from "lucide-react";
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
type SessionView = "terminal" | "sftp" | "gui";
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
  guiEnabled: boolean;
  guiType: "vnc" | "nomachine";
  guiPort: number;
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
  proxyPrivateKeyPath: "",
  guiEnabled: false,
  guiType: "vnc",
  guiPort: 5901
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

const maskHost = (ipOrHost: string): string => {
  return "••••••••";
};

const maskUsername = (username: string): string => {
  return "••••";
};

const maskHostLabel = (label: string): string => {
  if (!label) return "";
  const parts = label.split("@");
  if (parts.length === 2) {
    const hostPort = parts[1];
    const hpParts = hostPort.split(":");
    const p = hpParts[1] || "";
    return `••••@••••••••${p ? `:${p}` : ""}`;
  }
  return "••••••••";
};

function getSessionTitle(profileName: string, view: SessionView): string {
  return `${profileName} (${view === "sftp" ? "SFTP" : view === "gui" ? "Desktop GUI" : "Terminal"})`;
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

  // State for Desktop GUI installer and launcher
  const [guiCheckState, setGuiCheckState] = useState<{
    status: "idle" | "checking" | "checked" | "installing";
    hasGui: boolean;
    deType: string;
    vncInstalled: boolean;
    nxInstalled: boolean;
    ramMB: number;
    installLog: string[];
    error?: string;
    sessionId?: string;
    vncRunning?: boolean;
    vncLoading?: boolean;
    nxRunning?: boolean;
    nxLoading?: boolean;
    deList?: string[];
  }>({
    status: "idle",
    hasGui: false,
    deType: "",
    deList: [],
    vncInstalled: false,
    nxInstalled: false,
    ramMB: 0,
    installLog: [],
    vncRunning: false,
    vncLoading: false,
    nxRunning: false,
    nxLoading: false,
  });

  const [selectedDeToInstall, setSelectedDeToInstall] = useState<"xfce" | "mate" | "gnome" | "kde" | "cinnamon">("xfce");
  const [selectedServerType, setSelectedServerType] = useState<"vnc" | "nomachine">("vnc");
  const [vncViewer, setVncViewer] = useState<"remmina" | "tigervnc">("remmina");
  const [showVncSettings, setShowVncSettings] = useState(false);
  const [vncLaunching, setVncLaunching] = useState(false);
  const [nxLaunching, setNxLaunching] = useState(false);
  const [vncSettings, setVncSettings] = useState({
    resolution: "1920x1080",
    depth: 24,
    frameRate: 60,
    zlibLevel: 1,
    qualityLevel: 9,
    compressLevel: 1,
    encoding: "Tight" as "Tight" | "ZRLE" | "Hextile" | "Raw",
  });

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
  const guiCheckStateRef = useRef(guiCheckState);

  useEffect(() => {
    guiCheckStateRef.current = guiCheckState;
  }, [guiCheckState]);

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
    isRemoteUninstall?: boolean;
    confirmText?: string;
    onConfirm: (choice?: any) => void;
  }>({ open: false, title: "", message: "", onConfirm: () => {} });

  const [uninstallChoice, setUninstallChoice] = useState<"remote" | "tigervnc" | "nomachine">("remote");

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: (choice?: any) => void,
    isRemoteUninstall?: boolean,
    confirmText?: string
  ): void => {
    setUninstallChoice("remote");
    setConfirmModal({ open: true, title, message, onConfirm, isRemoteUninstall, confirmText });
  };

  const closeConfirm = (): void => {
    setConfirmModal((prev) => ({ ...prev, open: false }));
  };

  interface PromptModalState {
    open: boolean;
    title: string;
    label: string;
    defaultValue: string;
    onSubmit: (value: string) => void;
    onCancel: () => void;
  }
  const [promptModal, setPromptModal] = useState<PromptModalState>({
    open: false, title: "", label: "", defaultValue: "",
    onSubmit: () => {}, onCancel: () => {}
  });

  const showPrompt = (title: string, label: string, defaultValue: string): Promise<string | null> => {
    return new Promise((resolve) => {
      setPromptModal({
        open: true, title, label, defaultValue,
        onSubmit: (value: string) => { setPromptModal((p) => ({ ...p, open: false })); resolve(value); },
        onCancel: () => { setPromptModal((p) => ({ ...p, open: false })); resolve(null); }
      });
    });
  };

  const closePrompt = (): void => {
    promptModal.onCancel();
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
  const [sftpTab, setSftpTab] = useState<"files" | "workspaces">("files");
  const [sftpWorkspaces, setSftpWorkspaces] = useState<Array<{ path: string; updatedAt: string }>>([]);
  const [sftpLoading, setSftpLoading] = useState(false);
  const [streamMode, setStreamMode] = useState(false);
  const [appLoading, setAppLoading] = useState(true);

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
    setSftpLoading(true);

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
    } finally {
      setSftpLoading(false);
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

  const refreshWorkspaces = async (): Promise<void> => {
    if (!activeSessionId) {
      setSftpWorkspaces([]);
      return;
    }
    setSftpStatus("Loading workspaces...");
    try {
      const list = await window.api.sftpListWorkspaces(activeSessionId);
      setSftpWorkspaces(list);
      setSftpStatus(`Workspaces: ${list.length} found`);
    } catch (error: unknown) {
      setSftpStatus(`Error listing workspaces: ${String(error instanceof Error ? error.message : error)}`);
      setSftpWorkspaces([]);
    }
  };

  const createTerminalRuntime = (sessionId: string, element: HTMLDivElement): TerminalRuntime => {
    const safe = sanitizeSettings(settings);
    const terminal = new Terminal({
      cursorBlink: safe.cursorBlink,
      convertEol: true,
      fontFamily: `${safe.terminalFontFamily}, ui-monospace, SFMono-Regular, Menlo, monospace`,
      fontSize: safe.terminalFontSize,
      theme: terminalThemes[safe.terminalTheme],
      scrollback: safe.scrollbackLines,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    fitAddon.fit();

    terminal.onData((data: string) => {
      void window.api.sshWrite(sessionId, data).catch((error: unknown) => {
        terminal.writeln(`\r\n[shadowssh] ・ input error: ${String(error)}`);
      });
    });

    // Clipboard: Ctrl+Shift+C copy, Ctrl+Shift+V paste
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.ctrlKey && event.shiftKey && event.key === "C") {
        const selection = terminal.getSelection();
        if (selection) { event.preventDefault(); void navigator.clipboard.writeText(selection); return false; }
      }
      if (event.ctrlKey && event.shiftKey && event.key === "V") {
        event.preventDefault();
        void navigator.clipboard.readText().then((text: string) => {
          terminal.paste(text);
          terminal.focus();
        });
        return false;
      }
      return true;
    });

    // Right-click context menu
    element.addEventListener("contextmenu", (event: MouseEvent) => {
      event.preventDefault();
      const existing = document.querySelectorAll(".app-context-menu");
      existing.forEach((el) => el.remove());
      const selection = terminal.getSelection();
      const menu = document.createElement("div");
      menu.className = "app-context-menu";
      menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:99999;background:var(--surface,#1a1d23);border:1px solid var(--border,#333);border-radius:8px;padding:4px 0;min-width:140px;box-shadow:0 8px 24px rgba(0,0,0,0.6);font-size:13px;`;
      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy";
      copyBtn.style.cssText = "display:block;width:100%;padding:7px 16px;border:none;background:none;color:var(--text,#ddd);font-size:13px;text-align:left;cursor:pointer;";
      copyBtn.disabled = !selection; if (!selection) copyBtn.style.opacity = "0.4";
      copyBtn.onmouseenter = () => { copyBtn.style.background = "var(--hover,#333)"; };
      copyBtn.onmouseleave = () => { copyBtn.style.background = "none"; };
      copyBtn.onclick = () => { if (selection) navigator.clipboard.writeText(selection); document.body.removeChild(menu); };
      const pasteBtn = document.createElement("button");
      pasteBtn.textContent = "Paste";
      pasteBtn.style.cssText = copyBtn.style.cssText; pasteBtn.style.opacity = "1"; pasteBtn.disabled = false;
      pasteBtn.onmouseenter = () => { pasteBtn.style.background = "var(--hover,#333)"; };
      pasteBtn.onmouseleave = () => { pasteBtn.style.background = "none"; };
       pasteBtn.onclick = () => { navigator.clipboard.readText().then((t: string) => { terminal.paste(t); terminal.focus(); }); document.body.removeChild(menu); };
      menu.appendChild(copyBtn); menu.appendChild(pasteBtn); 
      
      const sep = document.createElement("div");
      sep.style.cssText = "height:1px;background:var(--border,#333);margin:4px 8px;";
      menu.appendChild(sep);

      const clearBtn = document.createElement("button");
      clearBtn.textContent = "Clear";
      clearBtn.style.cssText = pasteBtn.style.cssText;
      clearBtn.onmouseenter = () => { clearBtn.style.background = "var(--hover,#333)"; };
      clearBtn.onmouseleave = () => { clearBtn.style.background = "none"; };
      clearBtn.onclick = () => { terminal.clear(); document.body.removeChild(menu); };
      menu.appendChild(clearBtn);

      document.body.appendChild(menu);
      const rect = menu.getBoundingClientRect();
      if (event.clientX + rect.width > window.innerWidth) {
        menu.style.left = `${Math.max(5, window.innerWidth - rect.width - 5)}px`;
      }
      if (event.clientY + rect.height > window.innerHeight) {
        menu.style.top = `${Math.max(5, window.innerHeight - rect.height - 5)}px`;
      }
      const close = () => { 
        if (document.body.contains(menu)) document.body.removeChild(menu); 
        document.removeEventListener("click", close); 
        document.removeEventListener("contextmenu", close);
      };
      setTimeout(() => {
        document.addEventListener("click", close);
        document.addEventListener("contextmenu", close);
      }, 0);
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

    // Safety timeout to prevent getting stuck in "checking" state
    const timeoutId = setTimeout(() => {
      setUpdateStatus((current) => {
        if (current === "checking") {
          showToast("Update check timed out.", "error");
          setUpdateInfo({ error: "Update check timed out." });
          return "error";
        }
        return current;
      });
    }, 7000);

    try {
      const result = await window.api.checkForUpdates();
      if (!result.ok && result.error) {
        clearTimeout(timeoutId);
        setUpdateStatus("error");
        setUpdateInfo({ error: result.error });
        showToast(`Update check failed: ${result.error}`, "error");
      }
      // success: status will be updated by onUpdateEvent listener
    } catch (error: unknown) {
      clearTimeout(timeoutId);
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
    const timer = setTimeout(() => {
      setAppLoading(false);
    }, 1800);
    return () => clearTimeout(timer);
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
        showToast(`Update available: Version ${event.latestVersion}`, "info");
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
      runtime.terminal.writeln(`[shadowssh] ・ connecting to ${streamMode ? maskHostLabel(session.hostLabel) : session.hostLabel}...`);
    }
  }, [sessions, settings, streamMode]);

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
      if (sftpTab === "workspaces") {
        void refreshWorkspaces();
      } else {
        void refreshSftp();
      }
    }
  }, [activeSessionId, activeSession?.view, sftpTab]);

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
        runtime.terminal.writeln("\r\n[shadowssh] ・ connected.");
        void window.api.sshResize(event.sessionId, runtime.terminal.cols, runtime.terminal.rows);
        if (activeSessionId === event.sessionId && activeSession?.view === "sftp") {
          void refreshSftp();
        }
      }

      if (event.status === "error") {
        runtime.terminal.writeln(`\r\n[shadowssh] ・ ${event.message ?? "unknown connection error"}`);
      }

      if (event.status === "disconnected") {
        runtime.terminal.writeln(`\r\n[shadowssh] ・ disconnected${event.message ? `: ${event.message}` : ""}`);
      }

      // Auto-reconnect logic
      if (event.status === "error" || event.status === "disconnected") {
        const session = sessionsRef.current.find(s => s.sessionId === event.sessionId);
        if (session && session.hostId && settingsRef.current.autoReconnect) {
          const delay = (settingsRef.current.autoReconnectDelay ?? 15) * 1000;
          runtime.terminal.writeln(`\r\n[shadowssh] ・ Auto-reconnecting in ${delay / 1000}s...`);
          
          if (reconnectTimersRef.current.has(event.sessionId)) {
            clearTimeout(reconnectTimersRef.current.get(event.sessionId));
          }
          
          const timerId = setTimeout(() => {
            reconnectTimersRef.current.delete(event.sessionId);
            runtime.terminal.writeln(`\r\n[shadowssh] ・ Attempting reconnect...`);
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
    
    // Refit after DOM layout updates when sidebar toggles
    const timer = setTimeout(onResize, 50);
    
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timer);
    };
  }, [isSidebarOpen]);

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
      proxyPrivateKeyPath: "",
      guiEnabled: host.guiEnabled ?? false,
      guiType: host.guiType ?? "vnc",
      guiPort: host.guiPort ?? 5901
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
        proxyPrivateKeyPath: undefined,
        guiEnabled: formState.guiEnabled,
        guiType: formState.guiType,
        guiPort: formState.guiPort
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

  useEffect(() => {
    if (activeSessionId) {
      const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
      if (activeSession && activeSession.view === "gui") {
        setGuiCheckState(prev => {
          if (prev.status === "idle" || prev.sessionId !== activeSessionId) {
            void checkVpsGuiStatus(activeSessionId);
          }
          return prev;
        });
      }
    }
  }, [activeSessionId, sessions]);

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
    } else if (view === "gui") {
      // Re-scan if the gui check state hasn't been fetched yet, or if it belongs to a different session
      setGuiCheckState(prev => {
        if (prev.status === "idle" || prev.sessionId !== sessionId) {
          void checkVpsGuiStatus(sessionId);
        }
        return prev;
      });
    }
  };

  const checkVpsGuiStatus = async (sessionId: string) => {
    setGuiCheckState(prev => ({ ...prev, status: "checking", error: undefined, sessionId }));
    try {
      const info = await window.api.smdCheckStatus(sessionId);
      
      let vncRunning = false;
      if (info.vncInstalled) {
        try {
          const vncCheck = await window.api.sshExec(sessionId, "pgrep -u $(whoami) -x Xvnc >/dev/null && echo YES || echo NO");
          vncRunning = vncCheck.output.trim() === "YES";
        } catch {
          // ignore
        }
      }

      let nxRunning = false;
      if (info.nxInstalled) {
        try {
          const nxCheck = await window.api.sshExec(sessionId, "ss -tln | grep :4000 >/dev/null && echo YES || (netstat -tln | grep :4000 >/dev/null && echo YES || echo NO)");
          nxRunning = nxCheck.output.trim() === "YES";
        } catch {
          // ignore
        }
      }

      setGuiCheckState({
        status: "checked",
        hasGui: info.hasGui,
        deType: info.deType as any,
        deList: info.deList ?? [],
        vncInstalled: info.vncInstalled,
        nxInstalled: info.nxInstalled,
        ramMB: info.ramMB,
        installLog: [],
        sessionId,
        vncRunning,
        vncLoading: false,
        nxRunning,
        nxLoading: false
      });
      if (info.deType && ["xfce", "mate", "gnome", "kde", "cinnamon"].includes(info.deType)) {
        setSelectedDeToInstall(info.deType as any);
      }
    } catch (err: any) {
      setGuiCheckState(prev => ({
        ...prev,
        status: "idle",
        error: err.message || String(err)
      }));
    }
  };

  const installVpsGui = async (sessionId: string, de: "xfce" | "mate" | "gnome" | "kde" | "cinnamon") => {
    setGuiCheckState(prev => ({
      ...prev,
      status: "installing",
      installLog: ["Starting desktop GUI installation via SMD...", "This may take several minutes..."],
      error: undefined
    }));

    const addLog = (msg: string) => setGuiCheckState(prev => ({
      ...prev,
      installLog: [...prev.installLog, msg]
    }));

    try {
      // Step 1: Install desktop environment (skip if already detected)
      if (!guiCheckState.hasGui) {
        addLog(`==> Installing ${de.toUpperCase()} desktop environment using SMD...`);
        const resDe = await window.api.smdInstall(sessionId, de);
        addLog(resDe.output);
        if (!resDe.success) {
          throw new Error(`Failed to install desktop environment ${de}`);
        }
      } else {
        addLog(`==> Desktop environment (${de.toUpperCase()}) already installed, skipping...`);
      }

      // Step 2: Install VNC server using SMD
      addLog("==> Installing and configuring TigerVNC server using SMD...");
      const resVnc = await window.api.smdInstall(sessionId, "tigervnc");
      addLog(resVnc.output);
      if (!resVnc.success) {
        throw new Error("Failed to install TigerVNC server");
      }

      // Automatically configure it for the installed/target DE!
      addLog(`==> Setting default desktop session command for ${de.toUpperCase()}...`);
      const setDeRes = await window.api.smdSetDefaultDe(sessionId, de);
      addLog(setDeRes.output);

      // Step 3: Start VNC server (display :1)
      addLog("==> Starting VNC server on display :1...");
      const startRes = await window.api.sshExec(sessionId, `vncserver -kill :1 2>/dev/null; vncserver :1 -geometry ${vncSettings.resolution} -depth ${vncSettings.depth} -FrameRate ${vncSettings.frameRate} -ZlibLevel ${vncSettings.zlibLevel} -SecurityTypes VncAuth 2>&1 && echo VNC_STARTED || echo VNC_STARTED`);
      if (!startRes.output.includes("VNC_STARTED")) {
          throw new Error(`VNC startup failed. Output:\n${startRes.output}`);
      }

      addLog("Installation completed successfully!");
      addLog("VNC Server running on port 5901.");

      setGuiCheckState(prev => ({
        ...prev,
        status: "checked",
        hasGui: true,
        deType: de,
        vncInstalled: true,
      }));
      showToast("Desktop GUI installed successfully!", "success");

      if (activeSessionHost) {
        const updatedHost = {
          ...activeSessionHost,
          guiEnabled: true,
          guiType: "vnc" as const,
          guiPort: 5901
        };
        await window.api.saveHost(updatedHost);
        void refreshHosts();
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      addLog(`Error: ${errMsg}`);
      setGuiCheckState(prev => ({
        ...prev,
        status: "checked",
        error: errMsg,
      }));
      showToast("GUI Installation failed", "error");
    }
  };

  const installVpsNomachine = async (sessionId: string, de: "xfce" | "mate" | "gnome" | "kde" | "cinnamon") => {
    setGuiCheckState(prev => ({
      ...prev,
      status: "installing",
      installLog: ["Starting NoMachine + Desktop installation via SMD...", "This may take several minutes..."],
      error: undefined
    }));

    const addLog = (msg: string) => setGuiCheckState(prev => ({
      ...prev,
      installLog: [...prev.installLog, msg]
    }));

    try {
      // Step 1: Install desktop environment (skip if already detected)
      if (!guiCheckState.hasGui) {
        addLog(`==> Installing ${de.toUpperCase()} desktop environment using SMD...`);
        const resDe = await window.api.smdInstall(sessionId, de);
        addLog(resDe.output);
        if (!resDe.success) {
          throw new Error(`Failed to install desktop environment ${de}`);
        }
      } else {
        addLog(`==> Desktop environment (${de.toUpperCase()}) already installed, skipping...`);
      }

      // Step 2: Install NoMachine using SMD
      addLog("==> Installing and configuring NoMachine server using SMD...");
      const resNx = await window.api.smdInstall(sessionId, "nomachine");
      addLog(resNx.output);
      if (!resNx.success) {
        throw new Error("Failed to install NoMachine server");
      }

      // Automatically configure it for the installed/target DE!
      addLog(`==> Setting default desktop session command for ${de.toUpperCase()}...`);
      const setDeRes = await window.api.smdSetDefaultDe(sessionId, de);
      addLog(setDeRes.output);

      // Step 3: Start NoMachine server
      addLog("==> Starting NoMachine server...");
      const startRes = await window.api.sshExec(sessionId, "sudo systemctl restart nxserver.service 2>&1 || sudo /etc/NX/nxserver --restart 2>&1 || sudo /etc/NX/nxserver --startup 2>&1 || true");
      
      // Verify NX is installed
      const verifyRes = await window.api.sshExec(sessionId, "command -v nxserver >/dev/null 2>&1 && echo NX_OK || ([ -d /usr/NX ] && echo NX_OK || echo NX_MISSING)");
      const hasNxBinary = verifyRes.output.includes("NX_OK");

      if (hasNxBinary) {
        // Poll/verify NoMachine is running by checking port 4000
        let portOpen = false;
        addLog("==> Verifying NoMachine server is listening on port 4000 (polling up to 15 seconds)...");
        for (let i = 0; i < 15; i++) {
          const verifyPort = await window.api.sshExec(sessionId, "ss -tln | grep :4000 >/dev/null && echo YES || (netstat -tln | grep :4000 >/dev/null && echo YES || echo NO)");
          if (verifyPort.output.trim() === "YES") {
            portOpen = true;
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
        }

        addLog("NoMachine installed successfully!");
        if (portOpen) {
          addLog("NoMachine server is active on port 4000.");
        } else {
          addLog("Warning: NoMachine port 4000 is not active yet. It may take longer to initialize, or you can start it manually.");
        }

        setGuiCheckState(prev => ({
          ...prev,
          status: "checked",
          hasGui: true,
          deType: de,
          nxInstalled: true,
          nxRunning: portOpen,
        }));
        showToast("NoMachine + Desktop installed successfully!", "success");

        if (activeSessionHost) {
          const updatedHost = {
            ...activeSessionHost,
            guiEnabled: true,
            guiType: "nomachine" as const,
            guiPort: 4000
          };
          await window.api.saveHost(updatedHost);
          void refreshHosts();
        }
      } else {
        throw new Error(`NoMachine installation could not be verified. Install Output:\n${resNx.output}\n\nStartup Output:\n${startRes.output}`);
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      addLog(`Error: ${errMsg}`);
      setGuiCheckState(prev => ({
        ...prev,
        status: "checked",
        error: errMsg,
      }));
      showToast("NoMachine Installation failed", "error");
    }
  };

  const uninstallVpsGui = (target: "all" | "de" | "remote" | "nomachine" | "tigervnc") => {
    if (!activeSession) return;
    
    let confirmMsg = "Are you sure you want to completely uninstall the remote display servers and desktop environments? This will also permanently delete user desktop directories (~/Desktop, ~/Documents, ~/Downloads, ~/Pictures, ~/Music, ~/Videos, ~/Public, ~/Templates) from the remote server. This action cannot be undone.";
    let title = "Uninstall GUI Components";
    if (target === "de") {
      confirmMsg = "Are you sure you want to uninstall the Desktop Environment? This will also permanently delete user desktop directories (~/Desktop, ~/Documents, ~/Downloads, ~/Pictures, ~/Music, ~/Videos, ~/Public, ~/Templates) from the remote server. This action cannot be undone.";
      title = "Uninstall Desktop Environment";
    } else if (target === "nomachine") {
      confirmMsg = "Are you sure you want to uninstall NoMachine only? VNC and desktop environments will remain.";
      title = "Uninstall NoMachine";
    } else if (target === "tigervnc") {
      confirmMsg = "Are you sure you want to uninstall TigerVNC only? NoMachine and desktop environments will remain.";
      title = "Uninstall TigerVNC";
    } else if (target === "remote") {
      confirmMsg = "Are you sure you want to uninstall both Remote Display Servers (VNC, NoMachine)? The underlying desktop environments will remain.";
      title = "Uninstall Remote Servers";
    }

    showConfirm(title, confirmMsg, async (choice) => {
      setGuiCheckState(prev => ({
        ...prev,
        status: "installing",
        installLog: ["==> Preparing to uninstall via SMD...", "This might take a minute..."],
        error: undefined
      }));
      
      const addLog = (msg: string) => setGuiCheckState(prev => ({
        ...prev,
        installLog: [...prev.installLog, msg]
      }));
      
      try {
        const exec = async (cmd: string) => {
          const res = await window.api.sshExec(activeSession.sessionId, cmd);
          return res.output;
        };

        const resolvedTarget = (target === "remote" && choice) ? choice : target;
        
        if (resolvedTarget === "remote" || resolvedTarget === "all") {
          // Stop services first
          await exec("sudo systemctl stop nxserver.service 2>/dev/null || true");
          await exec("sudo /etc/NX/nxserver --shutdown 2>/dev/null || true");
          await exec("vncserver -kill :1 2>/dev/null || true");
          
          addLog("==> Removing NoMachine via SMD...");
          const resNx = await window.api.smdUninstall(activeSession.sessionId, "nomachine");
          addLog(resNx.output);

          addLog("==> Removing TigerVNC via SMD...");
          const resVnc = await window.api.smdUninstall(activeSession.sessionId, "tigervnc");
          addLog(resVnc.output);
        } else if (resolvedTarget === "nomachine") {
          await exec("sudo systemctl stop nxserver.service 2>/dev/null || true");
          await exec("sudo /etc/NX/nxserver --shutdown 2>/dev/null || true");
          addLog("==> Removing NoMachine via SMD...");
          const resNx = await window.api.smdUninstall(activeSession.sessionId, "nomachine");
          addLog(resNx.output);
        } else if (resolvedTarget === "tigervnc") {
          await exec("vncserver -kill :1 2>/dev/null || true");
          addLog("==> Removing TigerVNC via SMD...");
          const resVnc = await window.api.smdUninstall(activeSession.sessionId, "tigervnc");
          addLog(resVnc.output);
        }

        if (resolvedTarget === "all" || resolvedTarget === "de") {
          const deToUninstall = guiCheckState.deType && guiCheckState.deType !== "none" ? guiCheckState.deType : "xfce";
          addLog(`==> Removing Desktop Environment (${deToUninstall.toUpperCase()}) via SMD...`);
          const resDe = await window.api.smdUninstall(activeSession.sessionId, deToUninstall);
          addLog(resDe.output);

          addLog("==> Permanently deleting standard user desktop directories...");
          await exec("rm -rf ~/Desktop ~/Documents ~/Downloads ~/Pictures ~/Music ~/Videos ~/Public ~/Templates");
        }
        
        // Always run autoremove
        addLog("==> Cleaning up unused dependencies...");
        await exec("export DEBIAN_FRONTEND=noninteractive; sudo apt-get autoremove -y 2>/dev/null || true");
        
        addLog("Uninstall completed successfully.");
        
        // Update state
        showToast("Uninstall completed", "success");
        
        if (activeSessionHost && (resolvedTarget === "all" || resolvedTarget === "remote" || resolvedTarget === "nomachine" || resolvedTarget === "tigervnc")) {
          const updatedHost = { ...activeSessionHost };
          // Only clear GUI if all remote tools are gone
          if (resolvedTarget === "remote" || resolvedTarget === "all" ||
              (resolvedTarget === "nomachine" && !guiCheckState.vncInstalled) ||
              (resolvedTarget === "tigervnc" && !guiCheckState.nxInstalled)) {
            delete updatedHost.guiEnabled;
            delete updatedHost.guiType;
            delete updatedHost.guiPort;
          }
          await window.api.saveHost(updatedHost);
          void refreshHosts();
        }

        // Trigger a fresh scan
        addLog("==> Scanning system to auto-correct configurations...");
        await checkVpsGuiStatus(activeSession.sessionId);
        
      } catch (err: any) {
         const errMsg = err.message || String(err);
         addLog(`Error during uninstall: ${errMsg}`);
         setGuiCheckState(prev => ({ ...prev, status: "checked", error: errMsg }));
      }
    }, target === "remote", "Uninstall");
  };

  const fetchHostStats = useCallback(async (hostId: string): Promise<void> => {
    if (fetchingStatsHostIdsRef.current.has(hostId)) {
      return;
    }

    const connected = sessions.find((s) => s.hostId === hostId && s.status === "connected");
    if (!connected) return;

    if (
      guiCheckStateRef.current.status === "installing" ||
      guiCheckStateRef.current.status === "checking"
    ) {
      if (guiCheckStateRef.current.sessionId === connected.sessionId) {
        return;
      }
    }

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
      if (now - lastStatsPollAtRef.current >= 8000) {
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
        proxyPassword: h.proxyAuthMethod === "password" ? h.proxyPassword : undefined,
        guiEnabled: h.guiEnabled,
        guiType: h.guiType,
        guiPort: h.guiPort
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
        password: formState.authMethod === "password" ? formState.password : undefined,
        guiEnabled: formState.guiEnabled,
        guiType: formState.guiType,
        guiPort: formState.guiPort
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
    setSftpLoading(true);

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
    } finally {
      setSftpLoading(false);
    }
  };

  const onSftpOpenWorkspace = async (remotePath: string): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    const parts = remotePath.split("/");
    const baseName = parts[parts.length - 1] || "";
    if (baseName.startsWith(".")) {
      showToast("Cannot open hidden folders (like .profile or .cache) as workspaces", "error");
      return;
    }

    setSftpStatus("Opening workspace...");
    try {
      await window.api.sftpOpenWorkspace(activeSessionId, remotePath);
      setSftpStatus(`Workspace opened: ${remotePath}`);
      void refreshWorkspaces();
    } catch (error: unknown) {
      setSftpStatus(`Workspace failed: ${String(error instanceof Error ? error.message : error)}`);
    }
  };

  const onStartVncServer = async (guiPort: number): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Starting VNC server on VPS...");
    setGuiCheckState(prev => ({ ...prev, vncLoading: true }));
    try {
      // Build dynamic xstartup content — prioritizing the currently active DE detected by SMD
      const activeDe = guiCheckState.deType || "xfce";
      const deOrder = [activeDe, ...["xfce", "mate", "cinnamon", "kde", "gnome"].filter(x => x !== activeDe)];
      const checks: string[] = [];
      for (const de of deOrder) {
        if (de === "kde") {
          checks.push(
            "command -v startplasma-x11 >/dev/null 2>&1; then\n  exec dbus-run-session -- startplasma-x11",
            "command -v startkde >/dev/null 2>&1; then\n  exec dbus-run-session -- startkde"
          );
        } else if (de === "cinnamon") {
          checks.push("command -v cinnamon-session >/dev/null 2>&1; then\n  exec dbus-run-session -- cinnamon-session");
        } else if (de === "xfce") {
          checks.push("command -v startxfce4 >/dev/null 2>&1; then\n  exec dbus-run-session -- startxfce4");
        } else if (de === "mate") {
          checks.push("command -v mate-session >/dev/null 2>&1; then\n  exec dbus-run-session -- mate-session");
        } else if (de === "gnome") {
          checks.push("command -v gnome-session >/dev/null 2>&1; then\n  exec dbus-run-session -- gnome-session");
        }
      }

      const conditionalBlocks = checks.map((chk, index) => {
        const prefix = index === 0 ? "if" : "elif";
        return `${prefix} ${chk}`;
      });

      // Calculate display number based on port. VNC port = 5900 + display.
      // Default VNC port 5901 = :1
      const displayNum = guiPort >= 5900 && guiPort < 6000 ? (guiPort - 5900) : 1;

      const xstartupContent = [
        "#!/bin/sh",
        "unset SESSION_MANAGER",
        "unset DBUS_SESSION_BUS_ADDRESS",
        "export XDG_SESSION_TYPE=x11",
        ...conditionalBlocks,
        "elif command -v openbox-session >/dev/null 2>&1; then",
        "  exec openbox-session",
        "elif command -v openbox >/dev/null 2>&1; then",
        "  exec openbox",
        "else",
        "  xterm",
        "fi",
      ].join("\n") + "\n";

      // Write the full setup script via SFTP (avoids any exec channel multiline/length issues)
      const setupScript = [
        "#!/bin/bash",
        "mkdir -p ~/.vnc",
        // Write xstartup (already uploaded separately via SFTP below)
        "chmod +x ~/.vnc/xstartup",
        // Hardcode the encrypted VNC password for 'shadow' (Bex4lXJvDCY=) to bypass unreliable vncpasswd commands
        "echo 'Bex4lXJvDCY=' | base64 -d > ~/.vnc/passwd",
        "chmod 600 ~/.vnc/passwd",
        // Clean kill
        `vncserver -kill :${displayNum} >/dev/null 2>&1 || true`,
        "pkill -15 -u \"$(whoami)\" -f Xvnc >/dev/null 2>&1 || true",
        "sleep 1",
        "pkill -9 -u \"$(whoami)\" -f Xvnc >/dev/null 2>&1 || true",
        `rm -rf /tmp/.X11-unix/X${displayNum} /tmp/.X${displayNum}-lock ~/.vnc/*.pid ~/.vnc/*.log /tmp/vnc_start.log`,
        // Start vncserver — daemonizes, exec channel closes after this line
        // Start with high-quality / high-performance TigerVNC settings:
        //   -geometry 1920x1080  → Full HD resolution
        //   -depth 24            → True colour (24bpp)
        //   -FrameRate 60        → Up to 60 fps updates
        //   -ZlibLevel 1         → Fastest zlib compression (lower latency)
        //   -SecurityTypes VncAuth → Standard password auth
        //   (localhost binding defaults to 0 = accept all, SSH tunnel handles security)
        `vncserver :${displayNum} -rfbport ${guiPort} -geometry ${vncSettings.resolution} -depth ${vncSettings.depth} -FrameRate ${vncSettings.frameRate} -ZlibLevel ${vncSettings.zlibLevel} -SecurityTypes VncAuth >/tmp/vnc_start.log 2>&1`,
        "echo SETUP_DONE",
      ].join("\n") + "\n";

      // Upload both files via SFTP — guaranteed to work, no exec channel length issues
      await window.api.sshWriteFile(activeSessionId, "/tmp/vnc_xstartup.sh", xstartupContent);
      await window.api.sshWriteFile(activeSessionId, "/tmp/vnc_setup.sh", setupScript);
      console.log("[VNC] Scripts uploaded via SFTP");

      // Short exec: copy xstartup into place, make executable
      const cpRes = await window.api.sshExec(activeSessionId, "cp /tmp/vnc_xstartup.sh ~/.vnc/xstartup && chmod +x ~/.vnc/xstartup && echo CP_OK");
      console.log("[VNC-CP]:", cpRes.output);

      // Run the setup script — short command, always works
      const setupRes = await window.api.sshExec(activeSessionId, "bash /tmp/vnc_setup.sh");
      console.log("[VNC-SETUP]:", setupRes.output);

      // Poll port in a separate exec (vncserver daemonizes so setup closes first)
      const pollRes = await window.api.sshExec(activeSessionId,
        `for i in $(seq 1 20); do (echo > /dev/tcp/localhost/${guiPort}) 2>/dev/null && echo VNC_PORT_READY && break; sleep 1; done; cat /tmp/vnc_start.log 2>/dev/null; pgrep -ax Xvnc || echo NO_XVNC`
      );
      console.log("[VNC-POLL]:", pollRes.output);

      if (!pollRes.output.includes("VNC_PORT_READY")) {
        throw new Error(`VNC server did not start on port ${guiPort} within 20s.\nLog: ${pollRes.output.slice(0, 800)}`);
      }

      setSftpStatus("VNC server started successfully on VPS");
      setGuiCheckState(prev => ({
        ...prev,
        vncRunning: true,
        vncLoading: false
      }));
    } catch (error: unknown) {
      setSftpStatus(`VNC server startup failed: ${String(error instanceof Error ? error.message : error)}`);
      showToast(String(error instanceof Error ? error.message : error), "error");
      setGuiCheckState(prev => ({ ...prev, vncLoading: false }));
    }
  };

  const onStopVncServer = async (): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Stopping VNC server on VPS...");
    setGuiCheckState(prev => ({ ...prev, vncLoading: true }));
    try {
      await window.api.sshExec(activeSessionId, "vncserver -kill :1 >/dev/null 2>&1 || true; pkill -9 -u \"$(whoami)\" -f Xvnc >/dev/null 2>&1 || true");
      await window.api.sftpCloseGuiConnection(activeSessionId, "vnc");
      setSftpStatus("VNC server stopped successfully");
      setGuiCheckState(prev => ({
        ...prev,
        vncRunning: false,
        vncLoading: false
      }));
    } catch (error: unknown) {
      setSftpStatus(`Stopping VNC failed: ${String(error instanceof Error ? error.message : error)}`);
      showToast(String(error instanceof Error ? error.message : error), "error");
      setGuiCheckState(prev => ({ ...prev, vncLoading: false }));
    }
  };

  const onLaunchVncViewer = async (guiPort: number, viewer?: "remmina" | "tigervnc"): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Launching VNC Viewer...");
    setVncLaunching(true);
    try {
      await window.api.sftpOpenGuiConnection(activeSessionId, "vnc", guiPort, viewer ?? vncViewer, {
        qualityLevel: vncSettings.qualityLevel,
        compressLevel: vncSettings.compressLevel,
        encoding: vncSettings.encoding,
      });
      setSftpStatus("VNC GUI launched successfully");
    } catch (error: unknown) {
      setSftpStatus(`VNC viewer launch failed: ${String(error instanceof Error ? error.message : error)}`);
      showToast(String(error instanceof Error ? error.message : error), "error");
    } finally {
      setTimeout(() => setVncLaunching(false), 3000);
    }
  };

  const onStartNxServer = async (): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Starting NoMachine server on VPS...");
    setGuiCheckState(prev => ({ ...prev, nxLoading: true }));
    try {
      // Always re-apply the DE session config before starting NX so we never
      // resume a stale/broken session from a previous desktop environment.
      // setDefaultDe now STOPS nxserver and clears sessions but does NOT restart it.
      const activeDe = guiCheckState.deType;
      if (activeDe) {
        setSftpStatus(`Configuring desktop session for ${activeDe.toUpperCase()}...`);
        await window.api.smdSetDefaultDe(activeSessionId, activeDe);
      }

      // Now explicitly start nxserver fresh.
      // reset-failed is needed because pkill -9 in setDefaultDe makes systemd think it crashed.
      setSftpStatus("Starting NoMachine server...");
      await window.api.sshExec(activeSessionId, [
        "sudo systemctl reset-failed nxserver.service 2>/dev/null || true",
        "sudo systemctl start nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --startup 2>/dev/null || true"
      ].join(" && "));

      // Poll/verify NoMachine is running by checking port 4000 (up to 30s since full wipe can be slow)
      setSftpStatus("Waiting for NoMachine to come online...");
      let verified = false;
      for (let i = 0; i < 30; i++) {
        const verifyPort = await window.api.sshExec(activeSessionId, "ss -tln | grep :4000 >/dev/null && echo YES || (netstat -tln | grep :4000 >/dev/null && echo YES || echo NO)");
        if (verifyPort.output.trim() === "YES") {
          verified = true;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      if (!verified) {
        throw new Error("NoMachine server failed to start (port 4000 remains closed after 30s).");
      }

      setSftpStatus("NoMachine server started successfully");
      setGuiCheckState(prev => ({
        ...prev,
        nxRunning: true,
        nxLoading: false
      }));
      showToast(`NoMachine started with ${activeDe?.toUpperCase() ?? "desktop"} session`, "success");
    } catch (error: unknown) {
      setSftpStatus(`NoMachine startup failed: ${String(error instanceof Error ? error.message : error)}`);
      showToast(String(error instanceof Error ? error.message : error), "error");
      setGuiCheckState(prev => ({ ...prev, nxLoading: false }));
    }
  };

  const onStopNxServer = async (): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Stopping NoMachine server on VPS...");
    setGuiCheckState(prev => ({ ...prev, nxLoading: true }));
    try {
      await window.api.sshExec(activeSessionId, "sudo systemctl stop nxserver.service 2>/dev/null || sudo /etc/NX/nxserver --shutdown 2>/dev/null || true");
      await window.api.sftpCloseGuiConnection(activeSessionId, "nomachine");
      setSftpStatus("NoMachine server stopped successfully");
      setGuiCheckState(prev => ({
        ...prev,
        nxRunning: false,
        nxLoading: false
      }));
    } catch (error: unknown) {
      setSftpStatus(`Stopping NoMachine failed: ${String(error instanceof Error ? error.message : error)}`);
      showToast(String(error instanceof Error ? error.message : error), "error");
      setGuiCheckState(prev => ({ ...prev, nxLoading: false }));
    }
  };

  const onLaunchNoMachine = async (guiPort: number): Promise<void> => {
    if (!activeSessionId) {
      return;
    }

    setSftpStatus("Launching NoMachine client...");
    setNxLaunching(true);
    try {
      await window.api.sftpOpenGuiConnection(activeSessionId, "nomachine", guiPort);
      setSftpStatus("NoMachine GUI launched successfully");
    } catch (error: unknown) {
      setSftpStatus(`NoMachine launch failed: ${String(error instanceof Error ? error.message : error)}`);
      showToast(String(error instanceof Error ? error.message : error), "error");
    } finally {
      setTimeout(() => setNxLaunching(false), 3000);
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
    setSftpLoading(true);
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
    } finally {
      setSftpLoading(false);
    }
  };

  const onSftpDelete = async (remotePath: string): Promise<void> => {
    if (!activeSessionId) return;
    const name = remotePath.split("/").pop() ?? remotePath;
    showConfirm("Delete Remote Item",`Delete "${name}" permanently from the remote server? This cannot be undone.`,async () => {
      setSftpStatus(`Deleting ${name}...`);
      setSftpLoading(true);
      try {
        await window.api.sftpDelete(activeSessionId, remotePath);
        setSftpStatus(`Deleted: ${name}`);
        const currentDir = (sftpPathBySession.current.get(activeSessionId) ?? "/").trim() || "/";
        await refreshSftp(currentDir);
      } catch (error: unknown) {
        setSftpStatus(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setSftpLoading(false);
      }
    });
  };

  const sftpCopiedPathRef = useRef<string | null>(null);

  const onSftpCopyPath = (remotePath: string): void => {
    void navigator.clipboard.writeText(remotePath).then(() => {
      showToast(`Copied path: ${remotePath}`, "info");
    });
  };

  const onSftpCopy = (remotePath: string): void => {
    const name = remotePath.split("/").pop() ?? remotePath;
    sftpCopiedPathRef.current = remotePath;
    void navigator.clipboard.writeText(name).then(() => {
      showToast(`Copied: ${name}`, "info");
    });
    setSftpStatus(`Copied: ${name}. Navigate and paste.`);
  };

  const onSftpPaste = async (): Promise<void> => {
    if (!activeSessionId) return;
    const sourcePath = sftpCopiedPathRef.current;
    if (!sourcePath) {
      setSftpStatus("Nothing copied. Use Copy button first.");
      return;
    }
    const currentDir = (sftpPathBySession.current.get(activeSessionId) ?? "/").trim() || "/";
    const sourceName = sourcePath.split("/").pop() ?? "item";
    const destPath = currentDir === "/" ? `/${sourceName}` : `${currentDir}/${sourceName}`;
    if (destPath === sourcePath) {
      setSftpStatus("Source and destination are the same");
      return;
    }
    setSftpStatus(`Pasting ${sourceName} to ${currentDir}...`);
    try {
      await window.api.sftpCopy(activeSessionId, sourcePath, destPath);
      setSftpStatus(`Pasted: ${sourceName}`);
      await refreshSftp(currentDir);
    } catch (error: unknown) {
      setSftpStatus(`Paste failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onSftpMkdir = async (): Promise<void> => {
    if (!activeSessionId) return;
    const name = await showPrompt("Create Folder", "Folder name:", "");
    if (!name?.trim()) {
      setSftpStatus("Folder creation cancelled");
      return;
    }
    const currentDir = (sftpPathBySession.current.get(activeSessionId) ?? "/").trim() || "/";
    const remotePath = currentDir === "/" ? `/${name.trim()}` : `${currentDir}/${name.trim()}`;
    setSftpStatus(`Creating folder: ${name.trim()}...`);
    try {
      await window.api.sftpMkdir(activeSessionId, remotePath);
      setSftpStatus(`Created folder: ${name.trim()}`);
      await refreshSftp(currentDir);
    } catch (error: unknown) {
      setSftpStatus(`Mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onSftpCreateFile = async (): Promise<void> => {
    if (!activeSessionId) return;
    const name = await showPrompt("Create File", "File name:", "");
    if (!name?.trim()) {
      setSftpStatus("File creation cancelled");
      return;
    }
    const currentDir = (sftpPathBySession.current.get(activeSessionId) ?? "/").trim() || "/";
    const remotePath = currentDir === "/" ? `/${name.trim()}` : `${currentDir}/${name.trim()}`;
    setSftpStatus(`Creating file: ${name.trim()}...`);
    try {
      await window.api.sftpCreateFile(activeSessionId, remotePath);
      setSftpStatus(`Created file: ${name.trim()}`);
      await refreshSftp(currentDir);
    } catch (error: unknown) {
      setSftpStatus(`Create file failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onSftpRename = async (oldPath: string): Promise<void> => {
    if (!activeSessionId) return;
    const oldName = oldPath.split("/").pop() ?? oldPath;
    const newName = await showPrompt(`Rename`, "New name:", oldName);
    if (!newName?.trim() || newName.trim() === oldName) {
      setSftpStatus("Rename cancelled");
      return;
    }
    const parentDir = getParentPath(oldPath);
    const newPath = parentDir === "/" ? `/${newName.trim()}` : `${parentDir}/${newName.trim()}`;
    setSftpStatus(`Renaming ${oldName} to ${newName.trim()}...`);
    try {
      await window.api.sftpRename(activeSessionId, oldPath, newPath);
      setSftpStatus(`Renamed to: ${newName.trim()}`);
      const currentDir = (sftpPathBySession.current.get(activeSessionId) ?? "/").trim() || "/";
      await refreshSftp(currentDir);
    } catch (error: unknown) {
      setSftpStatus(`Rename failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const onSftpMove = async (sourcePath: string): Promise<void> => {
    if (!activeSessionId) return;
    const sourceName = sourcePath.split("/").pop() ?? sourcePath;
    const currentDir = (sftpPathBySession.current.get(activeSessionId) ?? "/").trim() || "/";
    const targetDir = `${currentDir}/${sourceName}`;
    const destPath = await showPrompt("Move", `Move "${sourceName}" to:`, targetDir);
    if (!destPath?.trim() || destPath.trim() === sourcePath) {
      setSftpStatus("Move cancelled");
      return;
    }
    setSftpStatus(`Moving ${sourceName} to ${destPath.trim()}...`);
    try {
      await window.api.sftpRename(activeSessionId, sourcePath, destPath.trim());
      setSftpStatus(`Moved to: ${destPath.trim()}`);
      await refreshSftp(currentDir);
    } catch (error: unknown) {
      setSftpStatus(`Move failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const contextMenuCleanupRef = useRef<(() => void) | null>(null);

  const showContextMenu = (items: Array<{ label: string; action: () => void; disabled?: boolean; danger?: boolean }>, x: number, y: number): void => {
    if (contextMenuCleanupRef.current) {
      contextMenuCleanupRef.current();
      contextMenuCleanupRef.current = null;
    }
    const existing = document.querySelector(".app-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "app-context-menu";
    menu.style.position = "fixed";
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.style.zIndex = "99999";
    menu.style.background = "var(--surface, #1a1d23)";
    menu.style.border = "1px solid var(--border, #333)";
    menu.style.borderRadius = "8px";
    menu.style.padding = "4px 0";
    menu.style.minWidth = "170px";
    menu.style.boxShadow = "0 8px 24px rgba(0,0,0,0.6)";
    menu.style.fontSize = "13px";

    for (const item of items) {
      if (item.label === "---") {
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:var(--border,#333);margin:4px 8px;";
        menu.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.textContent = item.label;
      btn.disabled = item.disabled ?? false;
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.padding = "7px 16px";
      btn.style.border = "none";
      btn.style.background = "none";
      btn.style.color = item.danger ? "var(--error,#e05353)" : "var(--text,#ddd)";
      btn.style.fontSize = "13px";
      btn.style.textAlign = "left";
      btn.style.cursor = btn.disabled ? "default" : "pointer";
      btn.style.opacity = btn.disabled ? "0.4" : "1";
      btn.onmouseenter = () => { if (!btn.disabled) btn.style.background = "var(--hover,#333)"; };
      btn.onmouseleave = () => { btn.style.background = "none"; };
      btn.onclick = () => {
        if (!btn.disabled) item.action();
        cleanup();
      };
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      menu.style.left = `${Math.max(5, window.innerWidth - rect.width - 5)}px`;
    }
    if (y + rect.height > window.innerHeight) {
      menu.style.top = `${Math.max(5, window.innerHeight - rect.height - 5)}px`;
    }

    const cleanup = (): void => {
      if (document.body.contains(menu)) {
        document.body.removeChild(menu);
      }
      document.removeEventListener("click", handleClick);
      document.removeEventListener("contextmenu", handleClick);
      contextMenuCleanupRef.current = null;
    };

    const handleClick = (): void => cleanup();
    setTimeout(() => {
      document.addEventListener("click", handleClick);
      document.addEventListener("contextmenu", handleClick);
    }, 0);

    contextMenuCleanupRef.current = cleanup;
  };

  const onSftpContextMenu = (entry: SFTPEntry, x: number, y: number): void => {
    const items: Array<{ label: string; action: () => void; disabled?: boolean; danger?: boolean }> = [];
    if (entry.isDirectory) {
      items.push({ label: "Open", action: () => { void refreshSftp(entry.path); } });
      if (!entry.name.startsWith(".")) {
        items.push({ label: "Open Workspace", action: () => { void onSftpOpenWorkspace(entry.path); } });
      }
      items.push({ label: "---", action: () => {} });
    } else {
      items.push({ label: "Edit", action: () => { void onSftpEditFile(entry.path); } });
      items.push({ label: "Download", action: () => { void onSftpDownload(entry.path); } });
      if (entry.name.toLowerCase().endsWith(".zip")) {
        items.push({ label: "Extract", action: () => { void onSftpExtractZip(entry.path); } });
      }
      items.push({ label: "---", action: () => {} });
    }
    items.push({ label: "Copy Name", action: () => { onSftpCopy(entry.path); } });
    items.push({ label: "Copy Path", action: () => { onSftpCopyPath(entry.path); } });
    items.push({ label: "Rename", action: () => { void onSftpRename(entry.path); } });
    items.push({ label: "Move", action: () => { void onSftpMove(entry.path); } });
    items.push({ label: "Download", action: () => { void onSftpDownload(entry.path); } });
        items.push({ label: "---", action: () => {} });
        items.push({ label: "Delete", action: () => { void onSftpDelete(entry.path); }, danger: true });
    showContextMenu(items, x, y);
  };

  const onSftpBackgroundContextMenu = (x: number, y: number): void => {
    const items: Array<{ label: string; action: () => void; disabled?: boolean; danger?: boolean }> = [
      { label: "New Folder", action: () => { void onSftpMkdir(); } },
      { label: "New File", action: () => { void onSftpCreateFile(); } },
      { label: "---", action: () => {} },
      { label: "Paste", action: () => { void onSftpPaste(); }, disabled: !sftpCopiedPathRef.current },
      { label: "Upload", action: () => { void onSftpUpload(); } },
      { label: "---", action: () => {} },
      { label: "Refresh", action: () => { void refreshSftp(); } },
    ];
    showContextMenu(items, x, y);
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

  if (appLoading) {
    return (
      <div className="app-splash-screen">
        <div className="app-splash-bg-effects">
          <div className="splash-icon icon-1">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <div className="splash-icon icon-2">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <div className="splash-icon icon-3">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div className="splash-icon icon-4">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </div>
          <div className="splash-icon icon-5">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div className="splash-icon icon-6">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div className="splash-icon icon-7">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <line x1="9" y1="1" x2="9" y2="4" />
              <line x1="15" y1="1" x2="15" y2="4" />
              <line x1="9" y1="20" x2="9" y2="23" />
              <line x1="15" y1="20" x2="15" y2="23" />
              <line x1="20" y1="9" x2="23" y2="9" />
              <line x1="20" y1="15" x2="23" y2="15" />
              <line x1="1" y1="9" x2="4" y2="9" />
              <line x1="1" y1="15" x2="4" y2="15" />
            </svg>
          </div>
          <div className="splash-icon icon-8">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <div className="splash-icon icon-9">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
              <line x1="2" y1="9" x2="22" y2="9" />
              <line x1="8" y1="21" x2="8" y2="9" />
            </svg>
          </div>
          <div className="splash-icon icon-10">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
        </div>
        <div className="app-splash-content">
          <img src={appLogoPath} alt="ShadowSSH" className="app-splash-logo" />
          <h1 className="app-splash-title">ShadowSSH</h1>
          <div className="app-splash-loader">
            <div className="app-splash-spinner" />
          </div>
        </div>
      </div>
    );
  }

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
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`ghost-btn small stream-mode-btn ${streamMode ? "active" : ""}`}
                  title={streamMode ? "Streaming Mode: ON (sensitive info hidden)" : "Streaming Mode: OFF (sensitive info visible)"}
                  onClick={() => setStreamMode(!streamMode)}
                  style={{
                    padding: "3px 6px",
                    display: "inline-flex",
                    alignItems: "center",
                    border: "none",
                    background: "transparent",
                    color: streamMode ? "var(--accent)" : "var(--muted)",
                    cursor: "pointer",
                    transition: "color 0.2s ease"
                  }}
                >
                  {streamMode ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
                <button type="button" className="ghost-btn small" onClick={openCreateModal}>+ New</button>
                <button type="button" className="ghost-btn small" title="Refresh" onClick={() => void refreshHosts()}>↻</button>
              </div>
            </div>
            {streamMode && (
              <div className="stream-mode-badge" style={{
                margin: "0 0 12px 0",
                padding: "6px 10px",
                background: "color-mix(in oklab, var(--accent) 12%, transparent)",
                border: "1px solid color-mix(in oklab, var(--accent) 25%, transparent)",
                borderRadius: "6px",
                color: "var(--accent)",
                fontSize: "0.75rem",
                fontWeight: "600",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}>
                <span className="dot dot-connected" style={{ width: "8px", height: "8px" }} />
                Streaming Mode Enabled
              </div>
            )}
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
                      {streamMode && (host.name === host.host || /^[0-9.]+$/.test(host.name)) ? maskHost(host.name) : host.name}
                    </div>
                    <div className="host-meta">
                      {streamMode ? maskUsername(host.username) : host.username}@{streamMode ? maskHost(host.host) : host.host}:{host.port}
                    </div>
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
                      <span className="conn-name">
                        {streamMode && (session.profileName === session.hostLabel || /^[0-9.]+$/.test(session.profileName) || session.profileName.includes("@"))
                          ? maskHostLabel(session.hostLabel)
                          : session.profileName || session.hostLabel}
                      </span>
                    </div>
                    <div className="conn-host">
                      {streamMode ? maskHostLabel(session.hostLabel) : session.hostLabel}
                    </div>
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
                                  sftpStartPath: h.sftpStartPath,
                                  guiEnabled: h.guiEnabled,
                                  guiType: h.guiType,
                                  guiPort: h.guiPort
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
                        <option value="cursor">Cursor</option>
                        <option value="codium">VSCodium</option>
                        <option value="antigravity">Antigravity</option>
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
                
                <div className="sidebar-section-title" style={{ marginTop: '24px' }}>Workspace Editor</div>
                <p className="editor-desc">
                  Select an application to open full remote folders. (Requires native Remote SSH support in the editor).
                </p>
                <label>
                  Workspace Application
                  <select
                    value={settingsDraft.workspaceEditorCommand ?? "code"}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, workspaceEditorCommand: e.target.value }))}
                  >
                      <optgroup label="Remote-SSH Capable">
                        <option value="code">Visual Studio Code</option>
                        <option value="cursor">Cursor</option>
                        <option value="codium">VSCodium</option>
                        <option value="antigravity">Antigravity</option>
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
                <p style={{ color: 'var(--muted)', margin: 0, fontSize: '0.85rem' }}>Version {__APP_VERSION__}</p>
              </div>
              <div className="backup-sep" />
              <div style={{ marginTop: '12px', fontSize: '0.85rem', lineHeight: 1.6 }}>
                <p><strong>Credits:</strong> ismdevz</p>
                <p><strong>Open Source:</strong> ShadowSSH is an open source project.</p>
                <div style={{ marginTop: '16px' }}>
                  <button type="button" className="ghost-btn" onClick={() => window.open('https://github.com/ismdevz', '_blank')}>
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
                    Version {updateInfo.latestVersion} is available.
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
                  <span className="tab-title">
                    {streamMode && (session.profileName === session.hostLabel || /^[0-9.]+$/.test(session.profileName) || session.profileName.includes("@"))
                      ? `${maskHostLabel(session.hostLabel)} (${session.view === "sftp" ? "SFTP" : session.view === "gui" ? "GUI" : "Terminal"})`
                      : session.title}
                  </span>
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
                const latencyTone = latencyMs === null ? "red" : latencyMs <= 120 ? "green" : latencyMs <= 300 ? "yellow" : "red";
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
                <button
                  type="button"
                  className={`vs-btn ${activeSession.view === "gui" ? "active" : ""}`}
                  onClick={() => switchSessionView(activeSession.sessionId, "gui")}
                >
                  Desktop GUI
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
                <span className="statusbar-name">
                  {streamMode && (activeSession.profileName === activeSession.hostLabel || /^[0-9.]+$/.test(activeSession.profileName)) ? maskHostLabel(activeSession.profileName) : activeSession.profileName}
                </span>
              ) : null}
              <span className="statusbar-sep">·</span>
              <span className="statusbar-host">
                {streamMode ? maskHostLabel(activeSession.hostLabel) : activeSession.hostLabel}
              </span>
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
              style={{ backgroundColor: terminalThemes[settings.terminalTheme]?.background || '#000' }}
              ref={(node) => {
                if (node) {
                  paneRefs.current.set(session.sessionId, node);
                }
              }}
            />
          ))}

          {activeSession?.view === "sftp" ? (
            <aside id="sftp-panel" className="sftp-panel sftp-tab-panel">
              <div className="sftp-tab-header">
                <button
                  type="button"
                  className={`sftp-tab-btn ${sftpTab === "files" ? "active" : ""}`}
                  onClick={() => setSftpTab("files")}
                >
                  Files & Folders
                </button>
                <button
                  type="button"
                  className={`sftp-tab-btn ${sftpTab === "workspaces" ? "active" : ""}`}
                  onClick={() => setSftpTab("workspaces")}
                >
                  Workspaces
                </button>
              </div>
              {sftpLoading && (
                <div className="sftp-progress-bar">
                  <div className="sftp-progress-line" />
                </div>
              )}

              {sftpTab === "workspaces" ? (
                <div className="sftp-controls">
                  <button type="button" className="ghost-btn small" onClick={() => void refreshWorkspaces()}>↻ Refresh</button>
                  <span className="sftp-status" style={{ flex: 1, padding: 0 }}>Registered workspaces on this server</span>
                </div>
              ) : (
                <>
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
                    <span className="sftp-control-sep">|</span>
                    <button type="button" className="ghost-btn small" disabled={!activeSession} onClick={() => void onSftpMkdir()}>+Folder</button>
                    <button type="button" className="ghost-btn small" disabled={!activeSession} onClick={() => void onSftpCreateFile()}>+File</button>
                  </div>
                </>
              )}
              <div id="sftp-status" className="sftp-status">{sftpStatus}</div>
              <div className={`sftp-header ${sftpTab === "workspaces" ? "workspace-header" : ""}`}>
                <span>{sftpTab === "workspaces" ? "Workspace Path" : "Name"}</span>
                {sftpTab !== "workspaces" && <span>Size</span>}
                <span>{sftpTab === "workspaces" ? "Last Opened" : "Modified"}</span>
                <span>Actions</span>
              </div>
              <div id="sftp-list" className="sftp-list" onContextMenu={(e) => { if (sftpTab === "workspaces") return; const target = e.target as HTMLElement; if (target.closest(".sftp-item")) return; e.preventDefault(); onSftpBackgroundContextMenu(e.clientX, e.clientY); }}>
                {sftpTab === "workspaces" ? (
                  sftpWorkspaces.length === 0 ? (
                    <div className="sftp-empty">No workspaces found on this server</div>
                  ) : (
                    sftpWorkspaces.map((ws) => (
                      <div
                        className="sftp-item workspace-item"
                        key={ws.path}
                      >
                        <div
                          className="sftp-main"
                          onClick={() => void onSftpOpenWorkspace(ws.path)}
                          title={`Open ${ws.path} in VSCode`}
                        >
                          <span className="sftp-type"><FolderIcon /></span>
                          <span className="sftp-name" style={{ fontWeight: 500 }}>{ws.path}</span>
                        </div>
                        <span className="sftp-mtime">{formatModTime(new Date(ws.updatedAt).getTime() / 1000)}</span>
                        <div className="sftp-actions">
                          <button
                            type="button"
                            className="ghost-btn small"
                            onClick={() => void onSftpOpenWorkspace(ws.path)}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="ghost-btn small danger"
                            onClick={() => {
                              showConfirm(
                                "Delete Workspace Reference",
                                `Are you sure you want to delete the workspace reference for "${ws.path}"?\n\nThis will not delete your files on the server.`,
                                () => {
                                  void window.api.sftpDeleteWorkspace(activeSessionId!, ws.path)
                                    .then(() => refreshWorkspaces())
                                    .catch((err) => showToast(String(err), "error"));
                                }
                              );
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )
                ) : (
                  sftpEntries.length === 0 ? (
                    <div className="sftp-empty">Directory is empty</div>
                  ) : (
                    sftpEntries.map((entry) => (
                      <div
                        className={`sftp-item ${selectedRemotePath === entry.path ? "active" : ""}`}
                        key={entry.path}
                        onClick={() => {
                          setSelectedRemotePath(entry.path);
                        }}
                        onDoubleClick={() => {
                          if (entry.isDirectory) {
                            void refreshSftp(entry.path);
                          } else {
                            void onSftpEditFile(entry.path);
                          }
                        }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSftpContextMenu(entry, e.clientX, e.clientY); }}
                      >
                        <div className="sftp-main">
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
                  )
                )}
              </div>
            </aside>
          ) : null}

          {activeSession?.view === "gui" ? (
            <aside id="gui-panel" className="gui-tab-panel">
              <div className="sftp-breadcrumb-row" style={{ minHeight: "auto", padding: "10px 14px" }}>
                <span className="statusbar-name">Desktop GUI Environment Manager</span>
              </div>

              <div style={{ flex: 1, padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
                {guiCheckState.status === "checking" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "12px", color: "var(--muted)" }}>
                    <div className="sftp-progress-bar" style={{ width: "200px" }}><div className="sftp-progress-line" /></div>
                    <p style={{ fontSize: "0.85rem" }}>Auditing VPS display packages and system resources...</p>
                  </div>
                )}

                {guiCheckState.status === "installing" && (
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div className="sftp-progress-bar" style={{ flex: 1 }}><div className="sftp-progress-line" /></div>
                      <span style={{ fontSize: "0.8rem", color: "var(--accent)" }}>Installing...</span>
                    </div>
                    <div style={{
                      flex: 1,
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid var(--line)",
                      borderRadius: "8px",
                      padding: "12px",
                      fontFamily: "monospace",
                      fontSize: "0.75rem",
                      color: "#39ff14",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      maxHeight: "300px"
                    }}>
                      {guiCheckState.installLog.join("\n")}
                    </div>
                  </div>
                )}

                {guiCheckState.error && (
                  <div style={{ padding: "14px", border: "1px solid #ff4a4a", borderRadius: "8px", background: "rgba(255, 74, 74, 0.1)", color: "#ff8888", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h4 style={{ margin: 0, fontWeight: 600 }}>Error Encountered</h4>
                    <p style={{ margin: 0, fontSize: "0.8rem" }}>{guiCheckState.error}</p>
                    <button type="button" className="ghost-btn small" onClick={() => void checkVpsGuiStatus(activeSession.sessionId)} style={{ alignSelf: "flex-start", marginTop: "4px" }}>Retry Audit</button>
                  </div>
                )}

                {guiCheckState.status === "checked" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {/* Status Cards Row */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "12px",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid var(--line)",
                      borderRadius: "10px",
                      padding: "16px"
                    }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>RAM</div>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {guiCheckState.ramMB} MB
                          {guiCheckState.ramMB < 2048 ? (
                            <span style={{ color: "#ffb703", fontSize: "0.72rem", marginLeft: "6px" }}>(Low)</span>
                          ) : (
                            <span style={{ color: "var(--accent)", fontSize: "0.72rem", marginLeft: "6px" }}>(OK)</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Desktop</div>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {guiCheckState.hasGui ? (
                            guiCheckState.deList && guiCheckState.deList.length > 1 ? (
                              <select
                                value={guiCheckState.deType}
                                onChange={async (e) => {
                                  if (!activeSession) return;
                                  const newDe = e.target.value;
                                  // Update state immediately
                                  setGuiCheckState(prev => ({ ...prev, deType: newDe }));
                                  showToast(`Setting default desktop to ${newDe.toUpperCase()}...`, "info");
                                  const res = await window.api.smdSetDefaultDe(activeSession.sessionId, newDe);
                                  if (res.success) {
                                    showToast(`Default desktop successfully changed to ${newDe.toUpperCase()}!`, "success");
                                    void checkVpsGuiStatus(activeSession.sessionId);
                                  } else {
                                    showToast(`Failed to change default desktop: ${res.output}`, "error");
                                    void checkVpsGuiStatus(activeSession.sessionId);
                                  }
                                }}
                                style={{
                                  background: "rgba(0, 0, 0, 0.4)",
                                  color: "var(--accent)",
                                  border: "1px solid var(--accent)",
                                  borderRadius: "4px",
                                  padding: "2px 6px",
                                  fontSize: "0.85rem",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  outline: "none"
                                }}
                              >
                                {guiCheckState.deList.map((de) => (
                                  <option key={de} value={de} style={{ background: "#1f1f2e", color: "#fff" }}>
                                    {de.toUpperCase()}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span style={{ color: "var(--accent)" }}>{guiCheckState.deType.toUpperCase()}</span>
                            )
                          ) : (
                            <span style={{ color: "var(--muted)" }}>None</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Servers</div>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem", display: "flex", gap: "8px" }}>
                          <span style={{ color: guiCheckState.vncInstalled ? "var(--accent)" : "var(--muted)" }}>
                            VNC {guiCheckState.vncInstalled ? "✓" : "✗"}
                          </span>
                          <span style={{ color: guiCheckState.nxInstalled ? "var(--accent)" : "var(--muted)" }}>
                            NX {guiCheckState.nxInstalled ? "✓" : "✗"}
                          </span>
                        </div>
                      </div>
                      </div>

                    {/* Manage Section - shown when any GUI component is detected */}
                    {(guiCheckState.hasGui || guiCheckState.vncInstalled || guiCheckState.nxInstalled) && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

                        {/* ── VNC Card ─────────────────────────────────────────── */}
                        <div style={{ border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                          {/* VNC Header */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(7,172,81,0.06)", borderBottom: "1px solid var(--line)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.05em" }}>VNC SERVER</span>
                              <span style={{ fontSize: "0.68rem", padding: "2px 7px", borderRadius: "99px", fontWeight: 600,
                                background: guiCheckState.vncInstalled ? (guiCheckState.vncRunning ? "rgba(34,197,94,0.15)" : "rgba(7,172,81,0.1)") : "rgba(100,100,100,0.1)",
                                color: guiCheckState.vncInstalled ? (guiCheckState.vncRunning ? "#22c55e" : "var(--accent)") : "var(--muted)",
                                border: `1px solid ${guiCheckState.vncInstalled ? (guiCheckState.vncRunning ? "#22c55e" : "var(--accent)") : "var(--line)"}` }}>
                                {guiCheckState.vncInstalled ? (guiCheckState.vncRunning ? "● Running" : "Installed") : "Not Installed"}
                              </span>
                            </div>
                            {guiCheckState.vncInstalled && (
                              <button type="button" title="VNC Settings" onClick={() => setShowVncSettings(true)}
                                style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "7px", fontSize: "0.72rem",
                                  fontWeight: 600, cursor: "pointer", border: "1px solid var(--line)", background: "transparent", color: "var(--muted)" }}>
                                <Cog size={14} /> Settings
                                <span style={{ fontSize: "0.65rem", background: "var(--bg)", borderRadius: "4px", padding: "1px 5px", color: "var(--accent)" }}>
                                  {vncSettings.resolution} · {vncSettings.frameRate}fps
                                </span>
                              </button>
                            )}
                          </div>
                          {/* VNC Body */}
                          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                            {guiCheckState.vncInstalled ? (
                              <>
                                {/* Viewer selector */}
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ fontSize: "0.72rem", color: "var(--muted)", marginRight: "2px" }}>Viewer:</span>
                                  {(["remmina", "tigervnc"] as const).map(v => (
                                    <button key={v} type="button" onClick={() => setVncViewer(v)}
                                      style={{ padding: "3px 10px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer",
                                        border: vncViewer === v ? "2px solid var(--accent)" : "1px solid var(--line)",
                                        background: vncViewer === v ? "rgba(7,172,81,0.1)" : "transparent",
                                        color: vncViewer === v ? "var(--accent)" : "var(--text)" }}>
                                      {v === "remmina" ? "Remmina" : "TigerVNC"}
                                    </button>
                                  ))}
                                </div>
                                {/* VNC action buttons */}
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                  {guiCheckState.vncRunning ? (
                                    <button type="button" className="vs-btn"
                                      style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "#ff4d4f", color: "#fff", fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem" }}
                                      disabled={guiCheckState.vncLoading} onClick={() => void onStopVncServer()}>
                                      <Square size={14} fill="currentColor" />
                                      {guiCheckState.vncLoading ? "Stopping..." : "Stop VNC"}
                                    </button>
                                  ) : (
                                    <button type="button" className="vs-btn"
                                      style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--accent)", color: "#000", fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem" }}
                                      disabled={guiCheckState.vncLoading} onClick={() => void onStartVncServer(activeSessionHost?.guiPort ?? 5901)}>
                                      <Play size={14} fill="currentColor" />
                                      {guiCheckState.vncLoading ? "Starting..." : "Start VNC"}
                                    </button>
                                  )}
                                  <button type="button" className="vs-btn"
                                    style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                                      background: guiCheckState.vncRunning && !vncLaunching ? "#22c55e" : "#4b5563", color: "#fff",
                                      fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem", border: "none", borderRadius: "6px",
                                      cursor: guiCheckState.vncRunning && !vncLaunching ? "pointer" : "not-allowed",
                                      opacity: guiCheckState.vncRunning && !vncLaunching ? 1 : 0.5 }}
                                    disabled={!guiCheckState.vncRunning || vncLaunching}
                                    title={!guiCheckState.vncRunning ? "Start VNC server first" : "Launch local VNC client"}
                                    onClick={() => void onLaunchVncViewer(activeSessionHost?.guiPort ?? 5901)}>
                                    <Monitor size={14} />
                                    {vncLaunching ? "Launching..." : "Launch Viewer"}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button type="button" className="vs-btn"
                                style={{ background: "var(--accent)", color: "#000", fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem", alignSelf: "flex-start" }}
                                onClick={() => void installVpsGui(activeSession.sessionId, guiCheckState.deType as any || "xfce")}>
                                Install VNC Server
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── NoMachine Card ────────────────────────────────────── */}
                        <div style={{ border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" }}>
                          {/* NX Header */}
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "rgba(92,124,250,0.06)", borderBottom: "1px solid var(--line)" }}>
                            <span style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.05em" }}>NOMACHINE</span>
                            <span style={{ fontSize: "0.68rem", padding: "2px 7px", borderRadius: "99px", fontWeight: 600,
                              background: guiCheckState.nxInstalled ? (guiCheckState.nxRunning ? "rgba(92,124,250,0.15)" : "rgba(92,124,250,0.08)") : "rgba(100,100,100,0.1)",
                              color: guiCheckState.nxInstalled ? (guiCheckState.nxRunning ? "#818cf8" : "#5c7cfa") : "var(--muted)",
                              border: `1px solid ${guiCheckState.nxInstalled ? (guiCheckState.nxRunning ? "#818cf8" : "#5c7cfa") : "var(--line)"}` }}>
                              {guiCheckState.nxInstalled ? (guiCheckState.nxRunning ? "● Running" : "Installed") : "Not Installed"}
                            </span>
                          </div>
                          {/* NX Body */}
                          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                            {guiCheckState.nxInstalled ? (
                              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                {guiCheckState.nxRunning ? (
                                  <button type="button" className="vs-btn"
                                    style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "#ff4d4f", color: "#fff", fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem" }}
                                    disabled={guiCheckState.nxLoading} onClick={() => void onStopNxServer()}>
                                    <Square size={14} fill="currentColor" />
                                    {guiCheckState.nxLoading ? "Stopping..." : "Stop NoMachine"}
                                  </button>
                                ) : (
                                  <button type="button" className="vs-btn"
                                    style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "#5c7cfa", color: "#fff", fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem" }}
                                    disabled={guiCheckState.nxLoading} onClick={() => void onStartNxServer()}>
                                    <Play size={14} fill="currentColor" />
                                    {guiCheckState.nxLoading ? "Configuring & Starting..." : "Start NoMachine"}
                                  </button>
                                )}
                                <button type="button" className="vs-btn"
                                  style={{ display: "inline-flex", alignItems: "center", gap: "5px",
                                    background: guiCheckState.nxRunning && !nxLaunching ? "#22c55e" : "#4b5563", color: "#fff",
                                    fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem",
                                    cursor: guiCheckState.nxRunning && !nxLaunching ? "pointer" : "not-allowed",
                                    opacity: guiCheckState.nxRunning && !nxLaunching ? 1 : 0.5 }}
                                  disabled={!guiCheckState.nxRunning || nxLaunching}
                                  title={!guiCheckState.nxRunning ? "Start NoMachine server first" : "Launch local NoMachine client"}
                                  onClick={() => void onLaunchNoMachine(4000)}>
                                  <Monitor size={14} />
                                  {nxLaunching ? "Launching..." : "Launch Client"}
                                </button>
                              </div>
                            ) : (
                              <button type="button" className="vs-btn"
                                style={{ background: "#5c7cfa", color: "#fff", fontWeight: 600, padding: "7px 14px", fontSize: "0.8rem", alignSelf: "flex-start" }}
                                onClick={() => void installVpsNomachine(activeSession.sessionId, guiCheckState.deType as any || "xfce")}>
                                Install NoMachine
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── Bottom utility row ────────────────────────────────── */}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                          <button type="button" className="ghost-btn" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                            onClick={() => void checkVpsGuiStatus(activeSession.sessionId)}>
                            <RefreshCw size={14} /> Re-Scan
                          </button>
                          {guiCheckState.hasGui && (
                            <button type="button" className="ghost-btn" style={{ color: "#ff4d4f", display: "inline-flex", alignItems: "center", gap: "4px" }}
                              title="Uninstall Desktop Environment" onClick={() => void uninstallVpsGui("de")}>
                              <Trash2 size={14} /> Uninstall DE
                            </button>
                          )}
                          {(guiCheckState.vncInstalled || guiCheckState.nxInstalled) && (
                            <button type="button" className="ghost-btn" style={{ color: "#ff4d4f", display: "inline-flex", alignItems: "center", gap: "4px" }}
                              title="Uninstall Remote Display Server (VNC / NoMachine)" onClick={() => void uninstallVpsGui("remote")}>
                              <Trash2 size={14} /> Uninstall Remote
                            </button>
                          )}
                          <button type="button" className="vs-btn" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px", border: "1px solid #ff4d4f", color: "#ff4d4f", background: "transparent" }}
                            title="Completely uninstall GUI and Remote Display Servers" onClick={() => void uninstallVpsGui("all")}>
                            <Trash2 size={14} /> Uninstall All
                          </button>
                        </div>

                      </div>
                    )}

                    {/* Install Section */}
                    {!guiCheckState.hasGui || (!guiCheckState.vncInstalled && !guiCheckState.nxInstalled) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <div style={{ color: "#ffb703", fontSize: "0.85rem", fontWeight: 600 }}>
                          {!guiCheckState.hasGui
                            ? "⚠ No Desktop Environment detected. Install one below:"
                            : "⚠ No remote display server detected. Install VNC or NoMachine:"}
                        </div>

                        {/* Desktop Environment Selection */}
                        {!guiCheckState.hasGui && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                            {(["xfce", "mate", "gnome", "kde", "cinnamon"] as const).map((deName) => {
                              const locked = (deName === "gnome" || deName === "kde") && guiCheckState.ramMB < 2048 || (deName === "cinnamon" && guiCheckState.ramMB < 1536);
                              const labels: Record<string, [string, string]> = {
                                xfce: ["XFCE Desktop", "Lightweight, stable, fast. Recommended."],
                                mate: ["MATE Desktop", "Classic layout, light on resources."],
                                gnome: ["GNOME Desktop", "Modern, visual-rich. Min 2GB RAM."],
                                kde: ["KDE Standard", "Customizable, powerful. Min 2GB RAM."],
                                cinnamon: ["Cinnamon", "Elegant, modern, comfortable. Min 1.5GB RAM."]
                              };
                              return (
                                <div
                                  key={deName}
                                  onClick={() => !locked && setSelectedDeToInstall(deName)}
                                  style={{
                                    border: selectedDeToInstall === deName ? "2px solid var(--accent)" : "1px solid var(--line)",
                                    borderRadius: "10px",
                                    padding: "12px",
                                    cursor: locked ? "not-allowed" : "pointer",
                                    opacity: locked ? 0.35 : 1,
                                    background: selectedDeToInstall === deName ? "rgba(7, 172, 81, 0.05)" : "transparent",
                                    transition: "all 150ms ease"
                                  }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: "0.83rem", marginBottom: "3px" }}>{labels[deName]?.[0]}</div>
                                  <p style={{ fontSize: "0.73rem", color: "var(--muted)", margin: 0 }}>{labels[deName]?.[1]}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Server Type Selection */}
                        {(!guiCheckState.vncInstalled && !guiCheckState.nxInstalled) && (
                          <>
                            <div style={{ fontSize: "0.82rem", fontWeight: 600, marginTop: "4px" }}>Remote Display Server:</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                              <div
                                onClick={() => setSelectedServerType("vnc")}
                                style={{
                                  border: selectedServerType === "vnc" ? "2px solid var(--accent)" : "1px solid var(--line)",
                                  borderRadius: "10px",
                                  padding: "12px",
                                  cursor: "pointer",
                                  background: selectedServerType === "vnc" ? "rgba(7, 172, 81, 0.05)" : "transparent",
                                  transition: "all 150ms ease"
                                }}
                              >
                                <div style={{ fontWeight: 600, fontSize: "0.83rem", marginBottom: "3px" }}>VNC Server</div>
                                <p style={{ fontSize: "0.73rem", color: "var(--muted)", margin: 0 }}>TightVNC / TigerVNC — universal, lightweight. Port 5901.</p>
                              </div>
                              <div
                                onClick={() => setSelectedServerType("nomachine")}
                                style={{
                                  border: selectedServerType === "nomachine" ? "2px solid #5c7cfa" : "1px solid var(--line)",
                                  borderRadius: "10px",
                                  padding: "12px",
                                  cursor: "pointer",
                                  background: selectedServerType === "nomachine" ? "rgba(92, 124, 250, 0.05)" : "transparent",
                                  transition: "all 150ms ease"
                                }}
                              >
                                <div style={{ fontWeight: 600, fontSize: "0.83rem", marginBottom: "3px" }}>NoMachine (NX)</div>
                                <p style={{ fontSize: "0.73rem", color: "var(--muted)", margin: 0 }}>Premium performance, hardware accel. Port 4000.</p>
                              </div>
                            </div>
                          </>
                        )}

                        <div style={{ display: "flex", gap: "10px" }}>
                          <button
                            type="button"
                            className="vs-btn"
                            style={{
                              background: (guiCheckState.vncInstalled || guiCheckState.nxInstalled) ? "var(--accent)" : (selectedServerType === "vnc" ? "var(--accent)" : "#5c7cfa"),
                              color: (guiCheckState.vncInstalled || guiCheckState.nxInstalled) ? "#000" : (selectedServerType === "vnc" ? "#000" : "#fff"),
                              fontWeight: 600,
                              padding: "8px 16px"
                            }}
                            onClick={() => {
                              const deToUse = (guiCheckState.hasGui && guiCheckState.deType
                                ? guiCheckState.deType as "xfce" | "mate" | "gnome" | "kde" | "cinnamon"
                                : selectedDeToInstall);
                              
                              let serverToInstall = selectedServerType;
                              if (!guiCheckState.hasGui) {
                                if (guiCheckState.nxInstalled && !guiCheckState.vncInstalled) {
                                  serverToInstall = "nomachine";
                                } else if (guiCheckState.vncInstalled) {
                                  serverToInstall = "vnc";
                                }
                              }

                              if (serverToInstall === "vnc") {
                                void installVpsGui(activeSession.sessionId, deToUse);
                              } else {
                                void installVpsNomachine(activeSession.sessionId, deToUse);
                              }
                            }}
                          >
                            {guiCheckState.hasGui
                              ? `Install ${selectedServerType === "vnc" ? "VNC" : "NoMachine"} Server`
                              : (guiCheckState.vncInstalled || guiCheckState.nxInstalled)
                                ? `Install ${selectedDeToInstall.toUpperCase()}`
                                : `Install ${selectedDeToInstall.toUpperCase()} + ${selectedServerType === "vnc" ? "VNC" : "NoMachine"}`}
                          </button>
                          <button type="button" className="ghost-btn" onClick={() => void checkVpsGuiStatus(activeSession.sessionId)}>
                            Re-Scan
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
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
            
            {confirmModal.isRemoteUninstall && (
              <div style={{ marginTop: "12px", marginBottom: "16px", textAlign: "left", padding: "12px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", borderRadius: "6px" }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "8px", color: "var(--fg)" }}>Select uninstallation target:</div>
                <label style={{ display: "flex", alignItems: "center", marginBottom: "8px", cursor: "pointer", fontSize: "0.85rem", color: "var(--fg)" }}>
                  <input
                    type="radio"
                    name="uninstall_choice"
                    value="remote"
                    checked={uninstallChoice === "remote"}
                    onChange={() => setUninstallChoice("remote")}
                    style={{ marginRight: "8px" }}
                  />
                  Uninstall Both (VNC & NoMachine)
                </label>
                {guiCheckState.vncInstalled && (
                  <label style={{ display: "flex", alignItems: "center", marginBottom: "8px", cursor: "pointer", fontSize: "0.85rem", color: "var(--fg)" }}>
                    <input
                      type="radio"
                      name="uninstall_choice"
                      value="tigervnc"
                      checked={uninstallChoice === "tigervnc"}
                      onChange={() => setUninstallChoice("tigervnc")}
                      style={{ marginRight: "8px" }}
                    />
                    Uninstall VNC Only
                  </label>
                )}
                {guiCheckState.nxInstalled && (
                  <label style={{ display: "flex", alignItems: "center", cursor: "pointer", fontSize: "0.85rem", color: "var(--fg)" }}>
                    <input
                      type="radio"
                      name="uninstall_choice"
                      value="nomachine"
                      checked={uninstallChoice === "nomachine"}
                      onChange={() => setUninstallChoice("nomachine")}
                      style={{ marginRight: "8px" }}
                    />
                    Uninstall NoMachine Only
                  </label>
                )}
              </div>
            )}

            <div className="confirm-modal-actions">
              <button type="button" className="ghost-btn" onClick={closeConfirm}>Cancel</button>
              <button
                type="button"
                className="primary-btn danger-btn"
                onClick={() => { confirmModal.onConfirm(uninstallChoice); closeConfirm(); }}
              >
                {confirmModal.confirmText || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Prompt modal */}
      {promptModal.open && (
        <div className="modal" onClick={closePrompt}>
          <div className="modal-card modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{promptModal.title}</h2>
              <button type="button" className="modal-close" onClick={closePrompt}>×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); const input = (e.target as HTMLFormElement).querySelector("input") as HTMLInputElement; if (input) promptModal.onSubmit(input.value); }}>
              <div className="encrypt-modal-body">
                <label>
                  {promptModal.label}
                  <input type="text" defaultValue={promptModal.defaultValue} autoFocus onKeyDown={(e) => { if (e.key === "Escape") closePrompt(); }} />
                </label>
                <div className="form-buttons">
                  <button type="button" className="ghost-btn" onClick={closePrompt}>Cancel</button>
                  <button type="submit" className="primary-btn">OK</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* VNC Settings Modal */}
      {showVncSettings && (
        <div className="modal" style={{ zIndex: 9990 }} onClick={() => setShowVncSettings(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: "16px",
              width: "min(540px, 95vw)",
              boxShadow: "0 32px 100px rgba(0,0,0,0.7)",
              overflow: "hidden",
              color: "#e6edf3",
            }}
          >
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "16px 22px", borderBottom: "1px solid #30363d",
              background: "rgba(7,172,81,0.07)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.3rem" }}>⚙️</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.98rem", color: "#e6edf3" }}>VNC Settings</div>
                  <div style={{ fontSize: "0.71rem", color: "#8b949e" }}>Server &amp; viewer quality configuration</div>
                </div>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowVncSettings(false)}>×</button>
            </div>

            <div className="dark-scrollbar" style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "18px", maxHeight: "70vh", overflowY: "auto" }}>

              {/* ── Server Settings ─────────────────────────── */}
              <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "10px", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.68rem", fontWeight: 700, color: "#07ac51", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>
                  <Monitor size={13} /> Server — applied when VNC starts
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

                  {/* Resolution */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Resolution</label>
                    <select
                      value={vncSettings.resolution}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, resolution: e.target.value }))}
                      style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "7px", padding: "7px 10px", color: "#e6edf3", fontSize: "0.82rem", outline: "none", cursor: "pointer", appearance: "auto", colorScheme: "dark" }}
                    >
                      {["1280x720","1366x768","1440x900","1600x900","1920x1080","2560x1440","3840x2160"].map(r => (
                        <option key={r} value={r} style={{ background: "#161b22", color: "#e6edf3" }}>{r}</option>
                      ))}
                    </select>
                  </div>

                  {/* Color Depth */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Color Depth</label>
                    <select
                      value={vncSettings.depth}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, depth: Number(e.target.value) }))}
                      style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "7px", padding: "7px 10px", color: "#e6edf3", fontSize: "0.82rem", outline: "none", cursor: "pointer", appearance: "auto", colorScheme: "dark" }}
                    >
                      <option value={16} style={{ background: "#161b22", color: "#e6edf3" }}>16-bit (faster)</option>
                      <option value={24} style={{ background: "#161b22", color: "#e6edf3" }}>24-bit (true colour)</option>
                      <option value={32} style={{ background: "#161b22", color: "#e6edf3" }}>32-bit (max)</option>
                    </select>
                  </div>

                  {/* Frame Rate */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", gridColumn: "1 / -1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Frame Rate</label>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#07ac51", background: "rgba(7,172,81,0.12)", borderRadius: "6px", padding: "2px 8px" }}>{vncSettings.frameRate} fps</span>
                    </div>
                    <input type="range" min={10} max={60} step={5} value={vncSettings.frameRate}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, frameRate: Number(e.target.value) }))}
                      style={{ accentColor: "#07ac51", width: "100%", cursor: "pointer" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#484f58" }}>
                      <span>10 fps</span><span>60 fps</span>
                    </div>
                  </div>

                  {/* Zlib Level */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", gridColumn: "1 / -1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Zlib Compression Level</label>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#07ac51", background: "rgba(7,172,81,0.12)", borderRadius: "6px", padding: "2px 8px" }}>
                        {vncSettings.zlibLevel === 1 ? "1 — fastest" : vncSettings.zlibLevel === 9 ? "9 — max" : vncSettings.zlibLevel}
                      </span>
                    </div>
                    <input type="range" min={1} max={9} step={1} value={vncSettings.zlibLevel}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, zlibLevel: Number(e.target.value) }))}
                      style={{ accentColor: "#07ac51", width: "100%", cursor: "pointer" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#484f58" }}>
                      <span>1 — Low latency</span><span>9 — High compression</span>
                    </div>
                  </div>

                </div>
              </div>

              {/* ── Viewer Settings ─────────────────────────── */}
              <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "10px", padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.68rem", fontWeight: 700, color: "#5c7cfa", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px" }}>
                  <Monitor size={13} /> Viewer — applied when launching client
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

                  {/* Encoding */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Encoding</label>
                    <select
                      value={vncSettings.encoding}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, encoding: e.target.value as typeof vncSettings.encoding }))}
                      style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: "7px", padding: "7px 10px", color: "#e6edf3", fontSize: "0.82rem", outline: "none", cursor: "pointer", appearance: "auto", colorScheme: "dark" }}
                    >
                      <option value="Tight" style={{ background: "#161b22", color: "#e6edf3" }}>Tight (best quality)</option>
                      <option value="ZRLE" style={{ background: "#161b22", color: "#e6edf3" }}>ZRLE (compression)</option>
                      <option value="Hextile" style={{ background: "#161b22", color: "#e6edf3" }}>Hextile (low CPU)</option>
                      <option value="Raw" style={{ background: "#161b22", color: "#e6edf3" }}>Raw (no compress)</option>
                    </select>
                  </div>

                  {/* Quality Level */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Quality Level</label>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#5c7cfa", background: "rgba(92,124,250,0.12)", borderRadius: "6px", padding: "2px 8px" }}>{vncSettings.qualityLevel}/9</span>
                    </div>
                    <input type="range" min={0} max={9} step={1} value={vncSettings.qualityLevel}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, qualityLevel: Number(e.target.value) }))}
                      style={{ accentColor: "#5c7cfa", width: "100%", cursor: "pointer" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#484f58" }}>
                      <span>0 Low</span><span>9 Max</span>
                    </div>
                  </div>

                  {/* Compress Level */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px", gridColumn: "1 / -1" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.73rem", color: "#8b949e", fontWeight: 600 }}>Viewer Compression Level</label>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#5c7cfa", background: "rgba(92,124,250,0.12)", borderRadius: "6px", padding: "2px 8px" }}>
                        {vncSettings.compressLevel === 1 ? "1 — fastest" : vncSettings.compressLevel === 9 ? "9 — max" : vncSettings.compressLevel}
                      </span>
                    </div>
                    <input type="range" min={1} max={9} step={1} value={vncSettings.compressLevel}
                      onChange={(e) => setVncSettings(prev => ({ ...prev, compressLevel: Number(e.target.value) }))}
                      style={{ accentColor: "#5c7cfa", width: "100%", cursor: "pointer" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#484f58" }}>
                      <span>1 — Low latency</span><span>9 — Max compression</span>
                    </div>
                  </div>

                </div>
              </div>

              {/* ── Quick Presets ────────────────────────────── */}
              <div>
                <div style={{ fontSize: "0.68rem", color: "#8b949e", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Quick Presets</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {[
                    { icon: <Rocket size={14} />,  label: "Performance",   color: "#f59e0b", values: { resolution: "1280x720",  depth: 16, frameRate: 60, zlibLevel: 1, qualityLevel: 5, compressLevel: 1, encoding: "Tight" as const } },
                    { icon: <Scale size={14} />,   label: "Balanced",       color: "#8b949e", values: { resolution: "1920x1080", depth: 24, frameRate: 30, zlibLevel: 3, qualityLevel: 7, compressLevel: 3, encoding: "Tight" as const } },
                    { icon: <Monitor size={14} />, label: "Best Quality",   color: "#07ac51", values: { resolution: "1920x1080", depth: 24, frameRate: 60, zlibLevel: 1, qualityLevel: 9, compressLevel: 1, encoding: "Tight" as const } },
                    { icon: <Monitor size={14} />, label: "Low Bandwidth",  color: "#5c7cfa", values: { resolution: "1280x720",  depth: 16, frameRate: 15, zlibLevel: 9, qualityLevel: 3, compressLevel: 9, encoding: "Tight" as const } },
                  ].map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setVncSettings(preset.values)}
                      style={{
                        padding: "8px 12px", borderRadius: "8px", fontSize: "0.77rem", fontWeight: 600,
                        cursor: "pointer", border: `1px solid ${preset.color}33`,
                        background: `${preset.color}0f`, color: preset.color,
                        transition: "all 150ms", textAlign: "left"
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        {preset.icon}
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Actions ─────────────────────────────────── */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
                <button type="button" className="ghost-btn" onClick={() => setShowVncSettings(false)}>Cancel</button>
                <button
                  type="button"
                  onClick={() => setShowVncSettings(false)}
                  style={{
                    padding: "8px 20px", borderRadius: "8px", border: "none",
                    background: "#07ac51", color: "#000", fontWeight: 700,
                    fontSize: "0.85rem", cursor: "pointer"
                  }}
                >
                  Apply Settings
                </button>
              </div>
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
