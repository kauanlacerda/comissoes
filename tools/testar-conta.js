// Testa a conta e a sincronização (conta.js) contra uma NUVEM FALSA em memória.
// Não usa internet nem cria contas de verdade. Uso: node tools/testar-conta.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Store = require('../store');
const { criarConta, avaliarNuvem, situacaoNuvem, mesclar, erroAmigavel } = require('../conta');

const espera = (ms) => new Promise(r => setTimeout(r, ms));
const resultados = [];
const ok = (nome, cond, extra = '') => { resultados.push(!!cond); console.log((cond ? 'PASSOU ' : 'FALHOU ') + nome + (extra ? ' — ' + extra : '')); };
const TEMPOS = { envio: 40, puxar: 10 ** 9, falha: 150, sair: 300, denovo: 40 };
const pastas = [];
const novaPasta = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'comissoes-conta-')); pastas.push(d); return d; };
const copia = (x) => JSON.parse(JSON.stringify(x));
const dadosCom = (n, tag = 'c') => ({ config: { nome: tag }, clientes: Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, nome: `${tag} ${i}` })), pedidos: [] });
const cli = (id, nome = id) => ({ id, nome });
const ids = (d) => ((d && d.clientes) || []).map(c => c.id).sort();
const temId = (d, id) => ids(d).includes(id);
const nomeDe = (d, id) => (((d && d.clientes) || []).find(c => c.id === id) || {}).nome;
// espera uma condição (sem depender de tempo fixo)
async function ate(fn, ms = 3000) { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await espera(10); return fn(); }
const segurar = () => { let soltar; const p = new Promise(r => { soltar = r; }); return { p, soltar }; };

// ---------- nuvem falsa (Supabase em memória, com RLS) ----------
// Como a biblioteca de verdade, cada requisição usa a sessão do momento em que SAI (não a de quando a resposta chega).
function criarNuvem() {
  const linhas = new Map();   // user_id → { payload, atualizado_em, dispositivo }
  const contas = new Map();   // email → { id, senha, meta }
  let relogio = Date.parse('2026-10-09T12:00:00Z');
  const nuvem = {
    online: true, semTabela: false, linhas, contas, envios: 0, atraso: 5, atrasoSessao: 0, limite: 2000000,
    portao: null,               // (pedido) => promessa: segura uma requisição pra criar corridas
    erroLogin: null,            // erro que o próximo login devolve
    revogados: new Set(),       // sessões que o servidor não aceita mais
    pedidos: []                 // log: { op, uid, cols }
  };
  const agora = () => new Date(relogio += 1000).toISOString();
  nuvem.cadastrar = (email, senha) => { const id = 'uid-' + email.split('@')[0]; contas.set(email, { id, senha, meta: { nome: email.split('@')[0] } }); return id; };
  // outro PC gravou direto na nuvem
  nuvem.escrever = (uid, payload) => { linhas.set(uid, { payload: copia(payload), atualizado_em: agora(), dispositivo: 'outro-pc' }); };
  nuvem.cliente = (storage, chave) => {
    const sessao = () => { try { return JSON.parse(storage.getItem(chave) || 'null'); } catch { return null; } };
    const semRede = () => ({ data: {}, error: new Error('TypeError: fetch failed') });
    return {
      auth: {
        async getSession() {
          if (nuvem.atrasoSessao) await espera(nuvem.atrasoSessao);
          if (!nuvem.online) throw new Error('fetch failed');
          const s = sessao();
          // refresh token revogado: a biblioteca apaga a sessão guardada
          if (s && s.user && nuvem.revogados.has(s.user.id)) { storage.removeItem(chave); return { data: { session: null }, error: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' } }; }
          return { data: { session: s }, error: null };
        },
        async signInWithPassword({ email, password }) {
          if (!nuvem.online) return semRede();
          if (nuvem.erroLogin) { const e = nuvem.erroLogin; nuvem.erroLogin = null; return { data: {}, error: e }; }
          const c = contas.get(email);
          if (!c || c.senha !== password) return { data: {}, error: Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }) };
          const s = { access_token: 'x', user: { id: c.id, email, user_metadata: c.meta } };
          storage.setItem(chave, JSON.stringify(s));
          return { data: { user: s.user, session: s }, error: null };
        },
        async signUp({ email, password }) {
          if (!nuvem.online) return semRede();
          if (contas.has(email)) return { data: { user: { id: 'x', identities: [] }, session: null }, error: null };
          nuvem.cadastrar(email, password);
          return nuvem.cliente(storage, chave).auth.signInWithPassword({ email, password });
        },
        async signOut() { storage.removeItem(chave); return { error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
      },
      from() {
        const q = { filtros: {} };
        const api = {
          select(c) { if (q.op) q.retorno = c; else { q.op = 'select'; q.cols = c; } return api; },
          eq(c, v) { q.filtros[c] = v; return api; },
          update(row) { q.op = 'update'; q.row = row; return api; },
          insert(row) { q.op = 'insert'; q.row = row; return api; },
          upsert(row) { q.op = 'upsert'; q.row = row; return api; },
          maybeSingle() { return api; },
          single() { return api; },
          then(sim, nao) { return exec().then(sim, nao); }
        };
        async function exec() {
          const s0 = sessao(); const uid = s0 && s0.user && s0.user.id; // o token sai junto com a requisição
          nuvem.pedidos.push({ op: q.op, uid, cols: q.cols });
          if (nuvem.portao) await nuvem.portao({ op: q.op, uid, cols: q.cols, filtros: q.filtros });
          await espera(nuvem.atraso);
          if (!nuvem.online) return { data: null, error: new Error('TypeError: fetch failed') };
          if (nuvem.semTabela) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.comissoes_dados' in the schema cache" } };
          const grande = () => q.row && Buffer.byteLength(JSON.stringify(q.row.payload)) > nuvem.limite;
          const CHECK = { code: '23514', message: 'new row for relation "comissoes_dados" violates check constraint "comissoes_tamanho"' };
          const gravar = () => { const l = { payload: copia(q.row.payload), atualizado_em: agora(), dispositivo: q.row.dispositivo }; linhas.set(uid, l); nuvem.envios++; return l; };
          if (q.op === 'select') {
            if (!uid || q.filtros.user_id !== uid) return { data: null, error: null }; // RLS esconde
            const l = linhas.get(uid);
            return { data: l ? (q.cols === 'atualizado_em' ? { atualizado_em: l.atualizado_em } : copia(l)) : null, error: null };
          }
          if (q.op === 'update') {
            const l = linhas.get(uid);
            if (!uid || q.filtros.user_id !== uid || !l) return { data: [], error: null };
            if ('atualizado_em' in q.filtros && q.filtros.atualizado_em !== l.atualizado_em) return { data: [], error: null };
            if (grande()) return { data: null, error: CHECK };
            return { data: [{ atualizado_em: gravar().atualizado_em }], error: null };
          }
          if (!uid || q.row.user_id !== uid) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
          if (q.op === 'insert' && linhas.has(uid)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          if (grande()) return { data: null, error: CHECK };
          return { data: { atualizado_em: gravar().atualizado_em }, error: null };
        }
        return api;
      }
    };
  };
  return nuvem;
}

function pc(nuvem, dadosIniciais) {
  const dir = novaPasta();
  const store = new Store(dir);
  if (dadosIniciais) store.set(dadosIniciais);
  const avisos = [], estados = [];
  const avisar = (c, d) => { avisos.push(c); if (c === 'conta:estado') estados.push(d); };
  const nova = () => criarConta({ dir, store, safeStorage: { isEncryptionAvailable: () => false }, avisar, cliente: nuvem.cliente, tempos: TEMPOS });
  const x = { dir, store, avisos, estados, conta: nova(), reabrir() { x.conta.parar(); x.conta = nova(); return x.conta; } };
  return x;
}
const backups = (dir, prefixo) => { try { return fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith(prefixo)); } catch { return []; } };
const nClientes = (store) => (store.get().clientes || []).length;
const lerMeta = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'conta.json'), 'utf8'));
// muda os dados como a tela faz (grava e avisa)
const editar = (x, fn) => { const d = copia(x.store.get()); fn(d); x.store.set(d); x.conta.marcarMudanca(); };
const semPendencia = (x) => () => !x.conta.estado().sync.pendente && x.conta.estado().sync.status === 'ok';

// renderer/js/nucleo.js num sandbox, com uma ponte falsa
function nucleo(dados) {
  const salvos = [], conta = { sujo: 0 };
  const api = {
    dados: { ler: async () => copia(dados), salvar: async (s) => { salvos.push(copia(s)); return true; }, sujo: () => { conta.sujo++; }, onRecarregar() {} },
    janela: { tema() {} }, arquivos: { removerPedido() {} }
  };
  const window = { api, addEventListener() {} };
  const ctx = vm.createContext({ window, UI: { esc: String, toast() {}, fecharMenu() {} }, document: { documentElement: { dataset: {} }, getElementById: () => null }, location: { search: '' }, URLSearchParams, setTimeout, clearTimeout, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'nucleo.js'), 'utf8'), ctx);
  return { App: window.App, salvos, conta };
}

(async () => {
  const nuvem = criarNuvem();
  const SAK = nuvem.cadastrar('sak@exemplo.com', 'senha123');

  // 1) primeiro login num PC com dados sem dono: pergunta, e só sobe se a pessoa disser que são dela
  const A = pc(nuvem, dadosCom(3, 'sak'));
  await A.conta.iniciar();
  ok('sem sessão começa deslogado', A.conta.estado().logado === false);
  const r1 = await A.conta.entrar('sak@exemplo.com', 'errada');
  ok('senha errada é recusada com mensagem em português', !r1.ok && /senha errados/.test(r1.erro), r1.erro);
  const r2 = await A.conta.entrar('sak@exemplo.com', 'senha123');
  await espera(200);
  ok('login certo entra', r2.ok && A.conta.estado().logado);
  ok('dados do PC sem dono: pergunta antes de subir', r2.estado.adotar && r2.estado.adotar.clientes === 3 && !nuvem.linhas.has(SAK));
  await A.conta.adotar(true);
  await ate(semPendencia(A));
  ok('"Guardar na minha conta" sobe os dados do PC pra nuvem', nuvem.linhas.get(SAK) && nuvem.linhas.get(SAK).payload.clientes.length === 3);
  ok('depois de enviar não fica pendência', A.conta.estado().sync.pendente === false && A.conta.estado().sync.status === 'ok' && !A.conta.estado().adotar);

  // 2) segundo PC vazio: puxa da nuvem
  const B = pc(nuvem, null);
  await B.conta.iniciar();
  await B.conta.entrar('sak@exemplo.com', 'senha123');
  ok('segundo PC recebe os dados da conta', nClientes(B.store) === 3);
  ok('a tela é avisada pra recarregar', B.avisos.includes('dados:recarregar'));

  // 3) mudança no PC B sobe sozinha
  B.store.set(dadosCom(5, 'sak')); B.conta.marcarMudanca();
  await espera(400);
  ok('mudança local sobe sozinha', nuvem.linhas.get(SAK).payload.clientes.length === 5);

  // 4) PC A puxa a mudança feita no B
  await A.conta.puxar();
  ok('outro PC puxa a versão mais nova', nClientes(A.store) === 5);

  // 5) outra conta no mesmo PC: nada se mistura
  const AMIGO = nuvem.cadastrar('amigo@exemplo.com', 'senha456');
  const sair1 = await A.conta.sair();
  ok('sair funciona', sair1.ok && !A.conta.estado().logado);
  await A.conta.entrar('amigo@exemplo.com', 'senha456');
  await espera(300);
  ok('conta do amigo começa vazia no PC que era do sak', nClientes(A.store) === 0);
  ok('os dados do sak viram cópia de segurança antes', backups(A.dir, 'outra-conta-').length >= 1);
  ok('a nuvem do sak não foi mexida pela conta do amigo', nuvem.linhas.get(SAK).payload.clientes.length === 5);
  A.store.set(dadosCom(1, 'amigo')); A.conta.marcarMudanca();
  await espera(400);
  ok('dados do amigo vão pra linha dele', nuvem.linhas.get(AMIGO) && nuvem.linhas.get(AMIGO).payload.clientes.length === 1);
  ok('e a linha do sak continua igual', nuvem.linhas.get(SAK).payload.clientes.length === 5);

  // 6) sem internet: guarda e manda quando voltar
  nuvem.online = false;
  B.store.set(dadosCom(6, 'sak')); B.conta.marcarMudanca();
  await espera(120);
  ok('sem internet fica "offline" com pendência', B.conta.estado().sync.status === 'offline' && B.conta.estado().sync.pendente === true, B.conta.estado().sync.status);
  nuvem.online = true;
  await espera(500);
  ok('quando a internet volta, sobe sozinho', nuvem.linhas.get(SAK).payload.clientes.length === 6 && B.conta.estado().sync.pendente === false);

  // 7) tabela não criada no Supabase
  nuvem.semTabela = true;
  B.store.set(dadosCom(7, 'sak')); B.conta.marcarMudanca();
  await espera(150);
  ok('sem a tabela, avisa "sem-tabela" e não perde nada', B.conta.estado().sync.status === 'sem-tabela' && B.conta.estado().sync.pendente === true && nClientes(B.store) === 7);
  nuvem.semTabela = false;
  await B.conta.sincronizar();
  ok('depois de criar a tabela, sincroniza', nuvem.linhas.get(SAK).payload.clientes.length === 7);

  // 8) PC com dados, mesmo dono, que nunca falou com a nuvem: junta os dois lados (nada se perde)
  const C = pc(nuvem, dadosCom(2, 'velho'));
  fs.writeFileSync(path.join(C.dir, 'conta.json'), JSON.stringify({ donoId: SAK, pendente: true }));
  C.reabrir();
  await C.conta.iniciar();
  await C.conta.entrar('sak@exemplo.com', 'senha123');
  await ate(semPendencia(C));
  const n8 = nuvem.linhas.get(SAK).payload;
  ok('a nuvem não perde os 7 clientes dela por causa de um PC desatualizado', ['sak0', 'sak6'].every(id => temId(n8, id)) && n8.clientes.length === 9, 'nuvem=' + ids(n8));
  ok('e o que só esse PC tinha também sobe', temId(n8, 'velho0') && temId(n8, 'velho1'));
  ok('o PC fica com tudo e guarda uma cópia de antes da mescla', nClientes(C.store) === 9 && backups(C.dir, 'conflito-mesclado-').length >= 1);

  // 9) reabrir o app continua logado (sessão guardada)
  const contaB2 = B.reabrir();
  await contaB2.iniciar();
  ok('reabrir o app continua logado', contaB2.estado().logado === true && contaB2.estado().email === 'sak@exemplo.com');

  // 10) reabrir sem internet: continua logado e usa os dados do PC
  nuvem.online = false;
  const contaB3 = B.reabrir();
  await contaB3.iniciar();
  ok('sem internet ao abrir, continua logado com os dados do PC', contaB3.estado().logado === true && nClientes(B.store) === nuvem.linhas.get(SAK).payload.clientes.length);

  // 11) sair sem internet com mudança pendente: avisa e não perde
  B.store.set(dadosCom(8, 'sak')); contaB3.marcarMudanca();
  const sair2 = await contaB3.sair();
  ok('sair sem internet avisa que ficou pendência e mantém os dados no PC', sair2.ficouPendente === true && nClientes(B.store) === 8);
  nuvem.online = true;

  // 12) cadastro com e-mail que já existe
  const D = pc(nuvem, null);
  await D.conta.iniciar();
  const r3 = await D.conta.criar('sak@exemplo.com', 'qualquer', 'Sak');
  ok('cadastro com e-mail já usado avisa', !r3.ok && /já tem conta/.test(r3.erro), r3.erro);

  // ================= correções da revisão =================

  // 13) resposta atrasada da conta anterior não cai na conta nova (troca de conta no meio de um download)
  const X = nuvem.cadastrar('xis@exemplo.com', 'senha123');
  const Y = nuvem.cadastrar('ypsilon@exemplo.com', 'senha123');
  nuvem.escrever(X, dadosCom(4, 'xis'));
  nuvem.escrever(Y, dadosCom(1, 'ypsilon'));
  const P = pc(nuvem, null);
  await P.conta.iniciar();
  await P.conta.entrar('xis@exemplo.com', 'senha123');
  nuvem.escrever(X, dadosCom(5, 'xis')); // outro PC mudou a conta xis
  const h1 = segurar();
  nuvem.portao = (q) => (q.op === 'select' && q.uid === X && q.cols !== 'atualizado_em' ? h1.p : null);
  const puxando = P.conta.puxar();
  await espera(40);
  await P.conta.sair();
  await P.conta.entrar('ypsilon@exemplo.com', 'senha123');
  h1.soltar(); nuvem.portao = null;
  await puxando; await espera(60);
  ok('troca de conta no meio de um download: os dados da conta anterior não entram', P.conta.estado().email === 'ypsilon@exemplo.com' && ids(P.store.get()).join() === 'ypsilon0', ids(P.store.get()).join());
  editar(P, d => d.clientes.push(cli('y-novo')));
  await ate(() => temId(nuvem.linhas.get(Y).payload, 'y-novo'));
  ok('e a nuvem da conta nova só recebe os dados dela', ids(nuvem.linhas.get(Y).payload).every(id => id.startsWith('y')));

  // 14) envio em andamento quando a conta troca: vai pra linha certa e não bagunça a conta nova
  const h2 = segurar();
  nuvem.portao = (q) => (q.op === 'update' && q.uid === Y ? h2.p : null);
  P.store.set(dadosCom(3, 'ypsilon')); P.conta.marcarMudanca();
  await espera(120);
  const sairY = await P.conta.sair(); // desiste de esperar depois do limite
  await P.conta.entrar('xis@exemplo.com', 'senha123');
  h2.soltar(); nuvem.portao = null;
  await espera(150);
  ok('envio atrasado da conta anterior não mexe na conta nova', sairY.ficouPendente === true && P.conta.estado().email === 'xis@exemplo.com' && ids(P.store.get()).every(id => id.startsWith('xis')) && nClientes(P.store) === 5);
  ok('o envio atrasado foi pra linha da conta dele', ids(nuvem.linhas.get(Y).payload).join() === 'ypsilon0,ypsilon1,ypsilon2' && ids(nuvem.linhas.get(X).payload).every(id => id.startsWith('xis')));
  ok('a versão da nuvem guardada é a da conta nova', lerMeta(P.dir).nuvemEm === nuvem.linhas.get(X).atualizado_em);

  // 15) gravação da tela chegando no meio do login de outra conta não sobe os dados da anterior
  await P.conta.sair();
  const h3 = segurar();
  let primeira = true; // segura só o download do login (o envio que escapar passa direto)
  nuvem.portao = (q) => { if (primeira && q.op === 'select' && q.uid === Y) { primeira = false; return h3.p; } return null; };
  const entrando = P.conta.entrar('ypsilon@exemplo.com', 'senha123');
  await espera(20);
  P.conta.marcarMudanca(); // a tela ainda tinha o estado da conta xis
  await espera(150);
  h3.soltar(); nuvem.portao = null;
  await entrando; await espera(700);
  ok('gravação no meio da troca de conta não leva dados de outra conta', !ids(nuvem.linhas.get(Y).payload).some(id => id.startsWith('xis')) && !ids(P.store.get()).some(id => id.startsWith('xis')));

  // 16) fechar o app / sair esperam o envio que já está indo
  const Z = nuvem.cadastrar('zeta@exemplo.com', 'senha123');
  nuvem.escrever(Z, dadosCom(2, 'z'));
  const Q = pc(nuvem, null);
  await Q.conta.iniciar(); await Q.conta.entrar('zeta@exemplo.com', 'senha123');
  nuvem.portao = (q) => (q.op === 'update' && q.uid === Z ? espera(150) : null);
  editar(Q, d => d.clientes.push(cli('mud1')));
  await espera(80);
  editar(Q, d => d.clientes.push(cli('mud2'))); // durante o envio
  const t0 = Date.now();
  await Q.conta.antesDeFechar(3000);
  const dt = Date.now() - t0;
  ok('fechar o app espera o envio em andamento e manda o resto', temId(nuvem.linhas.get(Z).payload, 'mud1') && temId(nuvem.linhas.get(Z).payload, 'mud2') && !Q.conta.precisaEnviar() && dt > 100, dt + ' ms');
  editar(Q, d => d.clientes.push(cli('mud3')));
  await espera(80);
  editar(Q, d => d.clientes.push(cli('mud4'))); // durante o envio
  const sairZ = await Q.conta.sair();
  nuvem.portao = null;
  ok('sair espera o envio em andamento e manda o resto', sairZ.ficouPendente === false && temId(nuvem.linhas.get(Z).payload, 'mud3') && temId(nuvem.linhas.get(Z).payload, 'mud4'));

  // 16b) sair enquanto o app ainda liga a conta (abriu com sessão guardada e internet lenta)
  const V = nuvem.cadastrar('vagaroso@exemplo.com', 'senha123');
  nuvem.escrever(V, dadosCom(2, 'v'));
  const PV = pc(nuvem, null);
  await PV.conta.iniciar(); await PV.conta.entrar('vagaroso@exemplo.com', 'senha123');
  nuvem.escrever(V, dadosCom(3, 'v')); // outro PC mudou
  const h5 = segurar();
  nuvem.portao = (q) => (q.op === 'select' && q.uid === V ? h5.p : null);
  const cv = PV.reabrir(); const ligando = cv.iniciar();
  await espera(30);
  await cv.sair();
  h5.soltar(); nuvem.portao = null;
  await ligando; await espera(50);
  ok('sair enquanto o app ainda liga a conta: fica fora e nada atrasado é aplicado', !cv.estado().logado && nClientes(PV.store) === 2);

  // 17) dois PCs na mesma conta: mescla em três vias, ninguém passa por cima do outro
  const W = nuvem.cadastrar('w@exemplo.com', 'senha123');
  nuvem.escrever(W, { config: { nome: 'w', tema: 'cube' }, clientes: ['c0', 'c1', 'c2', 'c3', 'c6', 'c7'].map(id => cli(id)), pedidos: [{ id: 'p0', titulo: 'p0' }] });
  const W1 = pc(nuvem, null), W2 = pc(nuvem, null);
  for (const w of [W1, W2]) { await w.conta.iniciar(); await w.conta.entrar('w@exemplo.com', 'senha123'); }
  const acha = (d, id) => d.clientes.find(c => c.id === id);
  editar(W2, d => {
    d.clientes = d.clientes.filter(c => c.id !== 'c0');
    acha(d, 'c2').nome = 'c2-pc2'; acha(d, 'c3').nome = 'c3-pc2'; acha(d, 'c6').nome = 'c6-pc2';
    d.clientes.push(cli('pc2')); d.config.tema = 'of'; d.pedidos.push({ id: 'p-pc2', titulo: 'p-pc2' });
  });
  await ate(semPendencia(W2));
  editar(W1, d => { // W1 não puxou nada
    acha(d, 'c1').nome = 'c1-pc1'; acha(d, 'c6').nome = 'c6-pc1';
    d.clientes = d.clientes.filter(c => c.id !== 'c3' && c.id !== 'c7');
    d.clientes.push(cli('pc1')); d.config.nome = 'w1';
  });
  await ate(semPendencia(W1));
  const nw = nuvem.linhas.get(W).payload;
  ok('dois PCs: o que cada um criou fica', nomeDe(nw, 'pc1') && nomeDe(nw, 'pc2') && nw.pedidos.some(p => p.id === 'p0') && nw.pedidos.some(p => p.id === 'p-pc2'), ids(nw).join());
  ok('editado de um lado só: vale a edição', nomeDe(nw, 'c1') === 'c1-pc1' && nomeDe(nw, 'c2') === 'c2-pc2');
  ok('apagado de um lado e intacto do outro: some', !temId(nw, 'c0') && !temId(nw, 'c7'));
  ok('apagado de um lado mas editado do outro: fica a edição', nomeDe(nw, 'c3') === 'c3-pc2');
  ok('editado dos dois lados: vale o PC que enviou', nomeDe(nw, 'c6') === 'c6-pc1');
  ok('config: cada PC mudou uma chave, as duas ficam', nw.config.tema === 'of' && nw.config.nome === 'w1');
  ok('quem mesclou guarda cópia, avisa a tela e fica igual à nuvem', backups(W1.dir, 'conflito-mesclado-').length >= 1 && W1.avisos.includes('dados:recarregar') && ids(W1.store.get()).join() === ids(nw).join());
  await W2.conta.puxar();
  ok('o outro PC puxa o resultado mesclado', ids(W2.store.get()).join() === ids(nw).join() && nomeDe(W2.store.get(), 'c6') === 'c6-pc1');

  // 17b) mesmo pedido/cliente mudado nos dois PCs, em campos diferentes: as duas mudanças ficam
  editar(W2, d => { d.pedidos.find(p => p.id === 'p0').pago = true; acha(d, 'c1').conversa = { estado: 'respondido', desde: 'y' }; });
  await ate(semPendencia(W2));
  editar(W1, d => { d.pedidos.find(p => p.id === 'p0').notas = 'fundo azul'; acha(d, 'c1').notas = 'paga via pix'; }); // W1 não puxou
  await ate(semPendencia(W1));
  const nw2 = nuvem.linhas.get(W).payload, p0 = nw2.pedidos.find(p => p.id === 'p0'), c1w = acha(nw2, 'c1');
  ok('mesmo item mudado nos dois PCs em campos diferentes: os dois campos ficam', p0.pago === true && p0.notas === 'fundo azul' && c1w.conversa.estado === 'respondido' && c1w.notas === 'paga via pix' && c1w.nome === 'c1-pc1', JSON.stringify([p0, c1w]));

  // 18) outro PC grava entre a conferência e a gravação: a gravação condicional percebe e mescla de novo
  let injetou = false;
  nuvem.portao = (q) => {
    if (!injetou && q.op === 'update' && q.uid === W) { injetou = true; const d = copia(nuvem.linhas.get(W).payload); d.clientes.push(cli('no-meio')); nuvem.escrever(W, d); }
    return null;
  };
  editar(W1, d => d.clientes.push(cli('pc1-b')));
  await ate(semPendencia(W1));
  nuvem.portao = null;
  ok('gravação de outro PC no meio do envio não se perde', injetou && temId(nuvem.linhas.get(W).payload, 'no-meio') && temId(nuvem.linhas.get(W).payload, 'pc1-b'));

  // 19) PC fecha com mudança sem enviar, o outro mexe, o primeiro reabre: junta as duas
  nuvem.online = false;
  editar(W1, d => d.clientes.push(cli('offline-pc1')));
  await espera(100); W1.conta.parar(); // fechou sem internet
  nuvem.online = true;
  await W2.conta.puxar();
  editar(W2, d => d.clientes.push(cli('online-pc2')));
  await ate(semPendencia(W2));
  await W1.reabrir().iniciar();
  await ate(() => temId(nuvem.linhas.get(W).payload, 'offline-pc1'));
  ok('PC que ficou sem internet junta com o que o outro fez enquanto isso', temId(nuvem.linhas.get(W).payload, 'online-pc2') && temId(nuvem.linhas.get(W).payload, 'offline-pc1') && temId(W1.store.get(), 'online-pc2'));

  // 20) edição ainda no atraso de 150 ms da tela: a nuvem não passa por cima
  await ate(semPendencia(W1));
  { const d = copia(nuvem.linhas.get(W).payload); d.clientes.push(cli('outro-pc-3')); nuvem.escrever(W, d); }
  const nAv = W1.avisos.length;
  W1.conta.marcarMudanca(true); // a tela avisou: tem gravação a caminho
  await W1.conta.puxar();
  await espera(120);
  ok('com edição a caminho da tela, a nuvem não troca os dados locais', !W1.avisos.slice(nAv).includes('dados:recarregar') && !temId(W1.store.get(), 'outro-pc-3'));
  editar(W1, d => d.clientes.push(cli('digitado'))); // a gravação chegou
  await ate(() => semPendencia(W1)() && temId(nuvem.linhas.get(W).payload, 'digitado'));
  ok('quando a gravação chega, junta as duas coisas', temId(nuvem.linhas.get(W).payload, 'outro-pc-3') && temId(W1.store.get(), 'outro-pc-3') && temId(W1.store.get(), 'digitado'));

  // 21) nuvem esvaziada de propósito não volta com a cópia velha de outro PC
  await W2.conta.puxar();
  editar(W2, d => { d.clientes = []; d.pedidos = []; });
  await ate(() => nuvem.linhas.get(W).payload.clientes.length === 0 && semPendencia(W2)());
  await W1.reabrir().iniciar();
  await espera(150);
  ok('nuvem esvaziada num PC: o outro abre e também esvazia (não sobe a cópia velha)', nuvem.linhas.get(W).payload.clientes.length === 0 && nClientes(W1.store) === 0);

  // 22) conta que só tem configurações na nuvem
  const CF = nuvem.cadastrar('so-config@exemplo.com', 'senha123');
  nuvem.escrever(CF, { config: { nome: 'Fulano', linkGamepass: 'https://exemplo.com/gp', tema: 'of' }, clientes: [], pedidos: [] });
  const PF = pc(nuvem, null);
  await PF.conta.iniciar(); await PF.conta.entrar('so-config@exemplo.com', 'senha123');
  ok('PC novo e vazio recebe as configurações da conta', PF.store.get().config.nome === 'Fulano' && PF.store.get().config.tema === 'of');
  await W2.conta.sair(); await W2.conta.entrar('so-config@exemplo.com', 'senha123'); // PC que era da conta w
  ok('PC de outra conta recebe as configurações dela', W2.store.get().config.nome === 'Fulano' && W2.store.get().config.linkGamepass === 'https://exemplo.com/gp' && nClientes(W2.store) === 0);
  editar(W2, d => d.clientes.push(cli('f1')));
  await ate(() => temId(nuvem.linhas.get(CF).payload, 'f1'));
  ok('e a primeira edição não apaga as configurações da nuvem', nuvem.linhas.get(CF).payload.config.nome === 'Fulano' && nuvem.linhas.get(CF).payload.config.linkGamepass === 'https://exemplo.com/gp');

  // 23) campos e coleções de versões mais novas atravessam nuvem, disco e mescla
  editar(W2, d => { d.colecaoNova = [{ id: 'x1' }]; d.clientes[0].instagram = '@f1'; });
  await ate(semPendencia(W2));
  await PF.conta.puxar();
  ok('campos que esta versão não conhece não se perdem (nuvem e disco)', PF.store.get().colecaoNova && PF.store.get().clientes[0].instagram === '@f1' && new Store(PF.dir).get().colecaoNova.length === 1);

  // 24) mudanças não enviadas de uma conta sobrevivem a outra conta entrar no mesmo PC
  const K = nuvem.cadastrar('ka@exemplo.com', 'senha123');
  nuvem.cadastrar('am2@exemplo.com', 'senha123');
  nuvem.escrever(K, dadosCom(2, 'k'));
  const P4 = pc(nuvem, null);
  await P4.conta.iniciar(); await P4.conta.entrar('ka@exemplo.com', 'senha123');
  nuvem.online = false;
  editar(P4, d => d.clientes.push(cli('trabalho-offline')));
  await espera(80);
  const sairK = await P4.conta.sair();
  nuvem.online = true;
  await P4.conta.entrar('am2@exemplo.com', 'senha123');
  ok('outra conta entra e não vê o trabalho pendente da primeira', sairK.ficouPendente && nClientes(P4.store) === 0);
  editar(P4, d => d.clientes.push(cli('am2-0')));
  await ate(semPendencia(P4));
  await P4.conta.sair();
  await P4.conta.entrar('ka@exemplo.com', 'senha123');
  await ate(() => temId(nuvem.linhas.get(K).payload, 'trabalho-offline'));
  ok('o que não tinha subido volta quando a conta entra de novo, e sobe', temId(P4.store.get(), 'trabalho-offline') && temId(nuvem.linhas.get(K).payload, 'trabalho-offline') && !temId(nuvem.linhas.get(K).payload, 'am2-0') && !fs.existsSync(path.join(P4.dir, 'pendente-' + K + '.json')));

  // 25) dados sem dono (v1.0 ou modo só local) não vão pra conta de quem entrar primeiro
  const DONO = nuvem.cadastrar('dono@exemplo.com', 'senha123');
  const VIS = nuvem.cadastrar('visita@exemplo.com', 'senha123');
  nuvem.escrever(DONO, dadosCom(7, 'nuvem'));
  const P5 = pc(nuvem, dadosCom(3, 'pc'));
  await P5.conta.iniciar(); await P5.conta.entrar('visita@exemplo.com', 'senha123');
  await espera(200);
  ok('dados sem dono: pergunta antes de juntar com a conta', JSON.stringify(P5.conta.estado().adotar) === '{"clientes":3,"pedidos":0}');
  ok('e nada sobe sozinho pra conta de quem entrou', !nuvem.linhas.has(VIS) && !P5.conta.precisaEnviar());
  const c5 = P5.reabrir(); await c5.iniciar();
  ok('reabrir com a pergunta em aberto pergunta de novo', c5.estado().logado && c5.estado().adotar && c5.estado().adotar.clientes === 3);
  await c5.adotar(false); await espera(100);
  ok('"Começar vazio" guarda uma cópia e limpa', nClientes(P5.store) === 0 && backups(P5.dir, 'antes-de-comecar-vazio-').length === 1 && !nuvem.linhas.has(VIS) && !c5.estado().adotar);
  const P6 = pc(nuvem, dadosCom(2, 'pc6'));
  await P6.conta.iniciar(); await P6.conta.entrar('dono@exemplo.com', 'senha123');
  ok('com nuvem cheia, também pergunta e não mexe em nada antes', P6.conta.estado().adotar && nClientes(P6.store) === 2 && nuvem.linhas.get(DONO).payload.clientes.length === 7);
  await P6.conta.adotar(true);
  await ate(() => nuvem.linhas.get(DONO).payload.clientes.length === 9);
  ok('"Guardar na minha conta" junta com o que a conta já tinha', nuvem.linhas.get(DONO).payload.clientes.length === 9 && nClientes(P6.store) === 9);
  // 25b) a visita disse "Começar vazio" no PC do dono: quando o dono entra, ele é perguntado sobre os dados
  await c5.sair();
  const r5 = await c5.entrar('dono@exemplo.com', 'senha123');
  ok('quem disse "Começar vazio" não leva os dados embora: a próxima conta é perguntada', r5.ok && r5.estado.adotar && r5.estado.adotar.clientes === 3 && ids(P5.store.get()).join() === 'pc0,pc1,pc2' && nuvem.linhas.get(DONO).payload.clientes.length === 9, JSON.stringify(r5.estado && r5.estado.adotar));
  await c5.adotar(true);
  await ate(() => temId(nuvem.linhas.get(DONO).payload, 'pc0'));
  ok('e "Guardar na minha conta" sobe pra conta do dono', ['pc0', 'pc2', 'nuvem0', 'pc60'].every(id => temId(nuvem.linhas.get(DONO).payload, id)) && !nuvem.linhas.get(VIS) && !fs.existsSync(path.join(P5.dir, 'pendente-sem-dono.json')));
  // 25c) a mesma cópia antiga em dois PCs (v1.0, exportar/importar): o segundo "Guardar" não desfaz o que a conta já mudou
  const J = nuvem.cadastrar('junta@exemplo.com', 'senha123');
  const antiga = { config: { nome: 'j' }, clientes: [cli('j0'), cli('j1')], pedidos: [{ id: 'jp', clienteId: 'j0', titulo: 'T', feito: false, pago: false, valor: 100 }] };
  const J1 = pc(nuvem, copia(antiga)), J2 = pc(nuvem, { ...copia(antiga), clientes: [...antiga.clientes, cli('j-pc2')] });
  await J1.conta.iniciar(); await J1.conta.entrar('junta@exemplo.com', 'senha123'); await J1.conta.adotar(true); await ate(semPendencia(J1));
  editar(J1, d => { Object.assign(d.pedidos[0], { feito: true, pago: true }); d.clientes.find(c => c.id === 'j1').notas = 'fiel'; });
  await ate(semPendencia(J1));
  await J2.conta.iniciar(); await J2.conta.entrar('junta@exemplo.com', 'senha123'); await J2.conta.adotar(true); await ate(semPendencia(J2));
  const nj = nuvem.linhas.get(J).payload;
  ok('mesma cópia antiga em outro PC: "Guardar" não desfaz pago/notas da conta, sobe o que só o PC tinha e guarda a cópia dele',
    nj.pedidos[0].pago === true && nj.pedidos[0].feito === true && nj.clientes.find(c => c.id === 'j1').notas === 'fiel' && temId(nj, 'j-pc2') && backups(J2.dir, 'conflito-mesclado-').length === 1 && !lerMeta(J2.dir).juntar,
    JSON.stringify([nj.pedidos[0], ids(nj)]));
  // 25d) dois amigos revezando num PC com dados antigos: quem já disse "Começar vazio" não é perguntado de novo
  const RA = nuvem.cadastrar('reva@exemplo.com', 'senha123'), RB = nuvem.cadastrar('revb@exemplo.com', 'senha123');
  nuvem.escrever(RA, dadosCom(1, 'ra')); nuvem.escrever(RB, dadosCom(1, 'rb'));
  const P12 = pc(nuvem, dadosCom(4, 'velho'));
  await P12.conta.iniciar();
  const vezes = [];
  for (const e of ['reva', 'revb', 'reva', 'revb']) {
    const r = await P12.conta.entrar(e + '@exemplo.com', 'senha123');
    vezes.push(r.estado && r.estado.adotar ? 'perguntou' : '-');
    if (r.estado && r.estado.adotar) await P12.conta.adotar(false);
    await espera(80);
    await P12.conta.sair();
  }
  const rDono12 = await P12.conta.entrar('dono@exemplo.com', 'senha123');
  ok('quem já disse "Começar vazio" não é perguntado de novo; a próxima conta ainda é',
    vezes.join() === 'perguntou,perguntou,-,-' && backups(P12.dir, 'antes-de-comecar-vazio-').length === 2 && rDono12.estado.adotar && rDono12.estado.adotar.clientes === 4 && ![RA, RB].some(u => ids(nuvem.linhas.get(u).payload).some(i => i.startsWith('velho'))),
    vezes.join() + ' backups=' + backups(P12.dir, 'antes-de-comecar-vazio-').length);
  // 25e) "Guardar" sem internet e outra conta entra antes de subir: a mescla dela é a normal; quando a primeira volta, ainda vale o da conta
  const JX = nuvem.cadastrar('jx@exemplo.com', 'senha123'), JY = nuvem.cadastrar('jy@exemplo.com', 'senha123');
  nuvem.escrever(JX, { config: {}, clientes: [cli('x0', 'x0-conta')], pedidos: [] });
  nuvem.escrever(JY, dadosCom(2, 'y'));
  const P13 = pc(nuvem, { config: {}, clientes: [cli('x0', 'x0-velho'), cli('x-pc')], pedidos: [] }), Q13 = pc(nuvem, null);
  await P13.conta.iniciar(); await P13.conta.entrar('jx@exemplo.com', 'senha123');
  nuvem.online = false; await P13.conta.adotar(true); await espera(80);
  const sairX = await P13.conta.sair();
  nuvem.online = true;
  await P13.conta.entrar('jy@exemplo.com', 'senha123');
  await Q13.conta.iniciar(); await Q13.conta.entrar('jy@exemplo.com', 'senha123');
  editar(Q13, d => d.clientes.push(cli('y-novo')));
  await ate(semPendencia(Q13));
  editar(P13, d => { d.clientes.find(c => c.id === 'y0').nome = 'y0-P'; d.clientes = d.clientes.filter(c => c.id !== 'y1'); });
  await ate(semPendencia(P13));
  const ny = nuvem.linhas.get(JY).payload;
  ok('outra conta entra antes da adoção subir: a mescla dela é a normal (não a de quem adotou)', sairX.ficouPendente && nomeDe(ny, 'y0') === 'y0-P' && !temId(ny, 'y1') && temId(ny, 'y-novo') && !temId(ny, 'x-pc'), JSON.stringify(ny.clientes));
  await P13.conta.sair();
  await P13.conta.entrar('jx@exemplo.com', 'senha123');
  await ate(() => temId(nuvem.linhas.get(JX).payload, 'x-pc'));
  const nx = nuvem.linhas.get(JX).payload;
  ok('e quando quem adotou volta, no que os dois lados têm ainda vale o da conta', nomeDe(nx, 'x0') === 'x0-conta' && temId(nx, 'x-pc') && !ids(nx).some(i => i.startsWith('y')), JSON.stringify(nx.clientes));

  // 26) limite de 2 MB: não sobe, avisa em português e não fica tentando sem parar
  const G = nuvem.cadastrar('grande@exemplo.com', 'senha123');
  const P7 = pc(nuvem, null);
  await P7.conta.iniciar(); await P7.conta.entrar('grande@exemplo.com', 'senha123');
  editar(P7, d => d.clientes.push(cli('g0')));
  await ate(() => nuvem.linhas.has(G) && semPendencia(P7)());
  ok('o nome do PC vai cortado (até 60 caracteres)', nuvem.linhas.get(G).dispositivo === os.hostname().slice(0, 60));
  const pedidosAntes = nuvem.pedidos.length;
  editar(P7, d => { d.clientes[0].notas = 'x'.repeat(2000001); });
  await espera(400);
  const s7 = P7.conta.estado().sync;
  ok('dados acima de 2 MB não sobem e ficam no PC', s7.status === 'grande-demais' && s7.pendente && !nuvem.linhas.get(G).payload.clientes[0].notas && P7.store.get().clientes[0].notas.length === 2000001, s7.status);
  ok('o aviso é em português', /limite da nuvem/.test(s7.erro), s7.erro);
  ok('e não fica tentando sem parar', nuvem.pedidos.length === pedidosAntes, (nuvem.pedidos.length - pedidosAntes) + ' pedidos');
  editar(P7, d => { d.clientes[0].notas = 'curta'; });
  await ate(semPendencia(P7));
  ok('quando volta pro tamanho normal, sobe de novo', nuvem.linhas.get(G).payload.clientes[0].notas === 'curta');

  // 27) sessão revogada/vencida com internet: volta pra tela de entrar
  const R = nuvem.cadastrar('revogado@exemplo.com', 'senha123');
  const P8 = pc(nuvem, null);
  await P8.conta.iniciar(); await P8.conta.entrar('revogado@exemplo.com', 'senha123');
  nuvem.revogados.add(R);
  const c8 = P8.reabrir(); const nEst = P8.estados.length;
  await c8.iniciar();
  ok('sessão revogada com internet: sai e mostra a tela de entrar', c8.estado().logado === false && P8.estados.slice(nEst).some(s => s.logado === false));
  nuvem.revogados.delete(R);

  // 28) com sessão guardada, o app abre logado na hora (main.js não espera a internet)
  await c8.entrar('revogado@exemplo.com', 'senha123');
  nuvem.atrasoSessao = 300;
  const c9 = P8.reabrir(); const iniciando = c9.iniciar();
  ok('sessão guardada: logado antes da internet responder', c9.estado().logado === true);
  await iniciando; nuvem.atrasoSessao = 0;
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  ok('main.js só espera a conta iniciar quando ninguém entrou', /handle\('conta:estado'[^\n]*if \(!conta\.estado\(\)\.logado\) await/.test(mainJs));

  // 29) sem internet no primeiro uso: dá pra seguir só neste PC (dados sem dono)
  nuvem.online = false;
  const P10 = pc(nuvem, dadosCom(2, 'local'));
  await P10.conta.iniciar();
  const r10 = await P10.conta.entrar('dono@exemplo.com', 'senha123');
  ok('sem internet e dados sem dono: oferece "continuar sem entrar"', !r10.ok && r10.semConexao && r10.podeUsarLocal && P10.conta.estado().podeUsarLocal && /Sem conexão/.test(r10.erro));
  const P11 = pc(nuvem, dadosCom(1, 'dele'));
  fs.writeFileSync(path.join(P11.dir, 'conta.json'), JSON.stringify({ donoId: DONO }));
  await P11.reabrir().iniciar();
  const r11 = await P11.conta.entrar('dono@exemplo.com', 'senha123');
  ok('PC que já é de uma conta: não oferece', !r11.ok && r11.semConexao && !r11.podeUsarLocal);
  nuvem.online = true;

  // 30) erros do Supabase em português, pelo código
  const casos = [['invalid_credentials', /senha errados/], ['email_address_not_authorized', /confirmação/], ['over_email_send_rate_limit', /Muitas tentativas/], ['over_request_rate_limit', /Muitas tentativas/],
    ['email_address_invalid', /não parece válido/], ['validation_failed', /não parece válido/], ['weak_password', /fraca/], ['user_already_exists', /já tem conta/], ['email_exists', /já tem conta/],
    ['42501', /recusou/], ['PGRST205', /preparada/], ['42P01', /preparada/], ['23514', /limite/], ['payload-too-large', /limite/]];
  const falhos = casos.filter(([c, re]) => !re.test(erroAmigavel({ code: c, message: 'English text' })));
  ok('erros com código viram mensagens em português', !falhos.length, falhos.map(f => f[0]).join());
  ok('sem código conhecido, ainda entende o texto', /Sem conexão/.test(erroAmigavel(new Error('fetch failed'))) && /senha errados/.test(erroAmigavel(new Error('Invalid login credentials'))));
  nuvem.erroLogin = Object.assign(new Error('Email address "a@b.com" cannot be used as it is not authorized'), { code: 'email_address_not_authorized' });
  const r12 = await D.conta.entrar('sak@exemplo.com', 'senha123');
  ok('e chegam assim na tela de entrar', !r12.ok && /Fale com quem te passou o app/.test(r12.erro), r12.erro);

  // 31) chave da nuvem: só a pública; url com barra ou /rest/v1 também serve
  const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y';
  const U = 'https://abcdefgh.supabase.co';
  ok('chave pública (publishable ou anon) liga a nuvem', avaliarNuvem(U, 'sb_publishable_abc') === 'ok' && avaliarNuvem(U, jwt('anon')) === 'ok');
  ok('chave secreta (service_role ou sb_secret) fica de fora: "chave-errada"', avaliarNuvem(U, 'sb_secret_abc') === 'chave-errada' && avaliarNuvem(U, jwt('service_role')) === 'chave-errada');
  ok('url com barra no fim ou /rest/v1 é aceita', avaliarNuvem(U + '/', 'sb_publishable_abc') === 'ok' && avaliarNuvem('  ' + U + '/rest/v1/ ', 'sb_publishable_abc') === 'ok');
  ok('sem url/chave ou url que não é do Supabase: "sem-nuvem"', avaliarNuvem('', '') === 'sem-nuvem' && avaliarNuvem('https://exemplo.com', 'sb_publishable_abc') === 'sem-nuvem');
  ok('o nuvem.json do projeto tem a chave pública', situacaoNuvem() === 'ok', situacaoNuvem());

  // 32) regras da mescla em três vias
  const base = { versao: 1, config: { a: 1, b: 1, c: 1 }, clientes: ['1', '2', '3', '4', '5', '6', '7'].map(id => ({ id, n: 1 })), pedidos: [] };
  const local = { versao: 1, config: { a: 2, b: 1, d: 1 }, clientes: [{ id: '1', n: 2 }, { id: '2', n: 1 }, { id: '4', n: 3 }, { id: '5', n: 1 }, { id: '7', n: 8 }, { id: 'L', n: 1 }], pedidos: [] };
  const remoto = { versao: 1, config: { c: 1, b: 3, a: 1 }, clientes: [{ n: 1, id: '1' }, { id: '2', n: 5 }, { id: '3', n: 1 }, { id: '4', n: 4 }, { id: '6', n: 9 }, { id: 'N', n: 1 }], pedidos: [], colecaoNova: [1] };
  const m = mesclar(base, local, remoto);
  const n = (id) => (m.clientes.find(c => c.id === id) || {}).n;
  ok('mescla: mudou de um lado só, vale esse lado (ordem das chaves não importa)', n('1') === 2 && n('2') === 5 && m.config.a === 2 && m.config.b === 3);
  ok('mescla: apagado de um lado e intacto do outro some', n('3') === undefined && n('5') === undefined && !('c' in m.config));
  ok('mescla: apagado de um lado mas mudado do outro fica', n('6') === 9 && n('7') === 8);
  ok('mescla: mudou dos dois lados, vale o local; novos dos dois lados ficam', n('4') === 3 && n('L') === 1 && n('N') === 1 && m.config.d === 1);
  ok('mescla: chaves que esta versão não conhece ficam', Array.isArray(m.colecaoNova));
  ok('mescla com base vazia (primeira vez) não perde nada', mesclar({}, dadosCom(2, 'a'), dadosCom(3, 'b')).clientes.length === 5);

  // 33) nucleo.js (tela): campos novos ficam, campos antigos saem, imagens só do disco local, aviso de edição
  const t = nucleo({
    versao: 1, colecaoNova: [{ id: 'q' }], config: { nome: 'x', recursoNovo: true },
    clientes: [
      { id: 'c1', nome: 'Um', instagram: '@um', avatar: 'file:///C:/Users/x/AppData/Roaming/Comiss%C3%B5es/midia/discord/1.png?v=12', roblox: { id: '1', username: 'r', avatar: 'file://127.0.0.1/C$/x.png' } },
      { id: 'c2', nome: 'Dois', avatar: 'file://servidor/compartilhado/a.png' },
      { id: 'c3', nome: 'Três', avatar: 'https://cdn.discordapp.com/a.png' }
    ],
    pedidos: [{ id: 'p1', clienteId: 'c1', titulo: 'T', qtd: 3, etapa: 'pago', valor: 10, recebido: 10, rodada: 2, etapaEm: 'x', concluidoEm: '2026-01-01', ajustes: [{ texto: 'a' }], desconto: 5,
      entregas: [{ caminho: 'C:\\a.png', url: 'file:///C:/Users/x/pedidos/p1/entrega/slot-1.png?v=1' }, { url: 'file://10.0.0.5/share/b.png' }, null] }]
  });
  await t.App.carregar();
  const e0 = t.App.estado, c1 = e0.clientes[0], p1 = e0.pedidos[0];
  ok('tela: campos e coleções desconhecidos ficam', c1.instagram === '@um' && p1.desconto === 5 && e0.colecaoNova && e0.config.recursoNovo === true);
  ok('tela: campos da versão com etapas saem', ['etapa', 'etapaEm', 'recebido', 'rodada', 'ajustes', 'concluidoEm'].every(k => !(k in p1)) && p1.feito === true && p1.pago === true);
  ok('tela: imagem do disco local fica', /^file:\/\/\/C:\//.test(c1.avatar) && p1.entregas[0] && /slot-1/.test(p1.entregas[0].url));
  ok('tela: imagem de rede (file://servidor) ou de fora é ignorada', c1.roblox.avatar === '' && e0.clientes[1].avatar === '' && e0.clientes[2].avatar === '' && p1.entregas[1] === null);
  t.App.acoes.atualizarCliente('c1', { notas: 'digitando' }, { render: false });
  ok('tela: avisa na hora que tem edição a caminho (antes do atraso de 150 ms)', t.conta.sujo === 1 && t.salvos.length === 0);
  await espera(250);
  const salvo = t.salvos[t.salvos.length - 1];
  ok('tela: o que é salvo mantém os campos desconhecidos', salvo && salvo.clientes[0].instagram === '@um' && salvo.clientes[0].notas === 'digitando' && salvo.colecaoNova && salvo.pedidos[0].desconto === 5);

  // 34) cópias avulsas não crescem sem limite (dois PCs mesclando o dia todo): ficam as 10 últimas de cada motivo
  const S = new Store(novaPasta());
  S.set(dadosCom(1, 's')); S.set(dadosCom(2, 's')); // a segunda gravação cria o backup do dia
  S.snapshot('antes-de-importar');
  for (let i = 0; i < 15; i++) { S.snapshot('conflito-mesclado'); await espera(3); }
  const mescl = backups(path.dirname(S.file), 'conflito-mesclado-').sort();
  ok('cópias avulsas: ficam as 10 últimas de cada motivo, sem mexer nas outras', mescl.length === 10 && backups(path.dirname(S.file), 'antes-de-importar-').length === 1 && backups(path.dirname(S.file), 'comissoes-').length === 1, mescl.length + ' cópias');

  for (const x of [A, B, C, D, P, Q, PV, W1, W2, PF, P4, P5, P6, P7, P8, P10, P11, J1, J2, P12, P13, Q13]) x.conta.parar();
  await espera(50);
  for (const d of pastas) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  const falhas = resultados.filter(r => !r).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`);
  process.exit(falhas ? 1 : 0);
})();
