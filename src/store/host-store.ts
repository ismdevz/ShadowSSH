import type { HostRecord } from "../types/shared.js";

interface ShadowStoreSchema {
  hosts: HostRecord[];
}

type StoreAccess = {
  get: (key: "hosts", defaultValue: HostRecord[]) => HostRecord[];
  set: (key: "hosts", value: HostRecord[]) => void;
};

let storeAccessPromise: Promise<StoreAccess> | null = null;

async function getStoreAccess(): Promise<StoreAccess> {
  if (!storeAccessPromise) {
    storeAccessPromise = (async () => {
      const { default: Store } = await import("electron-store");

      const store = new Store<ShadowStoreSchema>({
        name: "shadowssh-settings",
        defaults: {
          hosts: []
        }
      });

      return store as unknown as StoreAccess;
    })();
  }

  return storeAccessPromise;
}

async function readHosts(): Promise<HostRecord[]> {
  const storeAccess = await getStoreAccess();
  return storeAccess.get("hosts", []);
}

export async function getHosts(): Promise<HostRecord[]> {
  const hosts = await readHosts();
  return [...hosts].sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveHost(host: HostRecord): Promise<HostRecord> {
  const storeAccess = await getStoreAccess();
  const hosts = await readHosts();
  const existingIndex = hosts.findIndex((item) => item.id === host.id);

  if (existingIndex >= 0) {
    hosts[existingIndex] = host;
  } else {
    hosts.push(host);
  }

  storeAccess.set("hosts", hosts);
  return host;
}

export async function deleteHost(hostId: string): Promise<void> {
  const storeAccess = await getStoreAccess();
  const hosts = await readHosts();
  const filtered = hosts.filter((host) => host.id !== hostId);
  storeAccess.set("hosts", filtered);
}

export async function findHost(hostId: string): Promise<HostRecord | undefined> {
  return (await readHosts()).find((host) => host.id === hostId);
}
