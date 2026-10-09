// Casca do app: lateral, cabeçalho, roteamento, busca (Ctrl+K), sino e atalhos.
(function () {
  const esc = UI.esc, ic = UI.icone;
  const $ = (s, el = document) => el.querySelector(s);

  // ---------- Lateral ----------
  function renderLateral() {
    const el = $('#lateral');
    const cfg = App.estado.config;
    const recolhida = !!cfg.lateralRecolhida;
    el.classList.toggle('recolhida', recolhida);
    const tela = App.rota.tela;
    const falta = App.faltaResponder();
    // até 4 conversas (quem espera primeiro); a lista encolhe/rola em janelas baixas pra nunca esconder Configurações/Recolher
    const conversas = [...falta, ...App.respondidos()].slice(0, 4);

    const nav = (id, icone, rotulo, cont) => `<button class="nav-item ${tela === id ? 'ativo' : ''}" data-ir="${id}" title="${esc(rotulo)}">${ic(icone, recolhida ? 20 : 18)}<span class="rot so-aberta">${esc(rotulo)}</span>${cont != null ? `<span class="cont so-aberta">${cont}</span>` : ''}</button>`;

    el.innerHTML = `
      <div class="marca">${ic('logo', 26, 2.4).replace('class="ic"', 'class="ic logo"')}<span class="so-aberta">Comissões</span>${ic('chevB', 16).replace('class="ic"', 'class="ic chev so-aberta"')}</div>
      ${nav('dashboard', 'dashboard', 'Dashboard')}
      ${nav('pedidos', 'pedidos', 'Pedidos', App.pedidosAFazer().length)}
      ${nav('clientes', 'clientes', 'Clientes', App.estado.clientes.length)}
      ${conversas.length ? `<div class="lateral-conversas so-aberta"><div class="lateral-secao">Conversas</div>
        ${conversas.map(c => {
          const f = c.conversa.estado === 'falta';
          return `<button class="conversa so-aberta" data-cliente="${esc(c.id)}">${UI.avatar({ tam: 34, img: c.avatar, nome: c.nome, classe: f ? 'anel-falta' : 'anel-ok' })}
            <span class="truncar"><span class="nome"><span class="truncar">${esc(c.nome)}</span><span class="ponto-status">${UI.ponto(f ? 'var(--vermelho)' : 'var(--verde)')}</span></span>
            <span class="estado ${f ? 'cor-vermelho' : 'cor-verde'}">${f ? 'Esperando ' + esc(App.fmtHa(c.conversa.desde)) : 'Respondido'}</span></span></button>`;
        }).join('')}</div>` : ''}
      <div class="espacador"></div>
      ${nav('config', 'config', 'Configurações')}
      <button class="nav-item" data-recolher title="${recolhida ? 'Expandir' : 'Recolher'}">${ic(recolhida ? 'expandir' : 'recolher', recolhida ? 20 : 18)}<span class="rot so-aberta">Recolher</span></button>`;

    el.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => App.ir(b.dataset.ir, null, b.dataset.grupo ? { grupo: b.dataset.grupo } : {}));
    el.querySelectorAll('[data-cliente]').forEach(b => b.onclick = () => App.ir('clientes', b.dataset.cliente));
    $('[data-recolher]', el).onclick = () => App.acoes.configurar({ lateralRecolhida: !recolhida });
  }

  // ---------- Cabeçalho ----------
  function renderCabecalho(tela) {
    const el = $('#cabecalho');
    const info = (tela && tela.cabecalho && tela.cabecalho()) || {};
    const alertas = App.alertas();
    const falta = App.faltaResponder();
    const botao = info.botao === null ? null : (info.botao || { rotulo: 'Novo cliente', icone: 'mais', acao: () => App.modais.novoCliente && App.modais.novoCliente() });
    el.innerHTML = `
      <div class="cab-titulo"><h1 title="${esc(info.titulo || '')}">${esc(info.titulo || '')}</h1>${info.sub ? `<div class="sub">${esc(info.sub)}</div>` : ''}</div>
      <button class="busca" data-busca>${ic('busca', 17)}<span class="rot">Buscar cliente, pedido ou @</span><span class="tecla">Ctrl K</span></button>
      <div class="cresce"></div>
      <button class="btn-cab" data-sino aria-label="Alertas">${ic('sino', 17)}${alertas.length ? `<span class="badge">${alertas.length}</span>` : ''}</button>
      ${info.pilha && falta.length ? `<div class="pilha" title="Esperando resposta">${falta.slice(0, 5).map(c => UI.avatar({ tam: 32, img: c.avatar, nome: c.nome })).join('')}${falta.length > 5 ? `<span class="avatar" style="--t:32px;--cor-avatar:#232b37;font-size:12px">+${falta.length - 5}</span>` : ''}</div>` : ''}
      ${botao ? `<button class="btn ${App.estado.config.tema === 'of' ? 'btn-acento btn-peq' : 'btn-primario'}" data-acao-cab>${ic(botao.icone || 'mais', 16, 2.4)}${esc(botao.rotulo)}</button>` : ''}`;
    $('[data-busca]', el).onclick = abrirBusca;
    $('[data-sino]', el).onclick = (e) => abrirSino(e.currentTarget);
    const b = $('[data-acao-cab]', el); if (b && botao) b.onclick = botao.acao;
  }

  // ---------- Área ----------
  const rolagens = {};
  let rotaDesenhada = null;
  function renderArea(tela) {
    const area = $('#area');
    // redesenho causado por trabalho em segundo plano não pode roubar o foco de quem está digitando
    const ae = document.activeElement;
    const manter = ae && ae.id && area.contains(ae) && App.rota === rotaDesenhada
      ? { id: ae.id, sel: typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd, ae.scrollTop] : null } : null;
    // guarda rolagens marcadas com data-rolagem="chave"
    area.querySelectorAll('[data-rolagem]').forEach(n => { rolagens[App.rota.tela + ':' + n.dataset.rolagem] = n.scrollTop; });
    const topo = area.scrollTop;
    area.classList.toggle('cheia', !!(tela && tela.cheia));
    if (!tela) { area.innerHTML = UI.vazio({ icone: 'info', titulo: 'Tela em construção' }); return; }
    try {
      area.innerHTML = tela.render();
      if (tela.montar) tela.montar(area);
      rotaDesenhada = App.rota;
      if (manter) {
        const n = document.getElementById(manter.id);
        if (n && n !== document.activeElement) { n.focus({ preventScroll: true }); if (manter.sel) { try { n.setSelectionRange(manter.sel[0], manter.sel[1]); } catch {} n.scrollTop = manter.sel[2]; } }
      }
    } catch (e) {
      console.error(e);
      area.innerHTML = UI.vazio({ icone: 'alerta', titulo: 'Algo deu errado nesta tela', texto: String(e && e.message || e) });
    }
    area.scrollTop = topo;
    area.querySelectorAll('[data-rolagem]').forEach(n => { const v = rolagens[App.rota.tela + ':' + n.dataset.rolagem]; if (v) n.scrollTop = v; });
  }

  function render() {
    const tela = App.telas[App.rota.tela];
    renderLateral();
    renderCabecalho(tela);
    renderArea(tela);
  }

  // ---------- Busca (Ctrl+K) ----------
  function abrirBusca() {
    if (UI.temModal()) return;
    UI.modal({
      titulo: 'Buscar', largura: 560,
      corpo: `<input class="input" data-q placeholder="Nome, @, ID do Discord, pedido ou jogo" autofocus><div class="lista" data-res style="max-height:52vh;overflow:auto"></div>`,
      aoMontar: (el, fechar) => {
        const q = $('[data-q]', el), res = $('[data-res]', el);
        let itens = [];
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const atualizar = () => {
          const t = norm(q.value.trim());
          const cs = App.estado.clientes.filter(c => !t || [c.nome, c.username, c.globalName, c.discordId, c.canalId, c.roblox && c.roblox.username].some(v => norm(v).includes(t))).slice(0, 8);
          const ps = App.estado.pedidos.filter(p => t && [p.titulo, p.jogo, (App.cliente(p.clienteId) || {}).nome].some(v => norm(v).includes(t))).slice(0, 8);
          itens = [...cs.map(c => ({ tipo: 'c', c })), ...ps.map(p => ({ tipo: 'p', p }))];
          res.innerHTML = itens.length ? itens.map((it, i) => it.tipo === 'c'
            ? `<button class="item" data-i="${i}">${UI.avatar({ tam: 32, img: it.c.avatar, nome: it.c.nome })}<span class="truncar"><span class="t1" style="display:block">${esc(it.c.nome)}</span><span class="t2">${it.c.username ? '@' + esc(it.c.username) : 'cliente'}</span></span></button>`
            : `<button class="item" data-i="${i}"><span class="avatar quadrado" style="--t:32px;--cor-avatar:var(--interno);color:var(--suave)">${ic('pedidos', 16)}</span><span class="truncar"><span class="t1" style="display:block">${esc(it.p.titulo)}</span><span class="t2">${esc((App.cliente(it.p.clienteId) || {}).nome || '')} · ${esc(App.status(it.p).rotulo)}</span></span></button>`).join('')
            : `<div class="mudo pequeno" style="padding:12px 4px">${t ? 'Nada encontrado.' : 'Nenhum cliente ainda.'}</div>`;
          res.querySelectorAll('[data-i]').forEach(b => b.onclick = () => abrir(+b.dataset.i));
        };
        const abrir = (i) => { const it = itens[i]; if (!it) return; fechar(); it.tipo === 'c' ? App.ir('clientes', it.c.id) : App.ir('pedidos', it.p.id); };
        q.addEventListener('input', atualizar);
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(0); });
        atualizar();
      }
    });
  }

  // ---------- Sino ----------
  function abrirSino(ancora) {
    const al = App.alertas();
    const corDe = { responder: 'var(--vermelho)', atrasado: 'var(--vermelho)', prazo: 'var(--amarelo)' };
    UI.menu(ancora, `<div class="menu-titulo sobrelinha">Alertas</div>${al.length ? al.map((a, i) => `<button class="item" data-a="${i}">${UI.ponto(corDe[a.tipo])}<span class="truncar"><span class="t1" style="display:block" >${esc(a.texto)}</span><span class="t2">${esc(a.sub)}</span></span></button>`).join('') : `<div class="mudo pequeno" style="padding:10px">Tudo em dia. Nenhum alerta.</div>`}`,
      (m, fechar) => m.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = al[+b.dataset.a]; fechar(); a.clienteId ? App.ir('clientes', a.clienteId) : App.ir('pedidos', a.pedidoId); }));
  }

  // ---------- Atalhos ----------
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); }
    else if (e.key === 'Escape') { if (!UI.fecharModalTopo()) UI.fecharMenu(); }
  });

  // atualiza os "há X min" a cada minuto sem mexer no que a pessoa está fazendo
  setInterval(() => { if (!UI.temModal() && !document.activeElement.matches('input, textarea, select')) render(); }, 60000);

  // ---------- Início ----------
  App.ouvir(render);
  App.renderizar = render;
  App.abrirBusca = abrirBusca;
  window.addEventListener('DOMContentLoaded', async () => {
    try { await App.carregar(); } catch (e) { console.error(e); UI.toast('Não deu pra ler os dados salvos.', 'erro'); }
    const p = new URLSearchParams(location.search);
    if (p.get('tela')) App.rota = { tela: p.get('tela'), id: p.get('id') || null };
    if (p.get('tema')) { App.estado.config.tema = p.get('tema') === 'of' ? 'of' : 'cube'; document.documentElement.dataset.tema = App.estado.config.tema; }
    try { App.conta = await App.api.conta.estado(); } catch {}
    try { App.atualizacao = await App.api.atualizacao.estado(); } catch {}
    render();
    if (!App.conta.logado) Entrada.mostrar();
    App.api.conta.onEstado((st) => {
      const estava = App.conta.logado;
      App.conta = st;
      if (estava && !st.logado) Entrada.mostrar('Você saiu da conta. Entre de novo quando quiser.');
      else if (App.rota.tela === 'config' && !Entrada.aberta()) render();
    });
    App.api.atualizacao.onEstado((st) => {
      App.atualizacao = st;
      avisoUpdate();
      if (App.rota.tela === 'config' && !Entrada.aberta()) render();
    });
    avisoUpdate();
    document.body.classList.add('pronto');
  });

  // ---------- Aviso de versão nova pronta ----------
  let avisoDispensado = '';
  function avisoUpdate() {
    const st = App.atualizacao || {};
    let el = document.getElementById('aviso-update');
    if (st.fase !== 'pronto' || avisoDispensado === st.versao) {
      if (el) el.remove();
      document.body.classList.remove('com-aviso-update');
      return;
    }
    if (!el) { el = document.createElement('div'); el.id = 'aviso-update'; el.className = 'aviso-update'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `${ic('atualizar', 18)}<div class="txt"><b>Versão ${esc(st.versao)} pronta</b><span>Reinicie pra usar agora, ou ela entra quando você fechar o app.</span></div>
      <button class="btn btn-sec btn-peq" data-depois>Depois</button><button class="btn btn-primario btn-peq" data-reiniciar>Reiniciar</button>`;
    el.querySelector('[data-depois]').onclick = () => { avisoDispensado = st.versao; avisoUpdate(); };
    el.querySelector('[data-reiniciar]').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Reiniciando…';
      const ok = await App.api.atualizacao.instalar();
      if (!ok) { b.disabled = false; b.textContent = 'Reiniciar'; UI.toast('Não deu pra reiniciar agora. A versão nova entra quando você fechar o app.', 'erro'); }
    };
    document.body.classList.add('com-aviso-update');
  }
  App.avisoUpdate = avisoUpdate;
})();
