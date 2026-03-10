import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initBackend } from './server.js'; // 【修改】改為載入新的 initBackend 模組

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 700,
        autoHideMenuBar: true, // 保留你原本隱藏選單列的設定
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs') // 【新增】掛載安全橋樑
        }
    });

    // 【修改】不再等待 Port，直接載入本地的 index.html
    // 根據你的專案結構，index.html 放在 public 資料夾下
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    // 【新增】初始化後端，把 mainWindow 傳遞給 server.js 以便發送進度條與日誌
    initBackend(mainWindow);
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(); // 這樣寫 MacOS 點擊 dock 圖示時才能正確重新開啟
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});