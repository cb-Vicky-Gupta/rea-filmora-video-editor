import { createRoot } from 'react-dom/client';
import './styles.css';

async function start() {
  // The Android build implements the desktop preload API inside the WebView. It must exist
  // before the app's modules load, so the app is imported afterwards.
  if (import.meta.env.MODE === 'android') (await import('./platform/web/index.js')).install();
  const { default: App } = await import('./App.jsx');
  createRoot(document.getElementById('root')).render(<App />);
}

start();
