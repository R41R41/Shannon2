import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@styles/global.scss';

// isTestフラグをポート番号で判定
const isTest = window.location.port === '14000';
console.log("isTest", isTest);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App isTest={isTest} />
  </StrictMode>
);
