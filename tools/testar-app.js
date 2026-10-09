// Teste de integração do app REAL (main + preload + IPC), com dados numa pasta temporária.
// Uso: node tools/testar-app.js
// Sobe o Electron com depuração remota, conversa via CDP e confere as pontes principais.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'comissoes-teste-'));
// dados no formato ANTIGO (etapas, pagamento parcial, rodadas) pra testar a migração
fs.writeFileSync(path.join(dados, 'comissoes-dados.json'), JSON.stringify({
  config: {}, clientes: [{ id: 'cli-velho', nome: 'Velho', conversa: { estado: 'falta', desde: new Date().toISOString() } }],
  pedidos: [
    { id: 'ped-velho-1', clienteId: 'cli-velho', titulo: 'Antigo pago', qtd: 2, etapa: 'pago', valor: 1000, recebido: 1000, ajustes: [{ texto: 'mais escuro' }] },
    { id: 'ped-velho-2', clienteId: 'cli-velho', titulo: 'Antigo metade', qtd: 1, etapa: 'comecado', valor: 500, recebido: 250 },
    { id: 'ped-velho-3', clienteId: 'cli-velho', titulo: 'Antigo aprovado', qtd: 1, etapa: 'aprovado', valor: 300, recebido: 0 }
  ]
}));
const porta = 9241;
const exe = path.join(raiz, 'node_modules', 'electron', 'dist', 'electron.exe');
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const proc = spawn(exe, ['.', `--remote-debugging-port=${porta}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], { cwd: raiz, env: { ...process.env, COMISSOES_DADOS: dados }, stdio: 'ignore' });
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
    await espera(1200);

    ok('ponte window.api existe', await ev('return !!window.api && App.noApp'));
    const mig = await ev("return App.estado.pedidos.map(p => ({ id: p.id, feito: p.feito, pago: p.pago, notas: p.notas, temEtapa: 'etapa' in p || 'recebido' in p || 'rodada' in p }))");
    const m1 = mig.find(p => p.id === 'ped-velho-1'), m2 = mig.find(p => p.id === 'ped-velho-2'), m3 = mig.find(p => p.id === 'ped-velho-3');
    ok('migração: etapa pago → feito e pago', m1 && m1.feito === true && m1.pago === true);
    ok('migração: ajustes antigos vão pras notas', m1 && /mais escuro/.test(m1.notas));
    ok('migração: começado com metade → a fazer e não pago', m2 && m2.feito === false && m2.pago === false);
    ok('migração: aprovado sem pagar → feito e não pago', m3 && m3.feito === true && m3.pago === false);
    ok('migração: campos de etapa somem', mig.every(p => !p.temEtapa));
    ok('tela inicial renderizou', await ev("return document.querySelector('#lateral').children.length > 3"));
    // dados: salvar e ler de volta
    await ev("App.acoes.novoCliente({ nome: 'Teste', faltaResponder: true }); return true");
    await espera(500);
    const lido = await ev('const d = await window.api.dados.ler(); return d.clientes.length');
    ok('dados salvos no disco e lidos de volta', lido === 2, 'clientes=' + lido);
    ok('arquivo JSON criado', fs.existsSync(path.join(dados, 'comissoes-dados.json')));
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
    }
    // arquivos: caminho fora da pasta é recusado
    const fora = await ev("return await window.api.arquivos.remover('C:\\\\Windows\\\\win.ini')");
    ok('remoção fora da pasta de dados é bloqueada', fora === false);
    const trav = await ev("return await window.api.arquivos.listar('../..', 'entrega')");
    ok('pedidoId com ../ é bloqueado', Array.isArray(trav) && trav.length === 0);
    const canalRuim = await ev("return await window.api.sistema.abrirCanal('abc')");
    ok('ID de grupo inválido é recusado', canalRuim === false);
    // tema
    await ev("App.definirTema('of'); return true");
    ok('troca de tema aplica data-tema', (await ev('return document.documentElement.dataset.tema')) === 'of');
    // navegação por todas as telas sem erro
    for (const t of ['dashboard', 'pedidos', 'clientes', 'config']) {
      const erro = await ev(`App.ir('${t}'); await new Promise(r=>setTimeout(r,150)); return document.querySelector('#area .vazio h3')?.textContent === 'Algo deu errado nesta tela'`);
      ok('tela ' + t + ' abre sem erro', !erro);
    }
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
