import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// Must match Vite's `base` so deep links like /admin/users resolve correctly.
const BASENAME = (import.meta.env.VITE_BASE_PATH as string | undefined)?.replace(/\/$/, '') ?? '/admin';

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={BASENAME}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
