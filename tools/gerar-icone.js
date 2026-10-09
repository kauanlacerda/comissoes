// Gera assets/icon.png (256) e assets/icon.ico (16–256) desenhando o logo num canvas.
// Uso: node_modules\.bin\electron tools\gerar-icone.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'comissoes-ico-')));

const TAMS = [16, 24, 32, 48, 64, 128, 256];
const desenhar = `(${function (tams) {
  const out = {};
  for (const t of tams) {
    const c = document.createElement('canvas'); c.width = c.height = t;
    const g = c.getContext('2d'); const s = t / 256;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    // fundo
    rr(8 * s, 8 * s, 240 * s, 240 * s, 56 * s); g.fillStyle = '#151b24'; g.fill();
    // quadrado azul
    const grd = g.createLinearGradient(0, 40 * s, 0, 216 * s); grd.addColorStop(0, '#4baafe'); grd.addColorStop(1, '#2b7fe0');
    rr(48 * s, 48 * s, 160 * s, 160 * s, 44 * s); g.fillStyle = grd; g.fill();
    // check
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(2, 22 * s); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(88 * s, 132 * s); g.lineTo(116 * s, 160 * s); g.lineTo(170 * s, 100 * s); g.stroke();
    out[t] = c.toDataURL('image/png').split(',')[1];
  }
  return out;
}})(${JSON.stringify(TAMS)})`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,<html><body></body></html>');
  const pngs = await w.webContents.executeJavaScript(desenhar);
  const bufs = TAMS.map(t => Buffer.from(pngs[t], 'base64'));
  const dir = path.join(__dirname, '..', 'assets');
  fs.writeFileSync(path.join(dir, 'icon.png'), bufs[bufs.length - 1]);
  // ICO com PNGs embutidos
  const cab = Buffer.alloc(6); cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(TAMS.length, 4);
  const entradas = []; let offset = 6 + 16 * TAMS.length;
  TAMS.forEach((t, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(t >= 256 ? 0 : t, 0); e.writeUInt8(t >= 256 ? 0 : t, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(bufs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += bufs[i].length; entradas.push(e);
  });
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([cab, ...entradas, ...bufs]));
  console.log('ícones gerados em', dir);
  app.quit();
});
