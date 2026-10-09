// Teste de integração do app REAL (main + preload + IPC), com dados numa pasta temporária.
// Uso: node tools/testar-app.js
// Sobe o Electron com depuração remota, conversa via CDP e confere as pontes principais.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'comissoes-teste-'));
// dados no formato ANTIGO (etapas, pagamento parcial, rodadas) pra testar a migração,
// mais campos de uma versão "mais nova" (têm que sobreviver) e um avatar de rede (tem que ser ignorado)
fs.writeFileSync(path.join(dados, 'comissoes-dados.json'), JSON.stringify({
  config: {}, colecaoNova: [{ id: 'x' }],
  clientes: [{ id: 'cli-velho', nome: 'Velho', instagram: '@velho', avatar: 'file://127.0.0.1/C$/nao-existe.png', conversa: { estado: 'falta', desde: new Date().toISOString() } }],
  pedidos: [
    { id: 'ped-velho-1', clienteId: 'cli-velho', titulo: 'Antigo pago', qtd: 2, etapa: 'pago', valor: 1000, recebido: 1000, ajustes: [{ texto: 'mais escuro' }], desconto: 5 },
    { id: 'ped-velho-2', clienteId: 'cli-velho', titulo: 'Antigo metade', qtd: 1, etapa: 'comecado', valor: 500, recebido: 250 },
    { id: 'ped-velho-3', clienteId: 'cli-velho', titulo: 'Antigo aprovado', qtd: 1, etapa: 'aprovado', valor: 300, recebido: 0 }
  ]
}));
const porta = 9241;
// COMISSOES_EXE=<caminho do Comissões.exe instalado> testa o app empacotado em vez do código-fonte
const instalado = process.env.COMISSOES_EXE || '';
const exe = instalado || path.join(raiz, 'node_modules', 'electron', 'dist', 'electron.exe');
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const proc = spawn(exe, [...(instalado ? [] : ['.']), `--remote-debugging-port=${porta}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], { cwd: instalado ? path.dirname(instalado) : raiz, env: { ...process.env, COMISSOES_DADOS: dados, COMISSOES_NUVEM: 'off' }, stdio: 'ignore' });
  let ws, id = 0; const pend = new Map();
  const resultados = [];
  const ok = (nome, cond, extra = '') => { resultados.push({ nome, ok: !!cond, extra }); console.log((cond ? 'PASSOU ' : 'FALHOU ') + nome + (extra ? ' — ' + extra : '')); };
  try {
    let alvo;
    for (let i = 0; i < 40 && !alvo; i++) {
      await espera(500);
      try { const l = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); alvo = l.find(t => t.type === 'page' && t.url.includes('index.html')); } catch {}
    }
    if (!alvo) throw new Error('janela não abriu');
    ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erro'); return r.result.result.value; };
    // espera a tela ficar pronta (o app empacotado carrega mais devagar que o código-fonte)
    for (let i = 0; i < 40; i++) { const r = await cdp('Runtime.evaluate', { expression: "typeof App === 'object' && !!document.querySelector('#lateral') && document.querySelector('#lateral').children.length > 3", returnByValue: true }); if (r.result && r.result.result && r.result.result.value === true) break; await espera(250); }
    await espera(300);

    ok('ponte window.api existe', await ev('return !!window.api && App.noApp'));
    const mig = await ev("return App.estado.pedidos.map(p => ({ id: p.id, feito: p.feito, pago: p.pago, notas: p.notas, temEtapa: 'etapa' in p || 'recebido' in p || 'rodada' in p }))");
    const m1 = mig.find(p => p.id === 'ped-velho-1'), m2 = mig.find(p => p.id === 'ped-velho-2'), m3 = mig.find(p => p.id === 'ped-velho-3');
    ok('migração: etapa pago → feito e pago', m1 && m1.feito === true && m1.pago === true);
    ok('migração: ajustes antigos vão pras notas', m1 && /mais escuro/.test(m1.notas));
    ok('migração: começado com metade → a fazer e não pago', m2 && m2.feito === false && m2.pago === false);
    ok('migração: aprovado sem pagar → feito e não pago', m3 && m3.feito === true && m3.pago === false);
    ok('migração: campos de etapa somem', mig.every(p => !p.temEtapa));
    ok('tela inicial renderizou', await ev("return document.querySelector('#lateral').children.length > 3"));
    // nuvem desligada no teste (nunca toca a nuvem de verdade)
    ok('teste roda só local (COMISSOES_NUVEM=off)', (await ev('return App.conta.semConta && App.conta.sync.status')) === 'sem-nuvem');
    const novos = await ev("const c = App.estado.clientes.find(c => c.id === 'cli-velho'), p = App.estado.pedidos.find(p => p.id === 'ped-velho-1'); return { insta: c.instagram, avatar: c.avatar, desconto: p.desconto, colecao: Array.isArray(App.estado.colecaoNova) }");
    ok('campos de versão mais nova não somem', novos.insta === '@velho' && novos.desconto === 5 && novos.colecao);
    ok('avatar de rede (file://servidor) é ignorado', novos.avatar === '');
    ok('ponte dados.sujo e conta.adotar existem', await ev("return typeof window.api.dados.sujo === 'function' && typeof window.api.conta.adotar === 'function'"));
    // dados: salvar e ler de volta
    await ev("App.acoes.novoCliente({ nome: 'Teste', faltaResponder: true }); return true");
    await espera(500);
    const lido = await ev('const d = await window.api.dados.ler(); return d.clientes.length');
    ok('dados salvos no disco e lidos de volta', lido === 2, 'clientes=' + lido);
    ok('arquivo JSON criado', fs.existsSync(path.join(dados, 'comissoes-dados.json')));
    const disco = JSON.parse(fs.readFileSync(path.join(dados, 'comissoes-dados.json'), 'utf8'));
    ok('o arquivo salvo mantém os campos novos', Array.isArray(disco.colecaoNova) && disco.clientes.some(c => c.instagram === '@velho') && !disco.pedidos.some(p => 'etapa' in p));
    // Discord sem token
    const semToken = await ev("return await window.api.discord.usuario('284719306512384000')");
    ok('Discord sem token avisa', !semToken.ok && semToken.codigo === 'sem-token', semToken.erro);
    const idRuim = await ev("return await window.api.discord.usuario('abc')");
    ok('ID inválido recusado', !idRuim.ok && idRuim.codigo === 'id-invalido');
    // token falso → Discord deve recusar (401) — testa a rede de verdade
    await ev("await window.api.discord.salvarToken('token-falso-de-teste'); return true");
    const st = await ev('return await window.api.discord.tokenStatus()');
    ok('token salvo (sem voltar pra tela)', st.configurado === true && !('token' in st), 'criptografado=' + st.criptografado);
    const falso = await ev("return await window.api.discord.usuario('284719306512384000')");
    ok('Discord recusa token falso', !falso.ok && (falso.codigo === 'token-invalido' || falso.codigo === 'rede'), falso.codigo + ': ' + falso.erro);
    await ev("await window.api.discord.salvarToken(''); return true");
    // Roblox (API pública)
    const rb = await ev("return await window.api.roblox.usuario('Roblox')");
    ok('Roblox encontra usuário público', rb.ok && rb.dados.id === '1', rb.ok ? rb.dados.displayName + ' avatar=' + (!!rb.dados.avatar) : rb.erro);
    if (rb.ok && rb.dados.avatar) {
      const carregou = await ev(`return await new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = ${JSON.stringify(rb.dados.avatar)}; })`);
      ok('avatar do Roblox salvo localmente e carregável', carregou);
      ok('e passa no filtro de imagem local (não some ao recarregar)', /^file:\/\/\/[A-Za-z]:\//.test(rb.dados.avatar), rb.dados.avatar.slice(0, 40));
    }
    // arquivos: caminho fora da pasta é recusado
    const fora = await ev("return await window.api.arquivos.remover('C:\\\\Windows\\\\win.ini')");
    ok('remoção fora da pasta de dados é bloqueada', fora === false);
    const trav = await ev("return await window.api.arquivos.listar('../..', 'entrega')");
    ok('pedidoId com ../ é bloqueado', Array.isArray(trav) && trav.length === 0);
    const canalRuim = await ev("return await window.api.sistema.abrirCanal('abc')");
    ok('ID de grupo inválido é recusado', canalRuim === false);
    // referências vindas da web: arrastar link/miniatura do Discord ou do navegador, colar com Ctrl+V
    const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const web = await ev(`App.ir('pedidos', 'ped-velho-1'); await new Promise(r => setTimeout(r, 300));
      const n = async () => (await window.api.arquivos.listar('ped-velho-1', 'referencias')).length;
      const ate = async (k) => { for (let i = 0; i < 80; i++) { if (await n() >= k) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
      const png = () => new File([Uint8Array.from(atob('${PNG1}'), c => c.charCodeAt(0))], 'image.png', { type: 'image/png' });
      const soltar = (dados, arquivos) => { const dt = new DataTransfer(); for (const [t, v] of Object.entries(dados)) dt.setData(t, v); for (const f of arquivos || []) dt.items.add(f);
        document.querySelector('[data-refs-zona]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
      const r = {};
      soltar({ 'text/html': '<img src="data:image/png;base64,${PNG1}">' }); r.miniatura = await ate(1);
      soltar({}, [png()]); r.semArquivo = await ate(2);
      const cola = new DataTransfer(); cola.items.add(png()); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: cola, bubbles: true, cancelable: true })); r.colar = await ate(3);
      const nas = new DataTransfer(); nas.items.add(png()); document.querySelector('[data-notas]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: nas, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 800)); r.notasIgnora = (await n()) === 3;
      const recusa = await window.api.arquivos.importarWeb({ pedidoId: 'ped-velho-1', tipo: 'referencias', urls: ['https://localhost/a.png', 'https://192.168.0.1/a.png', 'http://cdn.discordapp.com/embed/avatars/0.png', 'file:///C:/Windows/win.ini', 'data:image/png;base64,' + btoa('nao sou imagem')] });
      r.recusa = recusa.ok === false && (await n()) === 3;
      soltar({ 'text/uri-list': 'https://cdn.discordapp.com/embed/avatars/0.png' }); r.discord = await ate(4);
      return r;`);
    ok('referência: miniatura (data:) arrastada do navegador entra', web.miniatura);
    ok('referência: imagem arrastada sem arquivo no disco entra', web.semArquivo);
    ok('referência: Ctrl+V com imagem copiada entra', web.colar);
    ok('referência: colar dentro das notas não vira referência', web.notasIgnora);
    ok('referência: localhost, rede local, http, file e não-imagem são recusados', web.recusa);
    ok('referência: link do Discord arrastado é baixado (rede)', web.discord);
    // tema
    await ev("App.definirTema('of'); return true");
    ok('troca de tema aplica data-tema', (await ev('return document.documentElement.dataset.tema')) === 'of');
    // navegação por todas as telas sem erro
    for (const t of ['dashboard', 'pedidos', 'clientes', 'config']) {
      const erro = await ev(`App.ir('${t}'); await new Promise(r=>setTimeout(r,150)); return document.querySelector('#area .vazio h3')?.textContent === 'Algo deu errado nesta tela'`);
      ok('tela ' + t + ' abre sem erro', !erro);
    }
    // config (sem nuvem): Dados não fala em conta; status de envio/download troca no lugar, sem refazer a tela
    ok('Dados sem nuvem não fala em conta', (await ev("return document.querySelector('#area').textContent")).includes('ficam neste computador. As imagens'));
    const parcial = await ev(`const sel = document.querySelector('#cfg-moeda'), sync = document.querySelector('#area [data-sync-linha]');
      App.conta = { ...App.conta, sync: { ...App.conta.sync, status: 'offline' } }; App.atualizacao = { ...App.atualizacao, fase: 'baixando', versao: '9.9.9', pct: 42 };
      App.telas.config.parcial();
      const r = { selVivo: sel.isConnected, syncTrocou: !sync.isConnected && /Sem internet/.test(document.querySelector('#area [data-sync-linha]').textContent), pct: document.querySelector('#area [data-update-linha]').textContent.includes('42%') };
      App.conta = { ...App.conta, sync: { ...App.conta.sync, status: 'sem-nuvem' } }; App.atualizacao = { ...App.atualizacao, fase: 'dev' }; App.redesenhar(); return r;`);
    ok('status da config troca no lugar (select continua o mesmo)', parcial.selVivo && parcial.syncTrocou && parcial.pct, JSON.stringify(parcial));
    // "Continuar sem entrar": a config não finge conta conectada e tem como entrar
    const local = await ev(`const antes = App.conta;
      App.conta = { logado: false, email: '', nome: '', adotar: null, podeUsarLocal: true, sync: { status: 'desconectado', pendente: false, ultimo: '', erro: '' } };
      App.ir('config'); await new Promise(r => setTimeout(r, 100));
      const a = document.querySelector('#area'), r = { entrar: !!a.querySelector('[data-entrar-conta]'), outros: !!a.querySelector('[data-sincronizar], [data-sair-conta]'), naConta: a.textContent.includes('e na sua conta') };
      a.querySelector('[data-entrar-conta]')?.click(); r.abriu = Entrada.aberta();
      App.conta = antes; Entrada.esconder(); return r;`);
    ok('sem entrar: config mostra "Entrar" (sem Sincronizar/Sair) e abre a tela de entrada', local.entrar && !local.outros && !local.naConta && local.abriu, JSON.stringify(local));
    // tela de entrada: Ctrl+K não abre busca escondida; trocar de aba mantém o e-mail; toasts ficam por cima
    const ent = await ev(`Entrada.mostrar(); await new Promise(r => setTimeout(r, 60));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      const busca = UI.temModal();
      document.querySelector('.entrada [data-email]').value = 'amigo@gmail.com';
      document.querySelector('.entrada [data-aba=criar]').click();
      const email = document.querySelector('.entrada [data-email]').value;
      UI.toast('teste', 'ok'); await new Promise(r => setTimeout(r, 50));
      const t = document.querySelector('#toasts'), zt = +getComputedStyle(t).zIndex, ze = +getComputedStyle(document.querySelector('.entrada')).zIndex;
      Entrada.esconder(); return { busca, email, toastPorCima: zt > ze };`);
    ok('Ctrl+K não abre a busca atrás da tela de entrada', ent.busca === false);
    ok('trocar Entrar/Criar conta mantém o e-mail', ent.email === 'amigo@gmail.com', ent.email);
    ok('toasts aparecem por cima da tela de entrada', ent.toastPorCima);
  } catch (e) {
    ok('execução do teste', false, e.message);
  } finally {
    try { ws && ws.close(); } catch {}
    proc.kill();
    await espera(500);
    try { fs.rmSync(dados, { recursive: true, force: true }); } catch {}
  }
  const falhas = resultados.filter(r => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`);
  process.exit(falhas ? 1 : 0);
}
main();
