# YT-Media-Extractor (YouTube 影音下載神器)

![Electron](https://img.shields.io/badge/Electron-40.6.0-blue)
![Node](https://img.shields.io/badge/Node-v18%20%7C%20v20%20%7C%20v22-green)
![Security](https://img.shields.io/badge/Security-Context_Isolated-success)
![Platform](https://img.shields.io/badge/Platform-Win%20%7C%20Mac%20(Intel/M1)-lightgrey)
![License](https://img.shields.io/badge/License-Personal_Research-orange)

[cite_start]這是一款基於 **Electron** 與 **yt-dlp** 開發的跨平台案頭應用程式，專為尋求乾淨、安全、無廣告體驗的使用者設計。歷經核心架構的深度淬鍊，本軟體已具備商業級的防護標準、智慧防呆機制與極致的執行效能 [cite: 2, 211]。

## 🚀 核心技術與商業級亮點

### 🛡️ 1. 企業級安全與隱私防護 (Security & Privacy)
* [cite_start]**原生 IPC 通訊架構**：徹底捨棄本地端 HTTP (Express) 與 WebSocket 伺服器，改用 Electron 原生 IPC 橋接。實現零延遲啟動，並完全杜絕防毒軟體或防火牆的網路存取警告 [cite: 47, 48, 50, 51]。
* [cite_start]**軍規級憑證加密 (OS-Level DPAPI/Keychain)**：導入 Electron 內建的 `safeStorage`，將 YouTube 登入 Cookie 與作業系統底層帳號綁定加密 (`cookies.enc`) [cite: 85, 87, 90]。
* [cite_start]**動態解密與閱後即焚**：下載啟動時才動態解密憑證，任務結束或遭遇崩潰時，系統會立即強制銷毀明文暫存檔，確保隱私零外洩 [cite: 93, 94, 214, 215]。
* [cite_start]**防盜裝甲與前端防護**：自動化建置腳本 (`build-app.js`) 整合原始碼混淆 (Obfuscation)，並實作嚴格的內容安全策略 (CSP) 與開發者工具封鎖，保護智慧財產權並防止 XSS 攻擊 [cite: 261, 262, 266]。

### ⚡ 2. 跨平台效能與底層韌性 (Performance & Resiliency)
* [cite_start]**Apple Silicon 原生支援**：精準硬體識別，為 Mac M1/M2/M3 用戶自動配發專屬的 `aarch64` 架構核心，徹底擺脫 Rosetta 轉譯的效能損耗 [cite: 286]。
* [cite_start]**智慧網路重試機制**：針對核心組件下載導入 `fetchWithTimeoutAndRetry`，具備 60 秒硬性超時攔截與 3 次冷卻重試能力，確保在惡劣網路下仍能順利完成初次安裝 [cite: 178, 179, 181]。
* [cite_start]**五大終極防護鎖**：具備殭屍行程清道夫、全域致命崩潰攔截 (`uncaughtException`)、下載併發鎖、以及更新檔快取穿透機制，保障系統極致穩定 [cite: 215, 218, 221, 224]。

### 💡 3. 卓越的使用者體驗 (UX Excellence)
* [cite_start]**智慧錯誤翻譯機 (Smart Error Handling)**：精準攔截 `yt-dlp` 的標準錯誤輸出 (`stderr`)，自動將艱澀的工程代碼（如 403、地區限制、會員專屬）轉譯為帶有具體解決方案的多國語系白話文提示 [cite: 131, 134, 135]。
* [cite_start]**無縫多國語系與 EULA**：內建中/英雙語系即時切換，並實作首次啟動的「免責聲明與隱私權政策」攔截機制，兼顧法規合規與使用者體驗 [cite: 278, 279, 280]。
* [cite_start]**自訂路徑與防呆引導**：支援自訂並記憶下載路徑 (`localStorage`) [cite: 110, 111][cite_start]。登入 YouTube 前具備主動防呆預警，且輸入框會自動攔截多重網址，防止引擎過載 [cite: 115, 306]。

### 🛠️ 4. 專業維運系統 (Operations & Maintenance)
* [cite_start]**靜默版本檢查**：每次啟動後延遲 3.5 秒於背景比對 GitHub `versions.json`，不影響啟動速度，並引導使用者下載最新版本 [cite: 148, 151]。
* [cite_start]**生產環境日誌追蹤 (`electron-log`)**：無縫攔截所有底層輸出至本地 `main.log`，並實作檔案滾動管理。使用者可點擊介面左下角「📜 診斷日誌」一鍵提交除錯紀錄 [cite: 161, 163, 169]。

---

## 📂 檔案結構說明

| 檔案 / 資料夾 | 說明 |
| :--- | :--- |
| `main.js` | [cite_start]**主程序 (Main Process)**：負責視窗建立、安全隔離 (Context Isolation)、攔截預設選單及管理應用程式生命週期 [cite: 56, 215, 261]。 |
| `preload.cjs` | [cite_start]**安全橋樑 (Preload)**：使用 `contextBridge` 封裝前端專用的 IPC API 通道 (`window.api`)，確保前端無法直接調用 Node.js 底層 [cite: 59, 122]。 |
| `server.js` | [cite_start]**核心邏輯引擎**：處理 `yt-dlp` 下載任務、OS 級憑證加密、錯誤攔截翻譯、以及與 GitHub 的更新通訊 [cite: 89, 129, 148]。 |
| `build-app.js` | [cite_start]**自動化建置腳本**：處理生產環境打包前的原始碼備份、高強度混淆與還原作業 [cite: 265, 266]。 |
| `public/` | [cite_start]**前端資源**：包含 UI 介面 `index.html`、自定義背景圖與多國語系字典 [cite: 134]。 |
| `package.json` | [cite_start]專案依賴配置，包含 `electron-builder` 打包設定及自訂 App 圖示綁定 [cite: 259]。 |

---

## 💻 開發者指南

### 1. 環境需求
* **Node.js**: v18.19.0 或 v22+ (推薦用於最新 Electron 打包與 ES Module 規範)。
* **NVM**: 推薦使用 NVM 切換 Node 版本。

### 2. 安裝與執行
```powershell
# 安裝依賴套件
npm install

# 啟動開發者模式
npm start
```

### 3. 編譯打包 (Build)
本專案已整合原始碼混淆防護。請在終端機執行以下指令進行自動化打包：

```powershell
# Windows 打包 (將自動執行 build-app.js 混淆並生成 .exe / .7z)
npm run build

# macOS 打包 (生成 .dmg 映像檔)
# 注意：需在 Mac 環境中執行以獲得最佳相容性
```
**💡 開發小秘訣**：在軟體運行時，點擊右下角的「應用程式版本號」，即可瞬間開啟隱藏的 `.yt-audio-extractor` 核心資料夾，方便檢查 `yt-dlp` 與日誌狀態。

---

## ☕ 支持與贊助
本專案為獨立開發者的開源心血。若這個工具為您節省了寶貴的時間，歡迎透過軟體右上角的 **「☕ 贊助按鈕」** 隨喜請開發者喝杯咖啡，這將是維持核心引擎持續更新的最大動力！

---

## ⚖️ 免責聲明 (Disclaimer)

1. **技術研究用途**：本軟體僅供個人技術研究、介面設計學習與教育目的使用。
2. **遵守服務條款**：請務必遵守 YouTube 服務條款，**請勿**將本工具用於下載或散佈具備版權保護之影音內容，開發者對使用者的任何不當使用行為概不負責。
3. **開源依賴**：本軟體底層依賴 `yt-dlp` 與 `FFmpeg` 等開源社群維護之第三方組件。