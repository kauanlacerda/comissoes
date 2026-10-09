// Tela Pedidos: lista por grupo | detalhe do pedido | painel do cliente.
// Também define os modais App.modais.novoPedido / editarPedido / registrarPagamento.
(function () {
  const esc = UI.esc, ic = UI.icone;

  // ---------- Estado local da tela (não vai pro disco) ----------
  let concluidosAberto = false;
  let rotaVista = null;          // rota já tratada (rolar até o grupo/pedido só uma vez por navegação)
  let pedidoVisto = null;        // último pedido mostrado no detalhe (volta o detalhe pro topo ao trocar)
  let etapaVista = null;         // etapa desse pedido no último desenho (abre "Concluídos" quando ele acaba de concluir)
  const refsCache = {};          // pedidoId -> [{nome, caminho, url}]
  const filas = {};              // pedidoId -> Promise: uma leva de imagens da entrega por vez
  const reservas = {};           // pedidoId -> {espaço: n} espaços escolhidos por levas que ainda esperam na fila

  // arquivo solto sem caminho no disco: no app, é imagem arrastada direto do Discord ou do navegador
  const SEM_CAMINHO = App.noApp
    ? 'Imagem arrastada direto do Discord ou do navegador não tem arquivo. Salve no computador e arraste o arquivo salvo.'
    : 'Isso só funciona no app instalado.';
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const CHIP = { aceito: 'Aceito', comecado: 'Em produção', entregue: 'Entregue', aprovado: 'Aguardando pagamento', pago: 'Concluído' };

  // ---------- Utilidades locais ----------
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const corSegura = (cor) => (/^#[0-9a-f]{3,8}$/i.test(String(cor || '')) ? cor : '#2b4a78');
  const clienteDe = (p) => App.cliente(p.clienteId) || { id: '', nome: 'Cliente removido', username: '', avatar: '', corPerfil: '', discordId: '', conversa: { estado: 'respondido', desde: '' } };
  const esperando = (c) => !!(c && c.conversa && c.conversa.estado === 'falta');
  const emAberto = (p) => p.etapa === 'aceito' || p.etapa === 'comecado';

  // 'em 2 d' | 'hoje' | 'amanhã' | 'atrasado 1 d' | 'sem prazo'
  function prazoCurto(ymd) {
    const n = App.diasAte(ymd);
    if (n == null) return 'sem prazo';
    if (n === 0) return 'hoje';
    if (n === 1) return 'amanhã';
    return n > 0 ? `em ${n} d` : `atrasado ${-n} d`;
  }
  // dias inteiros desde um ISO (0 = hoje)
  function diasDesde(iso) {
    if (!iso) return null;
    const d = new Date(iso); if (isNaN(d)) return null;
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return -App.diasAte(ymd);
  }

  const porPrazo = (a, b) => (a.prazo || '9999-99-99').localeCompare(b.prazo || '9999-99-99') || (a.criadoEm || '').localeCompare(b.criadoEm || '');
  const porConclusao = (a, b) => (b.concluidoEm || '').localeCompare(a.concluidoEm || '');
  function doGrupo(id) {
    const ps = App.estado.pedidos.filter(p => App.grupoDe(p).id === id);
    return ps.sort(id === 'concluidos' ? porConclusao : porPrazo);
  }
  const gruposAtivos = () => App.GRUPOS.filter(g => g.id !== 'concluidos');
  const ativosEmOrdem = () => gruposAtivos().flatMap(g => doGrupo(g.id));

  // pedido selecionado: rota → primeiro do grupo pedido → primeiro ativo da lista → qualquer um
  function pedidoAtual() {
    const r = App.rota || {};
    const p = r.id ? App.pedido(r.id) : null;
    if (p) return p;
    if (r.grupo) { const g = doGrupo(r.grupo)[0]; if (g) return g; }
    return ativosEmOrdem()[0] || doGrupo('concluidos')[0] || App.estado.pedidos[0] || null;
  }

  // segunda linha do item da lista (já escapada)
  function legendaItem(p) {
    switch (p.etapa) {
      case 'aceito':
      case 'comecado': {
        const t = prazoCurto(p.prazo);
        const n = App.diasAte(p.prazo);
        return n != null && n < 0 ? `<span class="cor-vermelho">${esc(t)}</span>` : esc(t);
      }
      case 'entregue': {
        const n = diasDesde(p.etapaEm && p.etapaEm.entregue);
        return n == null ? 'entregue' : n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} d`;
      }
      case 'aprovado': return 'aprovado';
      default: return p.concluidoEm ? esc(App.fmtDataCurta(p.concluidoEm)) : 'concluído';
    }
  }

  // ---------- Cabeçalho ----------
  function cabecalho() {
    const n = App.pedidosAtivos().length;
    const m = App.faltaResponder().length;
    return {
      titulo: 'Pedidos',
      sub: `${plural(n, 'ativo', 'ativos')} · ${m ? `${m} esperando resposta` : 'ninguém esperando resposta'}`,
      botao: { rotulo: 'Novo pedido', icone: 'mais', acao: () => App.modais.novoPedido() }
    };
  }

  // ---------- Render ----------
  function render() {
    if (!App.estado.pedidos.length) return renderVazio();
    const r = App.rota || {};
    const p = pedidoAtual();
    // abre "Concluídos" ao navegar até lá e também quando o pedido aberto acaba de concluir (a rota não muda)
    const concluiuAgora = p && p.etapa === 'pago' && p.id === pedidoVisto && etapaVista != null && etapaVista !== 'pago';
    if ((r !== rotaVista && (r.grupo === 'concluidos' || (p && p.etapa === 'pago'))) || concluiuAgora) concluidosAberto = true;
    return `<div class="paineis ped" data-pedido="${esc(p.id)}">${renderLista(p)}${renderDetalhe(p)}${renderCliente(p)}</div>`;
  }

  function renderVazio() {
    const temClientes = App.estado.clientes.length > 0;
    const acao = temClientes
      ? `<button class="btn btn-primario" data-vazio-acao="pedido">${ic('mais', 16, 2.4)}Novo pedido</button>`
      : `<button class="btn btn-primario" data-vazio-acao="cliente">${ic('usuarioMais', 17)}Adicionar cliente</button>`;
    return `<div class="bloco cresce ped-vazio">${UI.vazio({
      icone: 'pedidos',
      titulo: 'Nenhum pedido ainda',
      texto: temClientes
        ? 'Quando alguém fechar uma comissão no Discord, registre aqui o prazo, o valor e as thumbs de cada entrega.'
        : 'Todo pedido é de um cliente. Adicione o primeiro pelo ID do Discord — nome e foto vêm sozinhos.',
      acao
    })}</div>`;
  }

  function itemHtml(p, sel) {
    const c = clienteDe(p);
    return `<button class="item ${sel && sel.id === p.id ? 'ativo' : ''}" data-ir-pedido="${esc(p.id)}" title="${esc(p.titulo)} — ${esc(c.nome)}">
      ${UI.avatar({ tam: 34, img: c.avatar, nome: c.nome })}
      <span class="ped-item-txt"><span class="t1">${esc(p.titulo)}</span><span class="t2">${esc(c.nome)} · ${legendaItem(p)}</span></span>
      ${esperando(c) ? `<span class="ped-item-ponto" title="Esperando resposta">${UI.ponto('var(--vermelho)')}</span>` : ''}
    </button>`;
  }

  function renderLista(sel) {
    const ativos = App.pedidosAtivos().length;
    const grupos = gruposAtivos().map(g => {
      const ps = doGrupo(g.id);
      if (!ps.length) return '';
      return `<div class="ped-grupo" data-grupo="${g.id}"><div class="grupo-rot sobrelinha">${esc(g.rotulo)} · ${ps.length}</div>${ps.map(p => itemHtml(p, sel)).join('')}</div>`;
    }).join('');
    const concl = doGrupo('concluidos');
    const conclHtml = concl.length ? `<div class="ped-grupo ped-grupo-concl" data-grupo="concluidos">
        <button class="grupo-rot sobrelinha ped-concl" data-concluidos aria-expanded="${concluidosAberto}">
          <span>Concluídos · ${concl.length}</span><span class="ped-concl-chev">${ic('chevB', 15)}</span></button>
        <div class="ped-concl-lista" ${concluidosAberto ? '' : 'hidden'}>${concl.map(p => itemHtml(p, sel)).join('')}</div>
      </div>` : '';
    return `<nav class="bloco div-r ped-lista" data-rolagem="lista-pedidos" aria-label="Lista de pedidos">
      <div class="ped-lista-cab"><h2 class="titulo-bloco">Pedidos</h2><span class="contagem">${plural(ativos, 'ativo', 'ativos')}</span></div>
      ${grupos || `<div class="mudo pequeno ped-lista-nada">Nenhum pedido ativo agora.</div>`}
      ${conclHtml}
    </nav>`;
  }

  function renderEtapas(p) {
    const atual = App.indiceEtapa(p.etapa);
    const tudo = p.etapa === 'pago';
    return `<div class="etapas" role="group" aria-label="Etapa do pedido">${App.ETAPAS.map((e, i) => {
      const cls = tudo || i < atual ? 'feito' : i === atual ? 'atual' : '';
      return `<button class="etapa ${cls}" data-etapa="${e.id}" aria-pressed="${i === atual}" title="${i === atual ? 'Etapa atual' : 'Mudar para ' + esc(e.rotulo)}"><span class="barra"></span><span class="nome">${esc(e.rotulo)}</span></button>`;
    }).join('')}</div>`;
  }

  function refsHtml(lista) {
    if (!lista) return `<div class="ped-refs-vazio">Carregando…</div>`;
    if (!lista.length) return `<div class="ped-refs-vazio">${ic('imagem', 16)}<span>Arraste as referências aqui</span></div>`;
    return lista.map(r => `<button class="ref" data-ref title="${esc(r.nome)} — abrir a pasta">${ic('imagem', 16)}<img src="${esc(r.url)}" alt="${esc(r.nome)}" loading="lazy"></button>`).join('');
  }

  function slotHtml(p, i) {
    const e = p.entregas[i];
    if (e && e.url) {
      // botão transparente por cima da imagem: abre a pasta pelo teclado também (sem botão dentro de botão)
      return `<div class="slot cheio" data-slot="${i}" title="Espaço ${i + 1} — clique para abrir a pasta de entrega">
        <img src="${esc(e.url)}" alt="Entrega ${i + 1}">
        <button class="ped-slot-abrir" aria-label="Espaço ${i + 1}: abrir a pasta de entrega"></button>
        <span class="ped-slot-num">${i + 1}</span>
        <button class="btn btn-sec btn-peq btn-icone remover" data-remover="${i}" title="Tirar esta imagem" aria-label="Tirar a imagem do espaço ${i + 1}">${ic('x', 15, 2.2)}</button>
      </div>`;
    }
    return `<div class="slot" data-slot="${i}" role="button" tabindex="0" aria-label="Espaço ${i + 1}: escolher imagem"><span class="num">${i + 1}</span><span>Arraste a thumb aqui</span></div>`;
  }

  function renderDetalhe(p) {
    const c = clienteDe(p);
    const n = p.qtd, x = App.entreguesNoPedido(p);
    const titulo = p.jogo || p.titulo;
    // o progresso nunca é cortado: só o título encolhe
    const progresso = `${x} de ${n} ${n === 1 ? 'entregue' : 'entregues'}${p.rodada > 1 ? ' · rodada ' + p.rodada : ''}`;
    const refs = refsCache[p.id];
    const ajustes = (p.ajustes || []).slice().reverse();
    return `<section class="bloco sem-pad cresce ped-detalhe" data-rolagem="detalhe-pedido" aria-label="Detalhe do pedido">
      <div class="capa" style="--cor-capa:${corSegura(c.corPerfil)}">
        <div class="ped-capa-txt"><h2 class="truncar" title="${esc(titulo)}">${esc(titulo)}</h2><div class="ped-capa-sub">${p.jogo ? `<span class="truncar" title="${esc(p.titulo)}">${esc(p.titulo)}</span><span aria-hidden="true">·</span>` : ''}<span class="ped-capa-cont">${progresso}</span></div></div>
        <span class="chip">${esc(CHIP[p.etapa] || App.rotuloEtapa(p.etapa))}</span>
      </div>
      <div class="ped-corpo">
        ${renderEtapas(p)}

        <section class="ped-secao ped-refs" data-refs-zona>
          <div class="bloco-cab">
            <h3 class="titulo-bloco ped-secao-tit">Referências do cliente</h3><span class="contagem" data-refs-cont>${refs ? refs.length : ''}</span>
            <span class="ped-links">
              <button class="link" data-refs-add>${ic('mais', 15, 2.4)}Adicionar</button>
              <button class="link" data-refs-pasta>${ic('pasta', 15)}Abrir pasta</button>
            </span>
          </div>
          <div class="ped-refs-grade" data-refs>${refsHtml(refs)}</div>
        </section>

        <section class="ped-secao">
          <div class="bloco-cab">
            <h3 class="titulo-bloco ped-secao-tit">Entrega</h3><span class="contagem">${x} de ${n}</span>
            <span class="ped-links"><button class="link" data-entrega-pasta>${ic('pasta', 15)}Abrir pasta de entrega</button></span>
          </div>
          <div class="slots">${Array.from({ length: n }, (_, i) => slotHtml(p, i)).join('')}</div>
        </section>

        ${ajustes.length ? `<section class="ped-secao">
          <div class="bloco-cab"><h3 class="titulo-bloco ped-secao-tit">Pedidos de ajuste</h3><span class="contagem">${ajustes.length}</span></div>
          <div class="ped-ajustes">${ajustes.map(a => `<div class="ped-ajuste">
            <div class="sobrelinha">Rodada ${esc(a.rodada)} · ${esc(App.fmtHa(a.em))}</div>
            <div class="caixa">${a.texto ? esc(a.texto) : '<span class="apagado">Sem descrição.</span>'}</div>
          </div>`).join('')}</div>
        </section>` : ''}

        <section class="ped-secao">
          <div class="bloco-cab"><h3 class="titulo-bloco ped-secao-tit"><label for="ped-notas">Notas do pedido</label></h3></div>
          <textarea class="input ped-notas" id="ped-notas" data-notas placeholder="Combinados, cores, texto da thumb, o que o cliente falou…">${esc(p.notas)}</textarea>
        </section>
      </div>
    </section>`;
  }

  // fato "Prazo": cor só enquanto o pedido ainda não foi entregue
  function fatoPrazo(p) {
    if (!p.prazo) return { rot: 'Prazo', val: '—', cls: '' };
    const d = App.diasAte(p.prazo);
    if (!emAberto(p)) {
      // já entregue: dia da semana só perto de hoje; longe disso, dia e mês ('qua, 9' de um mês atrás parece que ainda vem)
      const dt = App.paraData(p.prazo);
      const val = Math.abs(d) <= 6 ? App.fmtDia(p.prazo) : `${dt.getDate()} ${MES[dt.getMonth()]}`;
      return { rot: 'Prazo', val, cls: '', titulo: `Prazo ${d < 0 ? 'era' : 'é'} ${App.fmtDiaLongo(p.prazo)} de ${App.MES_LONGO[dt.getMonth()]}` };
    }
    if (d < 0) return { rot: 'Atrasado', val: `${-d} d`, cls: 'cor-vermelho', titulo: `Atrasado ${-d === 1 ? '1 dia' : -d + ' dias'} — venceu ${App.fmtDiaLongo(p.prazo)}` };
    const alerta = d <= (App.estado.config.prazoAlertaDias ?? 2);
    return { rot: 'Prazo', val: d === 0 ? 'hoje' : `em ${d} d`, cls: alerta ? 'cor-amarelo' : '', titulo: `Vence ${App.fmtDiaLongo(p.prazo)}` };
  }
  function fatoPago(p) {
    const pg = App.pagamento(p);
    const curto = { sem: '—', nao: 'não', metade: 'metade', pago: 'sim' }[pg.chave]
      || `${Math.round(((+p.recebido || 0) / (+p.valor || 1)) * 100)}%`;
    const det = pg.chave === 'sem' ? 'Sem valor definido' : `${pg.rotulo}: ${App.fmtValor(p.recebido, p.moeda)} de ${App.fmtValor(p.valor, p.moeda)}`;
    return { val: curto, titulo: det, cls: pg.chave === 'pago' ? 'cor-verde' : '' };
  }

  function renderCliente(p) {
    const c = clienteDe(p);
    const falta = esperando(c);
    const fp = fatoPrazo(p), fg = fatoPago(p);
    const idx = App.indiceEtapa(p.etapa);
    const n = p.qtd, x = App.entreguesNoPedido(p);
    const faltaReceber = App.falta(p);
    const desde = c.conversa && c.conversa.desde ? App.fmtHa(c.conversa.desde) : '';
    const dicaEntregar = idx >= 2 ? 'já entregue' : `${x} de ${n} ${n === 1 ? 'pronta' : 'prontas'}`;
    const podeAjuste = p.etapa === 'entregue' || p.etapa === 'aprovado';
    const dicaAjuste = podeAjuste ? `abre rodada ${p.rodada + 1}` : p.etapa === 'pago' ? 'concluído' : 'nada entregue';
    const dicaAprovou = p.etapa === 'entregue' ? `rodada ${p.rodada}` : idx >= 3 ? 'aprovado' : 'nada entregue';
    return `<aside class="bloco sem-pad div-l ped-cli" aria-label="Cliente do pedido">
      <div class="perfil-topo" style="--cor-capa:${corSegura(c.corPerfil)}"><div class="capa-mini"></div>${UI.avatar({ tam: 72, img: c.avatar, nome: c.nome })}</div>
      <div class="ped-cli-corpo">
        <div class="ped-cli-nome">
          ${c.id ? `<button class="ped-cli-titulo truncar" data-ficha title="Ver ficha de ${esc(c.nome)}">${esc(c.nome)}</button>` : `<div class="ped-cli-titulo truncar">${esc(c.nome)}</div>`}
          <div class="ped-cli-sub truncar">${App.ehGrupo(c) ? 'Grupo · ' : c.username ? '@' + esc(c.username) + ' · ' : ''}${esc(p.titulo)}</div>
        </div>
        <div class="fatos" style="--n:3">
          <div class="fato" ${fp.titulo ? `title="${esc(fp.titulo)}"` : ''}><span class="fato-rotulo ${fp.rot === 'Atrasado' ? fp.cls : ''}">${fp.rot}</span><span class="fato-valor ${fp.cls}">${esc(fp.val)}</span></div>
          <div class="fato" title="${esc(fg.titulo)}"><span class="fato-rotulo">Pago</span><span class="fato-valor ${fg.cls}">${esc(fg.val)}</span></div>
          <div class="fato"><span class="fato-rotulo">Rodada</span><span class="fato-valor">${esc(p.rodada)}</span></div>
        </div>
        ${c.id ? `<div class="caixa ped-conversa">
          ${UI.avatar({ tam: 32, img: c.avatar, nome: c.nome, classe: falta ? 'anel-falta' : 'anel-ok' })}
          <div class="ped-conv-txt"><div class="ped-conv-t1">${falta ? 'Falta responder' : 'Respondido'}</div>
            <div class="ped-conv-t2 ${falta ? 'cor-vermelho' : 'cor-verde'}">${falta ? 'Esperando' + (desde ? ' ' + esc(desde) : '') : (desde ? esc(desde) : 'em dia')}</div></div>
          <button class="btn btn-texto" data-conversa>${falta ? 'Respondi' : 'Nova msg'}</button>
        </div>` : ''}
        <div class="ped-espaco"></div>
        <div class="ped-acoes">
          <button class="btn btn-primario btn-bloco" data-acao="adicionar">${ic('upload', 18)}Adicionar trabalho</button>
          <button class="btn btn-sec btn-bloco" data-acao="entregar" ${idx >= 2 ? 'disabled' : ''}>${ic('check', 18)}Entregar<span class="dica">${dicaEntregar}</span></button>
          <button class="btn btn-sec btn-bloco" data-acao="ajuste" ${podeAjuste ? '' : 'disabled'}>${ic('atualizar', 18)}Pediu ajuste<span class="dica">${dicaAjuste}</span></button>
          <button class="btn btn-acento btn-bloco" data-acao="gamepass" ${faltaReceber > 0 && p.moeda === 'Robux' ? '' : 'disabled'} title="${p.moeda === 'Robux' ? 'Copia a mensagem com o valor que falta e o link do gamepass' : 'Gamepass só serve para pedidos em Robux'}">${ic('enviar', 18)}Enviar gamepass</button>
          <button class="btn btn-sec btn-bloco" data-acao="aprovou" ${p.etapa === 'entregue' ? '' : 'disabled'}>${ic('joinha', 18)}Cliente aprovou<span class="dica">${dicaAprovou}</span></button>
          <button class="btn btn-acento btn-bloco" data-acao="pago" ${faltaReceber > 0 ? '' : 'disabled'}>${ic('dinheiro', 18)}Marcar pago</button>
        </div>
        <button class="link ped-mais" data-mais aria-haspopup="menu">Mais opções ${ic('chevB', 15)}</button>
      </div>
    </aside>`;
  }

  // ---------- Arrastar e soltar ----------
  const temArquivos = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  function ligarSoltar(el, aoSoltar) {
    let cont = 0;
    el.addEventListener('dragenter', (e) => { if (!temArquivos(e)) return; e.preventDefault(); cont++; el.classList.add('arrastando'); });
    el.addEventListener('dragover', (e) => { if (!temArquivos(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('dragleave', () => { cont = Math.max(0, cont - 1); if (!cont) el.classList.remove('arrastando'); });
    el.addEventListener('drop', (e) => {
      if (!temArquivos(e)) return;
      e.preventDefault(); e.stopPropagation();
      cont = 0; el.classList.remove('arrastando');
      const arquivos = Array.from(e.dataTransfer.files || []);
      if (arquivos.length) aoSoltar(arquivos.map(f => App.api.arquivos.caminhoDe(f) || ''));
    });
  }

  // ---------- Referências ----------
  async function carregarRefs(pedidoId) {
    let lista = [];
    try { lista = (await App.api.arquivos.listar(pedidoId, 'referencias')) || []; } catch { lista = []; }
    const antes = refsCache[pedidoId];
    refsCache[pedidoId] = lista;
    const mudou = !antes || antes.map(r => r.url).join('|') !== lista.map(r => r.url).join('|');
    const raiz = document.querySelector('#area .ped');
    if (!mudou || !raiz || raiz.dataset.pedido !== pedidoId) return;
    const grade = raiz.querySelector('[data-refs]'), cont = raiz.querySelector('[data-refs-cont]');
    if (grade) grade.innerHTML = refsHtml(lista);
    if (cont) cont.textContent = String(lista.length);
  }

  async function importarRefs(pedidoId, caminhos) {
    if (!caminhos.length) return;
    let ok = 0; const erros = [];
    for (const caminho of caminhos) {
      if (!caminho) { erros.push(SEM_CAMINHO); continue; }
      let r;
      try { r = await App.api.arquivos.importar({ pedidoId, tipo: 'referencias', caminho }); } catch { r = null; }
      if (r && r.ok) ok++; else erros.push((r && r.erro) || 'Não deu pra copiar a imagem.');
    }
    if (erros.length) UI.toast(erros.length > 1 ? `${erros[0]} (${erros.length} arquivos não entraram)` : erros[0], 'erro');
    if (ok) { UI.toast(ok === 1 ? 'Referência adicionada.' : `${ok} referências adicionadas.`, 'ok'); await carregarRefs(pedidoId); }
  }

  // ---------- Entrega ----------
  async function colocarNaEntrega(pedidoId, caminho, i) {
    let r;
    try { r = await App.api.arquivos.importar({ pedidoId, tipo: 'entrega', caminho, slot: i }); } catch { r = null; }
    if (!r || !r.ok) { UI.toast((r && r.erro) || 'Não deu pra copiar a imagem.', 'erro'); return false; }
    App.acoes.definirEntrega(pedidoId, i, { caminho: r.caminho, url: r.url });
    return true;
  }

  // Põe imagens na entrega, uma leva por pedido de cada vez: soltar de novo no meio de uma importação
  // espera a anterior (senão as duas escolhem os mesmos espaços e uma imagem sobrescreve a outra).
  // O espaço onde a pessoa soltou fica reservado já na hora, para a leva anterior não ocupá-lo com as que sobram.
  function levarPraEntrega(pedidoId, caminhos, inicio = null) {
    const r = reservas[pedidoId] = reservas[pedidoId] || {};
    if (inicio != null) r[inicio] = (r[inicio] || 0) + 1;
    filas[pedidoId] = (filas[pedidoId] || Promise.resolve())
      .then(() => distribuir(pedidoId, caminhos, inicio))
      .catch((e) => { console.error(e); UI.toast('Não deu pra colocar as imagens na entrega.', 'erro'); })
      .finally(() => { if (inicio != null) r[inicio]--; });
    return filas[pedidoId];
  }

  // inicio = espaço onde a pessoa soltou (ou null = só os vazios, em ordem).
  // Relê o pedido antes de cada imagem: o espaço livre é decidido na hora, não no começo da leva.
  async function distribuir(pedidoId, caminhos, inicio) {
    if (!App.pedido(pedidoId) || !caminhos.length) return;
    if (caminhos.some(c => !c)) { UI.toast(SEM_CAMINHO, 'erro'); return; }
    const reservado = (i) => i !== inicio && (reservas[pedidoId] || {})[i] > 0;
    let ok = 0, usados = 0;
    for (const caminho of caminhos) {
      const p = App.pedido(pedidoId); if (!p) return;
      // a 1ª vai onde a pessoa soltou (troca, se já tinha); as outras vão pros vazios seguintes, dando a volta
      const ordem = Array.from({ length: p.qtd }, (_, k) => (inicio == null ? k : (inicio + k) % p.qtd));
      const alvo = !usados && inicio != null && inicio < p.qtd ? inicio : ordem.find(i => !p.entregas[i] && !reservado(i));
      if (alvo == null) break;
      usados++;
      if (await colocarNaEntrega(pedidoId, caminho, alvo)) ok++;
    }
    const sobra = caminhos.length - usados;
    if (!usados) {
      const p = App.pedido(pedidoId);
      UI.toast(`Os ${p ? p.qtd : ''} espaços já estão cheios. Tire uma imagem para trocar.`, 'erro');
    } else if (sobra > 0) {
      UI.toast(`${usados === 1 ? 'Só cabia 1' : `Só cabiam ${usados}`} — ${sobra === 1 ? '1 imagem ficou' : sobra + ' imagens ficaram'} de fora.`, 'erro');
    } else if (ok > 1) UI.toast(`${ok} imagens na entrega.`, 'ok');
  }

  async function escolherParaSlot(pedidoId, i) {
    let cs = [];
    try { cs = (await App.api.arquivos.escolherImagens(false)) || []; } catch { cs = []; }
    if (cs[0]) await levarPraEntrega(pedidoId, [cs[0]], i);
  }

  async function tirarDoSlot(pedidoId, i) {
    const p = App.pedido(pedidoId); if (!p) return;
    const e = p.entregas[i];
    App.acoes.definirEntrega(pedidoId, i, null);
    if (e && e.caminho) { try { await App.api.arquivos.remover(e.caminho); } catch {} }
  }

  // ---------- Ações ----------
  async function irParaEtapa(pedidoId, etapa) {
    const p = App.pedido(pedidoId); if (!p) return;
    const atual = App.indiceEtapa(p.etapa), alvo = App.indiceEtapa(etapa);
    if (alvo < 0 || alvo === atual) return;
    // de Pago para Aprovado com tudo pago, o núcleo conclui de novo na hora: avisa em vez de confirmar à toa
    if (p.etapa === 'pago' && etapa === 'aprovado' && (+p.valor || 0) > 0 && App.falta(p) <= 0) {
      UI.toast('Com tudo pago, “Aprovado” vira Concluído sozinho. Para reabrir, volte para “Entregue” ou edite o valor recebido.');
      return;
    }
    if (alvo < atual) {
      const ok = await UI.confirmar({ titulo: `Voltar para “${App.rotuloEtapa(etapa)}”?`, texto: 'O pedido volta de etapa. Pagamentos, imagens e rodada continuam como estão.', ok: 'Voltar etapa' });
      if (!ok) return;
    } else if (etapa === 'pago' && App.falta(p) > 0) {
      const ok = await UI.confirmar({ titulo: 'Marcar como pago?', texto: `Isso conta os ${App.fmtValor(App.falta(p), p.moeda)} que faltam como recebidos e conclui o pedido.`, ok: 'Marcar pago' });
      if (!ok) return;
    }
    App.acoes.mudarEtapa(pedidoId, etapa);
  }

  async function entregar(pedidoId) {
    const p = App.pedido(pedidoId); if (!p) return;
    const x = App.entreguesNoPedido(p);
    if (x < p.qtd) {
      const ok = await UI.confirmar({ titulo: 'Entregar assim mesmo?', texto: `Só ${x} de ${p.qtd} ${p.qtd === 1 ? 'imagem está pronta' : 'imagens estão prontas'} na entrega. Marcar o pedido como entregue mesmo assim?`, ok: 'Marcar entregue' });
      if (!ok) return;
    }
    App.acoes.mudarEtapa(pedidoId, 'entregue');
    UI.toast('Pedido entregue. Agora é esperar o cliente aprovar.', 'ok');
  }

  async function pediuAjuste(pedidoId) {
    const p = App.pedido(pedidoId); if (!p) return;
    const t = await UI.perguntar({
      titulo: 'Pediu ajuste', sub: `Fecha a rodada ${p.rodada} e começa a rodada ${p.rodada + 1}.`,
      rotulo: 'O que o cliente pediu?', multilinha: true, ok: 'Registrar ajuste',
      placeholder: 'Ex.: título maior, fundo de noite, trocar a pose do personagem'
    });
    if (t == null) return;
    App.acoes.pedirAjuste(pedidoId, t);
    const q = App.pedido(pedidoId);
    UI.toast(`Rodada ${q ? q.rodada : p.rodada + 1} começou — o pedido voltou para produção.`, 'ok');
  }

  function enviarGamepass(pedidoId) {
    const p = App.pedido(pedidoId); if (!p) return;
    if (p.moeda !== 'Robux') { UI.toast('Gamepass só serve para pedidos em Robux.', 'erro'); return; }
    const cfg = App.estado.config;
    const link = String(cfg.linkGamepass || '').trim();
    if (!link) { UI.toast('Falta o link do gamepass. Coloque em Configurações.', 'erro'); return; }
    const valor = App.fmtValor(App.falta(p), p.moeda);
    const msg = String(cfg.msgGamepass || 'Pode comprar o gamepass de {valor} quando puder: {link}')
      .replace(/\{valor\}/g, () => valor).replace(/\{link\}/g, () => link);
    App.copiar(msg, 'Mensagem copiada — cole no Discord');
  }

  function clienteAprovou(pedidoId) {
    App.acoes.mudarEtapa(pedidoId, 'aprovado');
    const p = App.pedido(pedidoId); if (!p) return;
    if (p.etapa === 'pago') UI.toast('Aprovado e já pago — pedido concluído.', 'ok');
    else UI.toast(App.falta(p) > 0 ? `Aprovado. Falta receber ${App.fmtValor(App.falta(p), p.moeda)}.` : 'Aprovado.', 'ok');
  }

  function abrirNovoCliente() {
    if (App.modais.novoCliente) App.modais.novoCliente();
    else App.ir('clientes');
  }

  function abrirMaisOpcoes(btn, pedidoId) {
    const p = App.pedido(pedidoId); if (!p) return;
    const c = App.cliente(p.clienteId);
    UI.menu(btn, `
      <button class="item" data-m="editar">${ic('lapis', 17)}<span class="t1">Editar pedido</span></button>
      ${c ? `<button class="item" data-m="discord">${ic('discord', 17)}<span class="t1">Abrir no Discord</span></button>
      <button class="item" data-m="ficha">${ic('clientes', 17)}<span class="t1">Ver ficha do cliente</span></button>` : ''}
      <button class="item ped-menu-perigo" data-m="excluir">${ic('lixo', 17)}<span class="t1">Excluir pedido</span></button>`,
    (m, fechar) => {
      // o botão fica no pé do painel: abre o menu para cima e centralizado nele
      m.classList.add('ped-menu');
      const r = btn.getBoundingClientRect();
      const h = m.offsetHeight, w = m.offsetWidth;
      if (r.bottom + 8 + h > window.innerHeight - 8) m.style.top = Math.max(8, r.top - 8 - h) + 'px';
      m.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + 'px';
      m.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', async () => {
        fechar();
        const acao = b.dataset.m;
        if (acao === 'editar') App.modais.editarPedido(pedidoId);
        else if (acao === 'discord') App.abrirDiscord(c);
        else if (acao === 'ficha') App.ir('clientes', c.id);
        else if (acao === 'excluir') {
          const ok = await UI.confirmar({ titulo: 'Excluir este pedido?', texto: `“${p.titulo}” some da lista e as imagens dele (referências e entrega) são apagadas do computador. Não dá pra desfazer.`, ok: 'Excluir pedido', perigo: true });
          if (!ok) return;
          App.acoes.removerPedido(pedidoId);
          delete refsCache[pedidoId];
          App.ir('pedidos');
          UI.toast('Pedido excluído.');
        }
      }));
    });
  }

  // ---------- Montar (eventos) ----------
  function montar(area) {
    const raiz = area.querySelector('.ped');
    if (!raiz) {
      const b = area.querySelector('[data-vazio-acao]');
      if (b) b.addEventListener('click', () => (b.dataset.vazioAcao === 'cliente' ? abrirNovoCliente() : App.modais.novoPedido()));
      return;
    }
    const id = raiz.dataset.pedido;
    const p = App.pedido(id); if (!p) return;
    const $ = (s) => raiz.querySelector(s);
    const $$ = (s) => Array.from(raiz.querySelectorAll(s));

    // lista
    $$('[data-ir-pedido]').forEach(b => b.addEventListener('click', () => App.ir('pedidos', b.dataset.irPedido)));
    const concl = $('[data-concluidos]');
    if (concl) concl.addEventListener('click', () => {
      concluidosAberto = !concluidosAberto;
      concl.setAttribute('aria-expanded', String(concluidosAberto));
      const l = raiz.querySelector('.ped-concl-lista'); if (l) l.hidden = !concluidosAberto;
    });

    // detalhe
    $$('[data-etapa]').forEach(b => b.addEventListener('click', () => irParaEtapa(id, b.dataset.etapa)));
    ligarSoltar($('[data-refs-zona]'), (cs) => importarRefs(id, cs));
    $('[data-refs-add]').addEventListener('click', async () => {
      let cs = [];
      try { cs = (await App.api.arquivos.escolherImagens(true)) || []; } catch { cs = []; }
      if (cs.length) importarRefs(id, cs);
    });
    $('[data-refs-pasta]').addEventListener('click', () => App.api.arquivos.abrirPasta(id, 'referencias'));
    $('[data-refs]').addEventListener('click', (e) => { if (e.target.closest('[data-ref]')) App.api.arquivos.abrirPasta(id, 'referencias'); });
    $('[data-entrega-pasta]').addEventListener('click', () => App.api.arquivos.abrirPasta(id, 'entrega'));

    $$('[data-slot]').forEach(s => {
      const i = +s.dataset.slot;
      const cheio = s.classList.contains('cheio');
      s.addEventListener('click', (e) => {
        if (e.target.closest('[data-remover]')) return;
        if (cheio) App.api.arquivos.abrirPasta(id, 'entrega'); else escolherParaSlot(id, i);
      });
      if (!cheio) s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolherParaSlot(id, i); } });
      ligarSoltar(s, (cs) => levarPraEntrega(id, cs, i));
    });
    $$('[data-remover]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); tirarDoSlot(id, +b.dataset.remover); }));

    const notas = $('[data-notas]');
    notas.addEventListener('input', () => App.acoes.atualizarPedido(id, { notas: notas.value }, { render: false }));

    // cliente
    const ficha = $('[data-ficha]');
    if (ficha) ficha.addEventListener('click', () => App.ir('clientes', p.clienteId));
    const conv = $('[data-conversa]');
    if (conv) conv.addEventListener('click', () => {
      const c = App.cliente(p.clienteId); if (!c) return;
      App.acoes.marcarConversa(c.id, esperando(c) ? 'respondido' : 'falta');
    });
    const acoes = {
      adicionar: async () => {
        let cs = [];
        try { cs = (await App.api.arquivos.escolherImagens(true)) || []; } catch { cs = []; }
        if (cs.length) levarPraEntrega(id, cs);
      },
      entregar: () => entregar(id),
      ajuste: () => pediuAjuste(id),
      gamepass: () => enviarGamepass(id),
      aprovou: () => clienteAprovou(id),
      pago: () => App.modais.registrarPagamento(id)
    };
    $$('[data-acao]').forEach(b => b.addEventListener('click', () => { const f = acoes[b.dataset.acao]; if (f) f(); }));
    const mais = $('[data-mais]');
    mais.addEventListener('click', () => abrirMaisOpcoes(mais, id));

    // referências: o cache já foi desenhado; atualiza do disco
    carregarRefs(id);

    // rolagens: o shell restaura as rolagens salvas logo depois de montar(), então ajusta em seguida
    const rotaNova = App.rota !== rotaVista;
    const trocouPedido = pedidoVisto !== id;
    const mudouEtapa = !trocouPedido && etapaVista !== p.etapa;   // o item mudou de grupo na lista
    rotaVista = App.rota; pedidoVisto = id; etapaVista = p.etapa;
    if (rotaNova || trocouPedido || mudouEtapa) queueMicrotask(() => {
      const lista = raiz.querySelector('.ped-lista');
      const det = raiz.querySelector('.ped-detalhe');
      if (trocouPedido && det) det.scrollTop = 0;
      if (!lista || !(rotaNova || mudouEtapa)) return;
      const g = rotaNova && App.rota.grupo && !App.rota.id ? lista.querySelector(`[data-grupo="${App.rota.grupo}"]`) : null;
      if (g) { lista.scrollTop = Math.max(0, g.offsetTop - 8); return; }
      const sel = lista.querySelector('.item.ativo');
      if (sel && (sel.offsetTop < lista.scrollTop || sel.offsetTop + sel.offsetHeight > lista.scrollTop + lista.clientHeight)) {
        lista.scrollTop = Math.max(0, sel.offsetTop - lista.clientHeight / 3);
      }
    });
  }

  App.telas.pedidos = { cheia: true, cabecalho, render, montar };

  // =====================================================================
  // Modais
  // =====================================================================
  const opt = (v, rot, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(rot)}</option>`;
  // Valores são campos de texto (o type=number do Chromium lê '1.500' e '1.500,00' como 1,5, calado).
  // Aceita o jeito brasileiro e o americano: '1.500' → 1500 · '1.500,50' → 1500.5 · '12,5' → 12.5 · '12.5' → 12.5.
  // Vazio = 0; o que não for número = NaN (vira erro no campo).
  const numero = (v) => {
    let s = String(v == null ? '' : v).replace(/R\$|US\$|robux|\s/gi, '');
    if (s === '') return 0;
    const neg = s.startsWith('-'); if (neg) s = s.slice(1);
    const virgula = s.lastIndexOf(','), ponto = s.lastIndexOf('.');
    if (virgula >= 0 && ponto >= 0) s = virgula > ponto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (virgula >= 0) s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return neg ? -Number(s) : Number(s);
  };
  // número → texto do campo, com vírgula decimal ('' continua vazio)
  const paraCampo = (n) => (n === '' || n == null ? '' : String(Math.round((+n || 0) * 100) / 100).replace('.', ','));
  const NUM_RUIM = 'Não entendi esse número. Ex.: 1500 ou 12,50.';

  function erroCampo(el, campo, msg) {
    const alvo = el.querySelector(`[data-erro="${campo}"]`);
    if (alvo) alvo.textContent = msg || '';
    const inp = el.querySelector(`[data-f="${campo}"]`);
    if (inp) { inp.classList.toggle('ped-invalido', !!msg); if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  }

  function semClientes() {
    UI.modal({
      titulo: 'Novo pedido', sub: 'Todo pedido é de um cliente.', largura: 460,
      corpo: `<p class="suave ped-modal-texto">Você ainda não tem clientes. Adicione o primeiro pelo ID do Discord — nome e foto vêm sozinhos — e depois crie o pedido dele.</p>`,
      rodape: `<button class="btn btn-sec" data-nao>Cancelar</button><button class="btn btn-primario" data-sim>${ic('usuarioMais', 17)}Adicionar cliente</button>`,
      aoMontar: (el, fechar) => {
        el.querySelector('[data-nao]').addEventListener('click', fechar);
        el.querySelector('[data-sim]').addEventListener('click', () => { fechar(); abrirNovoCliente(); });
      }
    });
  }

  function formPedido({ clienteId = '', pedido = null } = {}) {
    const clientes = App.estado.clientes.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!clientes.length && !pedido) { semClientes(); return; }
    const edit = !!pedido;
    const d = pedido || { clienteId, titulo: '', jogo: '', qtd: 4, valor: '', moeda: App.estado.config.moedaPadrao || 'Robux', recebido: 0, prazo: '', etapa: 'aceito' };
    const selCli = d.clienteId && App.cliente(d.clienteId) ? d.clienteId : '';
    const corpo = `
      <div class="campo"><label for="pf-cliente">Cliente</label>
        <select class="input" id="pf-cliente" data-f="clienteId">
          ${selCli ? '' : opt('', 'Escolha o cliente…', true)}
          ${clientes.map(c => opt(c.id, App.ehGrupo(c) ? `${c.nome} (grupo)` : c.username ? `${c.nome} (@${c.username})` : c.nome, c.id === selCli)).join('')}
        </select><div class="ped-erro" data-erro="clienteId" role="alert"></div></div>
      <div class="linha-campos">
        <div class="campo"><label for="pf-titulo">Título</label><input class="input" id="pf-titulo" data-f="titulo" maxlength="80" placeholder="Pack 4 thumbs" value="${esc(d.titulo)}" ${selCli ? 'autofocus' : ''}><div class="ped-erro" data-erro="titulo" role="alert"></div></div>
        <div class="campo"><label for="pf-jogo">Jogo <span class="ped-opcional">(opcional)</span></label><input class="input" id="pf-jogo" data-f="jogo" maxlength="60" placeholder="Lava Obby" value="${esc(d.jogo)}"></div>
      </div>
      <div class="linha-campos">
        <div class="campo"><label for="pf-qtd">Quantidade de entregas</label><input class="input" id="pf-qtd" data-f="qtd" type="number" min="1" max="12" step="1" value="${esc(d.qtd)}"><div class="ped-erro" data-erro="qtd" role="alert"></div></div>
        <div class="campo"><label for="pf-prazo">Prazo <span class="ped-opcional">(opcional)</span></label><input class="input" id="pf-prazo" data-f="prazo" type="date" value="${esc(d.prazo)}"></div>
      </div>
      <div class="linha-campos">
        <div class="campo"><label for="pf-valor">Valor</label><input class="input" id="pf-valor" data-f="valor" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(paraCampo(d.valor))}"><div class="ped-erro" data-erro="valor" role="alert"></div></div>
        <div class="campo"><label for="pf-moeda">Moeda</label><select class="input" id="pf-moeda" data-f="moeda">${App.MOEDAS.map(m => opt(m, m, m === d.moeda)).join('')}</select></div>
      </div>
      <div class="linha-campos">
        <div class="campo"><label for="pf-recebido">Já recebido</label><input class="input" id="pf-recebido" data-f="recebido" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(paraCampo(d.recebido))}"><div class="ped-erro" data-erro="recebido" role="alert"></div></div>
        ${edit ? '<div></div>' : `<div class="campo"><label for="pf-etapa">Etapa inicial</label><select class="input" id="pf-etapa" data-f="etapa">${opt('aceito', 'Aceito', true)}${opt('comecado', 'Começado', false)}</select></div>`}
      </div>`;
    UI.modal({
      titulo: edit ? 'Editar pedido' : 'Novo pedido',
      sub: edit ? 'Mudou o combinado? Ajuste aqui.' : 'O que foi combinado com o cliente no Discord.',
      largura: 560, corpo,
      rodape: `<button class="btn btn-sec" data-nao>Cancelar</button><button class="btn btn-primario" data-sim>${ic('check', 17, 2.4)}${edit ? 'Salvar alterações' : 'Salvar pedido'}</button>`,
      aoMontar: (el, fechar) => {
        const f = (k) => el.querySelector(`[data-f="${k}"]`);
        const salvar = () => {
          ['clienteId', 'titulo', 'qtd', 'valor', 'recebido'].forEach(k => erroCampo(el, k, ''));
          const v = {
            clienteId: f('clienteId').value, titulo: f('titulo').value.trim(), jogo: f('jogo').value.trim(),
            qtd: numero(f('qtd').value), valor: numero(f('valor').value), moeda: f('moeda').value,
            recebido: numero(f('recebido').value), prazo: f('prazo').value || ''
          };
          let ok = true;
          const falha = (k, msg) => { if (ok) { const i = f(k); if (i) i.focus(); } ok = false; erroCampo(el, k, msg); };
          if (!v.clienteId || !App.cliente(v.clienteId)) falha('clienteId', 'Escolha de quem é o pedido.');
          if (!v.titulo) falha('titulo', 'Dê um nome ao pedido.');
          // texto que o campo numérico não entende chega como '' (validity.badInput): não deixa virar 0 calado
          if (f('qtd').validity && f('qtd').validity.badInput) falha('qtd', 'Use só números inteiros, de 1 a 12.');
          else if (!Number.isInteger(v.qtd) || v.qtd < 1 || v.qtd > 12) falha('qtd', 'De 1 a 12 entregas.');
          else if (edit && pedido.entregas.some((e, i) => e && i >= v.qtd)) falha('qtd', 'Tem imagem nos espaços acima disso. Tire antes de diminuir.');
          if (Number.isNaN(v.valor)) falha('valor', NUM_RUIM);
          else if (!isFinite(v.valor) || v.valor < 0) falha('valor', 'Use um número igual ou maior que zero.');
          if (Number.isNaN(v.recebido)) falha('recebido', NUM_RUIM);
          else if (!isFinite(v.recebido) || v.recebido < 0) falha('recebido', 'Use um número igual ou maior que zero.');
          else if (isFinite(v.valor) && v.recebido > v.valor) falha('recebido', 'Não pode passar do valor do pedido.');
          if (!ok) return;
          if (edit) {
            // concluído que voltou a ter dinheiro pra receber (valor subiu ou recebido baixou): reabre em
            // "Aguardando pagamento", senão a dívida some de todos os totais (só pedidos ativos contam)
            const estava = pedido.etapa;
            const reabrir = estava === 'pago' && v.recebido < v.valor;
            App.acoes.atualizarPedido(pedido.id, v);
            if (reabrir) App.acoes.mudarEtapa(pedido.id, 'aprovado');
            fechar();
            const depois = App.pedido(pedido.id);
            if (reabrir) UI.toast(`Pedido reaberto — falta receber ${App.fmtValor(v.valor - v.recebido, v.moeda)}.`, 'ok');
            else if (estava !== 'pago' && depois && depois.etapa === 'pago') UI.toast('Tudo pago — pedido concluído.', 'ok');
            else UI.toast('Pedido atualizado.', 'ok');
          } else {
            v.etapa = f('etapa').value === 'comecado' ? 'comecado' : 'aceito';
            const id = App.acoes.novoPedido(v);
            fechar();
            App.ir('pedidos', id);
            UI.toast('Pedido criado.', 'ok');
          }
        };
        el.querySelector('[data-nao]').addEventListener('click', fechar);
        el.querySelector('[data-sim]').addEventListener('click', salvar);
        el.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } }));
      }
    });
  }

  App.modais.novoPedido = (clienteId) => {
    const pre = clienteId || (App.rota && App.rota.tela === 'clientes' ? App.rota.id : '') || '';
    formPedido({ clienteId: pre });
  };
  App.modais.editarPedido = (id) => {
    const p = App.pedido(id);
    if (!p) { UI.toast('Esse pedido não existe mais.', 'erro'); return; }
    formPedido({ pedido: p });
  };

  App.modais.registrarPagamento = (id) => {
    const p = App.pedido(id);
    if (!p) { UI.toast('Esse pedido não existe mais.', 'erro'); return; }
    const falta = App.falta(p);
    if (falta <= 0) { UI.toast((+p.valor || 0) > 0 ? 'Esse pedido já está todo pago.' : 'Esse pedido não tem valor definido. Edite o pedido primeiro.'); return; }
    const c = App.cliente(p.clienteId);
    const arred = (n) => (p.moeda === 'Robux' ? Math.round(n) : Math.round(n * 100) / 100);
    const metade = arred(Math.min((+p.valor || 0) / 2, falta));
    UI.modal({
      titulo: 'Registrar pagamento', sub: `${p.titulo}${c ? ' · ' + c.nome : ''}`, largura: 480,
      corpo: `
        <div class="fatos ped-pag-fatos" style="--n:3">
          <div class="fato"><span class="fato-rotulo">Total</span><span class="fato-valor">${esc(App.fmtValor(p.valor, p.moeda))}</span></div>
          <div class="fato"><span class="fato-rotulo">Recebido</span><span class="fato-valor">${esc(App.fmtValor(p.recebido, p.moeda))}</span></div>
          <div class="fato"><span class="fato-rotulo">Falta</span><span class="fato-valor cor-amarelo">${esc(App.fmtValor(falta, p.moeda))}</span></div>
        </div>
        <div class="campo"><label for="pg-quantia">Quanto chegou agora <span class="ped-opcional">(${esc(p.moeda)})</span></label>
          <input class="input" id="pg-quantia" data-f="quantia" type="text" inputmode="decimal" autocomplete="off" value="${esc(paraCampo(falta))}" autofocus>
          <div class="ped-rapidos">
            <button class="btn btn-sec btn-peq" data-rapido="${esc(paraCampo(metade))}">Metade</button>
            <button class="btn btn-sec btn-peq" data-rapido="${esc(paraCampo(falta))}">Tudo que falta</button>
          </div>
          <div class="ped-erro" data-erro="quantia" role="alert"></div>
        </div>`,
      rodape: `<button class="btn btn-sec" data-nao>Cancelar</button><button class="btn btn-primario" data-sim>${ic('check', 17, 2.4)}Confirmar</button>`,
      aoMontar: (el, fechar) => {
        const inp = el.querySelector('[data-f="quantia"]');
        el.querySelectorAll('[data-rapido]').forEach(b => b.addEventListener('click', () => { inp.value = b.dataset.rapido; erroCampo(el, 'quantia', ''); inp.focus(); }));
        const confirmar = () => {
          let q = numero(inp.value);
          if (Number.isNaN(q)) { erroCampo(el, 'quantia', NUM_RUIM); inp.focus(); return; }
          if (Math.abs(q - falta) < 0.005) q = falta;   // o campo mostra 2 casas; "tudo que falta" quita de verdade
          if (!isFinite(q) || q <= 0) { erroCampo(el, 'quantia', 'Digite um valor maior que zero.'); inp.focus(); return; }
          if (q > falta + 0.001) { erroCampo(el, 'quantia', `Passa do que falta (${App.fmtValor(falta, p.moeda)}).`); inp.focus(); return; }
          App.acoes.registrarPagamento(id, q);
          fechar();
          const d = App.pedido(id);
          if (!d) return;
          if (d.etapa === 'pago') UI.toast(`Recebido ${App.fmtValor(q, p.moeda)}. Pedido concluído!`, 'ok');
          else if (App.falta(d) <= 0) UI.toast(`Recebido ${App.fmtValor(q, p.moeda)}. Tudo pago.`, 'ok');
          else UI.toast(`Recebido ${App.fmtValor(q, p.moeda)}. Falta ${App.fmtValor(App.falta(d), d.moeda)}.`, 'ok');
        };
        el.querySelector('[data-nao]').addEventListener('click', fechar);
        el.querySelector('[data-sim]').addEventListener('click', confirmar);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } });
        setTimeout(() => inp.select(), 40);
      }
    });
  };
})();
