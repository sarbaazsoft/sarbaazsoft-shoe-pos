import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { queryClient, registerQueryCacheLifecycle } from './services/queryClient.ts';
import { registerViteChunkErrorRecovery } from './utils/swUpdate.ts';

registerQueryCacheLifecycle();
registerViteChunkErrorRecovery();

// Delete any deprecated registration, slug, or subdomain keys from localStorage
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (/slug|subdomain|registration/i.test(k) || k === 'registered_store' || k === 'pos_registered')) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
