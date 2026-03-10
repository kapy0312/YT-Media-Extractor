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
import { app as electronApp, BrowserWindow, session, shell, ipcMain } from 'electron';

process.env.PYTHONIOENCODING = 'utf-8';
process.env.LANG = 'zh_TW.UTF-8';

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_DATA_DIR = path.join(os.homedir(), '.yt-audio-extractor');
if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

const COOKIE_FILE_PATH = path.join(APP_DATA_DIR, 'cookies.txt');

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

    // 【新增】提供前端「主動查詢」系統狀態的 API
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

    // 3. 開啟資料夾 API
    ipcMain.handle('api:open-folder', () => {
        try {
            const command = isWin ? `explorer "${DOWNLOAD_DIR}"` : `open "${DOWNLOAD_DIR}"`;
            exec(command);
            return { success: true };
        } catch (error) {
            throw new Error(error.message);
        }
    });

    // 4. 檢查登入狀態 API
    ipcMain.handle('api:check-login', () => {
        const isLoggedIn = fs.existsSync(COOKIE_FILE_PATH);
        return { isLoggedIn };
    });

    ipcMain.handle('api:open-app-data-folder', () => {
        try {
            shell.openPath(APP_DATA_DIR);
            return { success: true };
        } catch (error) {
            throw new Error(error.message);
        }
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

                        fs.writeFileSync(COOKIE_FILE_PATH, netscapeFormat, 'utf-8');

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
    ipcMain.handle('api:download', async (event, { url, format }) => {
        return new Promise((resolve, reject) => {
            const downloadFormat = format || 'mp3';
            if (mainWindowInstance) mainWindowInstance.webContents.send('log', `\n[Job] Starting download (${downloadFormat}): ${url}`);

            try {
                let args = [
                    url,
                    '--encoding', 'utf-8',
                    '--ffmpeg-location', getFfmpegPath(),
                    '-P', DOWNLOAD_DIR,
                    '--no-playlist',
                    '--progress',
                    '--newline',
                    '--output', downloadFormat === 'mp4' ? '%(title)s (Video).%(ext)s' : '%(title)s (Audio).%(ext)s',
                    '--extractor-args', 'youtube:player_client=tv,web',
                    '--no-check-certificates'
                ];

                if (fs.existsSync(COOKIE_FILE_PATH)) {
                    if (mainWindowInstance) mainWindowInstance.webContents.send('log', `[Job] 偵測到 Cookie 憑證，解鎖最高畫質與音質...`);
                    args.push('--cookies', COOKIE_FILE_PATH);
                }

                if (downloadFormat === 'mp4') {
                    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
                    args.push('--merge-output-format', 'mp4');
                } else {
                    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
                }

                const ytDlpProcess = ytDlpWrap.exec(args);

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
                    reject(new Error(err.message));
                });

            } catch (error) {
                reject(new Error(error.message));
            }
        });
    });
}