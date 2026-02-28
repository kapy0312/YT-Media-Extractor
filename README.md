# YT Audio Extractor (YouTube MP3 下載器)

![Electron](https://img.shields.io/badge/Electron-40.6.0-blue)
![Node](https://img.shields.io/badge/Node-v18%20%7C%20v20%20%7C%20v22-green)
![License](https://img.shields.io/badge/License-Personal_Research-orange)

這是一款基於 **Electron** 與 **yt-dlp** 開發的跨平台案頭應用程式，專為 Kevin Lai 設計。旨在提供一個乾淨、安全、無廣告的 YouTube 轉 MP3 下載解決方案。

## 🚀 核心技術亮點

* **免安裝依賴**：內建靜態 `FFmpeg` 二進位檔（透過 `ffmpeg-static`），使用者電腦不需手動安裝任何編解碼工具即可執行高品質 MP3 轉檔。
* **靜默自動更新 (Silent Auto-Update)**：每次程式啟動時，後端會自動執行 `yt-dlp -U` 檢查並更新核心引擎，確保下載邏輯能即時應對 YouTube 的演算法變動。
* **動態通訊埠分配**：採用 `app.listen(0)` 由作業系統自動分配可用 Port，完全避免與電腦其他服務衝突。
* **權限問題優化**：核心執行檔 `yt-dlp` 存放於使用者家目錄 (`AppData/.yt-audio-extractor`)，完美避開 Electron 打包後 `app.asar` 唯讀限制導致的崩潰。
* **介面視覺優化**：前端採用半透明毛玻璃質感卡片設計，結合自定義背景圖 (`bg.jpg`)，提供極簡且專業的視覺體驗。

## 📂 檔案結構說明

| 檔案/資料夾 | 說明 |
| :--- | :--- |
| `main.js` | **主程序 (Main Process)**：負責 Electron 視窗建立、隱藏選單及串接動態 Port 伺服器。 |
| `server.js` | **後端伺服器 (Node.js)**：處理下載邏輯、核心更新、FFmpeg 路徑判斷及 API 服務。 |
| `public/` | **前端資源**：包含 `index.html` (UI) 及背景圖 `bg.jpg`。 |
| `package.json` | **專案配置**：包含 `electron-builder` 打包設定、`asarUnpack` 路徑及腳本指令。 |

## 🛠️ 開發者指南

### 1. 環境需求
* **Node.js**: v18.19.0 (相容 `canvas` 專案) 或 v22+ (推薦用於最新 Electron 打包)。
* **NVM**: 推薦使用 NVM 切換 Node 版本。

### 2. 安裝與執行
```powershell```
# 安裝依賴
npm install

# 啟動開發者模式
npm start

### 3. 🛠️ 編譯打包 (Build)

請在終端機（如 PowerShell 或 CMD）中執行以下指令：

```powershell```
# Windows 打包 (生成 .exe 安裝檔)
npm run build

# macOS 打包 (生成 .dmg 映像檔) 
# 注意：需在 Mac 環境或透過 GitHub Actions 執行

> ### ⚠️ 免責聲明 (Disclaimer)
> 1. **技術研究用途**：本工具僅供個人技術研究與教育目的使用，請勿用於非法下載或傳播具備版權之內容。
> 2. **開源維護依賴**：本軟體核心依賴開源社群維護之第三方組件.