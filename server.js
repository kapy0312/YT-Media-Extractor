import YTDlpWrap from 'yt-dlp-wrap';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import { exec } from 'child_process';
import util from 'util';
import AdmZip from 'adm-zip';

// 【引入 Electron 原生模組】
import { app as electronApp, BrowserWindow, session, shell, ipcMain, safeStorage, dialog } from 'electron';

process.env.PYTHONIOENCODING = 'utf-8';
process.env.LANG = 'zh_TW.UTF-8';

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_DATA_DIR = path.join(os.homedir(), '.yt-audio-extractor');
if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

const ENCRYPTED_COOKIE_PATH = path.join(APP_DATA_DIR, 'cookies.enc');
const OLD_COOKIE_FILE_PATH = path.join(APP_DATA_DIR, 'cookies.txt');

// 將隱藏資料夾加入環境變數 PATH
process.env.PATH = `${APP_DATA_DIR}${path.delimiter}${process.env.PATH}`;

const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');
const isWin = os.platform() === 'win32';
const BINARY_PATH = path.join(APP_DATA_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp_macos');

const getFfmpegPath = () => {
    return ffmpegPath.includes('app.asar')
        ? ffmpegPath.replace('app.asar', 'app.asar.unpacked')
        : ffmpegPath;
};

let mainWindowInstance = null; // 用來儲存視窗實例

const YTDlpClass = YTDlpWrap.default;
const ytDlpWrap = new YTDlpClass();

const DENO_PATH = path.join(APP_DATA_DIR, isWin ? 'deno.exe' : 'deno');
let isSystemReady = false;

async function ensureBinary() {
    if (!fs.existsSync(BINARY_PATH)) {
        console.log('[System] Downloading yt-dlp...');
        await YTDlpClass.downloadFromGithub(BINARY_PATH);
    }
    ytDlpWrap.setBinaryPath(BINARY_PATH);

    if (!fs.existsSync(DENO_PATH)) {
        console.log('[System] Deno not found, initializing auto-download...');
        try {
            const zipUrl = isWin
                ? 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
                : 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip';
            const zipPath = path.join(APP_DATA_DIR, 'deno.zip');

            const response = await fetch(zipUrl);
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            const buffer = await response.arrayBuffer();
            fs.writeFileSync(zipPath, Buffer.from(buffer));

            const zip = new AdmZip(zipPath);
            zip.extractAllTo(APP_DATA_DIR, true);

            if (!isWin) fs.chmodSync(DENO_PATH, 0o755);
            fs.unlinkSync(zipPath);
            console.log(`[System] Deno downloaded successfully!`);
        } catch (error) {
            console.error('[System] Failed to download Deno:', error.message);
        }
    }
}

// ==========================================
// 【核心功能】初始化後端並註冊所有 IPC API
// ==========================================
export function initBackend(mainWindow) {
    mainWindowInstance = mainWindow;

    // 【資安升級】如果偵測到舊版的明文 cookie，為了保護使用者，啟動時自動刪除
    if (fs.existsSync(OLD_COOKIE_FILE_PATH)) {
        try { fs.unlinkSync(OLD_COOKIE_FILE_PATH); } catch (e) { }
    }

    ipcMain.handle('api:is-system-ready', () => {
        return { ready: isSystemReady };
    });

    // 1. 背景異步檢查/下載依賴
    ensureBinary().then(() => {
        isSystemReady = true;
        if (mainWindowInstance) mainWindowInstance.webContents.send('systemReady');
    }).catch(err => {
        console.error('[System] Background initialization failed:', err);
        isSystemReady = true;
        if (mainWindowInstance) mainWindowInstance.webContents.send('systemReady');
    });

    // 2. 註冊版本號 API
    ipcMain.handle('api:version', () => {
        return { version: electronApp.getVersion() };
    });

    // ==========================================
    // 📁 路徑與資料夾相關 API
    // ==========================================

    // 1. 取得系統預設下載路徑
    ipcMain.handle('api:get-default-path', () => {
        return DOWNLOAD_DIR;
    });

    // 2. 開啟資料夾選擇器 (讓使用者自訂路徑)
    ipcMain.handle('api:select-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindowInstance, {
            properties: ['openDirectory', 'createDirectory'],
            title: '選擇下載儲存位置'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, path: result.filePaths[0] };
        }
        return { success: false };
    });

    // 3. 開啟目前的下載資料夾
    ipcMain.handle('api:open-folder', async (event, targetPath) => {
        try {
            // 如果前端有傳自訂路徑就用前端的，沒有就用預設的
            const dirToOpen = targetPath || DOWNLOAD_DIR;
            // 【優化】改用 shell.openPath 更安全且跨平台
            await shell.openPath(dirToOpen);
            return { success: true };
        } catch (error) {
            throw new Error(error.message);
        }
    });

    ipcMain.handle('api:open-app-data-folder', () => {
        try {
            shell.openPath(APP_DATA_DIR);
            return { success: true };
        } catch (error) {
            throw new Error(error.message);
        }
    });

    // 4. 檢查登入狀態 API
    ipcMain.handle('api:check-login', () => {
        // 【修改】改為檢查加密的 Cookie 檔案是否存在
        const isLoggedIn = fs.existsSync(ENCRYPTED_COOKIE_PATH);
        return { isLoggedIn };
    });

    // 5. 登出 API
    ipcMain.handle('api:logout', () => {
        try {
            if (fs.existsSync(COOKIE_FILE_PATH)) fs.unlinkSync(COOKIE_FILE_PATH);
            return { success: true };
        } catch (error) {
            throw new Error(error.message);
        }
    });

    // 6. 修復引擎 API
    ipcMain.handle('api:fix-engine', async () => {
        try {
            if (fs.existsSync(BINARY_PATH)) fs.unlinkSync(BINARY_PATH);
            await ensureBinary();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 7. 攔截 YouTube 登入 Cookie API
    ipcMain.handle('api:login', async () => {
        return new Promise(async (resolve) => {
            const loginWin = new BrowserWindow({
                width: 800,
                height: 700,
                autoHideMenuBar: true,
                title: 'YouTube 登入中 (偵測到登入後將自動關閉)',
                webPreferences: { nodeIntegration: false, contextIsolation: true }
            });

            await loginWin.loadURL('https://www.youtube.com');

            let checkInterval;
            let isResolved = false;

            async function checkLoginAndClose() {
                try {
                    const cookies = await session.defaultSession.cookies.get({ url: 'https://www.youtube.com' });
                    const isLoggedIn = cookies.some(c => c.name === 'SID');

                    if (isLoggedIn && !isResolved) {
                        isResolved = true;
                        clearInterval(checkInterval);

                        let netscapeFormat = "# Netscape HTTP Cookie File\n# This is a generated file! Do not edit.\n\n";
                        cookies.forEach(c => {
                            let domain = c.domain;
                            if (!domain.startsWith('.') && !c.hostOnly) domain = '.' + domain;
                            const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
                            const path = c.path || '/';
                            const secure = c.secure ? 'TRUE' : 'FALSE';
                            const expiry = c.expirationDate ? Math.floor(c.expirationDate) : Math.floor(Date.now() / 1000) + 31536000;
                            netscapeFormat += `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expiry}\t${c.name}\t${c.value}\n`;
                        });

                        // 【安全加密】使用作業系統底層 API 進行加密寫入
                        if (safeStorage.isEncryptionAvailable()) {
                            const encryptedCookie = safeStorage.encryptString(netscapeFormat);
                            fs.writeFileSync(ENCRYPTED_COOKIE_PATH, encryptedCookie);
                        } else {
                            // 極少數系統不支援加密時，退回明文保護
                            fs.writeFileSync(ENCRYPTED_COOKIE_PATH, netscapeFormat, 'utf-8');
                        }

                        loginWin.webContents.executeJavaScript(`
                            const div = document.createElement('div');
                            div.id = 'success-tip';
                            div.innerHTML = "✅ 登入成功！正在自動關閉視窗...";
                            div.style.cssText = "position:fixed; top:0; left:0; width:100%; background:#10b981; color:white; text-align:center; padding:15px; z-index:99999; font-size:20px; font-weight:bold;";
                            document.body.appendChild(div);
                        `).catch(() => { });

                        setTimeout(() => {
                            if (!loginWin.isDestroyed()) loginWin.destroy();
                            resolve({ success: true, isLoggedIn: true });
                        }, 1000);
                    }
                } catch (e) {
                    console.error('檢查 Cookie 時出錯:', e);
                }
            }

            checkInterval = setInterval(() => {
                if (!loginWin.isDestroyed()) {
                    checkLoginAndClose();
                } else {
                    clearInterval(checkInterval);
                }
            }, 1500);

            loginWin.on('close', async (event) => {
                clearInterval(checkInterval);
                if (isResolved) return;

                const cookies = await session.defaultSession.cookies.get({ url: 'https://www.youtube.com' });
                const isLoggedIn = cookies.some(c => c.name === 'SID');
                resolve({ success: true, isLoggedIn: isLoggedIn });
            });
        });
    });

    // 8. 下載功能 API
    ipcMain.handle('api:download', async (event, { url, format, savePath }) => {
        return new Promise((resolve, reject) => {
            const downloadFormat = format || 'mp3';
            // 決定最終儲存路徑
            const targetDir = savePath || DOWNLOAD_DIR;

            if (mainWindowInstance) mainWindowInstance.webContents.send('log', `\n[Job] Starting download (${downloadFormat}): ${url}`);

            let tempCookiePath = null; // 【新增】暫存的解密 Cookie 檔案路徑

            try {
                let args = [
                    url,
                    '--encoding', 'utf-8',
                    '--ffmpeg-location', getFfmpegPath(),
                    '-P', targetDir,
                    '--no-playlist',
                    '--progress',
                    '--newline',
                    '--output', downloadFormat === 'mp4' ? '%(title)s (Video).%(ext)s' : '%(title)s (Audio).%(ext)s',
                    '--extractor-args', 'youtube:player_client=tv,web',
                    '--no-check-certificates'
                ];

                // 【解密與暫存處理】
                if (fs.existsSync(ENCRYPTED_COOKIE_PATH)) {
                    try {
                        const encryptedData = fs.readFileSync(ENCRYPTED_COOKIE_PATH);
                        let decryptedString;
                        try {
                            decryptedString = safeStorage.decryptString(encryptedData);
                        } catch (e) {
                            // 兼容無加密能力的環境
                            decryptedString = encryptedData.toString('utf-8');
                        }

                        // 在 OS 的暫存目錄建立隨機名稱的臨時 Cookie 檔
                        tempCookiePath = path.join(os.tmpdir(), `yt_cookie_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.txt`);
                        fs.writeFileSync(tempCookiePath, decryptedString, 'utf-8');

                        if (mainWindowInstance) mainWindowInstance.webContents.send('log', `[Job] 🔒 偵測到加密憑證，已安全解密並解鎖最高畫質...`);
                        args.push('--cookies', tempCookiePath);
                    } catch (err) {
                        console.error('Cookie 處理失敗:', err);
                        if (mainWindowInstance) mainWindowInstance.webContents.send('log', `[Job] ⚠️ Cookie 讀取失敗，將以未登入狀態下載。`);
                    }
                }

                if (downloadFormat === 'mp4') {
                    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
                    args.push('--merge-output-format', 'mp4');
                } else {
                    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
                }

                const ytDlpProcess = ytDlpWrap.exec(args);

                // 【清理暫存機制】無論成功或失敗都要銷毀明文暫存檔
                const cleanupTempCookie = () => {
                    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
                        try { fs.unlinkSync(tempCookiePath); } catch (e) { }
                    }
                };

                ytDlpProcess.ytDlpProcess.stdout.on('data', (buffer) => {
                    const text = buffer.toString('utf-8');
                    const match = text.match(/(\d+\.\d+)%/);
                    if (match) {
                        const percent = parseFloat(match[1]);
                        if (mainWindowInstance) mainWindowInstance.webContents.send('downloadProgress', { percent, eta: '下載中...' });
                    }
                });

                ytDlpProcess.ytDlpProcess.stderr.on('data', (buffer) => {
                    const text = buffer.toString('utf-8');
                    if (text.includes('Sign in to confirm') || text.includes('confirm you are not a bot')) {
                        if (mainWindowInstance) mainWindowInstance.webContents.send('cookieExpired');
                    }
                    if (!text.includes('%')) {
                        if (mainWindowInstance) mainWindowInstance.webContents.send('log', `[yt-dlp] ${text.trim()}`);
                    }
                    const match = text.match(/(\d+\.\d+)%/);
                    if (match) {
                        const percent = parseFloat(match[1]);
                        if (mainWindowInstance) mainWindowInstance.webContents.send('downloadProgress', { percent, eta: '下載中...' });
                    }
                });

                ytDlpProcess.on('close', (code) => {
                    cleanupTempCookie(); // 【新增】執行完畢銷毀明文
                    if (code === 0) {
                        if (mainWindowInstance) {
                            mainWindowInstance.webContents.send('log', `\n[Job] ${downloadFormat.toUpperCase()} Task Completed`);
                            mainWindowInstance.webContents.send('downloadComplete');
                        }
                        resolve({ success: true });
                    } else {
                        reject(new Error(`下載失敗 (Exit code: ${code})`));
                    }
                });

                ytDlpProcess.on('error', (err) => {
                    cleanupTempCookie(); // 【新增】發生錯誤銷毀明文
                    reject(new Error(err.message));
                });

            } catch (error) {
                // 如果在執行 yt-dlp 之前就崩潰，也要銷毀明文
                if (tempCookiePath && fs.existsSync(tempCookiePath)) {
                    try { fs.unlinkSync(tempCookiePath); } catch (e) { }
                }
                reject(new Error(error.message));
            }
        });
    });
}