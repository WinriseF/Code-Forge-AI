import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./i18n/config"; // Initialize i18next 
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { hydratePersistedStores } from '@/lib/store_bootstrap';

const MainApp = lazy(() => import('./windows/main/MainWindowApp'));
const SpotlightApp = lazy(() => import('./windows/spotlight/SpotlightWindowApp'));
const PeekApp = lazy(() => import('./windows/peek/PeekWindowApp'));
const GuardApp = lazy(() => import('./windows/guard/GuardWindowApp'));
const TransferApp = lazy(() => import('./windows/transfer/TransferWindowApp'));

const appWindow = getCurrentWebviewWindow()

const label = appWindow.label;

function Bootstrap() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    hydratePersistedStores(label)
      .catch((err) => {
        console.error('[Bootstrap] Failed to hydrate persisted stores:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isReady) {
    return null;
  }

  if (label === 'spotlight') {
    return (
      <Suspense fallback={null}>
        <SpotlightApp />
      </Suspense>
    );
  }

  if (label === 'peek') {
    return (
      <Suspense fallback={null}>
        <PeekApp />
      </Suspense>
    );
  }

  if (label === 'guard') {
    return (
      <Suspense fallback={null}>
        <GuardApp />
      </Suspense>
    );
  }

  if (label === 'transfer') {
    return (
      <Suspense fallback={null}>
        <TransferApp />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <MainApp />
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>
);
