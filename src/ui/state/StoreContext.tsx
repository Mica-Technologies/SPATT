import type { ReactNode } from 'react';
import type { ProjectStore } from '../../io/store';
import { StoreContext } from './storeContextValue';

export default function StoreProvider({ store, children }: { store: ProjectStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
