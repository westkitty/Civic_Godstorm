import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { ErrorBoundary } from './app/ErrorBoundary.tsx';
import './ui/tokens.css';

const container = document.getElementById('root');
if (!container) throw new Error('CIVIC GODSTORM boot failed: #root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
