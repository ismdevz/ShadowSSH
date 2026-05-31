import type { SecureApi } from "../preload/preload";

/// <reference types="vite/client" />

declare global {
  interface Window {
    api: SecureApi;
  }
}

export {};
