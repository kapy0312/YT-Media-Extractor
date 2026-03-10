// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的方法給前端 window.api
contextBridge.exposeInMainWorld('api', {
    // 呼叫後端 API (取代 fetch)
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    
    // 監聽後端事件 (取代 socket.on)
    on: (channel, callback) => {
        const subscription = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription); // 提供取消監聽的方法
    }
});