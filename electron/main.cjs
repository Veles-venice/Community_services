
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const db = require("./database.cjs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: "Kirana Manager",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  db.initDatabase(app.getPath("userData"));

  ipcMain.handle("dashboard", () => db.getDashboard());
  ipcMain.handle("products", () => db.getProducts());
  ipcMain.handle("save-product", (_, p) => db.saveProduct(p));
  ipcMain.handle("sale", (_, data) => db.createSale(data));
  ipcMain.handle("purchase", (_, data) => db.createPurchase(data));
  ipcMain.handle("expense", (_, data) => db.addExpense(data));
  ipcMain.handle("recent-sales", () => db.getRecentSales());
  ipcMain.handle("report", () => db.getReport());

  ipcMain.handle("backup", async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: "kirana-backup.db",
      filters: [{ name: "SQLite Database", extensions: ["db"] }]
    });

    if (result.canceled || !result.filePath) return null;

    await db.backupDatabase(result.filePath);
    return result.filePath;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

