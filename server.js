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

process.env.PYTHONIOENCODING = 'utf-8';
process.env.LANG = 'zh_TW.UTF-8';

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_DATA_DIR = path.join(os.homedir(), '.yt-audio-extractor');
if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}

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
            if (isWin) {
                // Windows：使用 PowerShell 下載並解壓縮 Deno
                const zipPath = path.join(APP_DATA_DIR, 'deno.zip');
                const command = `powershell -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' -OutFile '${zipPath}'; Expand-Archive -Path '${zipPath}' -DestinationPath '${APP_DATA_DIR}' -Force; Remove-Item '${zipPath}'"`;

                await execPromise(command);
                console.log('[System] Deno for Windows downloaded and extracted successfully!');
            } else {
                // Mac/Linux：使用 curl 下載並 unzip (若您未來想支援 Mac)
                const zipPath = path.join(APP_DATA_DIR, 'deno.zip');
                const command = `curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip -o "${zipPath}" && unzip -o "${zipPath}" -d "${APP_DATA_DIR}" && rm "${zipPath}"`;

                await execPromise(command);
                console.log('[System] Deno for Mac/Linux downloaded and extracted successfully!');
            }
        } catch (error) {
            console.error('[System] Failed to download Deno:', error.message);
            console.log('請手動下載 deno.exe 並放置於:', APP_DATA_DIR);
        }
    }
}

// Socket 連線測試
io.on('connection', (socket) => {
    // console.log('[Socket] 客戶端已連線');
    console.log('[Socket] Client connected');
});

app.get('/api/open-folder', (req, res) => {
    // 根據作業系統執行開啟指令
    const command = isWin ? `explorer "${DOWNLOAD_DIR}"` : `open "${DOWNLOAD_DIR}"`;
    exec(command);
    res.json({ success: true });
});

app.post('/api/download', async (req, res) => {
    // 接收來自前端的 url, 格式, 和 cookie 文字
    const { url, format, cookieData } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const downloadFormat = format || 'mp3';
    console.log(`\n[Job] Starting download (${downloadFormat}): ${url}`);

    // 【準備臨時 Cookie 檔案】
    let tempCookiePath = null;
    if (cookieData && cookieData.trim() !== '') {
        // 在隱藏資料夾內產生一個隨機名稱的暫存檔
        tempCookiePath = path.join(APP_DATA_DIR, `temp_cookie_${Date.now()}.txt`);
        fs.writeFileSync(tempCookiePath, cookieData);
        console.log(`[Job] 使用者提供了 Cookie，已建立暫存檔解鎖高畫質`);
    }

    try {
        let args = [
            url,
            '--encoding', 'utf-8',
            '--ffmpeg-location', getFfmpegPath(),
            '-P', DOWNLOAD_DIR,
            '--no-playlist',
            '--progress',
            '--newline',
            // 【修復 Bug】在檔名加上 (Video) 或 (Audio)，防止 MP4 被 MP3 的暫存檔覆蓋！
            '--output', downloadFormat === 'mp4' ? '%(title)s (Video).%(ext)s' : '%(title)s (Audio).%(ext)s',
            '--extractor-args', 'youtube:player_client=tv,web',
            '--no-check-certificates'
        ];

        // 如果有 Cookie，就把參數加進去
        if (tempCookiePath) {
            args.push('--cookies', tempCookiePath);
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
            if (tempCookiePath && fs.existsSync(tempCookiePath)) {
                fs.unlinkSync(tempCookiePath);
            }

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
            if (tempCookiePath && fs.existsSync(tempCookiePath)) {
                fs.unlinkSync(tempCookiePath);
            }
            console.error('\n[Job] Failed:', err.message);
            if (!res.headersSent) res.status(500).json({ error: err.message });
        });

    } catch (error) {
        if (tempCookiePath && fs.existsSync(tempCookiePath)) fs.unlinkSync(tempCookiePath);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

export function startServer() {
    return new Promise((resolve) => {
        ensureBinary().then(() => {
            // 注意：這裡是 server.listen 而不是 app.listen
            const s = server.listen(0, () => {
                const port = s.address().port;
                // console.log(`[System] 伺服器啟動於 Port: ${port}`);
                console.log(`[System] Server started on Port: ${port}`);
                resolve(port);
            });
        });
    });
}