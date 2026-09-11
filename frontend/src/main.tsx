import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/fill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/nocturne.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
