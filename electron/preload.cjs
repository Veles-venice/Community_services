
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("store", {
  dashboard: () => ipcRenderer.invoke("dashboard"),
  products: () => ipcRenderer.invoke("products"),
  saveProduct: (p) => ipcRenderer.invoke("save-product", p),
  sale: (data) => ipcRenderer.invoke("sale", data),
  purchase: (data) => ipcRenderer.invoke("purchase", data),
  expense: (data) => ipcRenderer.invoke("expense", data),
  recentSales: () => ipcRenderer.invoke("recent-sales"),
  report: () => ipcRenderer.invoke("report"),
  backup: () => ipcRenderer.invoke("backup")
});

