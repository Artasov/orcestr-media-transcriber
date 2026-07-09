import React from 'react';
import ReactDOM from 'react-dom/client';
import { OrcestrUiProvider } from '@orcestr/ui';
import '@orcestr/ui/styles.css';
import { App } from './App';
import { configureApi } from './api/client';
import './styles/global.css';

async function bootstrap() {
  await configureApi();
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <OrcestrUiProvider mode="dark" surface="orcestr">
        <App />
      </OrcestrUiProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
