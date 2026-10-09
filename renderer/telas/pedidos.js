// Tela Pedidos: lista (A fazer · Falta pagar · Concluídos) | detalhe do pedido | painel do cliente.
// Também define os modais App.modais.novoPedido / editarPedido.
// Simples de propósito: o pedido está feito ou não; o pagamento é pago ou não.
(function () {
  const esc = UI.esc, ic = UI.icone;

  // ---------- Estado local da tela (não vai pro disco) ----------
  let concluidosAberto = false;
  let rotaVista = null;          // rota já tratada (rolar até o grupo/pedido só uma vez por navegação)
  let pedidoVisto = null;        // último pedido mostrado no detalhe (volta o detalhe pro topo ao trocar)
  let grupoVisto = null;         // grupo desse pedido no último desenho (abre "Concluídos" quando ele acaba de concluir)
  const refsCache = {};          // pedidoId -> [{nome, caminho, url}]
  const filas = {};              // pedidoId -> Promise: uma leva de imagens das thumbs por vez
  const reservas = {};           // pedidoId -> {espaço: n} espaços escolhidos por levas que ainda esperam na fila

  // arquivo solto sem caminho no disco nem conteúdo legível
  const SEM_CAMINHO = App.noApp
    ? 'Não deu pra ler essa imagem. Salve no computador e arraste o arquivo salvo.'
    : 'Isso só funciona no app instalado.';

  // ---------- Utilidades locais ----------
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const thumbs = (x, n) => `${x} de ${n} ${n === 1 ? 'thumb' : 'thumbs'}`;
  const corSegura = (cor) => (/^#[0-9a-f]{3,8}$/i.test(String(cor || '')) ? cor : '#2b4a78');
  const clienteDe = (p) => App.cliente(p.clienteId) || { id: '', nome: 'Cliente removido', username: '', avatar: '', corPerfil: '', discordId: '', conversa: { estado: 'respondido', desde: '' } };
  const esperando = (c) => !!(c && c.conversa && c.conversa.estado === 'falta');
  const temValor = (p) => (+p.valor || 0) > 0;

  // 'em 2 d' | 'hoje' | 'amanhã' | 'atrasado 1 d' | 'sem prazo'
  function prazoCurto(ymd) {
    const n = App.diasAte(ymd);
    if (n == null) return 'sem prazo';
    if (n === 0) return 'hoje';
    if (n === 1) return 'amanhã';
    return n > 0 ? `em ${n} d` : `atrasado ${-n} d`;
  }

  // ---------- Grupos da lista ----------
  const doGrupo = (id) => (id === 'aFazer' ? App.pedidosAFazer() : id === 'faltaPagar' ? App.pedidosFaltaPagar() : id === 'concluidos' ? App.pedidosConcluidos() : []);
  const grupoDoPedido = (p) => (!p.feito ? 'aFazer' : App.ativo(p) ? 'faltaPagar' : 'concluidos');
  // links antigos (de antes de simplificar) ainda caem num grupo que existe; o resto é ignorado
  const GRUPO_ANTIGO = { aceitos: 'aFazer', producao: 'aFazer', entregues: 'faltaPagar', aguardando: 'faltaPagar' };
  const grupoDaRota = (g) => (['aFazer', 'faltaPagar', 'concluidos'].includes(g) ? g : GRUPO_ANTIGO[g] || null);

  // pedido selecionado: rota → o que já está na tela → primeiro do grupo pedido → primeiro a fazer → primeiro falta pagar → qualquer um
  function pedidoAtual() {
    const r = App.rota || {};
    const p = r.id ? App.pedido(r.id) : null;
    if (p) return p;
    // mesma rota (App.mudar não troca App.rota): fica no pedido mostrado, mesmo que ele mude de grupo
    if (r === rotaVista && pedidoVisto) { const v = App.pedido(pedidoVisto); if (v) return v; }
    const g = grupoDaRota(r.grupo);
    if (g) { const q = doGrupo(g)[0]; if (q) return q; }
    return App.pedidosAFazer()[0] || App.pedidosFaltaPagar()[0] || App.pedidosConcluidos()[0] || App.estado.pedidos[0] || null;
  }

  // segunda linha do item da lista (já escapada)
  function legendaItem(p) {
    if (!p.feito) {
      const t = prazoCurto(p.prazo);
      const n = App.diasAte(p.prazo);
      return n != null && n < 0 ? `<span class="cor-vermelho">${esc(t)}</span>` : esc(t);
    }
    if (App.ativo(p)) return 'não pago';
    return p.feitoEm ? esc(App.fmtHa(p.feitoEm)) : 'feito';
  }

  // ---------- Cabeçalho ----------
  function cabecalho() {
    // mesma conta da lateral: "a fazer"; "falta pagar" só aparece quando existe
    const n = App.pedidosAFazer().length;
    const f = App.pedidosFaltaPagar().length;
    return {
      titulo: 'Pedidos',
      sub: `${n} a fazer${f ? ` · ${f} falta pagar` : ''}`,
      botao: { rotulo: 'Novo pedido', icone: 'mais', acao: () => App.modais.novoPedido() }
    };
  }

  // ---------- Render ----------
  function render() {
    if (!App.estado.pedidos.length) return renderVazio();
    const r = App.rota || {};
    const p = pedidoAtual();
    const g = grupoDoPedido(p);
    // abre "Concluídos" ao navegar até lá e também quando o pedido aberto acaba de concluir (a rota não muda)
    const concluiuAgora = g === 'concluidos' && p.id === pedidoVisto && grupoVisto != null && grupoVisto !== 'concluidos';
    if ((r !== rotaVista && (grupoDaRota(r.grupo) === 'concluidos' || g === 'concluidos')) || concluiuAgora) concluidosAberto = true;
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
        ? 'Quando alguém fechar uma comissão no Discord, registre aqui o prazo, o valor e as thumbs do pedido.'
        : 'Todo pedido é de um cliente. Adicione o primeiro pelo ID do Discord — nome e foto vêm sozinhos.',
      acao
    })}</div>`;
  }

  function itemHtml(p, sel) {
    const c = clienteDe(p);
    return `<button class="item ${sel && sel.id === p.id ? 'ativo' : ''}" data-ir-pedido="${esc(p.id)}" title="${esc(p.titulo)} — ${esc(c.nome)}">
      ${UI.avatar({ tam: 34, img: c.avatar, nome: c.nome })}
      <span class="ped-item-txt"><span class="t1">${esc(p.titulo)}</span><span class="t2 ped-t2"><span class="ped-t2-nome">${esc(c.nome)}</span><span class="ped-t2-fim">&nbsp;· ${legendaItem(p)}</span></span></span>
      ${esperando(c) ? `<span class="ped-item-ponto" title="Esperando resposta">${UI.ponto('var(--vermelho)')}</span>` : ''}
    </button>`;
  }

  function renderLista(sel) {
    const grupos = [['aFazer', 'A fazer'], ['faltaPagar', 'Falta pagar']].map(([id, rotulo]) => {
      const ps = doGrupo(id);
      if (!ps.length) return '';
      return `<div class="ped-grupo" data-grupo="${id}"><div class="grupo-rot sobrelinha">${rotulo} · ${ps.length}</div>${ps.map(p => itemHtml(p, sel)).join('')}</div>`;
    }).join('');
    const concl = doGrupo('concluidos');
    const conclHtml = concl.length ? `<div class="ped-grupo ped-grupo-concl" data-grupo="concluidos">
        <button class="grupo-rot sobrelinha ped-concl" data-concluidos aria-expanded="${concluidosAberto}">
          <span>Concluídos · ${concl.length}</span><span class="ped-concl-chev">${ic('chevB', 15)}</span></button>
        <div class="ped-concl-lista" ${concluidosAberto ? '' : 'hidden'}>${concl.map(p => itemHtml(p, sel)).join('')}</div>
      </div>` : '';
    return `<nav class="bloco div-r ped-lista" data-rolagem="lista-pedidos" aria-label="Lista de pedidos">
      ${grupos || `<div class="mudo pequeno ped-lista-nada">Nada pra fazer nem pra receber agora.</div>`}
      ${conclHtml}
    </nav>`;
  }

  function refsHtml(lista) {
    if (!lista) return `<div class="ped-refs-vazio">Carregando…</div>`;
    if (!lista.length) return `<div class="ped-refs-vazio">${ic('imagem', 16)}<span>Arraste as referências aqui ou cole com Ctrl+V</span></div>`;
    return lista.map(r => `<button class="ref" data-ref title="${esc(r.nome)} — abrir a pasta">${ic('imagem', 16)}<img src="${esc(r.url)}" alt="${esc(r.nome)}" loading="lazy"></button>`).join('');
  }

  function slotHtml(p, i) {
    const e = p.entregas[i];
    if (e && e.url) {
      // botão transparente por cima da imagem: abre a pasta pelo teclado também (sem botão dentro de botão)
      return `<div class="slot cheio" data-slot="${i}" title="Thumb ${i + 1} — clique para abrir a pasta">
        <img src="${esc(e.url)}" alt="Thumb ${i + 1}">
        <button class="ped-slot-abrir" aria-label="Thumb ${i + 1}: abrir a pasta"></button>
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
    const refs = refsCache[p.id];
    return `<section class="bloco sem-pad cresce ped-detalhe" data-rolagem="detalhe-pedido" aria-label="Detalhe do pedido">
      <div class="capa" style="--cor-capa:${corSegura(c.corPerfil)}">
        <div class="ped-capa-txt"><h2 class="truncar" title="${esc(titulo)}">${esc(titulo)}</h2><div class="ped-capa-sub">${p.jogo ? `<span class="truncar" title="${esc(p.titulo)}">${esc(p.titulo)}</span><span aria-hidden="true">·</span>` : ''}<span class="ped-capa-cont">${thumbs(x, n)}</span></div></div>
        <span class="chip${p.feito ? ' ped-chip-feito' : ''}">${esc(App.status(p).rotulo)}</span>
      </div>
      <div class="ped-corpo">
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
            <h3 class="titulo-bloco ped-secao-tit">Thumbs</h3><span class="contagem">${x} de ${n}</span>
            <span class="ped-links"><button class="link" data-entrega-pasta>${ic('pasta', 15)}Abrir pasta</button></span>
          </div>
          <div class="slots">${Array.from({ length: n }, (_, i) => slotHtml(p, i)).join('')}</div>
        </section>

        <section class="ped-secao">
          <div class="bloco-cab"><h3 class="titulo-bloco ped-secao-tit"><label for="ped-notas">Notas do pedido</label></h3></div>
          <textarea class="input ped-notas" id="ped-notas" data-notas placeholder="Combinados, cores, texto da thumb, o que o cliente falou…">${esc(p.notas)}</textarea>
        </section>
      </div>
    </section>`;
  }

  // fato "Prazo": cor só enquanto o pedido não está feito; feito mostra "feito"
  function fatoPrazo(p) {
    const dt = App.paraData(p.prazo);
    const quando = dt ? `${App.fmtDiaLongo(p.prazo)} de ${App.MES_LONGO[dt.getMonth()]}` : '';
    if (p.feito) return { rot: 'Prazo', val: 'feito', cls: 'cor-verde', titulo: quando ? `Feito · o prazo era ${quando}` : 'Feito' };
    if (!dt) return { rot: 'Prazo', val: '—', cls: '', titulo: 'Sem prazo' };
    const d = App.diasAte(p.prazo);
    if (d < 0) return { rot: 'Atrasado', val: `${-d} d`, cls: 'cor-vermelho', titulo: `Atrasado ${-d === 1 ? '1 dia' : -d + ' dias'} — venceu ${quando}` };
    const alerta = d <= (App.estado.config.prazoAlertaDias ?? 2);
    return { rot: 'Prazo', val: d === 0 ? 'hoje' : `em ${d} d`, cls: alerta ? 'cor-amarelo' : '', titulo: `Vence ${quando}` };
  }
  function fatoPagamento(p) {
    const pg = App.pagamento(p);
    if (pg.chave === 'sem') return { val: '—', cls: '', titulo: 'Sem valor definido' };
    if (pg.chave === 'pago') return { val: 'Pago', cls: 'cor-verde', titulo: p.pagoEm ? `Pago em ${App.fmtDataCurta(p.pagoEm)}` : 'Pago' };
    return { val: 'Não pago', cls: '', titulo: `Falta receber ${App.fmtValor(App.falta(p), p.moeda)}` };
  }

  function renderCliente(p) {
    const c = clienteDe(p);
    const falta = esperando(c);
    const fp = fatoPrazo(p), fg = fatoPagamento(p);
    const valor = temValor(p) ? App.fmtValor(p.valor, p.moeda) : '—';
    const n = p.qtd, x = App.entreguesNoPedido(p);
    const desde = c.conversa && c.conversa.desde ? App.fmtHa(c.conversa.desde) : '';
    // só aparece quando dá pra usar: em Robux, com valor e ainda não pago
    const btnGamepass = p.moeda === 'Robux' && temValor(p) && !p.pago
      ? `<button class="btn btn-acento btn-bloco" data-acao="gamepass" title="Copia a mensagem com o valor e o link do gamepass">${ic('enviar', 18)}Enviar gamepass</button>` : '';
    const btnFeito = p.feito
      ? `<button class="btn btn-sec btn-bloco" data-acao="desfazer">${ic('atualizar', 18)}Voltar pra a fazer</button>`
      : `<button class="btn btn-primario btn-bloco" data-acao="feito">${ic('check', 18, 2.4)}Marcar como feito<span class="dica">${x} de ${n}<span class="ped-dica-mais"> ${n === 1 ? 'thumb' : 'thumbs'}</span></span></button>`;
    const btnPago = p.pago && temValor(p)
      ? `<button class="btn btn-sec btn-bloco" data-acao="despagar">${ic('dinheiro', 18)}Desmarcar pago</button>`
      : `<button class="btn btn-acento btn-bloco" data-acao="pago" ${temValor(p) ? '' : 'disabled title="Pedido sem valor — edite o pedido para pôr um valor"'}>${ic('dinheiro', 18)}Marcar como pago</button>`;
    return `<aside class="bloco sem-pad div-l ped-cli" aria-label="Cliente do pedido">
      <div class="perfil-topo" style="--cor-capa:${corSegura(c.corPerfil)}"><div class="capa-mini"></div>${UI.avatar({ tam: 72, img: c.avatar, nome: c.nome })}</div>
      <div class="ped-cli-corpo">
        <div class="ped-cli-nome">
          ${c.id ? `<button class="ped-cli-titulo truncar" data-ficha title="Ver ficha de ${esc(c.nome)}">${esc(c.nome)}</button>` : `<div class="ped-cli-titulo truncar">${esc(c.nome)}</div>`}
          ${App.ehGrupo(c) ? '<div class="ped-cli-sub truncar">Grupo</div>' : c.username ? `<div class="ped-cli-sub truncar">@${esc(c.username)}</div>` : ''}
        </div>
        <div class="fatos" style="--n:3">
          <div class="fato" title="${esc(fp.titulo)}"><span class="fato-rotulo ${fp.rot === 'Atrasado' ? fp.cls : ''}">${fp.rot}</span><span class="fato-valor ${fp.cls}">${esc(fp.val)}</span></div>
          <div class="fato" title="${esc(temValor(p) ? valor : 'Sem valor definido')}"><span class="fato-rotulo">Valor</span><span class="fato-valor">${esc(valor)}</span></div>
          <div class="fato" title="${esc(fg.titulo)}"><span class="fato-rotulo">Pagamento</span><span class="fato-valor ${fg.cls}">${esc(fg.val)}</span></div>
        </div>
        ${c.id ? `<div class="caixa ped-conversa">
          ${UI.avatar({ tam: 32, img: c.avatar, nome: c.nome, classe: falta ? 'anel-falta' : 'anel-ok' })}
          <div class="ped-conv-txt"><div class="ped-conv-t1">${falta ? 'Falta responder' : 'Respondido'}</div>
            <div class="ped-conv-t2 ${falta ? 'cor-vermelho' : 'cor-verde'}">${falta ? 'Esperando' + (desde ? ' ' + esc(desde) : '') : (desde ? esc(desde) : 'em dia')}</div></div>
          <button class="btn btn-texto" data-conversa>${falta ? 'Respondi' : 'Nova msg'}</button>
        </div>` : ''}
        <div class="ped-espaco"></div>
        <div class="ped-acoes">
          ${btnFeito}
          <button class="btn btn-sec btn-bloco" data-acao="adicionar">${ic('upload', 18)}Adicionar thumbs</button>
          ${btnPago}
          ${btnGamepass}
        </div>
        <button class="link ped-mais" data-mais aria-haspopup="menu">Mais opções ${ic('chevB', 15)}</button>
      </div>
    </aside>`;
  }

  // ---------- Arrastar, soltar e colar ----------
  // Cada item é o caminho de um arquivo do PC (texto) ou, vindo do Discord/navegador,
  // { bytes, nome } (imagem sem arquivo) ou { urls } (links pra baixar, em ordem de preferência).
  const MAX_SOLTO = 25 * 1024 * 1024;
  let arrastoInterno = false;    // arrastar uma imagem do próprio app não importa nada
  document.addEventListener('dragstart', () => { arrastoInterno = true; });
  document.addEventListener('dragend', () => { arrastoInterno = false; });
  const TIPOS_SOLTAR = ['Files', 'text/uri-list', 'text/html'];
  const podeSoltar = (e) => !arrastoInterno && !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).some(t => TIPOS_SOLTAR.includes(t)));

  // links de imagem que o Discord/navegador põem no arrasto: o link primeiro, depois o <img> (no Google, a miniatura)
  function urlsDe(dt) {
    const lista = (dt.getData('text/uri-list') || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    let imgs = [];
    const html = dt.getData('text/html') || '';
    if (html) { try { imgs = Array.from(new DOMParser().parseFromString(html, 'text/html').images).map(i => i.getAttribute('src') || ''); } catch {} }
    const texto = (dt.getData('text/plain') || '').trim();
    const urls = [];
    for (const u of [...lista, ...imgs, ...(/^https:\/\/\S+$/i.test(texto) ? [texto] : [])]) {
      if (/^(https:|data:image\/)/i.test(u) && !urls.includes(u)) urls.push(u);
    }
    return urls;
  }

  // Lê o que foi solto/colado. Os dados do arrasto só podem ser lidos na hora do evento:
  // pega arquivos e links antes de qualquer await.
  async function itensDe(dt) {
    const arquivos = Array.from(dt.files || []);
    const urls = urlsDe(dt);
    const itens = [];
    for (const f of arquivos) {
      const caminho = App.api.arquivos.caminhoDe(f) || '';
      // arquivo de imagem do PC; um arquivo temporário sem extensão de imagem (navegador) cai pros bytes
      if (caminho && (/\.(png|jpe?g|webp|gif|bmp)$/i.test(caminho) || !/^image\//.test(f.type))) { itens.push(caminho); continue; }
      // imagem que veio sem arquivo no disco (ex.: arrastada do navegador ou copiada): manda o conteúdo
      if (/^image\//.test(f.type) && f.size && f.size <= MAX_SOLTO) {
        // "image.png" é o nome genérico do que foi copiado: melhor deixar o app nomear
        try { itens.push({ bytes: new Uint8Array(await f.arrayBuffer()), nome: /^image\.\w+$/i.test(f.name || '') ? '' : (f.name || '') }); continue; } catch {}
      }
      if (!urls.length) itens.push('');
    }
    if (!itens.length && urls.length) itens.push({ urls });
    return itens;
  }

  function ligarSoltar(el, aoSoltar) {
    let cont = 0;
    el.addEventListener('dragenter', (e) => { if (!podeSoltar(e)) return; e.preventDefault(); cont++; el.classList.add('arrastando'); });
    el.addEventListener('dragover', (e) => { if (!podeSoltar(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('dragleave', () => { cont = Math.max(0, cont - 1); if (!cont) el.classList.remove('arrastando'); });
    el.addEventListener('drop', async (e) => {
      if (!podeSoltar(e)) return;
      e.preventDefault(); e.stopPropagation();
      cont = 0; el.classList.remove('arrastando');
      const itens = await itensDe(e.dataTransfer);
      if (itens.length) aoSoltar(itens); else UI.toast('Isso não é uma imagem.', 'erro');
    });
  }

  // salva um item (arquivo do PC ou imagem da web) no pedido
  async function importarItem(pedidoId, tipo, item, slot) {
    if (typeof item === 'string') return App.api.arquivos.importar({ pedidoId, tipo, caminho: item, slot });
    if (!App.api.arquivos.importarWeb) return { ok: false, erro: SEM_CAMINHO };
    return App.api.arquivos.importarWeb({ pedidoId, tipo, slot, ...item });
  }

  // Ctrl+V com o pedido aberto: imagem copiada (Discord "Copiar imagem", navegador) ou link de imagem vira referência
  document.addEventListener('paste', async (e) => {
    const raiz = document.querySelector('#area .ped');
    const pedidoId = raiz && raiz.dataset.pedido;
    if (!pedidoId || UI.temModal() || (window.Entrada && Entrada.aberta())) return;
    const alvo = e.target;
    if (alvo && (alvo.closest('input, textarea, select, [contenteditable]'))) return;
    const dt = e.clipboardData; if (!dt) return;
    // só reage a imagem ou link de imagem; texto comum colado fora de um campo é ignorado
    const temImagem = Array.from(dt.files || []).some(f => /^image\//.test(f.type));
    if (!temImagem && !urlsDe(dt).length) return;
    e.preventDefault();
    const itens = (await itensDe(dt)).filter(Boolean);
    if (itens.length) importarRefs(pedidoId, itens); else UI.toast('Isso não é uma imagem.', 'erro');
  });

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

  async function importarRefs(pedidoId, itens) {
    if (!itens.length) return;
    let ok = 0; const erros = [];
    const web = itens.some(x => x && typeof x === 'object');
    if (web) UI.toast(itens.length > 1 ? 'Baixando as imagens…' : 'Baixando a imagem…');
    for (const item of itens) {
      if (!item) { erros.push(SEM_CAMINHO); continue; }
      let r;
      try { r = await importarItem(pedidoId, 'referencias', item); } catch { r = null; }
      if (r && r.ok) ok++; else erros.push((r && r.erro) || 'Não deu pra copiar a imagem.');
    }
    if (erros.length) UI.toast(erros.length > 1 ? `${erros[0]} (${erros.length} arquivos não entraram)` : erros[0], 'erro');
    if (ok) { UI.toast(ok === 1 ? 'Referência adicionada.' : `${ok} referências adicionadas.`, 'ok'); await carregarRefs(pedidoId); }
  }

  // ---------- Thumbs (pasta de entrega) ----------
  async function colocarNaEntrega(pedidoId, item, i) {
    let r;
    try { r = await importarItem(pedidoId, 'entrega', item, i); } catch { r = null; }
    if (!r || !r.ok) { UI.toast((r && r.erro) || 'Não deu pra copiar a imagem.', 'erro'); return false; }
    App.acoes.definirEntrega(pedidoId, i, { caminho: r.caminho, url: r.url });
    return true;
  }

  // Põe imagens nos espaços de thumb, uma leva por pedido de cada vez: soltar de novo no meio de uma importação
  // espera a anterior (senão as duas escolhem os mesmos espaços e uma imagem sobrescreve a outra).
  // O espaço onde a pessoa soltou fica reservado já na hora, para a leva anterior não ocupá-lo com as que sobram.
  function levarPraEntrega(pedidoId, caminhos, inicio = null) {
    const r = reservas[pedidoId] = reservas[pedidoId] || {};
    if (inicio != null) r[inicio] = (r[inicio] || 0) + 1;
    filas[pedidoId] = (filas[pedidoId] || Promise.resolve())
      .then(() => distribuir(pedidoId, caminhos, inicio))
      .catch((e) => { console.error(e); UI.toast('Não deu pra colocar as imagens nas thumbs.', 'erro'); })
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
    } else if (ok > 1) UI.toast(`${ok} thumbs adicionadas.`, 'ok');
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
  function marcarFeito(pedidoId) {
    App.acoes.marcarFeito(pedidoId, true);
    const p = App.pedido(pedidoId); if (!p) return;
    UI.toast(App.falta(p) > 0 ? `Feito! Falta receber ${App.fmtValor(App.falta(p), p.moeda)}.` : 'Feito — pedido concluído.', 'ok');
  }

  function marcarPago(pedidoId) {
    App.acoes.marcarPago(pedidoId, true);
    const p = App.pedido(pedidoId); if (!p) return;
    UI.toast(p.feito ? 'Pago — pedido concluído.' : 'Marcado como pago.', 'ok');
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
          const ok = await UI.confirmar({ titulo: 'Excluir este pedido?', texto: `“${p.titulo}” some da lista e as imagens dele (referências e thumbs) são apagadas do computador. Não dá pra desfazer.`, ok: 'Excluir pedido', perigo: true });
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
      feito: () => marcarFeito(id),
      desfazer: () => App.acoes.marcarFeito(id, false),
      adicionar: async () => {
        let cs = [];
        try { cs = (await App.api.arquivos.escolherImagens(true)) || []; } catch { cs = []; }
        if (cs.length) levarPraEntrega(id, cs);
      },
      pago: () => marcarPago(id),
      despagar: () => App.acoes.marcarPago(id, false),
      gamepass: () => enviarGamepass(id)
    };
    $$('[data-acao]').forEach(b => b.addEventListener('click', () => { const f = acoes[b.dataset.acao]; if (f) f(); }));
    const mais = $('[data-mais]');
    mais.addEventListener('click', () => abrirMaisOpcoes(mais, id));

    // referências: o cache já foi desenhado; atualiza do disco
    carregarRefs(id);

    // rolagens: o shell restaura as rolagens salvas logo depois de montar(), então ajusta em seguida
    const rotaNova = App.rota !== rotaVista;
    const trocouPedido = pedidoVisto !== id;
    const grupo = grupoDoPedido(p);
    const mudouGrupo = !trocouPedido && grupoVisto !== grupo;   // o item mudou de grupo na lista
    rotaVista = App.rota; pedidoVisto = id; grupoVisto = grupo;
    if (rotaNova || trocouPedido || mudouGrupo) queueMicrotask(() => {
      const lista = raiz.querySelector('.ped-lista');
      const det = raiz.querySelector('.ped-detalhe');
      if (trocouPedido && det) det.scrollTop = 0;
      if (!lista || !(rotaNova || mudouGrupo)) return;
      const gRota = rotaNova && !App.rota.id ? grupoDaRota(App.rota.grupo) : null;
      const g = gRota ? lista.querySelector(`[data-grupo="${gRota}"]`) : null;
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
    const d = pedido || { clienteId, titulo: '', jogo: '', qtd: 4, valor: '', moeda: App.estado.config.moedaPadrao || 'Robux', prazo: '', feito: false, pago: false };
    const selCli = d.clienteId && App.cliente(d.clienteId) ? d.clienteId : '';
    const pagoAtivo = (+d.valor || 0) > 0;
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
        <div class="campo"><label for="pf-qtd">Quantidade de thumbs</label><input class="input" id="pf-qtd" data-f="qtd" type="number" min="1" max="12" step="1" value="${esc(d.qtd)}"><div class="ped-erro" data-erro="qtd" role="alert"></div></div>
        <div class="campo"><label for="pf-prazo">Prazo <span class="ped-opcional">(opcional)</span></label><input class="input" id="pf-prazo" data-f="prazo" type="date" value="${esc(d.prazo)}"></div>
      </div>
      <div class="linha-campos">
        <div class="campo"><label for="pf-valor">Valor</label><input class="input" id="pf-valor" data-f="valor" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(paraCampo(d.valor))}"><div class="ped-erro" data-erro="valor" role="alert"></div></div>
        <div class="campo"><label for="pf-moeda">Moeda</label><select class="input" id="pf-moeda" data-f="moeda">${App.MOEDAS.map(m => opt(m, m, m === d.moeda)).join('')}</select></div>
      </div>
      <div class="linha-campos ped-marcadores">
        <label class="marcador"><input type="checkbox" data-f="feito" ${d.feito ? 'checked' : ''}><span>Já está feito</span></label>
        <label class="marcador" data-pago-rot ${pagoAtivo ? '' : 'title="Sem valor, não tem o que pagar"'}><input type="checkbox" data-f="pago" ${pagoAtivo && d.pago ? 'checked' : ''} ${pagoAtivo ? '' : 'disabled'}><span>Já está pago</span></label>
      </div>`;
    UI.modal({
      titulo: edit ? 'Editar pedido' : 'Novo pedido',
      sub: edit ? 'Mudou o combinado? Ajuste aqui.' : 'O que foi combinado com o cliente no Discord.',
      largura: 560, corpo,
      rodape: `<button class="btn btn-sec" data-nao>Cancelar</button><button class="btn btn-primario" data-sim>${ic('check', 17, 2.4)}${edit ? 'Salvar alterações' : 'Salvar pedido'}</button>`,
      aoMontar: (el, fechar) => {
        const f = (k) => el.querySelector(`[data-f="${k}"]`);
        // "Já está pago" só vale com valor: sem valor fica desligado (e lembra a escolha pra quando voltar a ter)
        const pago = f('pago'), pagoRot = el.querySelector('[data-pago-rot]');
        let querPago = !!d.pago;
        pago.addEventListener('change', () => { querPago = pago.checked; });
        f('valor').addEventListener('input', () => {
          const v = numero(f('valor').value);
          const ativo = isFinite(v) && v > 0;
          pago.disabled = !ativo;
          pago.checked = ativo && querPago;
          if (ativo) pagoRot.removeAttribute('title'); else pagoRot.title = 'Sem valor, não tem o que pagar';
        });
        const salvar = () => {
          ['clienteId', 'titulo', 'qtd', 'valor'].forEach(k => erroCampo(el, k, ''));
          const v = {
            clienteId: f('clienteId').value, titulo: f('titulo').value.trim(), jogo: f('jogo').value.trim(),
            qtd: numero(f('qtd').value), valor: numero(f('valor').value), moeda: f('moeda').value,
            prazo: f('prazo').value || '', feito: f('feito').checked
          };
          let ok = true;
          const falha = (k, msg) => { if (ok) { const i = f(k); if (i) i.focus(); } ok = false; erroCampo(el, k, msg); };
          if (!v.clienteId || !App.cliente(v.clienteId)) falha('clienteId', 'Escolha de quem é o pedido.');
          if (!v.titulo) falha('titulo', 'Dê um nome ao pedido.');
          // texto que o campo numérico não entende chega como '' (validity.badInput): não deixa virar 0 calado
          if (f('qtd').validity && f('qtd').validity.badInput) falha('qtd', 'Use só números inteiros, de 1 a 12.');
          else if (!Number.isInteger(v.qtd) || v.qtd < 1 || v.qtd > 12) falha('qtd', 'De 1 a 12 thumbs.');
          else if (edit && pedido.entregas.some((e, i) => e && i >= v.qtd)) falha('qtd', 'Tem imagem nos espaços acima disso. Tire antes de diminuir.');
          if (Number.isNaN(v.valor)) falha('valor', NUM_RUIM);
          else if (!isFinite(v.valor) || v.valor < 0) falha('valor', 'Use um número igual ou maior que zero.');
          if (!ok) return;
          v.pago = v.valor > 0 && pago.checked;   // sem valor não existe "pago"
          if (edit) {
            App.acoes.atualizarPedido(pedido.id, v);
            fechar();
            UI.toast('Pedido atualizado.', 'ok');
          } else {
            const id = App.acoes.novoPedido(v);
            fechar();
            App.ir('pedidos', id);
            UI.toast('Pedido criado.', 'ok');
          }
        };
        el.querySelector('[data-nao]').addEventListener('click', fechar);
        el.querySelector('[data-sim]').addEventListener('click', salvar);
        el.querySelectorAll('input:not([type="checkbox"])').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } }));
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
})();
