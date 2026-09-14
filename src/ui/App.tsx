import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { BrowserStore } from '../io/browser-store';
import { detectHost, type Host } from '../io/host';
import type { ProjectStore } from '../io/store';
import LibraryScreen from './library/LibraryScreen';
import StoreProvider from './state/StoreContext';
import { useWorkspace } from './state/workspace';
import Workspace from './workspace/Workspace';

const HOST_STORAGE_LABEL: Record<Host, string> = {
  browser: 'in this browser',
  tauri: 'on this computer',
  server: 'on the SPATT server',
};

/** Picks the project library for the host. The desktop and server stores join as they are built. */
async function createStore(host: Host): Promise<ProjectStore> {
  if (host === 'tauri') {
    const { TauriStore } = await import('../io/tauri-store');
    return new TauriStore();
  }
  return new BrowserStore();
}

export default function App() {
  const [host, setHost] = useState<Host | null>(null);
  const [store, setStore] = useState<ProjectStore | null>(null);
  const hasProject = useWorkspace((s) => s.project !== null);

  useEffect(() => {
    let cancelled = false;
    void detectHost()
      .then(async (detected) => ({ detected, created: await createStore(detected) }))
      .then(({ detected, created }) => {
        if (!cancelled) {
          setHost(detected);
          setStore(created);
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

  return <StoreProvider store={store}>{hasProject ? <Workspace /> : <LibraryScreen hostLabel={HOST_STORAGE_LABEL[store.kind === 'tauri' ? 'tauri' : host]} />}</StoreProvider>;
}
