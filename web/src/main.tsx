import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Base styles come first, so a component's own rule wins over them at equal specificity.
import './app/tokens.css';
import './app/base.css';
import { App } from './app/app';
import { registerWorker } from './features/notifications/push';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

registerWorker();

createRoot(root).render(
   <StrictMode>
      <App />
   </StrictMode>,
);
