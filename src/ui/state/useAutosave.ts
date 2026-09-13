import { useEffect, useState } from 'react';
import { saveToStore } from '../../io/store';
import { useProjectStore } from './storeContextValue';
import { useWorkspace } from './workspace';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export const AUTOSAVE_DELAY_MS = 600;

/**
 * Saves the open project to the library shortly after each change, and immediately when the page
 * is being hidden or closed.
 */
export function useAutosave(): { status: SaveStatus; error: string | null } {
  const store = useProjectStore();
  const project = useWorkspace((s) => s.project);
  const revision = useWorkspace((s) => s.revision);
  const [savedRevision, setSavedRevision] = useState(revision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project || revision === savedRevision) {
      return;
    }
    const timer = setTimeout(() => {
      setSaving(true);
      saveToStore(store, project)
        .then(() => {
          setSavedRevision(revision);
          setError(null);
        })
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setSaving(false));
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, revision, savedRevision, store]);

  useEffect(() => {
    const flush = () => {
      const current = useWorkspace.getState();
      if (current.project && current.revision !== savedRevision) {
        void saveToStore(store, current.project);
      }
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store, savedRevision]);

  const status: SaveStatus = error ? 'error' : saving ? 'saving' : project && revision !== savedRevision ? 'pending' : 'saved';
  return { status, error };
}
