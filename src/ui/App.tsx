import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { BrowserStore } from '../io/browser-store';
import { detectHost, type Host } from '../io/host';
import { HttpStore } from '../io/http-store';
import type { ProjectStore } from '../io/store';
import AccessScreen from './library/AccessScreen';
import LibraryScreen from './library/LibraryScreen';
import StoreProvider from './state/StoreContext';
import { useWorkspace } from './state/workspace';
import Workspace from './workspace/Workspace';

const HOST_STORAGE_LABEL: Record<Host, string> = {
  browser: 'in this browser',
  tauri: 'on this computer',
  server: 'on the SPATT server, shared with every device that uses it',
};

/** Picks the project library for the host. */
async function createStore(host: Host): Promise<ProjectStore> {
  if (host === 'tauri') {
    const { TauriStore } = await import('../io/tauri-store');
    return new TauriStore();
  }
  return host === 'server' ? new HttpStore() : new BrowserStore();
}

export default function App() {
  const [host, setHost] = useState<Host | null>(null);
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [needsAccess, setNeedsAccess] = useState(false);
  const hasProject = useWorkspace((s) => s.project !== null);

  useEffect(() => {
    let cancelled = false;
    void detectHost()
      .then(async (detected) => {
        const created = await createStore(detected);
        const access = created instanceof HttpStore ? await created.hasAccess().catch(() => false) : true;
        return { detected, created, access };
      })
      .then(({ detected, created, access }) => {
        if (!cancelled) {
          setHost(detected);
          setStore(created);
          setNeedsAccess(!access);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!host || !store) {
    return (
      <Box sx={{ height: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (needsAccess && store instanceof HttpStore) {
    return (
      <AccessScreen
        onSignIn={async (token) => {
          const ok = await store.signIn(token);
          if (ok) setNeedsAccess(false);
          return ok;
        }}
      />
    );
  }

  return <StoreProvider store={store}>{hasProject ? <Workspace /> : <LibraryScreen hostLabel={HOST_STORAGE_LABEL[host]} />}</StoreProvider>;
}
