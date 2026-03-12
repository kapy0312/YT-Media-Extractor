import fs from 'fs';
import { execSync } from 'child_process';
import JavaScriptObfuscator from 'javascript-obfuscator';

console.log('🛡️  啟動安全打包流程...');

// 1. 定義要混淆的檔案
const filesToObfuscate = ['server.js', 'main.js'];

// 2. 這是我為你精心配製的「安全混淆設定」
// 能有效防破解，同時不會把 Node.js 原生模組搞壞，也不會過度拖慢效能
const obfuscatorOptions = {
    target: 'node',               // 針對 Node.js 環境
    compact: true,                // 壓縮成一行
    controlFlowFlattening: true,  // 打亂程式碼執行順序 (防破解核心)
    controlFlowFlatteningThreshold: 0.5, // 50% 邏輯打亂 (平衡效能)
    stringArray: true,            // 把你的字串全部抽離並加密
    stringArrayEncoding: ['base64'], // 字串用 Base64 加密
    renameGlobals: false,         // 🚨 絕對不改全域變數，防止程式崩潰
    ignoreRequireImports: true    // 保護 import / require 語法
};

try {
    // 3. 備份與混淆
    for (const file of filesToObfuscate) {
        console.log(`📦 正在備份並混淆: ${file}`);
        // 備份原始乾淨代碼
        fs.copyFileSync(file, `${file}.backup`); 
        
        // 讀取並混淆
        const originalCode = fs.readFileSync(file, 'utf8');
        const obfuscatedCode = JavaScriptObfuscator.obfuscate(originalCode, obfuscatorOptions).getObfuscatedCode();
        
        // 覆寫為亂碼版
        fs.writeFileSync(file, obfuscatedCode);
    }

    console.log('✅ 混淆完成！準備交給 Electron-Builder 打包...');

    // 4. 執行原本的打包指令 (這裡以 Windows 為例)
    execSync('npx electron-builder --win', { stdio: 'inherit' });

    console.log('🎉 打包大功告成！');

} catch (error) {
    console.error('❌ 打包過程中發生錯誤:', error.message);
} finally {
    // 5. 【最重要的一步】無論打包成功或失敗，必定還原原始碼！
    console.log('🧹 正在還原原始乾淨的程式碼...');
    for (const file of filesToObfuscate) {
        if (fs.existsSync(`${file}.backup`)) {
            fs.copyFileSync(`${file}.backup`, file);
            fs.unlinkSync(`${file}.backup`); // 刪除備份檔
        }
    }
    console.log('✨ 程式碼已恢復原狀，你可以繼續開發了！');
}