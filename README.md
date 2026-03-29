# YT-Media-Extractor (YouTube 影音下載神器)

<div align="center">

![Version](https://img.shields.io/badge/Version-2.6.5-blue)
![Electron](https://img.shields.io/badge/Electron-33.2.0-47848F?logo=electron)
![Node](https://img.shields.io/badge/Node-v18%20%7C%20v22+-339933?logo=node.js)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20(Intel%2FM1%2FM2%2FM3)-lightgrey)
![Security](https://img.shields.io/badge/Security-OS--Level%20Encrypted-success)
![License](https://img.shields.io/badge/License-Personal_Research-orange)

**基於 Electron + yt-dlp 的跨平台 YouTube 影音下載工具**
支援 MP3 / MP4 格式、OS 級憑證加密、智慧錯誤翻譯、Apple Silicon 原生最佳化

</div>

---

## 目錄

- [專案簡介](#-專案簡介)
- [功能特色](#-功能特色)
- [技術架構](#-技術架構)
- [系統需求](#-系統需求)
- [安裝與執行](#-安裝與執行)
- [建置打包](#-建置打包)
- [檔案結構](#-檔案結構)
- [後端 IPC API 清單](#-後端-ipc-api-清單)
- [下載流程說明](#-下載流程說明)
- [安全架構設計](#-安全架構設計)
- [錯誤翻譯對照表](#-錯誤翻譯對照表)
- [開發小秘訣](#-開發小秘訣)
- [支持與贊助](#-支持與贊助)
- [免責聲明](#-免責聲明)

---

## 專案簡介

**YT-Media-Extractor** 是一款以 **Electron** 為基礎、結合 **yt-dlp** 引擎的跨平台桌面應用程式，專為追求乾淨、安全、無廣告下載體驗的使用者設計。

本軟體歷經核心架構的深度淬鍊，具備：
- **商業級安全防護**：OS 底層 DPAPI / Keychain 憑證加密，動態解密、閱後即焚
- **跨平台原生最佳化**：自動偵測 Mac 架構，為 Apple Silicon (M1/M2/M3) 配發 `aarch64` 原生核心
- **智慧錯誤翻譯**：將 yt-dlp 的工程錯誤碼自動轉譯為帶解決方案的白話中英文提示
- **零本地端 HTTP 伺服器**：完全採用 Electron 原生 IPC 通訊，杜絕防火牆警告與安全漏洞

---

## 功能特色

### 🛡️ 企業級安全與隱私防護

| 功能 | 說明 |
| :--- | :--- |
| **原生 IPC 通訊架構** | 捨棄本地 HTTP / WebSocket，改用 Electron IPC，零延遲啟動且不觸發防火牆警告 |
| **OS 級憑證加密** | 使用 `safeStorage`（Windows DPAPI / macOS Keychain）加密 YouTube Cookie，與 OS 帳號綁定 |
| **動態解密 + 閱後即焚** | 下載任務啟動才解密憑證，完成後立即強制刪除明文暫存檔，隱私零外洩 |
| **程式碼混淆 + CSP 防護** | 建置腳本整合 `javascript-obfuscator`，並實作嚴格 Content Security Policy，防止 XSS |
| **Context Isolation** | 嚴格的 Electron 安全模型：`nodeIntegration: false` + `contextIsolation: true` |
| **殭屍行程清道夫** | 應用程式退出時強制終止所有後台 yt-dlp 行程，避免資源洩漏 |

### ⚡ 跨平台效能與底層韌性

| 功能 | 說明 |
| :--- | :--- |
| **Apple Silicon 原生支援** | 精準硬體識別，為 arm64 Mac 自動下載 `aarch64` 架構核心，告別 Rosetta 轉譯損耗 |
| **智慧網路重試機制** | `fetchWithTimeoutAndRetry`：60 秒硬性超時攔截 + 3 次自動冷卻重試 |
| **五大穩定性防護鎖** | 殭屍行程清除、全域崩潰攔截 (`uncaughtException`)、下載併發鎖、快取穿透、錯誤邊界 |
| **自動核心安裝** | 首次啟動自動下載 yt-dlp / Deno 核心，支援安裝失敗後一鍵修復 |
| **最佳畫質自動選取** | yt-dlp 自動挑選最高品質音視頻流並透過 FFmpeg 合併輸出 |

### 💡 卓越的使用者體驗

| 功能 | 說明 |
| :--- | :--- |
| **MP3 / MP4 格式支援** | 下載 YouTube 影片為 MP3 音訊或 MP4 高清影片 |
| **智慧錯誤翻譯機** | 精準攔截 yt-dlp stderr，將 403、地區限制、Cookie 過期等錯誤轉為白話文提示 |
| **中英雙語系** | 介面支援繁體中文與英文即時切換 |
| **自訂下載路徑** | 使用者可設定並記憶自訂下載位置（儲存於 `localStorage`） |
| **即時進度顯示** | 下載進度條 + 即時狀態日誌更新 |
| **EULA 首次啟動攔截** | 首次啟動顯示「免責聲明與隱私政策」確認視窗，符合法規要求 |
| **YouTube 登入整合** | 內嵌 YouTube 登入視窗，解鎖高畫質與會員限定內容 |
| **一鍵修復引擎** | 提供 UI 按鈕重新下載 yt-dlp 核心，方便排除引擎故障 |

### 🛠️ 專業維運系統

| 功能 | 說明 |
| :--- | :--- |
| **靜默版本檢查** | 啟動後延遲 3.5 秒於背景比對 GitHub `versions.json`，不影響啟動速度 |
| **electron-log 日誌系統** | 完整記錄所有底層輸出至 `main.log`，支援檔案滾動管理 |
| **一鍵診斷日誌** | 點擊介面「📜 診斷日誌」按鈕即可開啟日誌資料夾，方便除錯與回報問題 |
| **應用程式資料夾快捷** | 點擊介面版本號可瞬間開啟隱藏的 `.yt-audio-extractor` 核心資料夾 |

---

## 技術架構

```
┌─────────────────────────────────────────────────┐
│             Renderer Process (前端)              │
│   public/index.html  (HTML / CSS / JavaScript)  │
│   - 下載 UI、進度條、語系切換、錯誤顯示         │
└──────────────────┬──────────────────────────────┘
                   │ window.api (contextBridge IPC)
┌──────────────────▼──────────────────────────────┐
│             preload.cjs (安全橋樑)               │
│   contextBridge 封裝 ipcRenderer，              │
│   前端無法直接存取 Node.js 底層                  │
└──────────────────┬──────────────────────────────┘
                   │ ipcMain handlers
┌──────────────────▼──────────────────────────────┐
│             Main Process (主程序)                │
│   main.js  - 視窗建立、生命週期、安全設定        │
│   server.js - 核心邏輯引擎                       │
│     ├─ yt-dlp 下載任務管理                       │
│     ├─ OS 級憑證加密 / 解密 (safeStorage)       │
│     ├─ 智慧錯誤翻譯                              │
│     ├─ 自動版本更新檢查                          │
│     └─ Deno / yt-dlp 核心自動安裝               │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│             外部工具 (External Tools)            │
│   yt-dlp    - YouTube 下載引擎                  │
│   FFmpeg    - 音視頻轉換 / 合併 (ffmpeg-static)  │
│   Deno      - 輔助執行環境                       │
└─────────────────────────────────────────────────┘
```

### 依賴套件清單

| 套件 | 用途 | 版本 |
| :--- | :--- | :--- |
| `electron` | 桌面應用程式框架 | ^33.2.0 |
| `yt-dlp-wrap` | yt-dlp 下載引擎封裝 | ^2.3.12 |
| `ffmpeg-static` | 音視頻處理 (靜態 FFmpeg 二進位) | ^5.2.0 |
| `electron-log` | 應用程式日誌管理 | ^5.4.3 |
| `adm-zip` | ZIP 解壓縮 (用於 Deno 下載) | ^0.5.16 |
| `electron-builder` | 應用程式打包與發布 | ^25.1.8 |
| `javascript-obfuscator` | 生產環境程式碼混淆 | ^5.3.0 |

---

## 系統需求

| 項目 | 需求 |
| :--- | :--- |
| **作業系統** | Windows 10/11 或 macOS (Intel / Apple Silicon M1/M2/M3) |
| **Node.js** | v18.19.0 或 v22+（推薦搭配 NVM 管理版本） |
| **網路** | 首次啟動需連線下載 yt-dlp 與 Deno 核心（約數十 MB） |
| **磁碟空間** | 至少 500 MB（含 node_modules 與核心工具） |

---

## 安裝與執行

### 1. 取得專案

```bash
git clone https://github.com/your-username/YT-Media-Extractor.git
cd YT-Media-Extractor
```

### 2. 安裝依賴套件

```bash
npm install
```

### 3. 啟動開發者模式

```bash
npm start
```

> 首次啟動時，應用程式將自動從網路下載 `yt-dlp` 與 `Deno` 核心至 `~/.yt-audio-extractor/` 目錄，請確保網路通暢。

---

## 建置打包

本專案已整合自動化混淆與打包流程。

### Windows（生成 .exe 安裝包 + .7z）

```bash
npm run build
```

> 執行 `build-app.js`，流程為：備份原始碼 → 混淆 `main.js` / `server.js` → 執行 `electron-builder` 打包 → 還原原始碼。

### macOS（生成 .dmg 映像檔）

```bash
npm run build:mac
```

> **注意**：macOS 打包需在 Mac 環境執行以確保最佳相容性。Apple Silicon 版本將自動包含 `aarch64` 原生核心。

### 輸出目錄

打包完成後，安裝檔位於 `dist/` 資料夾。

---

## 檔案結構

```
YT-Media-Extractor/
├── main.js          # Electron 主程序：視窗建立、安全設定、生命週期管理
├── server.js        # 核心邏輯引擎：yt-dlp 任務、加密、錯誤翻譯、版本檢查
├── preload.cjs      # 安全橋樑：contextBridge 封裝前端 IPC API (window.api)
├── build-app.js     # 自動化建置腳本：程式碼混淆 + electron-builder 打包
├── package.json     # 專案依賴、腳本指令、electron-builder 打包設定
├── logo.ico         # Windows 應用程式圖示
├── logo.png         # 應用程式 Logo
├── public/
│   ├── index.html   # 前端 UI：下載介面、多語系字典、進度條、錯誤顯示
│   └── bg.jpg       # 背景圖片
└── dist/            # 打包輸出目錄（.gitignore 排除）
```

### 應用程式資料目錄（執行時自動建立）

```
~/.yt-audio-extractor/
├── yt-dlp(.exe)     # yt-dlp 核心二進位（自動下載）
├── deno(.exe)       # Deno 執行環境（自動下載）
├── cookies.enc      # OS 加密的 YouTube 登入 Cookie
└── main.log         # electron-log 應用程式日誌
```

---

## 後端 IPC API 清單

前端透過 `window.api.invoke(channel, ...args)` 呼叫以下 API：

| API Channel | 功能說明 | 參數 | 回傳值 |
| :--- | :--- | :--- | :--- |
| `api:version` | 取得應用程式版本 | — | `{ version }` |
| `api:is-system-ready` | 檢查核心二進位是否已就緒 | — | `{ ready: boolean }` |
| `api:get-default-path` | 取得預設下載路徑 | — | `string` (路徑) |
| `api:select-folder` | 開啟資料夾選擇器 | — | `{ success, path }` |
| `api:open-folder` | 在系統檔案管理器開啟資料夾 | `targetPath: string` | `{ success }` |
| `api:open-app-data-folder` | 開啟 `.yt-audio-extractor` 資料夾 | — | `{ success }` |
| `api:check-login` | 檢查 YouTube 登入狀態 | — | `{ isLoggedIn: boolean }` |
| `api:login` | 開啟 YouTube 登入視窗 | — | `{ success, isLoggedIn }` |
| `api:logout` | 清除加密 Cookie 並登出 | — | `{ success }` |
| `api:download` | 啟動下載任務 | `{ url, format, savePath }` | `{ success }` 或錯誤訊息 |
| `api:fix-engine` | 重新下載 yt-dlp 核心 | — | `{ success, error? }` |
| `api:check-update` | 從 GitHub 檢查更新 | — | `{ hasUpdate, latestVersion, downloadUrl }` |
| `api:open-external` | 在瀏覽器開啟外部連結 | `url: string` | — |
| `api:open-logs` | 開啟日誌資料夾 | — | `{ success }` |

---

## 下載流程說明

```
使用者輸入 URL 與格式（MP3 / MP4）
         ↓
URL 格式驗證（防止多重網址輸入）
         ↓
檢查下載併發鎖（避免同時多工下載）
         ↓
檢查登入狀態
   ├─ 已登入 → 解密 cookies.enc → 建立暫存 Cookie 檔案
   └─ 未登入 → 以訪客模式繼續
         ↓
組裝 yt-dlp 參數（格式、畫質、路徑、Cookie）
         ↓
啟動 yt-dlp 子行程
         ↓
解析 stdout → 提取進度百分比 → 即時更新 UI 進度條
解析 stderr → 觸發錯誤翻譯 → 回傳白話文錯誤訊息
         ↓
下載完成或發生錯誤
         ↓
清理暫存 Cookie 檔案 + 終止子行程
         ↓
發送 downloadComplete 訊號至前端 UI
```

---

## 安全架構設計

### 憑證加密儲存流程

```
使用者完成 YouTube 登入
         ↓
擷取 Cookie 資料
         ↓
Electron safeStorage.encryptString()
（OS 底層加密：Windows DPAPI / macOS Keychain）
         ↓
儲存至 ~/.yt-audio-extractor/cookies.enc
         ↓
─────────────── 下載啟動時 ───────────────
         ↓
safeStorage.decryptString() 解密
         ↓
寫入 OS 暫存目錄的臨時 Cookie 檔案
         ↓
傳遞給 yt-dlp 行程使用
         ↓
下載完成 / 發生錯誤 / 程式崩潰
         ↓
fs.unlinkSync() 強制刪除暫存 Cookie 檔案
```

### IPC 安全隔離架構

```
Renderer (前端)
  │  只能呼叫 window.api 封裝的白名單 API
  │  不能直接存取 Node.js / Electron API
  ▼
preload.cjs (contextBridge)
  │  嚴格白名單過濾，防止原型鏈污染
  ▼
ipcMain (主程序)
  │  執行所有特權操作：檔案 I/O、加解密、子行程管理
  ▼
yt-dlp / FFmpeg / Deno（外部工具）
```

---

## 錯誤翻譯對照表

| yt-dlp 錯誤訊號 | 使用者看到的提示 |
| :--- | :--- |
| `403 Forbidden` | 🚫 YouTube 拒絕連線，請嘗試修復引擎或重新登入 |
| `Sign in to confirm` | ⚠️ Cookie 已過期，請重新登入 YouTube |
| `confirm you are not a bot` | 🤖 觸發機器人驗證，請更新 Cookie |
| `Private video` | 🔒 影片為私人或已被刪除 |
| `geographic restriction` | 🌍 影片受地區限制，建議使用 VPN |
| `members-only` | 👑 此內容需要頻道會員資格 |
| `age-restricted` | 🔞 年齡限制影片，需登入帳號驗證 |
| `Invalid URL` | ❌ 請輸入有效的 YouTube 影片網址 |
| `network error` | 📡 網路連線異常，請確認網路狀態 |
| `Postprocessing error` | 🔧 FFmpeg 合併失敗，請確認磁碟空間 |

---

## 開發小秘訣

- **快速開啟應用程式資料夾**：在軟體運行時，點擊右下角「應用程式版本號」，即可瞬間開啟隱藏的 `.yt-audio-extractor` 核心資料夾，方便檢查 yt-dlp 狀態與日誌。

- **切換語言**：點擊右上角語言按鈕可在繁體中文與英文之間即時切換。

- **修復引擎**：若遇到 yt-dlp 執行錯誤，點擊「修復引擎」按鈕可重新下載最新版本的 yt-dlp 核心。

- **診斷日誌**：點擊「📜 診斷日誌」可開啟日誌資料夾，日誌包含完整的下載記錄與錯誤訊息，方便回報問題。

- **Node.js 版本管理**：推薦使用 NVM 管理 Node 版本，切換時請確認版本為 v18.19.0 或 v22+ 以符合 ES Module 規範。

---

## 支持與贊助

本專案為獨立開發者的開源心血結晶。

若這個工具為您節省了寶貴的時間，歡迎透過軟體右上角的 **「☕ 贊助按鈕」** 隨喜請開發者喝杯咖啡——這將是維持 yt-dlp 核心持續更新的最大動力！

---

## 免責聲明

1. **技術研究用途**：本軟體僅供個人技術研究、介面設計學習與教育目的使用。
2. **遵守服務條款**：請務必遵守 YouTube 服務條款，**請勿**將本工具用於下載或散佈具備著作權保護之影音內容。開發者對使用者的任何不當使用行為概不負責。
3. **開源依賴聲明**：本軟體底層依賴 `yt-dlp`、`FFmpeg`、`Deno` 等開源社群維護的第三方組件，感謝這些開源專案的貢獻者。
4. **隱私保護**：本軟體不蒐集、儲存或傳輸任何使用者個人資訊。所有憑證均加密儲存於使用者本機，且僅在下載執行時暫時解密使用。

---

<div align="center">
Made with ❤️ by an independent developer | Powered by <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a> + <a href="https://www.ffmpeg.org/">FFmpeg</a> + <a href="https://www.electronjs.org/">Electron</a>
</div>
