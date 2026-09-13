import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppRoot from '../ui/AppRoot';
import ManagerApp from './ManagerApp';

const container = document.getElementById('root');
if (!container) {
  throw new Error('manager.html is missing #root');
}

createRoot(container).render(
  <StrictMode>
    <AppRoot>
      <ManagerApp />
    </AppRoot>
  </StrictMode>,
);
