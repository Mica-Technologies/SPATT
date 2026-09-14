/**
 * Workspace state: the open project, what is selected, and undo/redo.
 *
 * Every edit goes through `edit(label, recipe)`, which clones the project, lets the recipe
 * mutate the clone, and records the previous version for undo. Projects are small (tens of KB),
 * so whole-project snapshots are simpler and safer than diffs.
 */
import { create } from 'zustand';
import type { Corridor, Intersection, Project } from '../../model';

export type WorkspaceTab = 'phases' | 'rings' | 'patterns' | 'schedule';

/** The editor, or the printable timing sheet preview. */
export type WorkspaceView = 'editor' | 'sheet';

export type CorridorTab = 'layout' | 'plans' | 'progression';

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
  /** When set, the main area edits this corridor instead of the selected intersection. */
  selectedCorridorId: string | null;
  corridorTab: CorridorTab;
  selectedPlanId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /**
   * The open project's version in the store, as last read or saved; `undefined` when unknown
   * (autosave then writes unconditionally). See `ProjectStore.write`.
   */
  storeVersion: string | undefined;
  /** A field the UI should scroll to and focus (from the problems panel), as an issue path. */
  focusRequest: { path: (string | number)[]; nonce: number } | null;

  open(project: Project, storeVersion?: string): void;
  close(): void;
  edit(label: string, recipe: (project: Project) => void): void;
  editIntersection(label: string, recipe: (intersection: Intersection, project: Project) => void): void;
  editCorridor(label: string, recipe: (corridor: Corridor, project: Project) => void): void;
  undo(): void;
  redo(): void;
  selectIntersection(id: string | null): void;
  selectCorridor(id: string | null): void;
  setCorridorTab(tab: CorridorTab): void;
  selectPlan(id: string | null): void;
  setTab(tab: WorkspaceTab): void;
  setView(view: WorkspaceView): void;
  selectPattern(id: string | null): void;
  requestFocus(path: (string | number)[]): void;
  setStoreVersion(version: string | undefined): void;
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
  selectedCorridorId: null,
  corridorTab: 'layout',
  selectedPlanId: null,
  past: [],
  future: [],
  storeVersion: undefined,
  focusRequest: null,

  open(project, storeVersion) {
    const first = project.intersections[0];
    set({
      project,
      revision: get().revision + 1,
      selectedIntersectionId: first?.id ?? null,
      selectedPatternId: first?.patterns[0]?.id ?? null,
      tab: 'phases',
      view: 'editor',
      selectedCorridorId: null,
      corridorTab: 'layout',
      selectedPlanId: null,
      past: [],
      future: [],
      storeVersion,
      focusRequest: null,
    });
  },

  close() {
    set({ storeVersion: undefined, project: null, selectedIntersectionId: null, selectedPatternId: null, selectedCorridorId: null, selectedPlanId: null, past: [], future: [], focusRequest: null });
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

  editCorridor(label, recipe) {
    const id = get().selectedCorridorId;
    get().edit(label, (project) => {
      const corridor = project.corridors.find((c) => c.id === id);
      if (corridor) {
        recipe(corridor, project);
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
    reconcileSelection();
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
    reconcileSelection();
  },

  /** Selects an intersection (leaving any corridor), falling back to the first one if the id no longer exists. */
  selectIntersection(id) {
    set({ selectedCorridorId: null });
    const project = get().project;
    const intersection = project?.intersections.find((i) => i.id === id) ?? project?.intersections[0];
    const patternId = get().selectedPatternId;
    set({
      selectedIntersectionId: intersection?.id ?? null,
      selectedPatternId: intersection?.patterns.some((p) => p.id === patternId) ? patternId : (intersection?.patterns[0]?.id ?? null),
    });
  },

  selectCorridor(id) {
    const corridor = get().project?.corridors.find((c) => c.id === id) ?? null;
    const planId = get().selectedPlanId;
    set({
      selectedCorridorId: corridor?.id ?? null,
      selectedPlanId: corridor?.plans.some((p) => p.id === planId) ? planId : (corridor?.plans[0]?.id ?? null),
    });
  },

  setCorridorTab(tab) {
    set({ corridorTab: tab });
  },

  selectPlan(id) {
    set({ selectedPlanId: id });
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

  setStoreVersion(version) {
    set({ storeVersion: version });
  },

  requestFocus(path) {
    set({ focusRequest: { path, nonce: (get().focusRequest?.nonce ?? 0) + 1 } });
  },
}));

/** After undo or redo: keep the selections that still exist, fall back where they do not. */
function reconcileSelection(): void {
  const { selectedIntersectionId, selectedCorridorId, selectIntersection, selectCorridor } = useWorkspace.getState();
  selectIntersection(selectedIntersectionId);
  if (selectedCorridorId !== null) {
    selectCorridor(selectedCorridorId);
  }
}

/** The selected corridor of the open project, if any. */
export function selectCorridor(state: WorkspaceState): Corridor | null {
  return state.project?.corridors.find((c) => c.id === state.selectedCorridorId) ?? null;
}

/** The selected intersection of the open project, if any. */
export function selectIntersection(state: WorkspaceState): Intersection | null {
  return state.project?.intersections.find((i) => i.id === state.selectedIntersectionId) ?? null;
}

export const undoLabel = (state: WorkspaceState): string | null => state.past.at(-1)?.label ?? null;
export const redoLabel = (state: WorkspaceState): string | null => state.future[0]?.label ?? null;
