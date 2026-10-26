import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setToken } from './api';
import './styles.css';

// The daemon writes its token into the page it serves; the UI needs it for state changes.
const token = document.querySelector<HTMLMetaElement>('meta[name="stint-token"]')?.content;
if (token) setToken(token);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
