/**
 * Workspace state: the open project, what is selected, and undo/redo.
 *
 * Every edit goes through `edit(label, recipe)`, which clones the project, lets the recipe
 * mutate the clone, and records the previous version for undo. Projects are small (tens of KB),
 * so whole-project snapshots are simpler and safer than diffs.
 */
import { create } from 'zustand';
import type { Intersection, Project } from '../../model';

export type WorkspaceTab = 'phases' | 'rings' | 'patterns' | 'schedule';

/** The editor, or the printable timing sheet preview. */
export type WorkspaceView = 'editor' | 'sheet';

export const HISTORY_LIMIT = 200;

interface HistoryEntry {
  label: string;
  project: Project;
}

export interface WorkspaceState {
  project: Project | null;
  /** Bumped on every change, so autosave and memoised validation can key off it. */
  revision: number;
  selectedIntersectionId: string | null;
  tab: WorkspaceTab;
  view: WorkspaceView;
  selectedPatternId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** A field the UI should scroll to and focus (from the problems panel), as an issue path. */
  focusRequest: { path: (string | number)[]; nonce: number } | null;

  open(project: Project): void;
  close(): void;
  edit(label: string, recipe: (project: Project) => void): void;
  editIntersection(label: string, recipe: (intersection: Intersection, project: Project) => void): void;
  undo(): void;
  redo(): void;
  selectIntersection(id: string | null): void;
  setTab(tab: WorkspaceTab): void;
  setView(view: WorkspaceView): void;
  selectPattern(id: string | null): void;
  requestFocus(path: (string | number)[]): void;
}

const touch = (project: Project, now = new Date()): void => {
  project.updatedAt = now.toISOString();
};

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  project: null,
  revision: 0,
  selectedIntersectionId: null,
  tab: 'phases',
  view: 'editor',
  selectedPatternId: null,
  past: [],
  future: [],
  focusRequest: null,

  open(project) {
    const first = project.intersections[0];
    set({
      project,
      revision: get().revision + 1,
      selectedIntersectionId: first?.id ?? null,
      selectedPatternId: first?.patterns[0]?.id ?? null,
      tab: 'phases',
      view: 'editor',
      past: [],
      future: [],
      focusRequest: null,
    });
  },

  close() {
    set({ project: null, selectedIntersectionId: null, selectedPatternId: null, past: [], future: [], focusRequest: null });
  },

  edit(label, recipe) {
    const { project, past, revision } = get();
    if (!project) {
      return;
    }
    const next = structuredClone(project);
    recipe(next);
    touch(next);
    set({
      project: next,
      revision: revision + 1,
      past: [...past, { label, project }].slice(-HISTORY_LIMIT),
      future: [],
    });
  },

  editIntersection(label, recipe) {
    const id = get().selectedIntersectionId;
    get().edit(label, (project) => {
      const intersection = project.intersections.find((i) => i.id === id);
      if (intersection) {
        recipe(intersection, project);
      }
    });
  },

  undo() {
    const { project, past, future, revision } = get();
    const previous = past.at(-1);
    if (!project || !previous) {
      return;
    }
    set({
      project: previous.project,
      revision: revision + 1,
      past: past.slice(0, -1),
      future: [{ label: previous.label, project }, ...future],
    });
    get().selectIntersection(get().selectedIntersectionId);
  },

  redo() {
    const { project, past, future, revision } = get();
    const next = future[0];
    if (!project || !next) {
      return;
    }
    set({
      project: next.project,
      revision: revision + 1,
      past: [...past, { label: next.label, project }],
      future: future.slice(1),
    });
    get().selectIntersection(get().selectedIntersectionId);
  },

  /** Selects an intersection, falling back to the first one if the id no longer exists. */
  selectIntersection(id) {
    const project = get().project;
    const intersection = project?.intersections.find((i) => i.id === id) ?? project?.intersections[0];
    const patternId = get().selectedPatternId;
    set({
      selectedIntersectionId: intersection?.id ?? null,
      selectedPatternId: intersection?.patterns.some((p) => p.id === patternId) ? patternId : (intersection?.patterns[0]?.id ?? null),
    });
  },

  setTab(tab) {
    set({ tab });
  },

  setView(view) {
    set({ view });
  },

  selectPattern(id) {
    set({ selectedPatternId: id });
  },

  requestFocus(path) {
    set({ focusRequest: { path, nonce: (get().focusRequest?.nonce ?? 0) + 1 } });
  },
}));

/** The selected intersection of the open project, if any. */
export function selectIntersection(state: WorkspaceState): Intersection | null {
  return state.project?.intersections.find((i) => i.id === state.selectedIntersectionId) ?? null;
}

export const undoLabel = (state: WorkspaceState): string | null => state.past.at(-1)?.label ?? null;
export const redoLabel = (state: WorkspaceState): string | null => state.future[0]?.label ?? null;
