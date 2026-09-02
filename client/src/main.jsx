import React from 'react';
import ReactDOM from 'react-dom/client';
import AppV2 from './AppV2.jsx';
import './styles.css';
import './operations.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppV2 />
  </React.StrictMode>
);
