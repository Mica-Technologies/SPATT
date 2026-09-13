import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../io/host';

/** Mirrors `AppInfo` in src-tauri/src/commands.rs. */
export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  mode: 'window' | 'headless' | 'service' | 'tray';
}

/** Mirrors `ServerStatus` in src-tauri/src/commands.rs. */
export interface ServerStatus {
  running: boolean;
  url: string | null;
}

const PREVIEW_INFO: AppInfo = { version: 'dev', os: 'browser', arch: '', mode: 'window' };

export async function getAppInfo(): Promise<AppInfo> {
  return isTauri() ? invoke<AppInfo>('app_info') : PREVIEW_INFO;
}

export async function getServerStatus(): Promise<ServerStatus> {
  return isTauri() ? invoke<ServerStatus>('server_status') : { running: false, url: null };
}

export async function openSpattWindow(): Promise<void> {
  if (isTauri()) {
    await invoke('open_spatt_window');
  } else {
    window.open('./index.html', '_blank', 'noopener');
  }
}
