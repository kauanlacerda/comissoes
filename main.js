const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Store = require('./store');
const { criarConta, situacaoNuvem } = require('./conta');

let win = null;
let store = null;
let conta = null;
let contaPronta = Promise.resolve();
let saindo = false, instalando = false, relancar = false;
const avisar = (canal, dados) => { if (win && !win.isDestroyed()) win.webContents.send(canal, dados); };

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

// onde a imagem vai morar: espaço de thumb (slot-N) ou nome livre sem repetir
function destinoDaImagem(pedidoId, tipo, slot, nomeBase, ext) {
  const dir = dirPedido(pedidoId, tipo);
  fs.mkdirSync(dir, { recursive: true });
  let nome;
  if (tipo === 'entrega' && Number.isInteger(slot) && slot >= 0 && slot < 50) {
    for (const f of fs.readdirSync(dir)) if (f.startsWith(`slot-${slot + 1}.`)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    nome = `slot-${slot + 1}${ext}`;
  } else {
    const base = String(nomeBase || '').normalize('NFC').replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim().slice(0, 60) || 'imagem';
    nome = base + ext;
    let n = 2;
    while (fs.existsSync(path.join(dir, nome))) nome = `${base} (${n++})${ext}`;
  }
  return { destino: path.join(dir, nome), nome };
}

function importarArquivo({ pedidoId, tipo, caminho, slot }) {
  if (!idSeguro(pedidoId) || !TIPOS.includes(tipo)) return { ok: false, erro: 'Pedido inválido.' };
  const ext = path.extname(String(caminho || '')).toLowerCase();
  if (!EXT_IMG.includes(ext)) return { ok: false, erro: 'Só imagens (png, jpg, webp, gif).' };
  if (!fs.existsSync(caminho)) return { ok: false, erro: 'Arquivo não encontrado.' };
  const { destino, nome } = destinoDaImagem(pedidoId, tipo, slot, path.basename(caminho, path.extname(caminho)), ext);
  fs.copyFileSync(caminho, destino);
  return { ok: true, caminho: destino, url: urlDe(destino), nome };
}

// ---------- Imagens da web (arrastar do Discord/navegador, colar) ----------
const MAX_WEB = 25 * 1024 * 1024;
// o tipo vem dos primeiros bytes, não do link nem do servidor
function extDosBytes(b) {
  if (b.length > 8 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return '.png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return '.gif';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (b.length > 26 && b.toString('ascii', 0, 2) === 'BM') return '.bmp';
  return '';
}
// só https público: nada de localhost, rede local ou IP cru
function hostPublico(u) {
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h.startsWith('[') || /^[\d.]+$/.test(h)) return false;
  return true;
}
// link do Google Imagens (imgres?imgurl=…, url?q=…) → endereço da imagem original
function desembrulhar(u) {
  if (/(^|\.)google\.[a-z.]+$/.test(u.hostname)) {
    const alvo = u.searchParams.get('imgurl') || (u.pathname === '/url' && (u.searchParams.get('q') || u.searchParams.get('url')));
    if (alvo) { try { return new URL(alvo); } catch {} }
  }
  return u;
}
async function baixarDaWeb(endereco) {
  let u; try { u = desembrulhar(new URL(endereco)); } catch { return null; }
  for (let salto = 0; salto < 5; salto++) {
    if (!hostPublico(u)) return null;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(u.href, { redirect: 'manual', signal: ctl.signal, headers: { Accept: 'image/avif,image/webp,image/png,image/*;q=0.9,*/*;q=0.5' } });
      const para = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && para) { u = new URL(para, u); continue; }
      if (!r.ok || !r.body || Number(r.headers.get('content-length') || 0) > MAX_WEB) return null;
      const partes = []; let total = 0;
      for await (const pedaco of r.body) { total += pedaco.length; if (total > MAX_WEB) { ctl.abort(); return null; } partes.push(Buffer.from(pedaco)); }
      return { bytes: Buffer.concat(partes), url: u };
    } catch { return null; } finally { clearTimeout(t); }
  }
  return null;
}
const nomeDaUrl = (u) => { try { return path.basename(decodeURIComponent(u.pathname), path.extname(u.pathname)); } catch { return ''; } };

// opts: { pedidoId, tipo, slot, bytes?, nome?, urls? } — bytes (colado/arrastado sem arquivo) ou links pra tentar em ordem
async function importarDaWeb(opts) {
  const { pedidoId, tipo, slot } = opts;
  if (!idSeguro(pedidoId) || !TIPOS.includes(tipo)) return { ok: false, erro: 'Pedido inválido.' };
  let bytes = null, nome = '';
  if (opts.bytes && opts.bytes.byteLength <= MAX_WEB) { bytes = Buffer.from(opts.bytes); nome = String(opts.nome || '').replace(/\.[a-z0-9]{2,5}$/i, ''); }
  else for (const c of (Array.isArray(opts.urls) ? opts.urls : []).slice(0, 6)) {
    const s = String(c || '');
    const dado = /^data:image\/[a-z+.-]+;base64,([a-z0-9+/=\s]+)$/i.exec(s);
    const r = dado ? (s.length < MAX_WEB * 1.4 ? { bytes: Buffer.from(dado[1], 'base64'), url: null } : null) : await baixarDaWeb(s);
    if (r && extDosBytes(r.bytes)) { bytes = r.bytes; nome = r.url ? nomeDaUrl(r.url) : ''; break; }
  }
  if (!bytes) return { ok: false, erro: 'Não deu pra baixar essa imagem. Salve no computador e arraste o arquivo.' };
  const ext = extDosBytes(bytes);
  if (!ext) return { ok: false, erro: 'Isso não é uma imagem (png, jpg, webp ou gif).' };
  const { destino, nome: final } = destinoDaImagem(pedidoId, tipo, slot, nome || 'referencia', ext);
  fs.writeFileSync(destino, bytes);
  return { ok: true, caminho: destino, url: urlDe(destino), nome: final };
}

// ---------- IPC ----------
function registrarIpc() {
  ipcMain.handle('dados:ler', () => store.get());
  ipcMain.handle('dados:salvar', (_e, estado) => { const ok = store.set(estado); if (ok && conta) conta.marcarMudanca(); return ok; });
  // a tela tem edição no atraso de 150 ms: conta como mudança já (a nuvem não passa por cima)
  ipcMain.on('dados:sujo', () => { if (conta) conta.marcarMudanca(true); });
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
      if (conta) conta.marcarMudanca();
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
  ipcMain.handle('arquivos:importarWeb', async (_e, opts) => { try { return await importarDaWeb(opts || {}); } catch (err) { return { ok: false, erro: 'Não deu pra salvar a imagem.' }; } });
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
  // DM ou grupo de DM pelo ID do canal: abre direto na conversa
  ipcMain.handle('sistema:abrirCanalDiscord', async (_e, id) => {
    if (!/^\d{17,20}$/.test(String(id))) return false;
    const temApp = !!app.getApplicationNameForProtocol('discord://');
    try { await shell.openExternal(temApp ? `discord://-/channels/@me/${id}` : `https://discord.com/channels/@me/${id}`); return true; }
    catch { shell.openExternal(`https://discord.com/channels/@me/${id}`); return true; }
  });
  ipcMain.handle('sistema:copiar', (_e, texto) => { clipboard.writeText(String(texto || '')); return true; });
  // ---------- conta ----------
  // só espera a conta iniciar se ninguém entrou ainda (com sessão guardada a tela abre na hora, mesmo sem internet)
  ipcMain.handle('conta:estado', async () => { if (!conta.estado().logado) await Promise.race([contaPronta, new Promise(r => setTimeout(r, 6000))]); return conta.estado(); });
  ipcMain.handle('conta:entrar', (_e, email, senha) => conta.entrar(email, senha));
  ipcMain.handle('conta:criar', (_e, email, senha, nome) => conta.criar(email, senha, nome));
  ipcMain.handle('conta:sair', () => conta.sair());
  ipcMain.handle('conta:adotar', (_e, sim) => conta.adotar(!!sim));
  ipcMain.handle('conta:sincronizar', () => conta.sincronizar());

  // ---------- atualização automática ----------
  ipcMain.handle('atualizacao:estado', () => ({ ...atualizacao, versaoAtual: app.getVersion() }));
  ipcMain.handle('atualizacao:checar', async () => {
    if (!atualizador || atualizacao.fase === 'pronto') return { ...atualizacao, versaoAtual: app.getVersion() };
    try { await atualizador.checkForUpdates(); } catch (e) { if (atualizacao.fase !== 'pronto') atualizacao = { ...atualizacao, fase: 'erro', erro: String((e && e.message) || e) }; }
    return { ...atualizacao, versaoAtual: app.getVersion() };
  });
  ipcMain.handle('atualizacao:instalar', async () => {
    if (!atualizador || atualizacao.fase !== 'pronto') return false;
    if (conta) await conta.antesDeFechar(4000);
    // se o instalador falhar na hora, o app segue aberto e o fechar normal volta a enviar pra nuvem
    let falhou = false;
    const f = () => { falhou = true; };
    atualizador.once('error', f);
    saindo = instalando = true;
    try { atualizador.quitAndInstall(false, true); } catch { falhou = true; }
    atualizador.removeListener('error', f);
    if (falhou) saindo = instalando = false;
    return !falhou;
  });

  ipcMain.on('janela:tema', (_e, tema) => {
    const c = CORES_BARRA[tema === 'of' ? 'of' : 'cube'];
    if (win && !win.isDestroyed()) { try { win.setTitleBarOverlay({ ...c, height: 40 }); win.setBackgroundColor(c.color); } catch {} }
  });
}

// ---------- Atualização automática (GitHub Releases) ----------
let atualizador = null;
let atualizacao = { fase: 'dev', versao: '', pct: 0, erro: '' };
function iniciarAtualizacoes() {
  if (!app.isPackaged) return; // rodando do código: nada a atualizar
  try { ({ autoUpdater: atualizador } = require('electron-updater')); } catch { return; }
  const mudar = (d) => {
    // versão já baixada fica pronta: procurar de novo ou ficar sem internet não tira o "Reiniciar"
    if (atualizacao.fase === 'pronto' && ['procurando', 'erro', 'atualizado'].includes(d.fase)) return;
    atualizacao = { ...atualizacao, ...d }; avisar('atualizacao:estado', { ...atualizacao, versaoAtual: app.getVersion() });
  };
  atualizacao.fase = 'parado';
  atualizador.autoDownload = true;          // baixa sozinho em segundo plano
  atualizador.autoInstallOnAppQuit = true;  // e instala quando o app fechar, se a pessoa não reiniciar antes
  atualizador.on('checking-for-update', () => mudar({ fase: 'procurando', erro: '' }));
  atualizador.on('update-available', (i) => mudar({ fase: 'baixando', versao: i.version, pct: 0 }));
  atualizador.on('download-progress', (p) => mudar({ fase: 'baixando', pct: Math.round(p.percent || 0) }));
  atualizador.on('update-downloaded', (i) => mudar({ fase: 'pronto', versao: i.version, pct: 100 }));
  atualizador.on('update-not-available', () => mudar({ fase: 'atualizado' }));
  atualizador.on('error', (e) => mudar({ fase: 'erro', erro: String((e && e.message) || e) }));
  const checar = () => { if (atualizacao.fase !== 'pronto') atualizador.checkForUpdates().catch(() => {}); };
  setTimeout(checar, 8000);
  setInterval(checar, 6 * 3600 * 1000);
}

// ---------- Conta fora do ar (falha ao iniciar o módulo): o app segue local ----------
function contaIndisponivel(erro, status = 'erro') {
  const estado = () => ({ logado: true, semConta: true, email: '', nome: '', adotar: null, podeUsarLocal: false, sync: { status, pendente: false, ultimo: '', erro } });
  const falha = async () => ({ ok: false, erro: 'A conta está indisponível nesta versão: ' + erro });
  return { iniciar: async () => {}, estado, entrar: falha, criar: falha, adotar: async () => estado(), sair: async () => ({ ok: false }), sincronizar: async () => estado(), marcarMudanca() {}, antesDeFechar: async () => {}, precisaEnviar: () => false };
}

// ---------- Ciclo de vida ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
    // abriu de novo enquanto fechava (enviando pra nuvem): reabre quando terminar
    if (saindo && !instalando && !relancar) { relancar = true; app.relaunch(); }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.sak.comissoes');
    store = new Store(dirDados());
    try {
      // COMISSOES_NUVEM=off: só local (os testes automáticos nunca tocam a nuvem de verdade)
      const nuvem = process.env.COMISSOES_NUVEM === 'off' ? 'sem-nuvem' : process.env.COMISSOES_CONTA_TESTE ? 'ok' : situacaoNuvem();
      if (nuvem === 'chave-errada') console.error('nuvem.json: essa é a chave secreta (service_role). Use a pública (anon/publishable).');
      if (nuvem !== 'ok') throw Object.assign(new Error(nuvem === 'chave-errada' ? 'a chave em nuvem.json é a secreta' : 'nuvem não configurada'), { semNuvem: true, status: nuvem });
      conta = criarConta({ dir: dirDados(), store, safeStorage, avisar });
      contaPronta = conta.iniciar().catch(() => {});
    } catch (e) {
      // a conta nunca pode impedir o app de abrir: segue com os dados do PC
      if (!e.semNuvem) console.error('conta indisponível:', e);
      conta = contaIndisponivel(String((e && e.message) || e), e.semNuvem ? e.status : 'erro');
    }
    registrarIpc();
    criarJanela();
    iniciarAtualizacoes();
  });
  app.on('window-all-closed', () => app.quit());
  // antes de fechar, manda pra nuvem o que ainda não foi (no máximo 4 s)
  app.on('before-quit', (e) => {
    if (saindo || !conta || !conta.precisaEnviar()) return;
    e.preventDefault();
    saindo = true;
    conta.antesDeFechar(4000).finally(() => app.quit());
  });
}
