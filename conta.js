// Conta e sincronização com a nuvem (Supabase), no processo principal.
// Senha, sessão e rede nunca passam pela tela. O app SEMPRE funciona offline;
// a nuvem é um espelho: cada conta tem uma linha (payload = o mesmo JSON do arquivo local).
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Projeto Supabase em nuvem.json (url + chave pública 'anon'/'publishable'; quem protege os dados é o RLS)
const NUVEM = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'nuvem.json'), 'utf8')); } catch { return {}; } })();
// aceita a url com barra no fim ou o endereço da API (…/rest/v1)
const limparUrl = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
// só a chave pública serve: a secreta (service_role / sb_secret_) passa por cima do RLS e iria junto no instalador
function papelDaChave(k) {
  if (k.startsWith('sb_publishable_')) return 'anon';
  if (k.startsWith('sb_')) return 'secreta';
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role || ''; } catch { return ''; }
}
// 'ok' | 'sem-nuvem' (nada configurado / url inválida) | 'chave-errada'
function avaliarNuvem(url, chave) {
  url = limparUrl(url); chave = String(chave || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !chave) return 'sem-nuvem';
  return papelDaChave(chave) === 'anon' ? 'ok' : 'chave-errada';
}
const SUPA_URL = limparUrl(NUVEM.url);
const SUPA_KEY = String(NUVEM.chave || '').trim();
const situacaoNuvem = () => avaliarNuvem(SUPA_URL, SUPA_KEY);
const nuvemConfigurada = () => situacaoNuvem() === 'ok';
const TABELA = 'comissoes_dados';
const CHAVE_SESSAO = 'comissoes-auth';
const ESPERA_ENVIO = 3000;          // junta várias mudanças num envio só
const INTERVALO_PUXAR = 5 * 60000;  // procura mudanças feitas em outro PC
const REPETIR_FALHA = 60000;        // sem internet: tenta de novo depois
const LIMITE_NUVEM = 2000000;       // mesmo limite da tabela (check no Supabase)
const TENTATIVAS = 3;               // outro PC gravou no meio do envio: mescla e tenta de novo
const DISPOSITIVO = (() => { let h = String(os.hostname() || '').slice(0, 60); while (Buffer.byteLength(h) > 100) h = h.slice(0, -1); return h; })();

class SemTempoReal { constructor() { throw new Error('tempo real desligado'); } }

const temDados = (d) => !!d && ((Array.isArray(d.clientes) && d.clientes.length > 0) || (Array.isArray(d.pedidos) && d.pedidos.length > 0));
const novoEm = (a, b) => !b || (a && new Date(a).getTime() > new Date(b).getTime());

// ---------- mescla em três vias (base = o que a nuvem tinha da última vez que este PC falou com ela) ----------
// igualdade que ignora a ordem das chaves (o jsonb da nuvem reordena)
const canon = (x) => Array.isArray(x) ? '[' + x.map(canon).join(',') + ']'
  : (x && typeof x === 'object') ? '{' + Object.keys(x).filter(k => x[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}'
  : JSON.stringify(x === undefined ? null : x);
const igual = (a, b) => canon(a) === canon(b);
const pega = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const objeto = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
// mudou de um lado só: vale esse lado | mudou dos dois: vale o local | apagado de um lado e intacto do outro: some
function escolher(b, l, n) {
  const tem = (x) => x !== undefined;
  if (tem(l) && tem(n)) return tem(b) && igual(l, b) && !igual(n, b) ? n : l;
  if (tem(l)) return tem(b) && igual(l, b) ? undefined : l;
  if (tem(n)) return tem(b) && igual(n, b) ? undefined : n;
  return undefined;
}
function mesclarChaves(b, l, n, pular = []) {
  b = objeto(b); l = objeto(l); n = objeto(n);
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(n)])) {
    if (pular.includes(k)) continue;
    const v = escolher(pega(b, k), pega(l, k), pega(n, k));
    if (v !== undefined) out[k] = v;
  }
  return out;
}
function mesclarLista(b, l, n) {
  const lista = (a) => (Array.isArray(a) ? a : []);
  const temId = (x) => !!x && typeof x === 'object' && x.id != null;
  const porId = (a) => { const m = new Map(); for (const x of lista(a)) if (temId(x) && !m.has(String(x.id))) m.set(String(x.id), x); return m; };
  const B = porId(b), L = porId(l), N = porId(n);
  const out = [];
  for (const id of [...L.keys(), ...[...N.keys()].filter(k => !L.has(k))]) {
    const vb = B.get(id), vl = L.get(id), vn = N.get(id);
    // mudou dos dois lados: junta campo a campo (no mesmo campo vale o local)
    const v = vb && vl && vn && !igual(vl, vb) && !igual(vn, vb) ? mesclarChaves(vb, vl, vn) : escolher(vb, vl, vn);
    if (v !== undefined) out.push(v);
  }
  // itens sem id (não deveria haver): ficam os daqui e os da nuvem que não existem aqui
  const soltos = lista(l).filter(x => !temId(x));
  return out.concat(soltos, lista(n).filter(x => !temId(x) && !soltos.some(y => igual(x, y))));
}
function mesclar(base, local, nuvem) {
  base = objeto(base); local = objeto(local); nuvem = objeto(nuvem);
  return {
    ...mesclarChaves(base, local, nuvem, ['config', 'clientes', 'pedidos']), // chaves de versões mais novas não se perdem
    config: mesclarChaves(base.config, local.config, nuvem.config),
    clientes: mesclarLista(base.clientes, local.clientes, nuvem.clientes),
    pedidos: mesclarLista(base.pedidos, local.pedidos, nuvem.pedidos)
  };
}

// tamanho como o Postgres mede (o jsonb volta com espaço depois de cada ':' e ',')
function tamanhoNaNuvem(texto) {
  let extra = 0, dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (dentro) { if (c === 92) i++; else if (c === 34) dentro = false; }
    else if (c === 34) dentro = true;
    else if (c === 58 || c === 44) extra++;
  }
  return Buffer.byteLength(texto) + extra;
}
const grandeDemais = () => Object.assign(new Error('dados grandes demais pra nuvem'), { code: 'payload-too-large' });

const MUITAS = 'Muitas tentativas. Espere um minuto e tente de novo.';
const JA_TEM = 'Esse e-mail já tem conta. Entre com ele.';
const EMAIL_RUIM = 'Esse e-mail não parece válido.';
const CADASTRO_OFF = 'Criar conta está desligado no momento. Fale com quem te passou o app.';
const SEM_TABELA = 'A nuvem ainda não foi preparada (falta rodar o script no Supabase).';
const GRANDE = 'Seus dados passaram do limite da nuvem (2 MB). Tudo continua salvo neste PC.';
const POR_CODIGO = {
  invalid_credentials: 'E-mail ou senha errados.',
  email_not_confirmed: 'Confirme seu e-mail primeiro: abra o link que chegou na caixa de entrada.',
  email_address_not_authorized: 'Não deu pra mandar o e-mail de confirmação pra esse endereço. Fale com quem te passou o app.',
  over_email_send_rate_limit: MUITAS, over_request_rate_limit: MUITAS,
  email_address_invalid: EMAIL_RUIM, validation_failed: EMAIL_RUIM,
  weak_password: 'Senha fraca demais. Use pelo menos 6 caracteres e evite senhas comuns.',
  user_already_exists: JA_TEM, email_exists: JA_TEM,
  signup_disabled: CADASTRO_OFF, email_provider_disabled: CADASTRO_OFF,
  42501: 'A nuvem recusou o acesso. Saia e entre de novo na conta.',
  PGRST205: SEM_TABELA, '42P01': SEM_TABELA,
  'payload-too-large': GRANDE, 23514: GRANDE
};

// o código do erro manda; o texto (em inglês) só quando não há código conhecido
function erroAmigavel(e) {
  const c = String((e && e.code) || '');
  if (c && Object.prototype.hasOwnProperty.call(POR_CODIGO, c)) return POR_CODIGO[c];
  const m = String((e && e.message) || e || '').toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha errados.';
  if (m.includes('already registered') || m.includes('already been registered')) return JA_TEM;
  if (m.includes('password should be') || m.includes('password is too')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('invalid format')) return EMAIL_RUIM;
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail primeiro: abra o link que chegou na caixa de entrada.';
  if (m.includes('rate limit') || m.includes('too many')) return MUITAS;
  if (m.includes('fetch') || m.includes('network') || m.includes('enotfound') || m.includes('econn') || m.includes('timeout')) return 'Sem conexão com a internet.';
  return 'Não deu certo: ' + ((e && e.message) || 'erro desconhecido');
}

function classificar(e) {
  const m = String((e && e.message) || e || '').toLowerCase();
  const code = String((e && e.code) || '');
  if (code === '42P01' || code === 'PGRST205' || m.includes('could not find the table') || (m.includes('relation') && m.includes('does not exist'))) return 'sem-tabela';
  if (code === 'payload-too-large' || code === '23514' || m.includes('too large')) return 'grande-demais';
  if (m.includes('fetch') || m.includes('network') || m.includes('enotfound') || m.includes('econn') || m.includes('timeout') || m.includes('socket')) return 'offline';
  return 'erro';
}

// opts.cliente / opts.tempos: só pros testes automáticos (nuvem falsa e relógio curto)
function criarConta({ dir, store, safeStorage, avisar, cliente, tempos = {} }) {
  const T = { envio: ESPERA_ENVIO, puxar: INTERVALO_PUXAR, falha: REPETIR_FALHA, sair: 8000, denovo: 1500, ...tempos };
  const arqSessao = path.join(dir, 'sessao.bin');
  const arqMeta = path.join(dir, 'conta.json');
  const arqBase = path.join(dir, 'base-nuvem.json');
  const arqPend = (id) => path.join(dir, 'pendente-' + String(id).replace(/[^a-z0-9-]/gi, '') + '.json');
  const lerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const espera = (ms) => new Promise(r => setTimeout(r, ms));

  // ---------- sessão guardada criptografada pelo Windows ----------
  const cripto = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
  let sessao = (() => {
    try { const b = fs.readFileSync(arqSessao); return JSON.parse(cripto() ? safeStorage.decryptString(b) : b.toString('utf8')) || {}; } catch { return {}; }
  })();
  const gravarSessao = () => {
    try { const t = JSON.stringify(sessao); fs.writeFileSync(arqSessao, cripto() ? safeStorage.encryptString(t) : Buffer.from(t, 'utf8')); } catch {}
  };
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(sessao, k) ? sessao[k] : null),
    setItem: (k, v) => { sessao[k] = v; gravarSessao(); },
    removeItem: (k) => { delete sessao[k]; gravarSessao(); }
  };
  const sb = typeof cliente === 'function' ? cliente(storage, CHAVE_SESSAO) : cliente || createClient(SUPA_URL, SUPA_KEY, {
    auth: { storage, storageKey: CHAVE_SESSAO, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    // o app não usa tempo real; e o Node 20 do Electron 33 não tem WebSocket nativo (a lib exige um na criação)
    realtime: { transport: SemTempoReal }
  });

  // ---------- estado da conta neste PC (não vai pra nuvem) ----------
  // donoId: de quem são os dados locais | nuvemEm: versão da nuvem que o local já contém
  // pendente: há mudança local ainda não enviada | adotar: dados sem dono esperando a pessoa dizer se são dela
  // juntar: conta que disse "são meus" e ainda não juntou com a nuvem (na primeira mescla vale o da conta)
  let meta = (() => { try { return JSON.parse(fs.readFileSync(arqMeta, 'utf8')) || {}; } catch { return {}; } })();
  const salvarMeta = () => { try { fs.writeFileSync(arqMeta, JSON.stringify(meta, null, 2)); } catch {} };

  // base-nuvem.json: o payload que a nuvem tinha na versão nuvemEm (o "antes" da mescla); só vale pra essa conta e versão
  function lerBase(uid) { const b = lerJson(arqBase); return b && b.donoId === uid && b.nuvemEm === meta.nuvemEm ? b.dados : null; }
  function gravarBase(uid, nuvemEm, texto) {
    try {
      if (texto) fs.writeFileSync(arqBase, '{"donoId":' + JSON.stringify(uid) + ',"nuvemEm":' + JSON.stringify(nuvemEm) + ',"dados":' + texto + '}');
      else fs.rmSync(arqBase, { force: true });
    } catch {}
  }

  let usuario = null;
  let status = 'desconectado'; // ok | enviando | offline | erro | sem-tabela | grande-demais | desconectado
  let erroMsg = '';
  let mudancas = 0, sujoEm = 0;
  let timerEnvio = null, intervalo = null;
  // geracao muda a cada entrada/saída de conta: resposta que chega depois da troca é ignorada
  let geracao = 0, enviando = false, envioG = -1, deNovo = false, envioAtual = Promise.resolve(true);
  const ocupado = () => enviando && envioG === geracao;
  const daConta = () => !!usuario && meta.donoId === usuario.id && !meta.adotar; // os dados locais são desta conta
  const sujo = () => Date.now() - sujoEm < 2000; // a tela avisou que tem gravação a caminho
  const podeUsarLocal = () => !usuario && (!meta.donoId || !!meta.adotar);

  function estado() {
    const md = (usuario && usuario.user_metadata) || {};
    const d = store.get() || {};
    return {
      logado: !!usuario,
      email: (usuario && usuario.email) || '',
      nome: md.nome || '',
      // dados deste PC que nenhuma conta assumiu: a tela pergunta antes de subir
      adotar: usuario && meta.adotar ? { clientes: (d.clientes || []).length, pedidos: (d.pedidos || []).length } : null,
      podeUsarLocal: podeUsarLocal(),
      sync: { status, pendente: !!meta.pendente, ultimo: meta.ultimoEnvio || meta.nuvemEm || '', erro: erroMsg }
    };
  }
  const emitir = () => avisar('conta:estado', estado());
  const falhou = (e) => { status = classificar(e); erroMsg = erroAmigavel(e); };

  async function baixar(soData, uid) {
    const { data, error } = await sb.from(TABELA).select(soData ? 'atualizado_em' : 'payload, atualizado_em').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // grava só se a nuvem ainda está na versão que o local conhece; null = outro PC gravou no meio
  async function gravar(uid, payload) {
    if (meta.nuvemEm) {
      const { data, error } = await sb.from(TABELA).update({ payload, dispositivo: DISPOSITIVO })
        .eq('user_id', uid).eq('atualizado_em', meta.nuvemEm).select('atualizado_em');
      if (error) throw error;
      return (data && data[0]) || null;
    }
    const { data, error } = await sb.from(TABELA).insert({ user_id: uid, payload, dispositivo: DISPOSITIVO }).select('atualizado_em').single();
    if (error) { if (error.code === '23505') return null; throw error; }
    return data;
  }

  // troca os dados locais pelos da nuvem (sempre guardando uma cópia antes)
  function aplicarNuvem(linha, motivo, uid) {
    if (temDados(store.get())) store.snapshot(motivo);
    store.set(linha.payload || {});
    meta.nuvemEm = linha.atualizado_em; meta.pendente = false; salvarMeta();
    gravarBase(uid, linha.atualizado_em, JSON.stringify(linha.payload || {}));
    avisar('dados:recarregar');
  }
  // a nuvem mudou e há mudança local: junta os dois (cópia antes) e a base vira essa versão da nuvem
  function mesclarNuvem(linha, uid, base) {
    const local = store.get();
    // adotando (sem base): no que os dois lados têm vale o da conta; a cópia deste PC fica no backup
    const junto = meta.juntar === uid ? mesclar({}, linha.payload || {}, local) : mesclar(base || {}, local, linha.payload || {});
    meta.juntar = '';
    if (!igual(junto, local)) { store.snapshot('conflito-mesclado'); store.set(junto); avisar('dados:recarregar'); }
    meta.nuvemEm = linha.atualizado_em; salvarMeta();
    gravarBase(uid, linha.atualizado_em, JSON.stringify(linha.payload || {}));
  }
  // dados locais de outra conta (ou recusados): guarda e começa limpo (nada vaza entre contas)
  function comecarLimpo(motivo) {
    if (temDados(store.get())) store.snapshot(motivo);
    store.set({ config: {}, clientes: [], pedidos: [] });
    meta.nuvemEm = ''; meta.pendente = false; salvarMeta();
    gravarBase('', '', null);
    avisar('dados:recarregar');
  }
  // o que uma conta não enviou fica guardado quando outra entra; volta quando ela entrar de novo
  function guardarPendente(id) {
    try { fs.writeFileSync(arqPend(id), JSON.stringify({ dados: store.get(), nuvemEm: meta.nuvemEm || '', base: lerBase(id), juntar: meta.juntar === id })); } catch {}
  }
  function restaurarPendente(volta, uid) {
    if (temDados(store.get())) store.snapshot('outra-conta');
    store.set(volta.dados);
    meta.nuvemEm = volta.nuvemEm || ''; meta.pendente = true; meta.juntar = volta.juntar ? uid : ''; salvarMeta();
    gravarBase(uid, meta.nuvemEm, volta.base ? JSON.stringify(volta.base) : null);
    try { fs.rmSync(arqPend(uid), { force: true }); } catch {}
    avisar('dados:recarregar');
    agendar(500); // sobe mesclando com o que mudou na nuvem enquanto isso
  }

  function agendar(ms) { clearTimeout(timerEnvio); timerEnvio = setTimeout(() => { enviar(); }, ms); }

  // chamado depois de cada gravação feita pela tela; sujoAgora = a tela avisou que vai gravar (ainda no atraso de 150 ms)
  function marcarMudanca(sujoAgora) {
    mudancas++;
    sujoEm = sujoAgora ? Date.now() : 0;
    if (!meta.pendente) { meta.pendente = true; salvarMeta(); }
    if (usuario) agendar(T.envio);
  }

  // um envio por vez; quem chama durante um envio recebe a mesma promessa (e outro envio vem logo depois)
  function enviar() {
    if (!daConta() || !meta.pendente) return Promise.resolve(true);
    if (ocupado()) { deNovo = true; return envioAtual; }
    if (sujo()) { agendar(T.envio); return Promise.resolve(false); } // a gravação da tela chega já já
    envioAtual = enviarAgora();
    return envioAtual;
  }

  async function enviarAgora() {
    const g = geracao, uid = usuario.id, n = mudancas;
    enviando = true; envioG = g; status = 'enviando'; emitir();
    let ok = false, depois = 0; // depois: ms até tentar de novo (0 = só na próxima mudança)
    try {
      if (tamanhoNaNuvem(JSON.stringify(store.get())) > LIMITE_NUVEM) throw grandeDemais();
      for (let t = 1; ; t++) {
        // o que a nuvem tem agora: na primeira vez tudo; depois só a data (e tudo se outro PC mudou)
        let linha = null, base = null;
        if (!meta.nuvemEm) {
          linha = await baixar(false, uid); if (g !== geracao) return false;
          base = {};                                          // primeira vez com dados dos dois lados: junta, nada se perde
        } else {
          const r = await baixar(true, uid); if (g !== geracao) return false;
          if (!r) meta.nuvemEm = '';                          // a linha sumiu da nuvem: cria de novo
          else if (r.atualizado_em !== meta.nuvemEm) {
            linha = await baixar(false, uid); if (g !== geracao) return false;
            base = lerBase(uid);
          }
        }
        if (linha) {
          if (sujo()) { depois = T.envio; return false; }    // a tela tem gravação a caminho: mescla depois dela
          mesclarNuvem(linha, uid, base);
        }
        const payload = store.get();
        const texto = JSON.stringify(payload);
        if (tamanhoNaNuvem(texto) > LIMITE_NUVEM) throw grandeDemais();
        const feito = await gravar(uid, payload); if (g !== geracao) return false;
        if (!feito) {
          if (t >= TENTATIVAS) throw new Error('a nuvem mudou várias vezes durante o envio');
          continue;                                           // outro PC gravou entre a conferência e a gravação
        }
        meta.juntar = ''; meta.nuvemEm = feito.atualizado_em; meta.ultimoEnvio = new Date().toISOString();
        if (mudancas === n) meta.pendente = false;
        salvarMeta(); gravarBase(uid, feito.atualizado_em, texto);
        status = 'ok'; erroMsg = ''; ok = true;
        return true;
      }
    } catch (e) {
      if (g !== geracao) return false;
      falhou(e);
      // grande demais não adianta repetir: tenta de novo só quando algo mudar
      depois = status === 'grande-demais' ? 0 : status === 'sem-tabela' ? 5 * T.falha : T.falha;
      return false;
    } finally {
      if (envioG === g) enviando = false;
      if (g === geracao) {
        emitir();
        if (ok && (deNovo || meta.pendente)) depois = T.denovo;
        deNovo = false;
        if (depois) agendar(depois);
      } else if (daConta() && meta.pendente) agendar(T.envio); // a conta trocou no meio: a de agora manda o dela
    }
  }

  // traz mudanças feitas em outro PC (só quando não há nada local por enviar)
  async function puxar() {
    if (!daConta() || meta.pendente || ocupado()) return;
    const g = geracao, uid = usuario.id;
    try {
      const r = await baixar(true, uid); if (g !== geracao) return;
      status = 'ok'; erroMsg = '';
      if (r && novoEm(r.atualizado_em, meta.nuvemEm)) {
        const linha = await baixar(false, uid); if (g !== geracao) return;
        if (linha && !meta.pendente && !ocupado()) aplicarNuvem(linha, 'antes-de-baixar-da-nuvem', uid);
      }
    } catch (e) { if (g !== geracao) return; falhou(e); }
    emitir();
  }

  // liga os dados deste PC à conta que acabou de entrar
  async function vincular(user) {
    const g = ++geracao;
    clearTimeout(timerEnvio); deNovo = false;
    usuario = user;
    let linha = null, online = true;
    try { linha = await baixar(false, user.id); status = 'ok'; erroMsg = ''; } catch (e) { falhou(e); online = false; }
    if (g !== geracao) return;
    const local = store.get();
    const semDono = !meta.donoId || !!meta.adotar; // nenhuma conta assumiu os dados deste PC
    if (!semDono && meta.donoId !== user.id) {
      // outra conta estava neste PC: guarda o que ela não enviou e usa os desta conta
      if (meta.pendente) guardarPendente(meta.donoId);
      const volta = lerJson(arqPend(user.id));
      const solto = volta ? null : lerJson(arqPend('sem-dono')); // alguém disse "não são meus": pergunta pra esta conta
      if (volta && volta.dados) restaurarPendente(volta, user.id);
      else if (solto && temDados(solto.dados) && !(solto.recusaram || []).includes(user.id)) { // quem já recusou não é perguntado de novo
        if (temDados(store.get())) store.snapshot('outra-conta');
        store.set(solto.dados); meta.nuvemEm = ''; meta.pendente = false; meta.adotar = true; gravarBase('', '', null);
        avisar('dados:recarregar');
      }
      else if (online && linha) aplicarNuvem(linha, 'outra-conta', user.id);
      else comecarLimpo('outra-conta');
    } else if (semDono) {
      if (temDados(local)) meta.adotar = true;            // não sobe sem a pessoa dizer que são dela
      else { meta.adotar = false; if (online && linha) aplicarNuvem(linha, 'antes-de-baixar-da-nuvem', user.id); }
    } else if (online) {
      if (linha) {
        // mudou aqui e na nuvem: junta (se a tela tem gravação a caminho, o envio mescla depois)
        if (meta.pendente) { if (linha.atualizado_em !== meta.nuvemEm && !sujo()) mesclarNuvem(linha, user.id, meta.nuvemEm ? lerBase(user.id) : {}); agendar(500); }
        else if (novoEm(linha.atualizado_em, meta.nuvemEm)) aplicarNuvem(linha, 'antes-de-baixar-da-nuvem', user.id);
      } else if (temDados(local) || meta.pendente) { meta.pendente = true; agendar(300); } // a conta ainda não tem linha na nuvem
    } else if (meta.pendente) {
      agendar(T.falha);
    }
    meta.donoId = user.id; meta.email = user.email || ''; salvarMeta();
    emitir();
  }

  async function iniciar() {
    // logado na hora pela sessão guardada (a tela não espera a internet); sem internet ela continua valendo
    let guardado = null;
    try { const s = JSON.parse(storage.getItem(CHAVE_SESSAO) || 'null'); guardado = (s && s.user) || null; } catch {}
    if (guardado && (!meta.donoId || meta.donoId === guardado.id)) usuario = guardado;
    let user = null;
    try { const { data } = await sb.auth.getSession(); user = (data && data.session && data.session.user) || null; } catch {}
    // sem internet a biblioteca mantém a sessão guardada; revogada ou vencida ela apaga, e a pessoa entra de novo
    if (!user && storage.getItem(CHAVE_SESSAO)) user = guardado;
    if (user) await vincular(user); else { usuario = null; status = 'desconectado'; emitir(); }
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === 'SIGNED_OUT') { usuario = null; status = 'desconectado'; emitir(); }
      else if (s && s.user && usuario) usuario = s.user;
    });
    intervalo = setInterval(() => { if (usuario && !meta.pendente) puxar(); }, T.puxar);
  }

  const falhaAoEntrar = (e) => ({ ok: false, erro: erroAmigavel(e), semConexao: classificar(e) === 'offline', podeUsarLocal: podeUsarLocal() });

  async function entrar(email, senha) {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(senha || '') });
      if (error) throw error;
      await vincular(data.user);
      return { ok: true, estado: estado() };
    } catch (e) { return falhaAoEntrar(e); }
  }

  async function criar(email, senha, nome) {
    email = String(email || '').trim(); nome = String(nome || '').trim();
    try {
      const { data, error } = await sb.auth.signUp({ email, password: String(senha || ''), options: { data: { nome: nome || email.split('@')[0], usuario: nome || email.split('@')[0] } } });
      if (error) throw error;
      // e-mail já cadastrado (o Supabase não diz direto, por segurança)
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { ok: false, erro: JA_TEM };
      if (!data.session) return { ok: true, precisaConfirmar: true };
      await vincular(data.user);
      return { ok: true, estado: estado() };
    } catch (e) { return falhaAoEntrar(e); }
  }

  // a pessoa respondeu se os dados sem dono deste PC são dela
  async function adotar(sim) {
    if (!usuario || !meta.adotar) return estado();
    meta.adotar = false;
    if (sim) {
      try { fs.rmSync(arqPend('sem-dono'), { force: true }); } catch {}
      meta.nuvemEm = ''; meta.pendente = true; meta.juntar = usuario.id; salvarMeta(); gravarBase('', '', null);
      enviar(); // sobe juntando com o que a conta já tiver na nuvem
    } else {
      // a próxima conta é perguntada de novo (fica até alguém dizer "são meus"; quem recusou não é perguntado outra vez)
      try { const s = lerJson(arqPend('sem-dono')); fs.writeFileSync(arqPend('sem-dono'), JSON.stringify({ dados: store.get(), recusaram: [...new Set([...((s && s.recusaram) || []), usuario.id])] })); } catch {}
      comecarLimpo('antes-de-comecar-vazio');
      puxar(); // e traz o que a conta já tem
    }
    emitir();
    return estado();
  }

  async function sair() {
    clearTimeout(timerEnvio);
    // espera o envio que já está indo e manda o que faltou (com limite de tempo)
    await Promise.race([envioAtual, espera(T.sair)]);
    if (daConta() && meta.pendente) await Promise.race([enviar(), espera(T.sair)]);
    const ficouPendente = daConta() && !!meta.pendente;
    geracao++; // resposta atrasada desta conta não vale mais
    clearTimeout(timerEnvio);
    try { await sb.auth.signOut({ scope: 'local' }); } catch {}
    sessao = {}; gravarSessao();
    usuario = null; status = 'desconectado'; erroMsg = '';
    emitir();
    return { ok: true, ficouPendente };
  }

  async function sincronizar() {
    if (!usuario) return estado();
    if (meta.pendente) await enviar(); else await puxar();
    return estado();
  }

  // ao fechar o app: espera o envio em andamento e manda o que faltou (com limite de tempo)
  async function antesDeFechar(limiteMs = 4000) {
    if (!daConta() || !meta.pendente) return;
    clearTimeout(timerEnvio);
    await Promise.race([envioAtual.then(() => enviar()), espera(limiteMs)]);
  }

  const parar = () => { clearTimeout(timerEnvio); clearInterval(intervalo); };
  return { iniciar, estado, entrar, criar, adotar, sair, sincronizar, puxar, marcarMudanca, antesDeFechar, parar, precisaEnviar: () => daConta() && !!meta.pendente };
}

module.exports = { criarConta, nuvemConfigurada, situacaoNuvem, avaliarNuvem, mesclar, erroAmigavel };
