// Núcleo: estado, persistência, regras de negócio e navegação.
// Telas leem App.estado e mudam dados SÓ via App.acoes.* (ver docs/CONTRATO.md).
(function () {
  const App = window.App = {};
  const esc = UI.esc;

  // ---------- API (Electron) ou simulação no navegador ----------
  App.noApp = !!window.api;
  App.api = window.api || criarApiSimulada();

  // ---------- Constantes ----------
  App.ETAPAS = [
    { id: 'aceito', rotulo: 'Aceito' },
    { id: 'comecado', rotulo: 'Começado' },
    { id: 'entregue', rotulo: 'Entregue' },
    { id: 'aprovado', rotulo: 'Aprovado' },
    { id: 'pago', rotulo: 'Pago' }
  ];
  App.GRUPOS = [
    { id: 'aceitos', rotulo: 'Aceitos', cor: 'var(--azul-texto)', etapa: 'aceito' },
    { id: 'producao', rotulo: 'Em produção', cor: 'var(--amarelo)', etapa: 'comecado' },
    { id: 'entregues', rotulo: 'Entregues', cor: 'var(--verde)', etapa: 'entregue' },
    { id: 'aguardando', rotulo: 'Aguardando pagamento', cor: 'var(--mudo)', etapa: 'aprovado' },
    { id: 'concluidos', rotulo: 'Concluídos', cor: 'var(--apagado)', etapa: 'pago' }
  ];
  App.MOEDAS = ['Robux', 'R$', 'US$'];
  const CONFIG_PADRAO = {
    tema: 'cube', nome: '', vagas: 3, ocupado: false, prazoAlertaDias: 2, moedaPadrao: 'Robux',
    linkGamepass: '', msgGamepass: 'Pode comprar o gamepass de {valor} quando puder: {link}', lateralRecolhida: false
  };

  // ---------- Estado ----------
  App.estado = { config: { ...CONFIG_PADRAO }, clientes: [], pedidos: [] };
  App.rota = { tela: 'dashboard', id: null };
  const ouvintes = [];
  App.ouvir = (fn) => ouvintes.push(fn);
  const emitir = () => ouvintes.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

  App.carregar = async () => {
    const d = await App.api.dados.ler();
    App.estado = normalizar(d);
    if (!App.noApp && new URLSearchParams(location.search).has('semente') && !App.estado.clientes.length) semear();
    aplicarTema();
  };

  function normalizar(d) {
    const e = d && typeof d === 'object' ? d : {};
    const ehObjeto = (o) => o && typeof o === 'object' && !Array.isArray(o);
    // config vinda de arquivo/backup: força tipos e limites (nada de string virando HTML)
    const cfg = { ...CONFIG_PADRAO, ...(ehObjeto(e.config) ? e.config : {}) };
    cfg.vagas = Math.max(1, Math.min(10, parseInt(cfg.vagas, 10) || 3));
    const pz = parseInt(cfg.prazoAlertaDias, 10);
    cfg.prazoAlertaDias = Number.isFinite(pz) ? Math.max(0, Math.min(14, pz)) : 2;
    if (!App.MOEDAS.includes(cfg.moedaPadrao)) cfg.moedaPadrao = 'Robux';
    cfg.tema = cfg.tema === 'of' ? 'of' : 'cube';
    cfg.ocupado = !!cfg.ocupado; cfg.lateralRecolhida = !!cfg.lateralRecolhida;
    ['nome', 'linkGamepass', 'msgGamepass'].forEach(k => { if (typeof cfg[k] !== 'string') cfg[k] = CONFIG_PADRAO[k]; });
    return {
      config: cfg,
      clientes: (Array.isArray(e.clientes) ? e.clientes : []).filter(ehObjeto).map(c => ({
        id: c.id || uid(), criadoEm: c.criadoEm || agoraISO(), nome: c.nome || c.globalName || c.username || 'Cliente',
        discordId: c.discordId || '', username: c.username || '', globalName: c.globalName || '', avatar: c.avatar || '',
        corPerfil: c.corPerfil || '', contaCriada: c.contaCriada || '', atualizadoEm: c.atualizadoEm || '',
        roblox: c.roblox || null, conversa: c.conversa && c.conversa.estado ? c.conversa : { estado: 'respondido', desde: agoraISO() },
        notas: c.notas || '', pagaVia: c.pagaVia || ''
      })),
      pedidos: (Array.isArray(e.pedidos) ? e.pedidos : []).filter(ehObjeto).map(p => {
        const qtd = Math.max(1, Math.min(12, parseInt(p.qtd, 10) || 1));
        const entregas = Array.from({ length: qtd }, (_, i) => (p.entregas && p.entregas[i]) || null);
        return {
          id: p.id || uid(), criadoEm: p.criadoEm || agoraISO(), clienteId: p.clienteId || '', titulo: p.titulo || 'Pedido', jogo: p.jogo || '',
          qtd, etapa: App.ETAPAS.some(x => x.id === p.etapa) ? p.etapa : 'aceito', valor: +p.valor || 0, moeda: App.MOEDAS.includes(p.moeda) ? p.moeda : 'Robux',
          recebido: +p.recebido || 0, prazo: p.prazo || '', rodada: Math.max(1, parseInt(p.rodada, 10) || 1), ajustes: Array.isArray(p.ajustes) ? p.ajustes : [],
          entregas, notas: p.notas || '', etapaEm: p.etapaEm || {}, concluidoEm: p.concluidoEm || ''
        };
      })
    };
  }

  // ---------- Persistência ----------
  let timerSalvar = null;
  const salvar = () => {
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(() => {
      Promise.resolve(App.api.dados.salvar(App.estado)).catch(() => UI.toast('Não deu pra salvar os dados.', 'erro'));
    }, 150);
  };
  window.addEventListener('beforeunload', () => { if (timerSalvar) { clearTimeout(timerSalvar); App.api.dados.salvar(App.estado); } });

  // App.mudar(fn, { render: false }) — muda o estado, salva e redesenha (a menos que render:false)
  App.mudar = (fn, opts = {}) => {
    const r = fn(App.estado);
    salvar();
    if (opts.render !== false) emitir();
    return r;
  };
  App.substituirEstado = (novo) => { App.estado = normalizar(novo); aplicarTema(); salvar(); emitir(); };
  App.redesenhar = () => emitir();

  // ---------- Navegação ----------
  // App.ir('pedidos', pedidoId, { grupo: 'producao' }) — extra vai junto na rota
  App.ir = (tela, id = null, extra = {}) => { App.rota = { tela, id, ...extra }; UI.fecharMenu(); emitir(); const a = document.getElementById('area'); if (a) a.scrollTop = 0; };
  App.telas = {};   // cada tela se registra aqui (ver docs/CONTRATO.md)
  App.modais = {};  // modais compartilhados (novoCliente, novoPedido, ...)

  // ---------- Tema ----------
  function aplicarTema() {
    const t = App.estado.config.tema === 'of' ? 'of' : 'cube';
    document.documentElement.dataset.tema = t;
    try { App.api.janela.tema(t); } catch {}
  }
  App.definirTema = (t) => { App.mudar(e => { e.config.tema = t === 'of' ? 'of' : 'cube'; }, { render: false }); aplicarTema(); emitir(); };

  // ---------- Utilidades ----------
  function uid() { return (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)); }
  function agoraISO() { return new Date().toISOString(); }
  App.uid = uid;
  App.agoraISO = agoraISO;
  const pad = (n) => String(n).padStart(2, '0');
  App.hoje = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  App.paraData = (ymd) => { if (!ymd) return null; const [a, m, d] = ymd.split('-').map(Number); return new Date(a, m - 1, d); };
  App.diasAte = (ymd) => { const d = App.paraData(ymd); if (!d) return null; const h = App.paraData(App.hoje()); return Math.round((d - h) / 86400000); };
  const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const SEM_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  App.MES_LONGO = MES_LONGO;
  App.SEM = SEM;
  // 'dom, 11'
  App.fmtDia = (ymd) => { const d = App.paraData(ymd); return d ? `${SEM[d.getDay()]}, ${d.getDate()}` : ''; };
  // 'domingo, 11'
  App.fmtDiaLongo = (ymd) => { const d = App.paraData(ymd); return d ? `${SEM_LONGO[d.getDay()]}, ${d.getDate()}` : ''; };
  // '9 de outubro de 2026'
  App.fmtDataLonga = (d = new Date()) => `${d.getDate()} de ${MES_LONGO[d.getMonth()]} de ${d.getFullYear()}`;
  // '24 fev 2017'
  App.fmtDataCurta = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`; };
  // 'ago 2026'
  App.fmtMesAno = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${MES[d.getMonth()]} ${d.getFullYear()}`; };
  // 'em 2 dias' / 'hoje' / 'amanhã' / 'atrasado 3 dias'
  App.fmtPrazoRel = (ymd) => {
    const n = App.diasAte(ymd); if (n == null) return 'sem prazo';
    if (n === 0) return 'hoje'; if (n === 1) return 'amanhã'; if (n > 1) return `em ${n} dias`;
    return n === -1 ? 'atrasado 1 dia' : `atrasado ${-n} dias`;
  };
  // 'há 3 h' / 'há 48 min' / 'agora'
  App.fmtHa = (iso) => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    const d = Math.floor(s / 86400); return d === 1 ? 'há 1 dia' : `há ${d} dias`;
  };
  App.anos = (iso) => { if (!iso) return ''; const a = Math.floor((Date.now() - new Date(iso).getTime()) / (365.25 * 86400000)); return a <= 0 ? 'menos de 1 ano' : a === 1 ? '1 ano' : `${a} anos`; };
  App.dataDoSnowflake = (id) => { try { return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString(); } catch { return ''; } };
  App.fmtNum = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  // '4.800 Robux' | 'R$ 90' | 'R$ 12,50' | 'US$ 10'
  App.fmtValor = (valor, moeda = 'Robux') => {
    const n = Number(valor || 0);
    if (moeda === 'Robux') return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} Robux`;
    const txt = n.toLocaleString('pt-BR', Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${moeda} ${txt}`;
  };
  App.saudacao = () => { const h = new Date().getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

  // ---------- Seletores ----------
  App.cliente = (id) => App.estado.clientes.find(c => c.id === id) || null;
  App.pedido = (id) => App.estado.pedidos.find(p => p.id === id) || null;
  App.pedidosDoCliente = (id) => App.estado.pedidos.filter(p => p.clienteId === id).sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
  App.ativo = (p) => p.etapa !== 'pago';
  App.pedidosAtivos = () => App.estado.pedidos.filter(App.ativo);
  App.indiceEtapa = (etapa) => App.ETAPAS.findIndex(e => e.id === etapa);
  App.rotuloEtapa = (etapa) => (App.ETAPAS.find(e => e.id === etapa) || {}).rotulo || '';
  App.grupoDe = (p) => (App.GRUPOS.find(g => g.etapa === p.etapa) || App.GRUPOS[0]);
  // pagamento: { chave: 'sem'|'nao'|'metade'|'parcial'|'pago', rotulo, tipo (classe de pill) }
  App.pagamento = (p) => {
    const v = +p.valor || 0, r = +p.recebido || 0;
    if (v <= 0) return { chave: 'sem', rotulo: 'Sem valor', tipo: 'neutra' };
    if (r >= v) return { chave: 'pago', rotulo: 'Pago', tipo: 'verde' };
    if (r <= 0) return { chave: 'nao', rotulo: 'Não pago', tipo: 'neutra' };
    // em Robux a "metade" é arredondada pra inteiro (1501 → 750 ou 751)
    if (Math.abs(r - v / 2) < (p.moeda === 'Robux' ? 0.51 : 0.01)) return { chave: 'metade', rotulo: 'Metade paga', tipo: 'amarelo' };
    return { chave: 'parcial', rotulo: 'Parcial', tipo: 'amarelo' };
  };
  App.falta = (p) => Math.max(0, (+p.valor || 0) - (+p.recebido || 0));
  App.faltaResponder = () => App.estado.clientes.filter(c => c.conversa.estado === 'falta').sort((a, b) => (a.conversa.desde || '').localeCompare(b.conversa.desde || ''));
  App.respondidos = () => App.estado.clientes.filter(c => c.conversa.estado !== 'falta').sort((a, b) => (b.conversa.desde || '').localeCompare(a.conversa.desde || ''));
  App.vagas = () => ({ usadas: App.estado.pedidos.filter(p => p.etapa === 'comecado').length, total: App.estado.config.vagas || 3 });
  // a receber por moeda, só pedidos ativos
  App.aReceber = () => {
    const porMoeda = {}; let pedidos = 0;
    for (const p of App.pedidosAtivos()) { const f = App.falta(p); if (f > 0) { porMoeda[p.moeda] = (porMoeda[p.moeda] || 0) + f; pedidos++; } }
    return { porMoeda, pedidos };
  };
  const emAberto = (p) => p.etapa === 'aceito' || p.etapa === 'comecado';
  App.venceEmBreve = () => App.pedidosAtivos().filter(p => emAberto(p) && p.prazo && App.diasAte(p.prazo) >= 0 && App.diasAte(p.prazo) <= (App.estado.config.prazoAlertaDias ?? 2)).sort((a, b) => a.prazo.localeCompare(b.prazo));
  App.atrasados = () => App.pedidosAtivos().filter(p => emAberto(p) && p.prazo && App.diasAte(p.prazo) < 0).sort((a, b) => a.prazo.localeCompare(b.prazo));
  App.proximasEntregas = () => App.pedidosAtivos().filter(p => emAberto(p) && p.prazo).sort((a, b) => a.prazo.localeCompare(b.prazo));
  App.entreguesNoPedido = (p) => p.entregas.filter(Boolean).length;
  App.alertas = () => {
    const a = [];
    for (const c of App.faltaResponder()) a.push({ tipo: 'responder', clienteId: c.id, texto: `${c.nome} está esperando resposta`, sub: App.fmtHa(c.conversa.desde) });
    for (const p of App.atrasados()) a.push({ tipo: 'atrasado', pedidoId: p.id, texto: `${p.titulo} está atrasado`, sub: (App.cliente(p.clienteId) || {}).nome || '' });
    for (const p of App.venceEmBreve()) a.push({ tipo: 'prazo', pedidoId: p.id, texto: `${p.titulo} vence ${App.fmtPrazoRel(p.prazo)}`, sub: (App.cliente(p.clienteId) || {}).nome || '' });
    return a;
  };
  // estatísticas do cliente
  App.resumoCliente = (id) => {
    const ps = App.pedidosDoCliente(id);
    const fechados = ps.filter(p => p.etapa === 'pago');
    const ajustes = fechados.length ? fechados.reduce((s, p) => s + (p.rodada - 1), 0) / fechados.length : null;
    const porMoeda = {};
    for (const p of ps) { const f = App.falta(p); if (f > 0 && App.ativo(p)) porMoeda[p.moeda] = (porMoeda[p.moeda] || 0) + f; }
    return { total: ps.length, ativos: ps.filter(App.ativo).length, concluidos: fechados.length, ajustesMedia: ajustes, aReceber: porMoeda };
  };

  // ---------- Ações (únicos pontos que mudam dados) ----------
  App.acoes = {
    novoCliente(d) {
      const c = {
        id: uid(), criadoEm: agoraISO(), nome: (d.nome || d.globalName || d.username || 'Cliente').trim(),
        discordId: d.discordId || '', username: d.username || '', globalName: d.globalName || '', avatar: d.avatar || '',
        corPerfil: d.corPerfil || '', contaCriada: d.contaCriada || (d.discordId ? App.dataDoSnowflake(d.discordId) : ''),
        atualizadoEm: d.discordId ? agoraISO() : '', roblox: d.roblox || null,
        conversa: { estado: d.faltaResponder ? 'falta' : 'respondido', desde: agoraISO() }, notas: '', pagaVia: d.pagaVia || ''
      };
      App.mudar(e => { e.clientes.push(c); });
      return c.id;
    },
    // opts.render=false → salva sem redesenhar (use enquanto a pessoa digita)
    atualizarCliente(id, patch, opts = {}) { App.mudar(e => { const c = e.clientes.find(x => x.id === id); if (c) Object.assign(c, patch); }, opts); },
    removerCliente(id) {
      const ids = App.estado.pedidos.filter(p => p.clienteId === id).map(p => p.id);
      App.mudar(e => { e.clientes = e.clientes.filter(c => c.id !== id); e.pedidos = e.pedidos.filter(p => p.clienteId !== id); });
      ids.forEach(pid => { try { App.api.arquivos.removerPedido(pid); } catch {} });
    },
    marcarConversa(id, estado) { App.mudar(e => { const c = e.clientes.find(x => x.id === id); if (c) c.conversa = { estado: estado === 'falta' ? 'falta' : 'respondido', desde: agoraISO() }; }); },
    novoPedido(d) {
      const qtd = Math.max(1, Math.min(12, parseInt(d.qtd, 10) || 1));
      const p = {
        id: uid(), criadoEm: agoraISO(), clienteId: d.clienteId, titulo: (d.titulo || 'Pedido').trim(), jogo: (d.jogo || '').trim(), qtd,
        etapa: d.etapa && App.ETAPAS.some(x => x.id === d.etapa) ? d.etapa : 'aceito', valor: +d.valor || 0, moeda: App.MOEDAS.includes(d.moeda) ? d.moeda : App.estado.config.moedaPadrao,
        recebido: Math.min(+d.recebido || 0, +d.valor || 0), prazo: d.prazo || '', rodada: 1, ajustes: [], entregas: Array(qtd).fill(null), notas: d.notas || '',
        etapaEm: { aceito: agoraISO() }, concluidoEm: ''
      };
      App.mudar(e => { e.pedidos.push(p); });
      return p.id;
    },
    atualizarPedido(id, patch, opts = {}) {
      App.mudar(e => {
        const p = e.pedidos.find(x => x.id === id); if (!p) return;
        Object.assign(p, patch);
        if (patch.qtd != null) { const q = Math.max(1, Math.min(12, parseInt(patch.qtd, 10) || 1)); p.qtd = q; p.entregas = Array.from({ length: q }, (_, i) => p.entregas[i] || null); }
        if (patch.recebido != null) p.recebido = Math.max(0, Math.min(+p.recebido || 0, +p.valor || 0));
        autoConcluir(p);
      }, opts);
    },
    mudarEtapa(id, etapa) {
      App.mudar(e => {
        const p = e.pedidos.find(x => x.id === id); if (!p || !App.ETAPAS.some(x => x.id === etapa)) return;
        p.etapa = etapa; p.etapaEm = { ...(p.etapaEm || {}), [etapa]: agoraISO() };
        if (etapa === 'pago') { p.recebido = p.valor; p.concluidoEm = agoraISO(); } else p.concluidoEm = '';
        autoConcluir(p);
      });
    },
    registrarPagamento(id, quantia) {
      App.mudar(e => {
        const p = e.pedidos.find(x => x.id === id); if (!p) return;
        p.recebido = Math.max(0, Math.min(+p.valor || 0, (+p.recebido || 0) + (+quantia || 0)));
        autoConcluir(p);
      });
    },
    pedirAjuste(id, texto) {
      App.mudar(e => {
        const p = e.pedidos.find(x => x.id === id); if (!p) return;
        p.ajustes.push({ em: agoraISO(), rodada: p.rodada, texto: String(texto || '').trim() });
        p.rodada += 1; p.etapa = 'comecado'; p.etapaEm = { ...(p.etapaEm || {}), comecado: agoraISO() }; p.concluidoEm = '';
      });
    },
    definirEntrega(id, indice, arquivo) { App.mudar(e => { const p = e.pedidos.find(x => x.id === id); if (p && indice >= 0 && indice < p.qtd) p.entregas[indice] = arquivo; }); },
    removerPedido(id) { App.mudar(e => { e.pedidos = e.pedidos.filter(p => p.id !== id); }); try { App.api.arquivos.removerPedido(id); } catch {} },
    configurar(patch) { App.mudar(e => { Object.assign(e.config, patch); }); }
  };
  // aprovado + tudo pago → conclui sozinho
  function autoConcluir(p) {
    if (p.etapa === 'aprovado' && (+p.valor || 0) > 0 && (+p.recebido || 0) >= (+p.valor || 0)) {
      p.etapa = 'pago'; p.etapaEm = { ...(p.etapaEm || {}), pago: agoraISO() }; p.concluidoEm = agoraISO();
    }
  }

  // ---------- Ações de alto nível reutilizadas por várias telas ----------
  App.abrirDiscord = (c) => { if (c && c.discordId) App.api.sistema.abrirDiscord(c.discordId); else UI.toast('Esse cliente não tem ID do Discord.', 'erro'); };
  App.copiar = async (texto, aviso = 'Copiado.') => { await App.api.sistema.copiar(texto); UI.toast(aviso, 'ok'); };
  // Puxa de novo os dados do Discord/Roblox e atualiza o cliente
  App.atualizarDadosCliente = async (id) => {
    const c = App.cliente(id); if (!c) return;
    let mudou = false;
    if (c.discordId) {
      const r = await App.api.discord.usuario(c.discordId);
      if (r.ok) {
        const d = r.dados;
        App.acoes.atualizarCliente(id, { username: d.username, globalName: d.globalName || '', avatar: d.avatar || c.avatar, corPerfil: d.corPerfil || c.corPerfil, contaCriada: d.contaCriada, atualizadoEm: agoraISO() });
        mudou = true;
      } else UI.toast(r.erro, 'erro');
    }
    if (c.roblox && c.roblox.username) {
      const r = await App.api.roblox.usuario(c.roblox.username);
      if (r.ok) { App.acoes.atualizarCliente(id, { roblox: r.dados }); mudou = true; }
    }
    if (mudou) UI.toast('Dados atualizados.', 'ok');
  };

  // ---------- Simulação no navegador (para testar a interface) ----------
  function criarApiSimulada() {
    const CHAVE = 'comissoes-dados';
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    const soNoApp = async () => { UI.toast('Isso só funciona no app instalado.'); return false; };
    return {
      dados: {
        ler: async () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { return null; } },
        salvar: async (s) => { try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch {} return true; },
        abrirPasta: soNoApp, exportar: async () => { await soNoApp(); return { ok: false }; }, importar: async () => { await soNoApp(); return { ok: false }; }
      },
      discord: {
        usuario: async (id) => {
          await espera(450); id = String(id || '').trim();
          if (!/^\d{17,20}$/.test(id)) return { ok: false, codigo: 'id-invalido', erro: 'Esse ID não parece válido. Ele tem de 17 a 20 números.' };
          const fim = id.slice(-4);
          return { ok: true, dados: { id, username: 'cliente' + fim, globalName: 'Cliente ' + fim, avatar: '', corPerfil: '#5b47a8', contaCriada: App.dataDoSnowflake(id) } };
        },
        tokenStatus: async () => ({ configurado: localStorage.getItem('comissoes-token') === '1', criptografado: true }),
        salvarToken: async (t) => { localStorage.setItem('comissoes-token', t ? '1' : ''); return { ok: true, configurado: !!t }; },
        testarToken: async () => { await espera(300); return localStorage.getItem('comissoes-token') === '1' ? { ok: true, bot: 'MeuBot' } : { ok: false, erro: 'Nenhum token salvo.' }; }
      },
      roblox: { usuario: async (n) => { await espera(400); return /^[A-Za-z0-9_]{3,20}$/.test(n) ? { ok: true, dados: { id: '1938475620', username: n, displayName: n, avatar: '' } } : { ok: false, erro: 'Usuário do Roblox inválido.' }; } },
      arquivos: {
        escolherImagens: async () => { await soNoApp(); return []; }, importar: async () => ({ ok: false, erro: 'Isso só funciona no app instalado.' }),
        listar: async () => [], abrirPasta: soNoApp, remover: async () => true, removerPedido: async () => true, caminhoDe: () => ''
      },
      sistema: { abrirExterno: async (u) => { window.open(u, '_blank'); return true; }, abrirDiscord: async () => { UI.toast('Abriria o Discord.'); return true; }, copiar: async (t) => { try { await navigator.clipboard.writeText(t); } catch {} return true; } },
      janela: { tema: () => {} }
    };
  }

  // Dados de exemplo (só no navegador, com ?semente=1)
  function semear() {
    const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
    const mk = (nome, user, discordId, falta, min, extra = {}) => ({ id: uid(), criadoEm: ha(60 * 24 * 60), nome, discordId, username: user, globalName: nome, avatar: '', corPerfil: extra.cor || '', contaCriada: App.dataDoSnowflake(discordId), atualizadoEm: ha(30), roblox: extra.roblox || null, conversa: { estado: falta ? 'falta' : 'respondido', desde: ha(min) }, notas: extra.notas || '', pagaVia: extra.pagaVia || '' });
    const luna = mk('Luna', 'lunarbloxx', '284719306512384000', true, 180, { cor: '#4a3b8c', roblox: { id: '1938475620', username: 'lunar_bloxx', displayName: 'LunaBuilds', avatar: '' }, notas: 'Prefere tons frios e fundo noturno. Sempre pede o PSD junto.', pagaVia: 'Gamepass' });
    const kaio = mk('Kaio', 'kaiodev', '391827364512837465', true, 48);
    const nexus = mk('Nexus Studio', 'nexus.studio', '512384756129384756', true, 12);
    const mira = mk('Mira', 'mirastudios', '612938475612938475', false, 300);
    const voidc = mk('Void', 'voidrbx', '712938475612938476', false, 1440);
    const panda = mk('PixelPanda', 'pixelpanda', '812938475612938477', false, 2880);
    const zero = mk('Zero', 'zeroping', '912938475612938478', false, 20);
    const ped = (cli, titulo, jogo, qtd, etapa, valor, recebido, prazo, rodada = 1) => ({ id: uid(), criadoEm: ha(60 * 24 * 5), clienteId: cli.id, titulo, jogo, qtd, etapa, valor, moeda: 'Robux', recebido, prazo, rodada, ajustes: [], entregas: Array(qtd).fill(null), notas: '', etapaEm: {}, concluidoEm: etapa === 'pago' ? ha(60 * 24 * 20) : '' });
    App.estado.clientes = [luna, kaio, nexus, mira, voidc, panda, zero];
    App.estado.pedidos = [
      ped(luna, 'Pack 4 thumbs', 'Lava Obby', 4, 'comecado', 4800, 2400, dia(2)),
      ped(kaio, 'Ícone de jogo', '', 1, 'aceito', 1500, 0, dia(5)),
      ped(nexus, 'Thumb + ícone', 'Tower Rush', 2, 'entregue', 3000, 3000, dia(-1)),
      ped(mira, 'Pack 2 thumbs', 'Mine Sim', 2, 'comecado', 2400, 0, dia(11)),
      ped(voidc, 'Banner animado', '', 1, 'aprovado', 3000, 0, dia(-2)),
      ped(luna, 'Thumb única', 'Lava Obby', 1, 'pago', 1200, 1200, dia(-30)),
      ped(luna, 'Ícone de jogo', '', 1, 'pago', 1500, 1500, dia(-60))
    ];
    App.estado.config.nome = 'sak';
    salvar();
  }
})();
