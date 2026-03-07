import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import YTDlpWrap from 'yt-dlp-wrap';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';
import { exec } from 'child_process'; // 用於執行系統指令
import util from 'util';
import AdmZip from 'adm-zip'; // 【新增】跨平台原生解壓縮模組

// 【神級新增】從 Electron 匯入視窗與 session 模組
import { app as electronApp, BrowserWindow, session, shell } from 'electron';

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

// [關鍵新增] 將隱藏資料夾加入環境變數 PATH，讓 yt-dlp 能自動偵測到 deno.exe
process.env.PATH = `${APP_DATA_DIR}${path.delimiter}${process.env.PATH}`;

const DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');
const isWin = os.platform() === 'win32';
const BINARY_PATH = path.join(APP_DATA_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp_macos');

const getFfmpegPath = () => {
    return ffmpegPath.includes('app.asar')
        ? ffmpegPath.replace('app.asar', 'app.asar.unpacked')
        : ffmpegPath;
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const YTDlpClass = YTDlpWrap.default;
const ytDlpWrap = new YTDlpClass();

// 新增 Deno 下載路徑定義
const DENO_PATH = path.join(APP_DATA_DIR, isWin ? 'deno.exe' : 'deno');
let isSystemReady = false;

async function ensureBinary() {
    // 1. 檢查並下載 yt-dlp
    if (!fs.existsSync(BINARY_PATH)) {
        console.log('[System] Downloading yt-dlp...');
        await YTDlpClass.downloadFromGithub(BINARY_PATH);
    }
    ytDlpWrap.setBinaryPath(BINARY_PATH);

    // 2. 檢查並自動下載 Deno (高清下載必需品)
    if (!fs.existsSync(DENO_PATH)) {
        console.log('[System] Deno not found, initializing auto-download... (This may take a minute)');
        try {
            const zipUrl = isWin
                ? 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
                : 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip';
            const zipPath = path.join(APP_DATA_DIR, 'deno.zip');

            // 原生 Fetch 下載，無系統權限限制
            const response = await fetch(zipUrl);
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            // 寫入壓縮檔
            const buffer = await response.arrayBuffer();
            fs.writeFileSync(zipPath, Buffer.from(buffer));

            // 解壓縮到 APP_DATA_DIR (deno.exe 會直接放在這裡)
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(APP_DATA_DIR, true);

            // 確保 Mac/Linux 下有執行權限
            if (!isWin) fs.chmodSync(DENO_PATH, 0o755);

            // 清理暫存檔
            fs.unlinkSync(zipPath);
            console.log(`[System] Deno for ${isWin ? 'Windows' : 'Mac/Linux'} downloaded and extracted successfully!`);
        } catch (error) {
            console.error('[System] Failed to download Deno:', error.message);
            console.log('請手動下載 deno.exe 並放置於:', APP_DATA_DIR);
        }
    }
}

// Socket 連線測試
io.on('connection', (socket) => {
    console.log('[Socket] Client connected');
    // 【關鍵修復】若前端連線時後端已就緒，立刻補發解鎖訊號
    if (isSystemReady) {
        socket.emit('systemReady');
    }
});

app.get('/api/open-folder', (req, res) => {
    // 根據作業系統執行開啟指令
    const command = isWin ? `explorer "${DOWNLOAD_DIR}"` : `open "${DOWNLOAD_DIR}"`;
    exec(command);
    res.json({ success: true });
});

// ==========================================
// 【終極魔改】攔截 YouTube Cookie 系統 (修復 Mojo 崩潰與逾時)
// ==========================================
app.get('/api/login', async (req, res) => {
    req.setTimeout(0);

    const loginWin = new BrowserWindow({
        width: 800,
        height: 700,
        autoHideMenuBar: true,
        title: 'YouTube 登入中 (偵測到登入後將自動關閉)',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await loginWin.loadURL('https://www.youtube.com');

    // 用來停止輪詢的變數
    let checkInterval;

    // 核心功能：檢查 Cookie 並執行關閉
    async function checkLoginAndClose() {
        try {
            const cookies = await session.defaultSession.cookies.get({ url: 'https://www.youtube.com' });
            // SID 是 YouTube 登入最關鍵的憑證
            const isLoggedIn = cookies.some(c => c.name === 'SID');

            if (isLoggedIn) {
                // 1. 停止檢查
                clearInterval(checkInterval);

                // 2. 轉換並儲存 Cookie
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
                console.log(`[系統] 偵測到登入成功，已自動儲存並關閉視窗`);

                // 3. 在 YouTube 頁面上顯示成功訊息給使用者看 (選填)
                loginWin.webContents.executeJavaScript(`
                    const div = document.createElement('div');
                    div.id = 'success-tip';
                    div.innerHTML = "✅ 登入成功！正在自動關閉視窗...";
                    div.style.cssText = "position:fixed; top:0; left:0; width:100%; background:#10b981; color:white; text-align:center; padding:15px; z-index:99999; font-size:20px; font-weight:bold;";
                    document.body.appendChild(div);
                `).catch(() => { });

                // 4. 回傳給前端並關閉
                if (!res.headersSent) {
                    res.json({ success: true, isLoggedIn: true });
                }

                // 延遲一秒關閉，讓使用者看得到那行綠色的字
                setTimeout(() => {
                    if (!loginWin.isDestroyed()) loginWin.destroy();
                }, 1000);

                return true;
            }
        } catch (e) {
            console.error('檢查 Cookie 時出錯:', e);
        }
        return false;
    }

    // 每 1.5 秒自動檢查一次 Cookie 狀態
    checkInterval = setInterval(() => {
        if (!loginWin.isDestroyed()) {
            checkLoginAndClose();
        } else {
            clearInterval(checkInterval);
        }
    }, 1500);

    // 預防萬一：使用者手動關閉視窗也要處理
    loginWin.on('close', async (event) => {
        clearInterval(checkInterval);
        if (res.headersSent) return;

        event.preventDefault(); // 攔截關閉
        // 最後檢查一次有沒有登入
        const cookies = await session.defaultSession.cookies.get({ url: 'https://www.youtube.com' });
        const isLoggedIn = cookies.some(c => c.name === 'SID');

        res.json({ success: true, isLoggedIn: isLoggedIn });
        loginWin.destroy(); // 正式銷毀
    });
});

// ==========================================
// 【新增】檢查目前是否有存活的 Cookie
// ==========================================
app.get('/api/check-login', (req, res) => {
    // 只要檔案存在，我們就當作已登入 (若過期，使用者可手動重新登入)
    const isLoggedIn = fs.existsSync(COOKIE_FILE_PATH);
    res.json({ isLoggedIn });
});

// ==========================================
// 【新增】登出 (刪除 Cookie 檔案)
// ==========================================
app.post('/api/logout', (req, res) => {
    try {
        if (fs.existsSync(COOKIE_FILE_PATH)) {
            fs.unlinkSync(COOKIE_FILE_PATH);
        }
        console.log('[系統] 使用者已登出，Cookie 已清除');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/download', async (req, res) => {
    const { url, format } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const downloadFormat = format || 'mp3';
    console.log(`\n[Job] Starting download (${downloadFormat}): ${url}`);

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

        // 【關鍵】如果專案資料夾裡有我們攔截產生的 cookies.txt，直接餵給它！
        if (fs.existsSync(COOKIE_FILE_PATH)) {
            console.log(`[Job] 偵測到 Cookie 憑證，解鎖最高畫質與音質...`);
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
                process.stdout.write(`\r>>> Progress (${downloadFormat}): ${percent}%   `);
                io.emit('downloadProgress', { percent, eta: '下載中...' });
            }
        });

        ytDlpProcess.ytDlpProcess.stderr.on('data', (buffer) => {
            const text = buffer.toString('utf-8');

            // 【自動偵測過期】檢查是否有「請登入」的關鍵字
            if (text.includes('Sign in to confirm') || text.includes('confirm you are not a bot')) {
                console.log('[系統] 偵測到 Cookie 可能已過期，通知前端...');
                io.emit('cookieExpired'); // 發送過期訊號
            }

            if (!text.includes('%')) {
                console.error(`\n[yt-dlp 訊息] ${text.trim()}`);
            }
            const match = text.match(/(\d+\.\d+)%/);
            if (match) {
                const percent = parseFloat(match[1]);
                io.emit('downloadProgress', { percent, eta: '下載中...' });
            }
        });

        ytDlpProcess.on('close', (code) => {
            // 【安全清理】無論成功或失敗，都把臨時的 Cookie 檔案刪除
            // if (tempCookiePath && fs.existsSync(tempCookiePath)) {
            //     fs.unlinkSync(tempCookiePath);
            // }

            if (code === 0) {
                process.stdout.write(`\n[Job] ${downloadFormat.toUpperCase()} Task Completed\n`);
                io.emit('downloadProgress', { percent: 100, eta: '完成' });
                res.json({ success: true });
            } else {
                console.error(`\n[Job] Failed with exit code ${code}`);
                if (!res.headersSent) res.status(500).json({ error: `下載失敗 (Exit code: ${code})` });
            }
        });

        ytDlpProcess.on('error', (err) => {
            // 【安全清理】發生崩潰錯誤時也要刪除
            // if (tempCookiePath && fs.existsSync(tempCookiePath)) {
            //     fs.unlinkSync(tempCookiePath);
            // }
            console.error('\n[Job] Failed:', err.message);
            if (!res.headersSent) res.status(500).json({ error: err.message });
        });

    } catch (error) {
        // if (tempCookiePath && fs.existsSync(tempCookiePath)) fs.unlinkSync(tempCookiePath);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 【新增】一鍵修復引擎 (自動刪除舊版並重抓最新版)
// ==========================================
app.post('/api/fix-engine', async (req, res) => {
    try {
        console.log('[系統] 客戶要求修復引擎，準備刪除舊版 yt-dlp...');

        // 1. 如果舊檔案存在，強制刪除
        if (fs.existsSync(BINARY_PATH)) {
            fs.unlinkSync(BINARY_PATH);
            console.log('[系統] 舊版 yt-dlp 已刪除');
        }

        // 2. 呼叫你原本寫好的 ensureBinary 重新下載最新版
        console.log('[系統] 正在為客戶下載最新版 yt-dlp...');
        await ensureBinary();
        console.log('[系統] 最新版 yt-dlp 下載完成！');

        res.json({ success: true });
    } catch (error) {
        console.error('[系統] 修復引擎失敗:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/open-folder', (req, res) => {
    try {
        shell.openPath(APP_DATA_DIR);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 【新增】取得專案版本號 (從 package.json)
// ==========================================
app.get('/api/version', (req, res) => {
    try {
        // 直接回傳 Electron 核心抓到的版本號，效能最高且最穩定
        res.json({ version: electronApp.getVersion() });
    } catch (error) {
        res.status(500).json({ error: '無法取得版本資訊' });
    }
});

export function startServer() {
    return new Promise((resolve) => {
        // 立即啟動伺服器並回傳 Port 給 Electron，讓 UI 瞬間載入不卡頓
        const s = server.listen(0, () => {
            const port = s.address().port;
            console.log(`[System] Server started on Port: ${port}`);
            resolve(port);

            // 將依賴下載移至背景異步執行
            ensureBinary().then(() => {
                isSystemReady = true;
                io.emit('systemReady'); // 下載/檢查完畢，通知前端解鎖
            }).catch(err => {
                console.error('[System] Background initialization failed:', err);
                // 【關鍵修復】即使背景下載失敗也要解鎖 UI，避免永久卡死
                isSystemReady = true;
                io.emit('systemReady');
            });
        });
    });
}