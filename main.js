const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Store = require('./store');

let win = null;
let store = null;

// testes automáticos apontam os dados pra uma pasta temporária (nunca mexem nos dados reais)
if (process.env.COMISSOES_DADOS) app.setPath('userData', process.env.COMISSOES_DADOS);
// datas, números e campos nativos em português (dd/mm/aaaa)
app.commandLine.appendSwitch('lang', 'pt-BR');

// ---------- Caminhos ----------
const dirDados = () => app.getPath('userData');
const dirMidia = (...p) => path.join(dirDados(), 'midia', ...p);
const dirPedido = (id, tipo) => path.join(dirDados(), 'pedidos', id, tipo);
const arquivoToken = () => path.join(dirDados(), 'discord-token.bin');

const EXT_IMG = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const TIPOS = ['referencias', 'entrega'];
const idSeguro = (id) => typeof id === 'string' && /^[a-z0-9-]{4,60}$/i.test(id);
const dentroDosPedidos = (p) => { const base = (path.resolve(dirDados(), 'pedidos') + path.sep).toLowerCase(); const r = path.resolve(String(p || '')); return r.toLowerCase().startsWith(base) && EXT_IMG.includes(path.extname(r).toLowerCase()); };
function urlDe(caminho) {
  try { const st = fs.statSync(caminho); return pathToFileURL(caminho).href + '?v=' + Math.round(st.mtimeMs); } catch { return ''; }
}

// ---------- Janela ----------
const CORES_BARRA = {
  cube: { color: '#0e131a', symbolColor: '#c5cdd9' },
  of: { color: '#000000', symbolColor: '#d4d4d8' }
};

function criarJanela() {
  const tema = (store.get().config || {}).tema === 'of' ? 'of' : 'cube';
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 1100, minHeight: 700,
    backgroundColor: CORES_BARRA[tema].color,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...CORES_BARRA[tema], height: 40 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // mostra no primeiro sinal de vida; o 'ready-to-show' nem sempre dispara com titleBarOverlay no Windows
  let mostrada = false;
  const mostrar = () => { if (mostrada || !win || win.isDestroyed()) return; mostrada = true; win.show(); win.focus(); };
  win.once('ready-to-show', mostrar);
  win.webContents.once('did-finish-load', () => setTimeout(mostrar, 60));
  setTimeout(mostrar, 4000);
  // nada de abrir janelas ou navegar pra fora do app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------- Token do bot (criptografado pelo Windows quando possível) ----------
function lerToken() {
  try {
    const buf = fs.readFileSync(arquivoToken());
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
    return buf.toString('utf8');
  } catch { return ''; }
}
function salvarToken(token) {
  const t = String(token || '').trim();
  if (!t) { try { fs.unlinkSync(arquivoToken()); } catch {} return; }
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8');
  fs.writeFileSync(arquivoToken(), buf);
}

// ---------- Rede ----------
async function baixarImagem(url, destino) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const tipo = r.headers.get('content-type') || '';
  if (!tipo.startsWith('image/')) throw new Error('não é imagem');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error('imagem grande demais');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buf);
  return destino;
}

const dataDoSnowflake = (id) => new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();

async function discordGet(rota, token) {
  return fetch('https://discord.com/api/v10' + rota, {
    headers: { Authorization: 'Bot ' + token, 'User-Agent': 'DiscordBot (https://github.com, 0.1) Comissoes' },
    signal: AbortSignal.timeout(12000)
  });
}

async function discordUsuario(id) {
  id = String(id || '').trim();
  if (!/^\d{17,20}$/.test(id)) return { ok: false, codigo: 'id-invalido', erro: 'Esse ID não parece válido. Ele tem de 17 a 20 números.' };
  const token = lerToken();
  if (!token) return { ok: false, codigo: 'sem-token', erro: 'Falta o token do bot. Configure em Configurações → Discord.' };
  let r;
  try { r = await discordGet('/users/' + id, token); } catch { return { ok: false, codigo: 'rede', erro: 'Sem conexão com o Discord. Tente de novo.' }; }
  if (r.status === 401) return { ok: false, codigo: 'token-invalido', erro: 'O token do bot foi recusado pelo Discord. Confira em Configurações.' };
  if (r.status === 404) return { ok: false, codigo: 'nao-encontrado', erro: 'Nenhuma conta com esse ID.' };
  if (r.status === 429) return { ok: false, codigo: 'limite', erro: 'O Discord pediu pra esperar alguns segundos. Tente de novo já já.' };
  if (!r.ok) return { ok: false, codigo: 'http', erro: 'O Discord respondeu com erro ' + r.status + '.' };
  const u = await r.json();
  const destino = dirMidia('discord', id + '.png');
  const urlAvatar = u.avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=256`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
  let avatar = '';
  try { await baixarImagem(urlAvatar, destino); avatar = urlDe(destino); } catch {}
  const cor = u.banner_color || (typeof u.accent_color === 'number' ? '#' + u.accent_color.toString(16).padStart(6, '0') : null);
  return {
    ok: true,
    dados: {
      id: u.id, username: u.username, globalName: u.global_name || null,
      avatar, avatarCaminho: avatar ? destino : '', corPerfil: cor, contaCriada: dataDoSnowflake(id), bot: !!u.bot
    }
  };
}

async function testarToken() {
  const token = lerToken();
  if (!token) return { ok: false, erro: 'Nenhum token salvo.' };
  try {
    const r = await discordGet('/users/@me', token);
    if (r.status === 401) return { ok: false, erro: 'Token recusado pelo Discord.' };
    if (!r.ok) return { ok: false, erro: 'Erro ' + r.status + ' do Discord.' };
    const u = await r.json();
    return { ok: true, bot: u.username };
  } catch { return { ok: false, erro: 'Sem conexão com o Discord.' }; }
}

async function robloxUsuario(nome) {
  nome = String(nome || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(nome)) return { ok: false, erro: 'Usuário do Roblox inválido.' };
  try {
    const r = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [nome], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) return { ok: false, erro: 'O Roblox respondeu com erro ' + r.status + '.' };
    const j = await r.json();
    const u = j && j.data && j.data[0];
    if (!u) return { ok: false, erro: 'Nenhum usuário do Roblox com esse nome.' };
    let avatar = '', avatarCaminho = '';
    try {
      const t = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${u.id}&size=150x150&format=Png&isCircular=false`, { signal: AbortSignal.timeout(12000) });
      const tj = await t.json();
      const img = tj && tj.data && tj.data[0] && tj.data[0].imageUrl;
      if (img) { avatarCaminho = await baixarImagem(img, dirMidia('roblox', u.id + '.png')); avatar = urlDe(avatarCaminho); }
    } catch {}
    return { ok: true, dados: { id: String(u.id), username: u.name, displayName: u.displayName, avatar, avatarCaminho } };
  } catch { return { ok: false, erro: 'Sem conexão com o Roblox. Tente de novo.' }; }
}

// ---------- Arquivos dos pedidos ----------
function listarImagens(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => EXT_IMG.includes(path.extname(f).toLowerCase()))
      .map(f => { const c = path.join(dir, f); return { nome: f, caminho: c, url: urlDe(c), mtime: fs.statSync(c).mtimeMs }; })
      .sort((a, b) => a.mtime - b.mtime);
  } catch { return []; }
}

function importarArquivo({ pedidoId, tipo, caminho, slot }) {
  if (!idSeguro(pedidoId) || !TIPOS.includes(tipo)) return { ok: false, erro: 'Pedido inválido.' };
  const ext = path.extname(String(caminho || '')).toLowerCase();
  if (!EXT_IMG.includes(ext)) return { ok: false, erro: 'Só imagens (png, jpg, webp, gif).' };
  if (!fs.existsSync(caminho)) return { ok: false, erro: 'Arquivo não encontrado.' };
  const dir = dirPedido(pedidoId, tipo);
  fs.mkdirSync(dir, { recursive: true });
  let nome;
  if (tipo === 'entrega' && Number.isInteger(slot) && slot >= 0 && slot < 50) {
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`slot-${slot + 1}.`)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    nome = `slot-${slot + 1}${ext}`;
  } else {
    const base = path.basename(caminho, path.extname(caminho)).normalize('NFC').replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().slice(0, 60) || 'imagem';
    nome = base + ext;
    let n = 2;
    while (fs.existsSync(path.join(dir, nome))) nome = `${base} (${n++})${ext}`;
  }
  const destino = path.join(dir, nome);
  fs.copyFileSync(caminho, destino);
  return { ok: true, caminho: destino, url: urlDe(destino), nome };
}

// ---------- IPC ----------
function registrarIpc() {
  ipcMain.handle('dados:ler', () => store.get());
  ipcMain.handle('dados:salvar', (_e, estado) => store.set(estado));
  ipcMain.handle('dados:abrirPasta', () => shell.openPath(dirDados()));
  ipcMain.handle('dados:exportar', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Exportar backup', defaultPath: 'comissoes-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, JSON.stringify(store.get(), null, 2), 'utf8');
    return { ok: true, caminho: r.filePath };
  });
  ipcMain.handle('dados:importar', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar backup', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const objetos = (a) => Array.isArray(a) && a.every(o => o && typeof o === 'object' && !Array.isArray(o));
      if (!objetos(j.clientes) || !objetos(j.pedidos)) return { ok: false, erro: 'Esse arquivo não é um backup do app.' };
      store.snapshot('antes-de-importar');
      store.set(j);
      return { ok: true, dados: store.get() };
    } catch { return { ok: false, erro: 'Não deu pra ler o arquivo.' }; }
  });

  ipcMain.handle('discord:usuario', (_e, id) => discordUsuario(id));
  ipcMain.handle('discord:tokenStatus', () => ({ configurado: !!lerToken(), criptografado: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle('discord:salvarToken', (_e, token) => { salvarToken(token); return { ok: true, configurado: !!lerToken() }; });
  ipcMain.handle('discord:testarToken', () => testarToken());
  ipcMain.handle('roblox:usuario', (_e, nome) => robloxUsuario(nome));

  ipcMain.handle('arquivos:escolherImagens', async (_e, multiplas) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Escolher imagens', properties: multiplas ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Imagens', extensions: EXT_IMG.map(e => e.slice(1)) }]
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('arquivos:importar', (_e, opts) => { try { return importarArquivo(opts || {}); } catch (err) { return { ok: false, erro: 'Não deu pra copiar a imagem.' }; } });
  ipcMain.handle('arquivos:listar', (_e, pedidoId, tipo) => (idSeguro(pedidoId) && TIPOS.includes(tipo)) ? listarImagens(dirPedido(pedidoId, tipo)) : []);
  ipcMain.handle('arquivos:abrirPasta', (_e, pedidoId, tipo) => {
    if (!idSeguro(pedidoId) || !TIPOS.includes(tipo)) return false;
    const d = dirPedido(pedidoId, tipo); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return true;
  });
  ipcMain.handle('arquivos:remover', (_e, caminho) => {
    if (!caminho || !dentroDosPedidos(caminho)) return false;
    try { fs.unlinkSync(caminho); return true; } catch { return false; }
  });
  ipcMain.handle('arquivos:removerPedido', (_e, pedidoId) => {
    if (!idSeguro(pedidoId)) return false;
    try { fs.rmSync(path.join(dirDados(), 'pedidos', pedidoId), { recursive: true, force: true }); return true; } catch { return false; }
  });

  ipcMain.handle('sistema:abrirExterno', (_e, url) => {
    try { const u = new URL(url); if (u.protocol === 'https:') { shell.openExternal(u.href); return true; } } catch {}
    return false;
  });
  ipcMain.handle('sistema:abrirDiscord', async (_e, id) => {
    if (!/^\d{17,20}$/.test(String(id))) return false;
    const temApp = !!app.getApplicationNameForProtocol('discord://');
    try { await shell.openExternal(temApp ? `discord://-/users/${id}` : `https://discord.com/users/${id}`); return true; }
    catch { shell.openExternal(`https://discord.com/users/${id}`); return true; }
  });
  ipcMain.handle('sistema:copiar', (_e, texto) => { clipboard.writeText(String(texto || '')); return true; });
  ipcMain.on('janela:tema', (_e, tema) => {
    const c = CORES_BARRA[tema === 'of' ? 'of' : 'cube'];
    if (win && !win.isDestroyed()) { try { win.setTitleBarOverlay({ ...c, height: 40 }); win.setBackgroundColor(c.color); } catch {} }
  });
}

// ---------- Ciclo de vida ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.sak.comissoes');
    store = new Store(dirDados());
    registrarIpc();
    criarJanela();
  });
  app.on('window-all-closed', () => app.quit());
}
