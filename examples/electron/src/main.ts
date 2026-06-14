import path from 'node:path';

import { bindWindow } from '@ipcora/electron/main';
import { app, BrowserWindow } from 'electron';

import { ipc } from './ipc.ts';

export function bootstrap() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const ipcIns = bindWindow(ipc, win);
  win.loadURL('http://localhost:7212/');

  setInterval(() => {
    ipcIns.$emit.updated('0');
  }, 1000);
}

app.whenReady().then(() => bootstrap());
