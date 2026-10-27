import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../../../src/entrypoints/popup/popup.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
