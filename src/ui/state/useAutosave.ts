import { useCallback, useEffect, useState } from 'react';
import { journalProject } from '../../io/journal';
import { ConflictError, newProjectId, openFromStore, saveToStore } from '../../io/store';
import { useProjectStore } from './storeContextValue';
import { useWorkspace } from './workspace';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

export const AUTOSAVE_DELAY_MS = 600;

/** How the user settles a save conflict. */
export type ConflictChoice = 'theirs' | 'mine' | 'copy';

export interface Conflict {
  /** The project's version in the store now, or `null` if it was deleted there. */
  current: string | null;
}

/**
 * Saves the open project to the library shortly after each change, and immediately when the page
 * is being hidden or closed (with a synchronous journal copy, in case that write is cut off).
 *
 * Every save is conditional on the version last read or saved. If another tab or device saved
 * the project in between, autosave stops with a `conflict` until `resolveConflict` is called:
 * load their version, overwrite it with this one, or save this one as a new project.
 */
export function useAutosave(): { status: SaveStatus; error: string | null; conflict: Conflict | null; resolveConflict: (choice: ConflictChoice) => Promise<void> } {
  const store = useProjectStore();
  const project = useWorkspace((s) => s.project);
  const revision = useWorkspace((s) => s.revision);
  const [savedRevision, setSavedRevision] = useState(revision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const fail = (cause: unknown) => {
    if (cause instanceof ConflictError) {
      setConflict({ current: cause.current });
    } else {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    if (!project || revision === savedRevision || conflict) {
      return;
    }
    const timer = setTimeout(() => {
      setSaving(true);
      saveToStore(store, project, useWorkspace.getState().storeVersion)
        .then((version) => {
          useWorkspace.getState().setStoreVersion(version);
          setSavedRevision(revision);
          setError(null);
        })
        .catch(fail)
        .finally(() => setSaving(false));
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, revision, savedRevision, store, conflict]);

  useEffect(() => {
    const flush = () => {
      const current = useWorkspace.getState();
      if (current.project && current.revision !== savedRevision && !conflict) {
        journalProject(current.project);
        // Hidden tabs often come back: keep the version, or the next autosave would conflict with
        // this very write. A conflict here is found again by that next autosave.
        void saveToStore(store, current.project, current.storeVersion)
          .then((version) => useWorkspace.getState().setStoreVersion(version))
          .catch(() => {});
      }
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store, savedRevision, conflict]);

  const resolveConflict = useCallback(
    async (choice: ConflictChoice) => {
      const state = useWorkspace.getState();
      const mine = state.project;
      if (!mine || !conflict) return;
      try {
        if (choice === 'theirs') {
          const theirs = await openFromStore(store, mine.id);
          if (!theirs || !theirs.result.ok) {
            throw new Error(theirs ? 'Their version could not be opened.' : 'The project was deleted elsewhere, so there is no other version to load.');
          }
          state.open(theirs.result.project, theirs.version);
          setSavedRevision(useWorkspace.getState().revision);
        } else if (choice === 'mine') {
          state.setStoreVersion(await saveToStore(store, mine, conflict.current));
          setSavedRevision(state.revision);
        } else {
          const copy = { ...structuredClone(mine), id: newProjectId(), name: `${mine.name} (copy)` };
          const version = await saveToStore(store, copy, null);
          const selected = { intersection: state.selectedIntersectionId, tab: state.tab, pattern: state.selectedPatternId };
          state.open(copy, version);
          useWorkspace.setState({ selectedIntersectionId: selected.intersection, tab: selected.tab, selectedPatternId: selected.pattern });
          setSavedRevision(useWorkspace.getState().revision);
        }
        setConflict(null);
        setError(null);
      } catch (cause) {
        setConflict(null);
        fail(cause);
      }
    },
    [store, conflict],
  );

  const status: SaveStatus = conflict ? 'conflict' : error ? 'error' : saving ? 'saving' : project && revision !== savedRevision ? 'pending' : 'saved';
  return { status, error, conflict, resolveConflict };
}
