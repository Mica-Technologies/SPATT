/**
 * Which host the web UI is running in. The UI is one build for all three; storage and a few
 * affordances (native dialogs, the manager) depend on the host, and nothing else may.
 */
export type Host = 'tauri' | 'server' | 'browser';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Health payload served by spatt-server at `/api/health`. */
export interface ServerHealth {
  app: 'spatt';
  version: string;
}

export async function detectHost(fetchImpl: typeof fetch = fetch): Promise<Host> {
  if (isTauri()) {
    return 'tauri';
  }
  try {
    const response = await fetchImpl('./api/health', { headers: { accept: 'application/json' } });
    if (response.ok) {
      const body = (await response.json()) as Partial<ServerHealth>;
      if (body.app === 'spatt') {
        return 'server';
      }
    }
  } catch {
    // No server behind this page: a dev server or a static host.
  }
  return 'browser';
}
