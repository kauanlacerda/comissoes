// Conta e sincronização com a nuvem (Supabase), no processo principal.
// Senha, sessão e rede nunca passam pela tela. O app SEMPRE funciona offline;
// a nuvem é um espelho: cada conta tem uma linha (payload = o mesmo JSON do arquivo local).
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Projeto Supabase em nuvem.json (url + chave 'anon', que é pública por definição; quem protege os dados é o RLS)
const NUVEM = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'nuvem.json'), 'utf8')); } catch { return {}; } })();
const SUPA_URL = String(NUVEM.url || '').trim();
const SUPA_KEY = String(NUVEM.chave || '').trim();
const nuvemConfigurada = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPA_URL) && SUPA_KEY.length > 20;
const TABELA = 'comissoes_dados';
const CHAVE_SESSAO = 'comissoes-auth';
const ESPERA_ENVIO = 3000;          // junta várias mudanças num envio só
const INTERVALO_PUXAR = 5 * 60000;  // procura mudanças feitas em outro PC
const REPETIR_FALHA = 60000;        // sem internet: tenta de novo depois

class SemTempoReal { constructor() { throw new Error('tempo real desligado'); } }

const temDados = (d) => !!d && ((Array.isArray(d.clientes) && d.clientes.length > 0) || (Array.isArray(d.pedidos) && d.pedidos.length > 0));
const novoEm = (a, b) => !b || (a && new Date(a).getTime() > new Date(b).getTime());

function erroAmigavel(e) {
  const m = String((e && e.message) || e || '').toLowerCase();
  if (m.includes('invalid login')) return 'E-mail ou senha errados.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Esse e-mail já tem conta. Entre com ele.';
  if (m.includes('password should be') || m.includes('password is too')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('invalid format')) return 'Esse e-mail não parece válido.';
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail primeiro: abra o link que chegou na caixa de entrada.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere um pouco e tente de novo.';
  if (m.includes('fetch') || m.includes('network') || m.includes('enotfound') || m.includes('econn') || m.includes('timeout')) return 'Sem conexão com a internet.';
  return 'Não deu certo: ' + ((e && e.message) || 'erro desconhecido');
}

function classificar(e) {
  const m = String((e && e.message) || e || '').toLowerCase();
  const code = (e && e.code) || '';
  if (code === '42P01' || code === 'PGRST205' || m.includes('could not find the table') || (m.includes('relation') && m.includes('does not exist'))) return 'sem-tabela';
  if (m.includes('fetch') || m.includes('network') || m.includes('enotfound') || m.includes('econn') || m.includes('timeout') || m.includes('socket')) return 'offline';
  return 'erro';
}

// opts.cliente / opts.tempos: só pros testes automáticos (nuvem falsa e relógio curto)
function criarConta({ dir, store, safeStorage, avisar, cliente, tempos = {} }) {
  const T = { envio: ESPERA_ENVIO, puxar: INTERVALO_PUXAR, falha: REPETIR_FALHA, ...tempos };
  const arqSessao = path.join(dir, 'sessao.bin');
  const arqMeta = path.join(dir, 'conta.json');

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
  // pendente: há mudança local ainda não enviada
  let meta = (() => { try { return JSON.parse(fs.readFileSync(arqMeta, 'utf8')) || {}; } catch { return {}; } })();
  const salvarMeta = () => { try { fs.writeFileSync(arqMeta, JSON.stringify(meta, null, 2)); } catch {} };

  let usuario = null;
  let status = 'desconectado'; // ok | enviando | offline | erro | sem-tabela | desconectado
  let erroMsg = '';
  let mudancas = 0;
  let timerEnvio = null, enviando = false, deNovo = false, intervalo = null;

  function estado() {
    const md = (usuario && usuario.user_metadata) || {};
    return {
      logado: !!usuario,
      email: (usuario && usuario.email) || '',
      nome: md.nome || '',
      sync: { status, pendente: !!meta.pendente, ultimo: meta.ultimoEnvio || meta.nuvemEm || '', erro: erroMsg }
    };
  }
  const emitir = () => avisar('conta:estado', estado());
  const falhou = (e) => { status = classificar(e); erroMsg = String((e && e.message) || e || ''); };

  async function baixar(soData) {
    const { data, error } = await sb.from(TABELA).select(soData ? 'atualizado_em' : 'payload, atualizado_em').eq('user_id', usuario.id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // troca os dados locais pelos da nuvem (sempre guardando uma cópia antes)
  function aplicarNuvem(linha, motivo) {
    if (temDados(store.get())) store.snapshot(motivo);
    store.set(linha.payload || {});
    meta.nuvemEm = linha.atualizado_em; meta.pendente = false; salvarMeta();
    avisar('dados:recarregar');
  }
  // dados locais de outra conta: guarda e começa limpo (nada vaza entre contas)
  function comecarLimpo() {
    if (temDados(store.get())) store.snapshot('outra-conta');
    store.set({ config: {}, clientes: [], pedidos: [] });
    meta.nuvemEm = ''; meta.pendente = false; salvarMeta();
    avisar('dados:recarregar');
  }

  function agendar(ms) { clearTimeout(timerEnvio); timerEnvio = setTimeout(() => { enviar(); }, ms); }

  // chamado depois de cada gravação feita pela tela
  function marcarMudanca() {
    mudancas++;
    meta.pendente = true; salvarMeta();
    if (usuario) agendar(T.envio);
  }

  async function enviar() {
    if (!usuario || !meta.pendente) return true;
    if (enviando) { deNovo = true; return false; }
    enviando = true; status = 'enviando'; emitir();
    const n = mudancas;
    let ok = false;
    try {
      // nunca sincronizou essa conta daqui: se a nuvem já tem dados, eles mandam (o local vira cópia de segurança)
      if (!meta.nuvemEm) {
        const linha = await baixar(false);
        if (linha && temDados(linha.payload)) {
          aplicarNuvem(linha, 'conflito-antes-de-enviar');
          status = 'ok'; erroMsg = ''; ok = true;
          return true;
        }
      }
      const { data, error } = await sb.from(TABELA)
        .upsert({ user_id: usuario.id, payload: store.get(), dispositivo: os.hostname() }, { onConflict: 'user_id' })
        .select('atualizado_em').single();
      if (error) throw error;
      meta.nuvemEm = data.atualizado_em; meta.ultimoEnvio = new Date().toISOString();
      if (mudancas === n) meta.pendente = false;
      salvarMeta(); status = 'ok'; erroMsg = ''; ok = true;
    } catch (e) {
      falhou(e);
      agendar(status === 'sem-tabela' ? 5 * T.falha : T.falha); // tenta de novo mais tarde
    } finally {
      enviando = false; emitir();
      if (ok && (deNovo || meta.pendente)) { deNovo = false; agendar(1500); }
    }
    return ok;
  }

  // traz mudanças feitas em outro PC (só quando não há nada local por enviar)
  async function puxar() {
    if (!usuario || meta.pendente || enviando) return;
    try {
      const r = await baixar(true);
      status = 'ok'; erroMsg = '';
      if (r && novoEm(r.atualizado_em, meta.nuvemEm)) {
        const linha = await baixar(false);
        if (linha && !meta.pendente && !enviando) aplicarNuvem(linha, 'antes-de-baixar-da-nuvem');
      }
    } catch (e) { falhou(e); }
    emitir();
  }

  // liga os dados deste PC à conta que acabou de entrar
  async function vincular(user) {
    usuario = user;
    const outroDono = !!meta.donoId && meta.donoId !== user.id;
    let linha = null, online = true;
    try { linha = await baixar(false); status = 'ok'; erroMsg = ''; } catch (e) { falhou(e); online = false; }
    const local = store.get();
    if (outroDono) {
      // outra conta estava neste PC: guarda os dados dela e usa os desta conta
      if (online && linha && temDados(linha.payload)) aplicarNuvem(linha, 'outra-conta');
      else comecarLimpo();
    } else if (online) {
      if (linha && temDados(linha.payload)) {
        const mesmoDono = meta.donoId === user.id;
        if (mesmoDono && meta.pendente && temDados(local)) agendar(500);               // mudanças daqui ainda não enviadas: o local vence
        else if (!mesmoDono || !temDados(local) || novoEm(linha.atualizado_em, meta.nuvemEm)) aplicarNuvem(linha, 'antes-de-baixar-da-nuvem');
      } else if (temDados(local)) {
        meta.pendente = true; agendar(300);                                                 // primeira vez: sobe o que já está no PC
      }
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
    if (!user) user = guardado;
    if (user) await vincular(user); else { status = 'desconectado'; emitir(); }
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === 'SIGNED_OUT') { usuario = null; status = 'desconectado'; emitir(); }
      else if (s && s.user && usuario) usuario = s.user;
    });
    intervalo = setInterval(() => { if (usuario && !meta.pendente) puxar(); }, T.puxar);
  }

  async function entrar(email, senha) {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(senha || '') });
      if (error) throw error;
      await vincular(data.user);
      return { ok: true, estado: estado() };
    } catch (e) { return { ok: false, erro: erroAmigavel(e) }; }
  }

  async function criar(email, senha, nome) {
    email = String(email || '').trim(); nome = String(nome || '').trim();
    try {
      const { data, error } = await sb.auth.signUp({ email, password: String(senha || ''), options: { data: { nome: nome || email.split('@')[0], usuario: nome || email.split('@')[0] } } });
      if (error) throw error;
      // e-mail já cadastrado (o Supabase não diz direto, por segurança)
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { ok: false, erro: 'Esse e-mail já tem conta. Entre com ele.' };
      if (!data.session) return { ok: true, precisaConfirmar: true };
      await vincular(data.user);
      return { ok: true, estado: estado() };
    } catch (e) { return { ok: false, erro: erroAmigavel(e) }; }
  }

  async function sair() {
    if (meta.pendente) await enviar();
    const ficouPendente = !!meta.pendente;
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

  // ao fechar o app: tenta mandar o que faltou (com limite de tempo)
  async function antesDeFechar(limiteMs = 4000) {
    if (!usuario || !meta.pendente) return;
    clearTimeout(timerEnvio);
    await Promise.race([enviar(), new Promise(r => setTimeout(r, limiteMs))]);
  }

  const parar = () => { clearTimeout(timerEnvio); clearInterval(intervalo); };
  return { iniciar, estado, entrar, criar, sair, sincronizar, puxar, marcarMudanca, antesDeFechar, parar, precisaEnviar: () => !!(usuario && meta.pendente) };
}

module.exports = { criarConta, nuvemConfigurada };
