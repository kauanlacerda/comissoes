// Tela inicial: resumo (3 números), calendário de prazos, clientes e pedidos em aberto.
// Mesmo HTML nos dois modos (cube / of); a diferença visual vem do CSS.
(function () {
  const esc = UI.esc, ic = UI.icone;

  // mês mostrado no calendário (fica entre redesenhos; volta pro mês atual ao reabrir o app)
  let mesCal = null;

  const VERMELHO = 'var(--vermelho)', VERDE = 'var(--verde)';
  const nomeDe = (clienteId) => (App.cliente(clienteId) || {}).nome || 'Cliente removido';
  const plural = (n, um, varios) => (n === 1 ? um : varios);
  const maiuscula = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const ymd = (a, m, d) => `${a}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

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

    // A fazer: legenda = o prazo mais perto entre eles (já vem ordenado por prazo)
    const aFazer = App.pedidosAFazer();
    const comPrazo = aFazer.filter(p => p.prazo);
    let legFazer = aFazer.length ? 'nenhum prazo próximo' : 'nada a fazer agora';
    if (comPrazo.length) {
      const prox = comPrazo[0].prazo;
      const d = -App.diasAte(prox);
      if (d > 0) {
        // atrasado: conta todos os atrasados (igual ao "Vence em breve"); os dias são do mais antigo
        const n = App.atrasados().length, dd = `${d} ${plural(d, 'dia', 'dias')}`;
        legFazer = `<span class="cor-vermelho">${n === 1 ? `1 atrasado há ${dd}` : `${n} atrasados há até ${dd}`}</span>`;
      } else {
        const n = comPrazo.filter(p => p.prazo === prox).length;
        legFazer = `${n} ${plural(n, 'vence', 'vencem')} ${esc(App.fmtPrazoRel(prox))}`;
      }
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
      ${stat({ rotulo: 'A fazer', ponto: 'var(--amarelo)', valor: aFazer.length, legenda: legFazer, tile: 'pincel', cor: 'var(--amarelo)', ir: aFazer.length ? 'aFazer' : '', titulo: aFazer.length ? 'Ver pedidos a fazer' : '' })}
      ${stat({ rotulo: 'Vence em breve', valor: breve.length + atras.length, legenda: legBreve, tile: 'calendario', cor: atras.length ? VERMELHO : 'var(--azul)', ir: (atras[0] || breve[0]) ? 'prazo' : '', titulo: `Prazos de hoje até ${dias} ${plural(dias, 'dia', 'dias')}${atras.length ? ', mais os atrasados' : ''}` })}
      ${stat({ rotulo: 'A receber', valor: esc(App.fmtNum(rec.porMoeda[principal] || 0)), legenda: legRec, tile: 'moeda', cor: VERDE, destaque: true, ir: 'pedidos', titulo: tituloRec })}
    </div>`;
  }

  // ---------- 2a) Calendário ----------
  function prazosPorDia() {
    const porDia = {};
    for (const p of App.proximasEntregas()) (porDia[p.prazo] = porDia[p.prazo] || []).push(p);
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
  // o que resume o cliente numa linha: o que tem a fazer, senão quanto já pediu
  function legendaCliente(c) {
    const r = App.resumoCliente(c.id);
    const tipo = App.ehServidor(c) ? 'servidor' : App.ehGrupo(c) ? 'grupo' : '';
    const ped = r.aFazer ? `${r.aFazer} a fazer` : r.total ? `${r.total} ${plural(r.total, 'pedido', 'pedidos')}` : 'sem pedidos';
    return { texto: [tipo, ped].filter(Boolean).join(' · '), ativo: r.aFazer > 0 };
  }

  function clientes() {
    const lista = App.clientesRecentes();
    const corpo = lista.length
      ? `<div class="lista dash-cli-lista" data-rolagem="dash-clientes">${lista.map(c => {
          const l = legendaCliente(c);
          return `<div class="linha clicavel dash-cli" data-linha-cliente="${esc(c.id)}">
            <button class="dash-cli-abrir" aria-label="${esc(`${c.nome}: ${l.texto}`)}">
              ${UI.avatar({ tam: 32, img: c.avatar, nome: c.nome, quadrado: App.ehServidor(c) })}
              <span class="dash-cli-txt">
                <span class="dash-nome"><span class="truncar">${esc(c.nome)}</span></span>
                <span class="dash-sub truncar ${l.ativo ? '' : 'mudo'}">${esc(l.texto)}</span>
              </span>
            </button>
          </div>`;
        }).join('')}</div>`
      : UI.vazio({
          icone: 'usuarioMais', titulo: 'Nenhum cliente ainda',
          texto: 'Cole o ID do Discord de quem te chamou e o app puxa a foto e o nome.',
          // sem clientes e sem pedidos, o vazio de Pedidos já mostra o "Novo cliente": não repete aqui
          acao: pedidosEmAberto().length ? `<button class="btn btn-sec btn-peq" data-novo-cliente>${ic('mais', 15, 2.4)}Novo cliente</button>` : ''
        });
    return `<div class="bloco dash-clientes">
      <div class="bloco-cab"><h2 class="titulo-bloco">Clientes</h2>${lista.length ? `<span class="contagem dash-direita">${lista.length}</span>` : ''}</div>
      ${corpo}
    </div>`;
  }

  // ---------- 2c) Pedidos ----------
  // o que ainda pede algo de você: a fazer (por prazo, sem prazo no fim) e depois feito mas não pago
  // (quem espera o pagamento há mais tempo primeiro)
  function pedidosEmAberto() {
    const pagar = App.pedidosFaltaPagar().sort((a, b) => (a.feitoEm || '').localeCompare(b.feitoEm || ''));
    return [...App.pedidosAFazer(), ...pagar];
  }

  function linhaPedido(p) {
    const c = App.cliente(p.clienteId) || { nome: 'Cliente removido', avatar: '' };

    let prazo1, prazo2 = '', prazoCls = 'mudo';
    if (p.feito) {
      prazo1 = '<span class="mudo">feito</span>';
      prazo2 = esc(App.fmtHa(p.feitoEm));
    } else if (p.prazo) {
      prazo1 = esc(App.fmtDia(p.prazo));
      prazo2 = esc(App.fmtPrazoRel(p.prazo));
      if (App.diasAte(p.prazo) < 0) prazoCls = 'cor-vermelho';
    } else prazo1 = '<span class="mudo">sem prazo</span>';

    const st = App.status(p), pg = App.pagamento(p);
    return `<div class="linha clicavel dash-ped" data-pedido="${esc(p.id)}" role="button" tabindex="0">
      <div class="dash-ped-cli">
        ${UI.avatar({ tam: 36, img: c.avatar, nome: c.nome, quadrado: App.ehServidor(c) })}
        <div class="dash-cli-txt">
          <div class="dash-nome"><span class="truncar">${esc(c.nome)}</span></div>
          <div class="dash-sub mudo truncar" title="${esc(p.jogo ? `${p.titulo} · ${p.jogo}` : p.titulo)}">${esc(p.titulo)}</div>
        </div>
      </div>
      <div class="dash-prazo">
        <div class="dash-prazo-1">${prazo1}</div>
        ${prazo2 ? `<div class="dash-sub ${prazoCls}">${prazo2}</div>` : ''}
      </div>
      <div>${UI.pill(st.rotulo, st.tipo)}</div>
      <div>${UI.pill(pg.rotulo, pg.tipo)}</div>
    </div>`;
  }

  function pedidos() {
    const lista = pedidosEmAberto();
    const temClientes = App.estado.clientes.length > 0;
    const corpo = lista.length
      ? `<div class="tabela dash-tabela" data-rolagem="dash-pedidos">
          <div class="tabela-cab"><span class="sobrelinha">Cliente</span><span class="sobrelinha">Prazo</span><span class="sobrelinha">Status</span><span class="sobrelinha">Pagamento</span></div>
          <div class="lista dash-com-lista">${lista.map(p => linhaPedido(p)).join('')}</div>
        </div>`
      : `<div class="dash-vazio">${temClientes
          ? UI.vazio({ icone: 'pedidos', titulo: 'Nada pendente', texto: 'O que falta fazer ou receber aparece aqui. Quando alguém fechar um pedido, é só registrar.', acao: `<button class="btn btn-primario btn-peq" data-novo-pedido>${ic('mais', 15, 2.4)}Novo pedido</button>` })
          : UI.vazio({ icone: 'pedidos', titulo: 'Nada pendente', texto: 'Primeiro adicione o cliente pelo ID do Discord. Depois é só registrar o pedido dele.', acao: `<button class="btn btn-primario btn-peq" data-novo-cliente>${ic('usuarioMais', 15, 2.2)}Novo cliente</button>` })}</div>`;
    return `<div class="bloco cresce dash-com">
      <div class="bloco-cab"><h2 class="titulo-bloco">Pedidos</h2>${lista.length ? `<span class="contagem">${lista.length} em aberto</span>` : ''}
        <button class="link dash-direita" data-abrir-pedidos>Abrir pedidos</button></div>
      ${corpo}
    </div>`;
  }

  // ---------- Tela ----------
  App.telas.dashboard = {
    cheia: false,
    cabecalho() {
      const nome = (App.estado.config.nome || '').trim();
      return { titulo: `${App.saudacao()}, ${nome || 'você'}`, sub: App.fmtDataLonga() };
    },
    render() {
      return `${resumo()}
        <div class="linha-grade cresce dash-grade">
          <div class="coluna div-r dash-esq">
            <div class="bloco div-b dash-cal" data-cal>${calendarioInterno()}</div>
            ${clientes()}
          </div>
          ${pedidos()}
        </div>`;
    },
    montar(area) {
      const ativar = (el, fn) => {
        el.addEventListener('click', fn);
        el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); fn(e); } });
      };

      area.querySelectorAll('[data-ir-stat]').forEach(el => ativar(el, () => {
        const t = el.dataset.irStat;
        if (t === 'aFazer') App.ir('pedidos', null, { grupo: 'aFazer' });
        else if (t === 'prazo') { const p = App.atrasados()[0] || App.venceEmBreve()[0]; if (p) App.ir('pedidos', p.id); }
        else App.ir('pedidos');
      }));

      const cal = area.querySelector('[data-cal]');
      if (cal) ligarCalendario(cal);

      // clique em qualquer parte da linha abre a ficha; o botão interno cuida do teclado
      area.querySelectorAll('[data-linha-cliente]').forEach(el => el.addEventListener('click', () => App.ir('clientes', el.dataset.linhaCliente)));

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
