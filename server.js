import YTDlpWrap from 'yt-dlp-wrap';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import { exec } from 'child_process';
import util from 'util';
import AdmZip from 'adm-zip';
import log from 'electron-log/main.js';

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

// 配置日誌
log.transports.file.level = 'info';
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
// 自動將 console.log 轉向到 electron-log
Object.assign(console, log.functions);

// 👇 [新增] 全域崩潰捕捉，確保致命錯誤一定會寫入 Log
process.on('uncaughtException', (error) => {
    log.error('[Fatal Error] Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason) => {
    log.error('[Fatal Error] Unhandled Rejection:', reason);
});

// 👇 [新增] 全域狀態變數，用來追蹤當前任務與暫存檔
let currentYtDlpProcess = null;
let activeTempCookiePath = null;
let isDownloading = false; // 後端併發鎖

// 👇 [新增] 強制清道夫函式：確保軟體關閉時絕對不會留下明文 Cookie 或殭屍行程
export function cleanupOnExit() {
    if (currentYtDlpProcess && !currentYtDlpProcess.killed) {
        try {
            currentYtDlpProcess.kill('SIGKILL');
            log.info('[System] Force killed background yt-dlp process.');
        } catch (e) { }
    }
    if (activeTempCookiePath && fs.existsSync(activeTempCookiePath)) {
        try {
            fs.unlinkSync(activeTempCookiePath);
            log.info('[System] Force cleaned up residual temp cookie.');
        } catch (e) { }
    }
}

// ==========================================
// 【核心功能】初始化後端並註冊所有 IPC API
// ==========================================

// ==========================================
// 🌐 網路請求工具：支援超時與重試機制
// ==========================================
async function fetchWithTimeoutAndRetry(url, options = {}, retries = 3, timeoutMs = 60000) {
    for (let i = 0; i < retries; i++) {
        const controller = new AbortController(); // 用來中斷請求的控制器
        const id = setTimeout(() => controller.abort(), timeoutMs); // 設定超時自動中斷

        try {
            console.log(`[Network] Fetching ${url} (Attempt ${i + 1}/${retries})...`);
            // 將信號 (signal) 傳給 fetch，這樣超時的時候才能強制拔線
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id); // 成功連線就解除定時炸彈

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            return response;
        } catch (error) {
            clearTimeout(id);
            const isTimeout = error.name === 'AbortError';
            const errMsg = isTimeout ? '連線超時 (Timeout)' : error.message;

            console.warn(`[Network] Download failed (Attempt ${i + 1}/${retries}): ${errMsg}`);

            if (i === retries - 1) throw new Error(`嘗試 ${retries} 次後皆失敗: ${errMsg}`);

            // 失敗後不要馬上重試，等待 3 秒讓網路喘息一下
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// ==========================================
// 📦 確保依賴組件存在 (含超時重試機制)
// ==========================================
async function ensureBinary() {
    // 1. 檢查並下載 yt-dlp (加入 3 次重試機制)
    if (!fs.existsSync(BINARY_PATH)) {
        console.log('[System] Downloading yt-dlp...');
        for (let i = 0; i < 3; i++) {
            try {
                await YTDlpClass.downloadFromGithub(BINARY_PATH);
                console.log('[System] yt-dlp downloaded successfully!');
                break; // 成功就跳出迴圈
            } catch (err) {
                console.warn(`[System] yt-dlp download failed (Attempt ${i + 1}/3): ${err.message}`);
                if (i === 2) console.error('[System] Failed to download yt-dlp after 3 attempts.');
                else await new Promise(res => setTimeout(res, 3000));
            }
        }
    }
    ytDlpWrap.setBinaryPath(BINARY_PATH);

    // 2. 檢查並下載 Deno (使用自訂的超時重試 fetch)
    if (!fs.existsSync(DENO_PATH)) {
        console.log('[System] Deno not found, initializing auto-download...');
        try {
            // 👇 【新增】判斷 Mac 架構 (支援 M1/M2/M3)
            const isMacArm = !isWin && os.arch() === 'arm64';

            // 👇 【修改】根據作業系統與晶片架構，派發對應的下載網址
            const zipUrl = isWin
                ? 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
                : isMacArm
                    ? 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip'
                    : 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip';

            const zipPath = path.join(APP_DATA_DIR, 'deno.zip');

            // 🚀 【升級】使用我們寫好的工具：3 次重試，每次 60 秒超時
            const response = await fetchWithTimeoutAndRetry(zipUrl, {}, 3, 60000);

            const buffer = await response.arrayBuffer();
            fs.writeFileSync(zipPath, Buffer.from(buffer));

            const zip = new AdmZip(zipPath);
            zip.extractAllTo(APP_DATA_DIR, true);

            if (!isWin) fs.chmodSync(DENO_PATH, 0o755);
            fs.unlinkSync(zipPath);
            console.log(`[System] Deno downloaded successfully!`);
        } catch (error) {
            console.error('[System] Deno installation aborted:', error.message);
        }
    }
}

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
    ipcMain.handle('api:logout', async () => {  // 👈 【修改 1】必須加上 async
        try {
            // 刪除實體硬碟的備份檔
            if (fs.existsSync(ENCRYPTED_COOKIE_PATH)) fs.unlinkSync(ENCRYPTED_COOKIE_PATH);

            // 👇 【修改 2：關鍵修復】徹底清除 Electron 瀏覽器內部所有的暫存與 Cookie！
            // 這樣下次打開登入視窗，才會是乾乾淨淨、需要重新輸入帳密的狀態
            // await session.defaultSession.clearStorageData();

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
        // 👇 [新增] 後端防護鎖，拒絕同時下載
        if (isDownloading) return { success: false, error: '目前已有下載任務正在進行中。' };
        isDownloading = true;

        return new Promise((resolve, reject) => {
            const downloadFormat = format || 'mp3';
            // 決定最終儲存路徑
            const targetDir = savePath || DOWNLOAD_DIR;

            if (mainWindowInstance) mainWindowInstance.webContents.send('log', `\n[Job] Starting download (${downloadFormat}): ${url}`);

            let tempCookiePath = null; // 【新增】暫存的解密 Cookie 檔案路徑

            try {
                let lastErrorMsg = ''; // 👇【新增】用來完整收集 yt-dlp 的錯誤報錯字串

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
                        activeTempCookiePath = tempCookiePath; // 👈 [新增] 註冊到全域，防突發崩潰
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
                currentYtDlpProcess = ytDlpProcess.ytDlpProcess; // 👈 [新增] 註冊到全域，防止變殭屍

                // 【清理暫存機制】無論成功或失敗都要銷毀明文暫存檔
                const cleanupTempCookie = () => {
                    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
                        try { fs.unlinkSync(tempCookiePath); } catch (e) { }
                    }
                    activeTempCookiePath = null; // 清除全域紀錄
                    currentYtDlpProcess = null;  // 清除全域紀錄
                    isDownloading = false;       // 👈 [新增] 解開防護鎖
                };

                // 👇 【關鍵修復一】：完整解析 stdout，把被隱藏的「合併中」狀態吐給前端
                ytDlpProcess.ytDlpProcess.stdout.on('data', (buffer) => {
                    const text = buffer.toString('utf-8');
                    const lines = text.split('\n');

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        // 解析進度 (改良 Regex：支援 100% 或是 23.4%)
                        const match = line.match(/(\d+(?:\.\d+)?)%/);
                        if (match) {
                            const percent = parseFloat(match[1]);
                            if (mainWindowInstance) mainWindowInstance.webContents.send('downloadProgress', { percent, eta: '下載中...' });
                        } else {
                            // 💡 顯示沒有 % 的關鍵狀態 (例如 Destination、Merging 合併中、Deleting...)
                            if (mainWindowInstance) mainWindowInstance.webContents.send('log', `[yt-dlp] ${line.trim()}`);
                        }
                    }
                });

                ytDlpProcess.ytDlpProcess.stderr.on('data', (buffer) => {
                    const text = buffer.toString('utf-8');
                    lastErrorMsg += text; // 收集錯誤輸出

                    if (text.includes('Sign in to confirm') || text.includes('confirm you are not a bot')) {
                        if (mainWindowInstance) mainWindowInstance.webContents.send('cookieExpired');
                    }
                    if (!text.includes('%')) {
                        if (mainWindowInstance) mainWindowInstance.webContents.send('log', `[Warn] ${text.trim()}`);
                    }
                });

                // 👇 【關鍵修復二】：確保結束時發送完成信號給 UI
                ytDlpProcess.on('close', (code) => {
                    cleanupTempCookie();
                    // 有時候套件成功退出時 code 會是 null，所以加上 || code == null 容錯
                    if (code === 0 || code == null) {
                        if (mainWindowInstance) {
                            mainWindowInstance.webContents.send('log', `\n[Job] ${downloadFormat.toUpperCase()} Task Completed`);
                            mainWindowInstance.webContents.send('downloadComplete'); // 👈 這裡一定要觸發前端的動畫收起
                        }
                        resolve({ success: true });
                    } else {
                        reject(new Error(lastErrorMsg || `下載失敗 (Exit code: ${code})`));
                    }
                });

                ytDlpProcess.on('error', (err) => {
                    cleanupTempCookie();
                    reject(new Error(err.message));
                });

            } catch (error) {
                isDownloading = false; // 解鎖
                if (tempCookiePath && fs.existsSync(tempCookiePath)) {
                    try { fs.unlinkSync(tempCookiePath); } catch (e) { }
                }
                activeTempCookiePath = null;
                reject(new Error(error.message));
            }
        });
    });

    // 🚀 [新增] 檢查更新 API
    ipcMain.handle('api:check-update', async () => {
        try {
            // 使用 Raw 連結讀取你的 JSON
            // 👇 [修改] 加上 ?t=時間戳記，強迫各國 ISP 抓取最新版本的 JSON，防止被快取
            const versionUrl = `https://raw.githubusercontent.com/kapy0312/my-app-update/main/versions.json?t=${Date.now()}`;
            const response = await fetchWithTimeoutAndRetry(versionUrl, { cache: 'no-store' }, 3, 10000);
            // 💡 這裡也順便套用了你寫好的 fetchWithTimeoutAndRetry 工具，讓檢查更新更穩！

            const data = await response.json();
            const remoteInfo = data['YT-Media-Extractor'];
            const currentVersion = electronApp.getVersion(); // 抓取 package.json 裡的 version

            // 比對版本號
            if (remoteInfo && remoteInfo.latest_version !== currentVersion) {
                return {
                    hasUpdate: true,
                    latestVersion: remoteInfo.latest_version,
                    downloadUrl: remoteInfo.download_url
                };
            }
            return { hasUpdate: false };
        } catch (error) {
            console.error('[Update Check Error]:', error);
            return { hasUpdate: false };
        }
    });

    // 🚀 [新增] 開啟瀏覽器 API
    ipcMain.handle('api:open-external', (event, url) => {
        if (url) shell.openExternal(url);
    });

    // 🚀 [新增] 開啟日誌資料夾 API
    ipcMain.handle('api:open-logs', () => {
        const logPath = log.transports.file.getFile().path;
        shell.showItemInFolder(logPath);
        return { success: true };
    });
}