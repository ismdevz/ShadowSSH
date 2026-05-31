import { Client } from "ssh2";
import { readFile } from "node:fs/promises";
import { basename, posix } from "node:path";
import type { Readable } from "node:stream";
import type { ConnectSSHInput, HostOS } from "../types/shared.js";
import type { SFTPWrapper } from "ssh2";
import type { ConnectConfig } from "ssh2";
import type { SFTPEntry } from "../types/shared.js";

interface SessionEvents {
  onState: (status: "connecting" | "connected" | "disconnected" | "error", message?: string) => void;
  onData: (data: string) => void;
}

export class SSHSession {
  private client: Client;
  private proxyClient: Client | null = null;
  private shellStream: NodeJS.ReadWriteStream | null = null;
  private sftp: SFTPWrapper | null = null;
  private latestConfig: ConnectSSHInput;

  public readonly id: string;

  public constructor(id: string, config: ConnectSSHInput, private readonly events: SessionEvents) {
    this.id = id;
    this.client = new Client();
    this.latestConfig = config;
  }

  public async connect(): Promise<void> {
    this.events.onState("connecting");
    const config = await this.toClientConfig(this.latestConfig);
    let connectConfig: ConnectConfig = config;

    if (this.latestConfig.proxyHost) {
      const sock = await this.createProxySocket(this.latestConfig, config.host, config.port);
      connectConfig = {
        ...config,
        sock
      };
    }

    return new Promise((resolve, reject) => {
      this.client
        .on("ready", () => {
          this.events.onState("connected");
          this.client.shell((shellError, stream) => {
            if (shellError) {
              const message = `Failed to open shell: ${shellError.message}`;
              this.events.onState("error", message);
              reject(shellError);
              return;
            }

            this.shellStream = stream;
            stream.on("data", (chunk: Buffer | string) => {
              this.events.onData(chunk.toString());
            });

            stream.on("close", () => {
              this.events.onState("disconnected", "Remote shell closed");
            });

            resolve();
          });
        })
        .on("error", (error) => {
          const message = `SSH connection error: ${error.message}`;
          this.events.onState("error", message);
          if (this.proxyClient) {
            this.proxyClient.end();
            this.proxyClient = null;
          }
          reject(error);
        })
        .on("end", () => {
          this.events.onState("disconnected", "SSH session ended");
          if (this.proxyClient) {
            this.proxyClient.end();
            this.proxyClient = null;
          }
        })
        .on("close", () => {
          this.events.onState("disconnected", "SSH connection closed");
          if (this.proxyClient) {
            this.proxyClient.end();
            this.proxyClient = null;
          }
        })
        .connect(connectConfig);
    });
  }

  public async reconnect(): Promise<void> {
    this.disconnect();
    this.client = new Client();
    this.proxyClient = null;
    this.sftp = null;
    await this.connect();
  }

  public updateConfig(config: ConnectSSHInput): void {
    this.latestConfig = config;
  }

  public getConfig(): ConnectSSHInput {
    return this.latestConfig;
  }

  public write(data: string): void {
    if (!this.shellStream) {
      return;
    }
    this.shellStream.write(data);
  }

  public resize(cols: number, rows: number): void {
    if (!this.shellStream) {
      return;
    }

    const maybeSetWindow = this.shellStream as NodeJS.ReadWriteStream & {
      setWindow?: (rows: number, cols: number, height: number, width: number) => void;
    };

    maybeSetWindow.setWindow?.(rows, cols, rows * 16, cols * 8);
  }

  private localForwardServers: Map<string, any> = new Map();

  public registerForwardServer(key: string, server: any): void {
    const existing = this.localForwardServers.get(key);
    if (existing) {
      try {
        existing.close();
      } catch {}
    }
    this.localForwardServers.set(key, server);
  }

  public closeForwardServer(key: string): void {
    const existing = this.localForwardServers.get(key);
    if (existing) {
      try {
        existing.close();
      } catch {}
      this.localForwardServers.delete(key);
    }
  }

  public disconnect(): void {
    if (this.sftp) {
      this.sftp.end();
      this.sftp = null;
    }

    if (this.shellStream) {
      this.shellStream.end();
      this.shellStream = null;
    }

    this.client.end();

    if (this.proxyClient) {
      this.proxyClient.end();
      this.proxyClient = null;
    }

    for (const server of this.localForwardServers.values()) {
      try {
        server.close();
      } catch {}
    }
    this.localForwardServers.clear();
  }

  public async createLocalForward(localPort: number, remoteHost: string, remotePort: number): Promise<any> {
    const { createServer } = await import("node:net");
    const server = createServer((socket) => {
      this.client.forwardOut(
        "127.0.0.1",
        socket.remotePort || 0,
        remoteHost,
        remotePort,
        (err, stream) => {
          if (err) {
            socket.end();
            return;
          }
          socket.pipe(stream).pipe(socket);
        }
      );
    });

    return new Promise((resolve, reject) => {
      server.listen(localPort, "127.0.0.1", () => {
        resolve(server);
      });
      server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async listDirectory(pathname: string): Promise<SFTPEntry[]> {
    const sftp = await this.getSftp();
    const target = pathname.trim() || ".";

    return new Promise((resolve, reject) => {
      sftp.readdir(target, (error, list) => {
        if (error) {
          reject(error);
          return;
        }

        const entries = (list ?? [])
          .map((entry) => {
            const name = entry.filename;
            const fullPath = target === "." ? name : posix.join(target, name);

            return {
              name,
              path: fullPath,
              isDirectory: entry.attrs.isDirectory(),
              size: entry.attrs.size,
              modifyTime: entry.attrs.mtime
            } satisfies SFTPEntry;
          })
          .sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) {
              return -1;
            }

            if (!a.isDirectory && b.isDirectory) {
              return 1;
            }

            return a.name.localeCompare(b.name);
          });

        resolve(entries);
      });
    });
  }

  public async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.getSftp();

    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  public async uploadFile(localPath: string, remoteDir: string): Promise<string> {
    const sftp = await this.getSftp();
    const filename = basename(localPath);
    const target = remoteDir.trim() === "." ? filename : posix.join(remoteDir.trim(), filename);

    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, target, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return target;
  }

  public async uploadFileToPath(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp();

    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  public async deleteFileOrDir(remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    const target = remotePath.trim();

    // First try SFTP unlink (works for files)
    try {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(target, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return;
    } catch {
      // unlink failed — likely a directory, use rm -rf via exec
      const escaped = target.replace(/'/g, "'\\''");
      await this.execCommand(`rm -rf '${escaped}'`);
    }
  }

  public async createDirectory(remotePath: string): Promise<void> {
    const sftp = await this.getSftp();
    const target = remotePath.trim();

    return new Promise((resolve, reject) => {
      sftp.mkdir(target, { mode: 0o755 }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  public async renamePath(fromPath: string, toPath: string): Promise<void> {
    // Use mv via exec (SFTP rename fails on cross-directory/mount moves)
    const src = fromPath.trim().replace(/'/g, "'\\''");
    const dest = toPath.trim().replace(/'/g, "'\\''");
    const cmd = `mv '${src}' '${dest}'`;
    await this.execCommand(cmd);
  }

  public async createEmptyFile(remotePath: string): Promise<void> {
    // Use touch via exec (SFTP write stream fails on some servers)
    const target = remotePath.trim().replace(/'/g, "'\\''");
    const cmd = `touch '${target}'`;
    await this.execCommand(cmd);
  }

  public async copyToPath(sourcePath: string, destPath: string): Promise<void> {
    const src = sourcePath.trim().replace(/'/g, "'\\''");
    const dest = destPath.trim().replace(/'/g, "'\\''");
    const cmd = `cp -r '${src}' '${dest}'`;
    await this.execCommand(cmd);
  }

  public async exec(command: string): Promise<string> {
    return this.execCommand(command);
  }

  public async writeFileContent(remotePath: string, content: string): Promise<void> {
    const sftp = await this.getSftp();
    return new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath);
      stream.on("close", resolve);
      stream.on("error", reject);
      stream.end(Buffer.from(content, "utf8"));
    });
  }

  public async detectRemoteOS(): Promise<HostOS> {
    try {
      const osRelease = await this.execCommand("cat /etc/os-release 2>/dev/null || uname -a");
      const text = osRelease.toLowerCase();

      if (text.includes("id=ubuntu") || text.includes(" ubuntu ") || text.includes("ubuntu")) {
        return "ubuntu";
      }

      if (text.includes("id=debian") || text.includes("debian")) {
        return "debian";
      }

      if (text.includes("id=arch") || text.includes("archlinux") || text.includes("arch linux")) {
        return "archlinux";
      }

      if (text.includes("id=fedora") || text.includes("fedora")) {
        return "fedora";
      }

      if (text.includes("opensuse") || text.includes("suse")) {
        return "opensuse";
      }

      if (text.includes("id=manjaro") || text.includes("manjaro")) {
        return "manjaro";
      }

      if (text.includes("id=kali") || text.includes("kali")) {
        return "kali";
      }

      if (text.includes("id=linuxmint") || text.includes("linux mint")) {
        return "linuxmint";
      }

      if (text.includes("id=pop") || text.includes("pop!_os") || text.includes("pop os")) {
        return "popos";
      }

      if (text.includes("id=alpine") || text.includes("alpine")) {
        return "alpine";
      }

      if (text.includes("id=gentoo") || text.includes("gentoo")) {
        return "gentoo";
      }

      if (text.includes("id=nixos") || text.includes("nixos")) {
        return "nixos";
      }

      if (text.includes("id=void") || text.includes("void linux") || text.includes("void")) {
        return "void";
      }

      if (text.includes("id=zorin") || text.includes("zorin")) {
        return "zorin";
      }

      if (text.includes("id=endeavouros") || text.includes("endeavouros")) {
        return "endeavouros";
      }

      if (text.includes("id=parrot") || text.includes("parrot")) {
        return "parrot";
      }

      if (text.includes("id=mx") || text.includes("mx linux") || text.includes("mx")) {
        return "mx";
      }

      if (text.includes("id=centos") || text.includes("centos")) {
        return "centos";
      }

      if (text.includes("id=rocky") || text.includes("rocky")) {
        return "rocky";
      }

      if (text.includes("id=almalinux") || text.includes("almalinux")) {
        return "almalinux";
      }

      if (
        text.includes("id=rhel") ||
        text.includes("id=ol") ||
        text.includes("red hat") ||
        text.includes("redhat") ||
        text.includes("oracle linux")
      ) {
        return "rhel";
      }

      if (text.includes("linux")) {
        return "linux";
      }

      return "unknown";
    } catch {
      return "unknown";
    }
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this.sftp) {
      return this.sftp;
    }

    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }

        this.sftp = sftp;
        resolve(sftp);
      });
    });
  }

  private async execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }

        let out = "";
        let err = "";

        stream.on("data", (chunk: Buffer | string) => {
          out += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer | string) => {
          err += chunk.toString();
        });

        stream.on("close", (code: number | null) => {
          if (code && code !== 0 && !out.trim()) {
            reject(new Error(err || `Command failed with code ${code}`));
            return;
          }

          resolve(out || err);
        });
      });
    });
  }

  private async toClientConfig(config: ConnectSSHInput): Promise<{
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: Buffer;
    passphrase?: string;
  }> {
    if (config.authMethod === "password") {
      return {
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password
      };
    }

    if (!config.privateKeyPath) {
      throw new Error("Private key path is required for private key authentication");
    }

    const privateKey = await readFile(config.privateKeyPath);

    return {
      host: config.host,
      port: config.port,
      username: config.username,
      privateKey,
      passphrase: config.passphrase
    };
  }

  private async createProxySocket(
    config: ConnectSSHInput,
    targetHost: string,
    targetPort: number
  ): Promise<Readable> {
    const proxyHost = config.proxyHost?.trim();
    const proxyUsername = config.proxyUsername?.trim();
    const proxyPort = config.proxyPort ?? 22;
    const proxyAuthMethod = config.proxyAuthMethod ?? "password";

    if (!proxyHost || !proxyUsername) {
      throw new Error("Proxy host and username are required");
    }

    const proxyConfig: ConnectConfig = {
      host: proxyHost,
      port: proxyPort,
      username: proxyUsername
    };

    if (proxyAuthMethod === "privateKey") {
      if (!config.proxyPrivateKeyPath) {
        throw new Error("Proxy private key path is required for private key authentication");
      }

      proxyConfig.privateKey = await readFile(config.proxyPrivateKeyPath);
    } else {
      if (!config.proxyPassword) {
        throw new Error("Proxy password is required for password authentication");
      }

      proxyConfig.password = config.proxyPassword;
    }

    this.proxyClient = new Client();

    return new Promise((resolve, reject) => {
      const proxyClient = this.proxyClient;
      if (!proxyClient) {
        reject(new Error("Proxy client initialization failed"));
        return;
      }

      proxyClient
        .once("ready", () => {
          proxyClient.forwardOut("127.0.0.1", 0, targetHost, targetPort, (error, stream) => {
            if (error || !stream) {
              reject(error ?? new Error("Failed to open proxy tunnel"));
              return;
            }

            resolve(stream as unknown as Readable);
          });
        })
        .once("error", (error) => {
          reject(new Error(`Proxy connection error: ${error.message}`));
        })
        .connect(proxyConfig);
    });
  }
}
