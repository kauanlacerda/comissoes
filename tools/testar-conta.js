// Testa a conta e a sincronização (conta.js) contra uma NUVEM FALSA em memória.
// Não usa internet nem cria contas de verdade. Uso: node tools/testar-conta.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const Store = require('../store');
const { criarConta } = require('../conta');

const espera = (ms) => new Promise(r => setTimeout(r, ms));
const resultados = [];
const ok = (nome, cond, extra = '') => { resultados.push(!!cond); console.log((cond ? 'PASSOU ' : 'FALHOU ') + nome + (extra ? ' — ' + extra : '')); };
const TEMPOS = { envio: 40, puxar: 10 ** 9, falha: 150 };
const pastas = [];
const novaPasta = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'comissoes-conta-')); pastas.push(d); return d; };
const dadosCom = (n, tag = 'c') => ({ config: { nome: tag }, clientes: Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, nome: `${tag} ${i}` })), pedidos: [] });

// ---------- nuvem falsa (Supabase em memória, com RLS) ----------
function criarNuvem() {
  const linhas = new Map();   // user_id → { payload, atualizado_em }
  const contas = new Map();   // email → { id, senha, meta }
  let relogio = Date.parse('2026-10-09T12:00:00Z');
  const nuvem = { online: true, semTabela: false, linhas, contas, envios: 0 };
  const agora = () => new Date(relogio += 1000).toISOString();
  const copia = (x) => JSON.parse(JSON.stringify(x));
  nuvem.cadastrar = (email, senha) => { const id = 'uid-' + email.split('@')[0]; contas.set(email, { id, senha, meta: { nome: email.split('@')[0] } }); return id; };
  nuvem.cliente = (storage, chave) => {
    const sessao = () => { try { return JSON.parse(storage.getItem(chave) || 'null'); } catch { return null; } };
    const semRede = () => ({ data: {}, error: new Error('TypeError: fetch failed') });
    return {
      auth: {
        async getSession() { if (!nuvem.online) throw new Error('fetch failed'); return { data: { session: sessao() }, error: null }; },
        async signInWithPassword({ email, password }) {
          if (!nuvem.online) return semRede();
          const c = contas.get(email);
          if (!c || c.senha !== password) return { data: {}, error: new Error('Invalid login credentials') };
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
        const q = {};
        const api = {
          select(c) { q.cols = c; return api; },
          eq(_c, v) { q.filtro = v; return api; },
          upsert(row) { q.row = row; return api; },
          maybeSingle: () => exec(),
          single: () => exec()
        };
        async function exec() {
          await espera(5);
          if (!nuvem.online) return { data: null, error: new Error('TypeError: fetch failed') };
          if (nuvem.semTabela) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.comissoes_dados' in the schema cache" } };
          const s = sessao(); const uid = s && s.user && s.user.id;
          if (q.row) {
            if (!uid || q.row.user_id !== uid) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
            const l = { payload: copia(q.row.payload), atualizado_em: agora() };
            linhas.set(uid, l); nuvem.envios++;
            return { data: { atualizado_em: l.atualizado_em }, error: null };
          }
          if (!uid || q.filtro !== uid) return { data: null, error: null }; // RLS esconde
          const l = linhas.get(uid);
          return { data: l ? copia(l) : null, error: null };
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
  const avisos = [];
  const conta = criarConta({ dir, store, safeStorage: { isEncryptionAvailable: () => false }, avisar: (c) => avisos.push(c), cliente: nuvem.cliente, tempos: TEMPOS });
  return { dir, store, conta, avisos, reabrir() { this.conta.parar(); this.conta = criarConta({ dir, store: this.store, safeStorage: { isEncryptionAvailable: () => false }, avisar: (c) => avisos.push(c), cliente: nuvem.cliente, tempos: TEMPOS }); return this.conta; } };
}
const backups = (dir, prefixo) => { try { return fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith(prefixo)); } catch { return []; } };
const nClientes = (store) => (store.get().clientes || []).length;

(async () => {
  const nuvem = createNuvemSafe();
  function createNuvemSafe() { return criarNuvem(); }
  const SAK = nuvem.cadastrar('sak@exemplo.com', 'senha123');

  // 1) primeiro login: o que já estava no PC sobe pra conta
  const A = pc(nuvem, dadosCom(3, 'sak'));
  await A.conta.iniciar();
  ok('sem sessão começa deslogado', A.conta.estado().logado === false);
  const r1 = await A.conta.entrar('sak@exemplo.com', 'errada');
  ok('senha errada é recusada com mensagem em português', !r1.ok && /senha errados/.test(r1.erro), r1.erro);
  const r2 = await A.conta.entrar('sak@exemplo.com', 'senha123');
  await espera(400);
  ok('login certo entra', r2.ok && A.conta.estado().logado);
  ok('primeiro login sobe os dados do PC pra nuvem', nuvem.linhas.get(SAK) && nuvem.linhas.get(SAK).payload.clientes.length === 3);
  ok('depois de enviar não fica pendência', A.conta.estado().sync.pendente === false && A.conta.estado().sync.status === 'ok');

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

  // 8) PC com dados, mesmo dono, mas que nunca falou com a nuvem: a nuvem não é sobrescrita
  const C = pc(nuvem, dadosCom(2, 'velho'));
  fs.writeFileSync(path.join(C.dir, 'conta.json'), JSON.stringify({ donoId: SAK, pendente: true }));
  C.reabrir();
  await C.conta.iniciar();
  await C.conta.entrar('sak@exemplo.com', 'senha123');
  await espera(700);
  ok('nuvem com dados não é sobrescrita por um PC desatualizado', nuvem.linhas.get(SAK).payload.clientes.length === 7, 'nuvem=' + nuvem.linhas.get(SAK).payload.clientes.length);
  ok('o PC desatualizado recebe a nuvem e guarda a cópia dele', nClientes(C.store) === 7 && (backups(C.dir, 'conflito-antes-de-enviar-').length + backups(C.dir, 'antes-de-baixar-da-nuvem-').length) >= 1);

  // 9) reabrir o app continua logado (sessão guardada)
  const contaB2 = B.reabrir();
  await contaB2.iniciar();
  ok('reabrir o app continua logado', contaB2.estado().logado === true && contaB2.estado().email === 'sak@exemplo.com');

  // 10) reabrir sem internet: continua logado e usa os dados do PC
  nuvem.online = false;
  const contaB3 = B.reabrir();
  await contaB3.iniciar();
  ok('sem internet ao abrir, continua logado com os dados do PC', contaB3.estado().logado === true && nClientes(B.store) === 7);

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

  for (const x of [A, B, C, D]) x.conta.parar();
  await espera(50);
  for (const d of pastas) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  const falhas = resultados.filter(r => !r).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`);
  process.exit(falhas ? 1 : 0);
})();
