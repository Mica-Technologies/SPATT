import { createContext, useContext } from 'react';
import type { ProjectStore } from '../../io/store';

export const StoreContext = createContext<ProjectStore | null>(null);

export function useProjectStore(): ProjectStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error('useProjectStore needs a StoreProvider');
  }
  return store;
}
