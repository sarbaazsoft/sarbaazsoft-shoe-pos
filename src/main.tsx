import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { registerViteChunkErrorRecovery } from './utils/swUpdate.ts';

registerViteChunkErrorRecovery();

if (typeof window !== 'undefined') {
  // Always clear any leftover Service Worker Cache Storage buckets so assets remain uncached
  if ('caches' in window && typeof window.caches?.keys === 'function') {
    window.caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => window.caches.delete(k))))
      .catch(() => {});
  }
  if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistration === 'function') {
    navigator.serviceWorker
      .getRegistration('/')
      .then((reg) => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        return reg?.update().catch(() => {});
      })
      .catch(() => {});
  }
}

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
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
