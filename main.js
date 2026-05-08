import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initBackend, cleanupOnExit, updateMainWindow } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let backendInitialized = false; // 👈 【新增】防止 IPC 重複註冊的鎖

function createWindow() {
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 600,
        height: 700,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'logo.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    // 👇 【新增】右鍵選單（複製/貼上）
    mainWindow.webContents.on('context-menu', (event, params) => {
        const menu = Menu.buildFromTemplate([
            { role: 'cut', label: '剪下' },
            { role: 'copy', label: '複製' },
            { role: 'paste', label: '貼上' },
            { type: 'separator' },
            { role: 'selectAll', label: '全選' }
        ]);
        menu.popup();
    });

    // 👇 【修復】只初始化一次，避免重複註冊 IPC Handler
    if (!backendInitialized) {
        initBackend(mainWindow);
        backendInitialized = true;
    } else {
        updateMainWindow(mainWindow);
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            // 👇 Mac 點擊 Dock 時只更新視窗實例，不重新初始化後端
            mainWindow.show();
        }
    });
});

app.on('window-all-closed', () => {
    cleanupOnExit();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    cleanupOnExit();
});