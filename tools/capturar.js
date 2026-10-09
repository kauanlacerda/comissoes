// Captura telas do app (modo simulado, com dados de exemplo) usando o próprio Electron.
// Uso: npx electron tools/capturar.js <pastaSaida> [tema=cube|of|ambos] [telas=dashboard,pedidos,...]
// Cada tela vira <pasta>/<tela>-<tema>.png. Extras: "ficha" (cliente 1), "pedido" (pedido 1),
// "novo-cliente" (modal), "novo-pedido" (modal), "busca" (Ctrl+K).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'comissoes-cap-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('lang', 'pt-BR');
const [saida = path.join(os.tmpdir(), 'comissoes-capturas'), temaArg = 'ambos', telasArg] = process.argv.slice(2).filter(a => !a.startsWith('--') && !a.endsWith('capturar.js') && a !== '.');
const temas = temaArg === 'ambos' ? ['cube', 'of'] : [temaArg];
const TODAS = ['dashboard', 'pedidos', 'pedido', 'clientes', 'ficha', 'config', 'novo-cliente', 'novo-pedido', 'busca'];
const telas = telasArg ? telasArg.split(',') : TODAS;
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const JS = {
  pedido: "App.ir('pedidos', App.estado.pedidos[0].id)",
  ficha: "App.ir('clientes', App.estado.clientes[0].id)",
  'novo-cliente': "App.modais.novoCliente && App.modais.novoCliente()",
  'novo-pedido': "App.modais.novoPedido && App.modais.novoPedido(App.estado.clientes[0].id)",
  busca: "App.abrirBusca()",
  'novo-grupo': "App.modais.novoCliente(); setTimeout(() => { document.querySelector('[data-tipo=grupo]').click(); const i = document.querySelector('[data-canal]'); i.value = '1093847561029384756'; i.dispatchEvent(new Event('input')); const a = document.querySelector('[data-apelido]'); a.value = 'Equipe Lava Obby'; a.dispatchEvent(new Event('input')); }, 100)",
  'ficha-grupo': "App.ir('clientes', App.acoes.novoCliente({ tipo: 'grupo', canalId: '1093847561029384756', nome: 'Equipe Lava Obby' }))",
  'ficha-servidor': "App.ir('clientes', App.acoes.novoCliente({ tipo: 'servidor', servidorId: '512384756129384756', canalId: '1093847561029384999', nome: 'Agência Nexus', globalName: 'Nexus Studio GFX' }))",
  'novo-servidor': "App.modais.novoCliente(); setTimeout(() => { document.querySelector('[data-tipo=servidor]').click(); const i = document.querySelector('[data-serv]'); i.value = 'https://discord.gg/nexus'; i.dispatchEvent(new Event('input')); }, 100)"
};
const TELA_BASE = { pedido: 'pedidos', ficha: 'clientes', 'novo-cliente': 'dashboard', 'novo-pedido': 'dashboard', busca: 'dashboard', 'novo-grupo': 'dashboard', 'ficha-grupo': 'clientes', 'novo-servidor': 'dashboard', 'ficha-servidor': 'clientes' };

app.whenReady().then(async () => {
  fs.mkdirSync(saida, { recursive: true });
  const win = new BrowserWindow({ width: 1400, height: 860, show: false, webPreferences: { offscreen: true } });
  const erros = [];
  win.webContents.on('console-message', (_e, nivel, msg, linha, fonte) => { if (nivel >= 2) erros.push(`${path.basename(fonte || '')}:${linha} ${msg}`); });
  for (const tema of temas) {
    for (const t of telas) {
      const vazio = t.endsWith('-vazio');
      const nome = vazio ? t.slice(0, -6) : t;
      const tela = TELA_BASE[nome] || nome;
      await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { semente: '1', tela, tema, ...(nome === 'entrada' ? { entrada: '1' } : {}) } });
      await espera(700);
      // "-vazio": zera os dados só na memória (não salva) pra ver os estados vazios
      if (vazio) { await win.webContents.executeJavaScript("App.estado.clientes=[];App.estado.pedidos=[];App.rota.id=null;App.redesenhar()"); await espera(300); }
      if (JS[nome]) { try { await win.webContents.executeJavaScript(JS[nome]); } catch (e) { erros.push(t + ': ' + e.message); } await espera(500); }
      const img = await win.webContents.capturePage();
      const arq = path.join(saida, `${t}-${tema}.png`);
      fs.writeFileSync(arq, img.toPNG());
      console.log('ok', arq);
    }
  }
  if (erros.length) console.log('ERROS DO CONSOLE:\n' + [...new Set(erros)].join('\n'));
  app.quit();
});
