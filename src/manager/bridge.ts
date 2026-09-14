import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../io/host';

/** Mirrors `AppInfo` in src-tauri/src/commands.rs. */
export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  mode: 'window' | 'headless' | 'service' | 'tray';
}

/** Mirrors `ServerStatus` in src-tauri/src/server.rs. */
export interface ServerStatus {
  running: boolean;
  port: number;
  lan: boolean;
  localUrl: string;
  /** The access link for other devices, with the token, while sharing on the network. */
  lanUrl: string | null;
  token: string;
  dataDir: string;
  keepServingOnClose: boolean;
  error: string | null;
}

/** Mirrors `SettingsPatch` in src-tauri/src/server.rs. */
export interface ServerSettingsPatch {
  port?: number;
  lan?: boolean;
  keepServingOnClose?: boolean;
}

/** Mirrors `LogLine` in src-tauri/src/server.rs. */
export interface LogLine {
  at: number;
  text: string;
}

const PREVIEW_INFO: AppInfo = { version: 'dev', os: 'browser', arch: '', mode: 'window' };

/** What the manager shows when opened in a plain browser (development preview). */
let preview: ServerStatus = {
  running: false,
  port: 8787,
  lan: false,
  localUrl: 'http://127.0.0.1:8787/',
  lanUrl: null,
  token: 'preview-token-not-used-by-any-server',
  dataDir: '(desktop app only)',
  keepServingOnClose: true,
  error: null,
};

const previewUpdate = (patch: Partial<ServerStatus>): Promise<ServerStatus> => {
  preview = { ...preview, ...patch };
  preview.localUrl = `http://127.0.0.1:${preview.port}/`;
  preview.lanUrl = preview.lan ? `http://192.168.1.10:${preview.port}/?token=${preview.token}` : null;
  return Promise.resolve(preview);
};

export async function getAppInfo(): Promise<AppInfo> {
  return isTauri() ? invoke<AppInfo>('app_info') : PREVIEW_INFO;
}

export function getServerStatus(): Promise<ServerStatus> {
  return isTauri() ? invoke<ServerStatus>('server_status') : Promise.resolve(preview);
}

export function startServer(): Promise<ServerStatus> {
  return isTauri() ? invoke<ServerStatus>('server_start') : previewUpdate({ running: true });
}

export function stopServer(): Promise<ServerStatus> {
  return isTauri() ? invoke<ServerStatus>('server_stop') : previewUpdate({ running: false });
}

export function updateServer(patch: ServerSettingsPatch): Promise<ServerStatus> {
  return isTauri() ? invoke<ServerStatus>('server_update', { patch }) : previewUpdate(patch);
}

export function regenerateToken(): Promise<ServerStatus> {
  return isTauri() ? invoke<ServerStatus>('server_regenerate_token') : previewUpdate({ token: `preview-${Date.now()}` });
}

export function getServerLogs(): Promise<LogLine[]> {
  return isTauri() ? invoke<LogLine[]>('server_logs') : Promise.resolve([]);
}

export async function openInBrowser(): Promise<void> {
  if (isTauri()) {
    await invoke('server_open_in_browser');
  } else {
    window.open(preview.localUrl, '_blank', 'noopener');
  }
}

export async function openProjectsFolder(): Promise<void> {
  if (isTauri()) {
    await invoke('open_projects_folder');
  }
}

/** Calls `onChange` when the server starts or stops from elsewhere (the tray). */
export async function onServerChanged(onChange: () => void): Promise<UnlistenFn> {
  return isTauri() ? listen('server-changed', onChange) : () => {};
}

export async function openSpattWindow(): Promise<void> {
  if (isTauri()) {
    await invoke('open_spatt_window');
  } else {
    window.open('./index.html', '_blank', 'noopener');
  }
}
