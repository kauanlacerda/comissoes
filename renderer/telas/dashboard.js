// Tela inicial: resumo (4 números), calendário de prazos, clientes e comissões ativas.
// Mesmo HTML nos dois modos (cube / of); a diferença visual vem do CSS.
(function () {
  const esc = UI.esc, ic = UI.icone;

  // mês mostrado no calendário (fica entre redesenhos; volta pro mês atual ao reabrir o app)
  let mesCal = null;

  const VERMELHO = 'var(--vermelho)', VERDE = 'var(--verde)';
  const emAberto = (p) => p.etapa === 'aceito' || p.etapa === 'comecado';
  const nomeDe = (clienteId) => (App.cliente(clienteId) || {}).nome || 'Cliente removido';
  const plural = (n, um, varios) => (n === 1 ? um : varios);
  const maiuscula = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const ymd = (a, m, d) => `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 'hoje' | 'ontem' | 'há 3 dias' a partir de uma data ISO
  function diasDesde(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const n = -App.diasAte(ymd(d.getFullYear(), d.getMonth(), d.getDate()));
    if (n <= 0) return 'hoje';
    return n === 1 ? 'ontem' : `há ${n} dias`;
  }

  // ---------- 1) Resumo ----------
  function stat({ rotulo, ponto, valor, legenda, tile, cor, destaque, ir, titulo }) {
    return `<div class="stat ${destaque ? 'destaque' : ''} ${ir ? 'dash-stat-ir' : ''}" ${ir ? `data-ir-stat="${ir}" role="button" tabindex="0"` : ''} ${titulo ? `title="${esc(titulo)}"` : ''}>
      <div class="stat-texto">
        <div class="stat-rotulo">${ponto ? UI.ponto(ponto) : ''}${esc(rotulo)}</div>
        <div class="stat-valor">${valor}</div>
        <div class="stat-legenda truncar">${legenda}</div>
      </div>
      <span class="stat-tile" style="--cor:${cor}">${ic(tile, 17)}</span>
    </div>`;
  }

  function resumo() {
    const cfg = App.estado.config;

    // Falta responder
    const falta = App.faltaResponder();
    const legFalta = falta.length
      ? `mais antigo: ${esc(falta[0].nome)}, ${esc(App.fmtHa(falta[0].conversa.desde))}`
      : 'ninguém esperando';

    // Em produção (etapa "começado")
    const prod = App.estado.pedidos.filter(p => p.etapa === 'comecado');
    const prodPrazo = prod.filter(p => p.prazo).sort((a, b) => a.prazo.localeCompare(b.prazo));
    let legProd = prod.length ? 'nenhum prazo próximo' : 'nada começado agora';
    if (prodPrazo.length) {
      const prox = prodPrazo[0].prazo;
      const n = prodPrazo.filter(p => p.prazo === prox).length;
      const d = -App.diasAte(prox);
      legProd = d > 0
        ? `<span class="cor-vermelho">${n} ${plural(n, 'atrasado', 'atrasados')} há ${d} ${plural(d, 'dia', 'dias')}</span>`
        : `${n} ${plural(n, 'vence', 'vencem')} ${esc(App.fmtPrazoRel(prox))}`;
    }

    // Vence em breve (+ atrasados)
    const breve = App.venceEmBreve(), atras = App.atrasados();
    const partes = [];
    if (atras.length) partes.push(`<span class="cor-vermelho forte">${atras.length} ${plural(atras.length, 'atrasado', 'atrasados')}</span>`);
    if (breve.length) {
      const nome = esc(nomeDe(breve[0].clienteId)), dia = esc(App.fmtDiaLongo(breve[0].prazo));
      // com atrasados na frente, deixa claro que este é o próximo (e não um dos atrasados)
      partes.push(atras.length ? `próximo: ${nome}, ${dia}` : `${nome} · ${dia}`);
    } else if (atras.length) partes.push(esc(nomeDe(atras[0].clienteId)));
    const legBreve = partes.length ? partes.join(' · ') : 'nada para os próximos dias';
    const dias = cfg.prazoAlertaDias ?? 2;

    // A receber
    const rec = App.aReceber();
    const moedas = App.MOEDAS.filter(m => (rec.porMoeda[m] || 0) > 0);
    const principal = (rec.porMoeda[cfg.moedaPadrao] || 0) > 0 ? cfg.moedaPadrao : (moedas[0] || cfg.moedaPadrao || 'Robux');
    // outras moedas logo depois da principal (se a legenda cortar, corta a contagem, não o dinheiro);
    // a contagem vem por último e vale pra todas as moedas
    const outras = moedas.filter(m => m !== principal).map(m => '+ ' + App.fmtValor(rec.porMoeda[m], m));
    const contaPed = `${rec.pedidos} ${plural(rec.pedidos, 'pedido', 'pedidos')}`;
    const legRec = rec.pedidos ? [principal, ...outras, contaPed].map(esc).join(' · ') : 'nada a receber agora';
    const tituloRec = rec.pedidos
      ? `A receber: ${[App.fmtValor(rec.porMoeda[principal] || 0, principal), ...outras].join(' ')} em ${contaPed}. Clique pra abrir os pedidos.`
      : 'Abrir pedidos';

    return `<div class="stats">
      ${stat({ rotulo: 'Falta responder', ponto: VERMELHO, valor: falta.length, legenda: legFalta, tile: 'msg', cor: VERMELHO, ir: falta.length ? 'falta' : '', titulo: falta.length ? 'Abrir quem espera há mais tempo' : '' })}
      ${stat({ rotulo: 'Em produção', ponto: 'var(--amarelo)', valor: prod.length, legenda: legProd, tile: 'pincel', cor: 'var(--amarelo)', ir: 'producao', titulo: 'Ver pedidos em produção' })}
      ${stat({ rotulo: 'Vence em breve', valor: breve.length + atras.length, legenda: legBreve, tile: 'calendario', cor: atras.length ? VERMELHO : 'var(--azul)', ir: (atras[0] || breve[0]) ? 'prazo' : '', titulo: `Prazos de hoje até ${dias} ${plural(dias, 'dia', 'dias')}${atras.length ? ', mais os atrasados' : ''}` })}
      ${stat({ rotulo: 'A receber', valor: esc(App.fmtNum(rec.porMoeda[principal] || 0)), legenda: legRec, tile: 'moeda', cor: VERDE, destaque: true, ir: 'pedidos', titulo: tituloRec })}
    </div>`;
  }

  // ---------- 2a) Calendário ----------
  function prazosPorDia() {
    const porDia = {};
    for (const p of App.pedidosAtivos()) if (emAberto(p) && p.prazo) (porDia[p.prazo] = porDia[p.prazo] || []).push(p);
    return porDia;
  }

  function calendarioInterno() {
    const hoje = App.hoje();
    const h = App.paraData(hoje);
    if (!mesCal) mesCal = { a: h.getFullYear(), m: h.getMonth() };
    const { a, m } = mesCal;
    const inicio = new Date(a, m, 1).getDay();
    const total = new Date(a, m + 1, 0).getDate();
    const porDia = prazosPorDia();
    const noMesAtual = a === h.getFullYear() && m === h.getMonth();

    const semana = App.SEM.map(s => `<div class="cal-semana">${esc(maiuscula(s))}</div>`).join('');
    let dias = '';
    for (let i = 0; i < inicio; i++) dias += '<div class="cal-dia fora" aria-hidden="true"></div>';
    for (let d = 1; d <= total; d++) {
      const chave = ymd(a, m, d);
      const ps = porDia[chave];
      const cls = `cal-dia ${chave === hoje ? 'hoje' : ''}`;
      if (ps && ps.length) {
        const atrasado = App.diasAte(chave) < 0;
        const dica = ps.map(p => `${p.titulo} · ${nomeDe(p.clienteId)}`).join('\n');
        dias += `<button class="${cls} dash-dia-prazo" data-dia="${chave}" title="${esc(dica)}" aria-label="${esc(`Dia ${d}: ${ps.length} ${plural(ps.length, 'prazo', 'prazos')}`)}"><span>${d}</span><i class="marca-prazo ${atrasado ? 'atrasado' : ''}"></i></button>`;
      } else {
        dias += `<div class="${cls}"><span>${d}</span></div>`;
      }
    }
    return `<div class="cal-cab">
        <button class="btn-circ" data-mes="-1" aria-label="Mês anterior">${ic('chevE', 16, 2.2)}</button>
        <button class="dash-mes ${noMesAtual ? '' : 'pode-voltar'}" data-mes="0" ${noMesAtual ? 'tabindex="-1"' : 'title="Voltar para este mês"'}>${esc(maiuscula(App.MES_LONGO[m]))} ${a}</button>
        <button class="btn-circ" data-mes="1" aria-label="Próximo mês">${ic('chevD', 16, 2.2)}</button>
      </div>
      <div class="cal-grade">${semana}${dias}</div>`;
  }

  function ligarCalendario(bloco) {
    bloco.querySelectorAll('[data-mes]').forEach(b => b.addEventListener('click', () => {
      const passo = +b.dataset.mes;
      const h = App.paraData(App.hoje());
      if (passo === 0) mesCal = { a: h.getFullYear(), m: h.getMonth() };
      else { const d = new Date(mesCal.a, mesCal.m + passo, 1); mesCal = { a: d.getFullYear(), m: d.getMonth() }; }
      bloco.innerHTML = calendarioInterno();
      ligarCalendario(bloco);
      // o botão clicado foi recriado: devolve o foco pra quem navega pelo teclado não cair no <body>
      // (no mês atual o título fica fora do Tab, então vai pra seta anterior)
      const alvo = bloco.querySelector(`[data-mes="${passo}"]:not([tabindex="-1"])`) || bloco.querySelector('[data-mes="-1"]');
      if (alvo) alvo.focus({ preventScroll: true });
    }));
    bloco.querySelectorAll('[data-dia]').forEach(b => b.addEventListener('click', () => {
      const ps = (prazosPorDia()[b.dataset.dia] || []);
      if (ps[0]) App.ir('pedidos', ps[0].id);
    }));
  }

  // ---------- 2b) Clientes ----------
  function clientes() {
    const lista = [...App.faltaResponder(), ...App.respondidos()];
    const corpo = lista.length
      ? `<div class="lista dash-cli-lista" data-rolagem="dash-clientes">${lista.map(c => {
          const f = c.conversa.estado === 'falta';
          const status = f ? 'Esperando ' + App.fmtHa(c.conversa.desde) : 'Respondido';
          // a linha não é um botão: dentro dela há dois botões irmãos (abrir ficha | Respondi)
          return `<div class="linha clicavel dash-cli" data-linha-cliente="${esc(c.id)}">
            <span class="barra-status" style="--cor:${f ? VERMELHO : VERDE}"></span>
            <button class="dash-cli-abrir" aria-label="${esc(`${c.nome}: ${status.toLowerCase()}`)}">
              ${UI.avatar({ tam: 32, img: c.avatar, nome: c.nome })}
              <span class="dash-cli-txt">
                <span class="dash-nome"><span class="truncar">${esc(c.nome)}</span><span class="ponto-status">${UI.ponto(f ? VERMELHO : VERDE)}</span></span>
                <span class="dash-sub truncar ${f ? 'cor-vermelho' : 'mudo'}">${esc(status)}</span>
              </span>
            </button>
            <button class="btn-texto" data-conversa="${esc(c.id)}" data-estado="${f ? 'respondido' : 'falta'}" title="${f ? 'Marcar que você já respondeu' : 'Marcar que chegou mensagem nova'}">${f ? 'Respondi' : 'Nova msg'}</button>
          </div>`;
        }).join('')}</div>`
      : UI.vazio({
          icone: 'usuarioMais', titulo: 'Nenhum cliente ainda',
          texto: 'Cole o ID do Discord de quem te chamou e o app puxa a foto e o nome.',
          acao: `<button class="btn btn-sec btn-peq" data-novo-cliente>${ic('mais', 15, 2.4)}Adicionar cliente</button>`
        });
    return `<div class="bloco dash-clientes">
      <div class="bloco-cab"><h2 class="titulo-bloco">Clientes</h2>${lista.length ? `<span class="contagem dash-direita">${lista.length}</span>` : ''}</div>
      ${corpo}
    </div>`;
  }

  // ---------- 2c) Comissões ----------
  function ordenarComissoes(lista) {
    // primeiro o que ainda é trabalho seu (aceito/começado) por prazo, sem prazo no fim;
    // depois o que está com o cliente (entregue, aprovado)
    const chave = (p) => [emAberto(p) ? 0 : 1, emAberto(p) ? 0 : App.indiceEtapa(p.etapa), p.prazo || '9999-99-99'];
    return lista.slice().sort((x, y) => {
      const a = chave(x), b = chave(y);
      return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    });
  }

  function linhaPedido(p, esperando) {
    const c = App.cliente(p.clienteId) || { nome: 'Cliente removido', avatar: '' };
    const idx = App.indiceEtapa(p.etapa);
    const barras = App.ETAPAS.map((_, i) => `<span class="${i < idx ? 'feito' : i === idx ? 'atual' : ''}"></span>`).join('');

    let prazo1, prazo2, prazoCls = 'mudo';
    if (emAberto(p)) {
      if (p.prazo) {
        prazo1 = esc(App.fmtDia(p.prazo));
        prazo2 = esc(App.fmtPrazoRel(p.prazo));
        if (App.diasAte(p.prazo) < 0) prazoCls = 'cor-vermelho';
      } else { prazo1 = '<span class="mudo">sem prazo</span>'; prazo2 = ''; }
    } else {
      prazo1 = esc(App.rotuloEtapa(p.etapa).toLowerCase());
      prazo2 = esc(diasDesde((p.etapaEm || {})[p.etapa]) || (p.prazo ? 'prazo ' + App.fmtDia(p.prazo) : ''));
    }

    const pg = App.pagamento(p);
    const pill = p.etapa === 'aprovado' && App.falta(p) > 0 && pg.chave === 'nao' ? UI.pill('Aguardando', 'amarelo') : UI.pill(pg.rotulo, pg.tipo);

    return `<div class="linha clicavel dash-ped" data-pedido="${esc(p.id)}" role="button" tabindex="0">
      <div class="dash-ped-cli">
        ${UI.avatar({ tam: 36, img: c.avatar, nome: c.nome })}
        <div class="dash-cli-txt">
          <div class="dash-nome"><span class="truncar">${esc(c.nome)}</span>${esperando ? `<span class="dash-espera" title="Esperando sua resposta">${UI.ponto(VERMELHO)}</span>` : ''}</div>
          <div class="dash-sub mudo truncar" title="${esc(p.jogo ? `${p.titulo} · ${p.jogo}` : p.titulo)}">${esc(p.titulo)}</div>
        </div>
      </div>
      <div class="dash-etapa">
        <div class="etapas-mini">${barras}</div>
        <div class="dash-etapa-rot cor-azul">${esc(App.rotuloEtapa(p.etapa))}</div>
      </div>
      <div class="dash-prazo">
        <div class="dash-prazo-1">${prazo1}</div>
        ${prazo2 ? `<div class="dash-sub ${prazoCls}">${prazo2}</div>` : ''}
      </div>
      <div>${pill}</div>
    </div>`;
  }

  function comissoes() {
    const ativos = ordenarComissoes(App.pedidosAtivos());
    const esperando = new Set(App.faltaResponder().map(c => c.id));
    const temClientes = App.estado.clientes.length > 0;
    const corpo = ativos.length
      ? `<div class="tabela dash-tabela" data-rolagem="dash-comissoes">
          <div class="tabela-cab"><span class="sobrelinha">Cliente</span><span class="sobrelinha">Etapa</span><span class="sobrelinha">Prazo</span><span class="sobrelinha">Pagamento</span></div>
          <div class="lista dash-com-lista">${ativos.map(p => linhaPedido(p, esperando.has(p.clienteId))).join('')}</div>
        </div>`
      : `<div class="dash-vazio">${temClientes
          ? UI.vazio({ icone: 'pedidos', titulo: 'Nenhuma comissão ativa', texto: 'Quando alguém fechar um pedido, registre aqui pra acompanhar etapa, prazo e pagamento.', acao: `<button class="btn btn-primario btn-peq" data-novo-pedido>${ic('mais', 15, 2.4)}Novo pedido</button>` })
          : UI.vazio({ icone: 'pedidos', titulo: 'Nenhuma comissão ativa', texto: 'Primeiro adicione o cliente pelo ID do Discord. Depois é só registrar o pedido dele.', acao: `<button class="btn btn-primario btn-peq" data-novo-cliente>${ic('usuarioMais', 15, 2.2)}Adicionar primeiro cliente</button>` })}</div>`;
    return `<div class="bloco cresce dash-com">
      <div class="bloco-cab"><h2 class="titulo-bloco">Comissões</h2><span class="contagem">${ativos.length} ${plural(ativos.length, 'ativa', 'ativas')}</span>
        <button class="link dash-direita" data-abrir-pedidos>Abrir pedidos</button></div>
      ${corpo}
    </div>`;
  }

  // ---------- Tela ----------
  App.telas.dashboard = {
    cheia: false,
    cabecalho() {
      const nome = (App.estado.config.nome || '').trim();
      return { titulo: `${App.saudacao()}, ${nome || 'você'}`, sub: App.fmtDataLonga(), pilha: true };
    },
    render() {
      return `${resumo()}
        <div class="linha-grade cresce dash-grade">
          <div class="coluna div-r dash-esq">
            <div class="bloco div-b dash-cal" data-cal>${calendarioInterno()}</div>
            ${clientes()}
          </div>
          ${comissoes()}
        </div>`;
    },
    montar(area) {
      const ativar = (el, fn) => {
        el.addEventListener('click', fn);
        el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); fn(e); } });
      };

      area.querySelectorAll('[data-ir-stat]').forEach(el => ativar(el, () => {
        const t = el.dataset.irStat;
        if (t === 'falta') { const c = App.faltaResponder()[0]; if (c) App.ir('clientes', c.id); }
        else if (t === 'producao') App.ir('pedidos', null, { grupo: 'producao' });
        else if (t === 'prazo') { const p = App.atrasados()[0] || App.venceEmBreve()[0]; if (p) App.ir('pedidos', p.id); }
        else App.ir('pedidos');
      }));

      const cal = area.querySelector('[data-cal]');
      if (cal) ligarCalendario(cal);

      // clique em qualquer parte da linha (fora do "Respondi") abre a ficha; o botão interno cuida do teclado
      area.querySelectorAll('[data-linha-cliente]').forEach(el => el.addEventListener('click', (e) => {
        if (e.target.closest('[data-conversa]')) return;
        App.ir('clientes', el.dataset.linhaCliente);
      }));
      area.querySelectorAll('[data-conversa]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        App.acoes.marcarConversa(b.dataset.conversa, b.dataset.estado);
      }));

      area.querySelectorAll('[data-pedido]').forEach(el => ativar(el, () => App.ir('pedidos', el.dataset.pedido)));
      const abrir = area.querySelector('[data-abrir-pedidos]');
      if (abrir) abrir.addEventListener('click', () => App.ir('pedidos'));

      area.querySelectorAll('[data-novo-cliente]').forEach(b => b.addEventListener('click', () => {
        if (App.modais.novoCliente) App.modais.novoCliente(); else UI.toast('A janela de novo cliente ainda não está disponível.', 'erro');
      }));
      area.querySelectorAll('[data-novo-pedido]').forEach(b => b.addEventListener('click', () => {
        if (App.modais.novoPedido) App.modais.novoPedido(); else UI.toast('A janela de novo pedido ainda não está disponível.', 'erro');
      }));
    }
  };
})();
