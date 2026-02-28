import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './server.js'; // 載入伺服器啟動模組

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

app.whenReady().then(async () => {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 700,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // 等待伺服器啟動，取得 OS 分配的安全 Port 後載入畫面
    const port = await startServer();
    mainWindow.loadURL(`http://localhost:${port}`);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            // Re-create window
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});