// Tela Clientes: lista (falta responder / respondidos), ficha do cliente e perfil com Discord/Roblox.
// Também define o modal compartilhado App.modais.novoCliente().
// Mesmo HTML nos dois modos (cube / of); a diferença visual vem do CSS.
(function () {
  const esc = UI.esc, ic = UI.icone;
  const $ = (s, el) => el.querySelector(s);
  const $$ = (s, el) => Array.from(el.querySelectorAll(s));

  // clientes cujos dados estão sendo puxados de novo (Discord/Roblox)
  const atualizando = new Set();
  // onde estava o cursor nas notas: um redesenho no meio da digitação (ex.: "Atualizar dados"
  // terminando) troca o textarea; com isso o foco e o cursor voltam pro mesmo lugar
  let notasEmEdicao = null; // { id, ini, fim, rol }

  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const soDigitos = (s) => String(s || '').replace(/\D/g, '');
  const limparRoblox = (s) => String(s || '').trim().replace(/^@/, '');
  const ID_VALIDO = /^\d{17,20}$/;
  // falhas do Discord que não são culpa do ID (bot, rede, limite): dá pra salvar o ID e puxar os dados depois
  const FALHA_SEM_CULPA_DO_ID = new Set(['sem-token', 'token-invalido', 'rede', 'limite', 'http']);
  const FALHA_DO_BOT = new Set(['sem-token', 'token-invalido']);
  // cor vinda do Discord entra num atributo style: só aceita #hex
  const corValida = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? String(c) : '');
  const corCapa = (c) => corValida(c.corPerfil) || UI.corDe(c.nome);
  const temRoblox = (c) => !!(c.roblox && (c.roblox.username || c.roblox.id));
  // '@usuario' | ID salvo mas ainda sem os dados do Discord | sem Discord
  const arroba = (c) => (App.ehGrupo(c) ? 'grupo de DM' : c.username ? '@' + c.username : c.discordId ? 'sem dados do Discord' : 'sem Discord');
  const idDiscordDe = (c) => (App.ehGrupo(c) ? c.canalId : c.discordId);
  // botão que mostra "Buscando…": o que foi clicado ou, se ele sumiu num redesenho, o primeiro que existir na tela
  const botaoVivo = (btn, ...seletores) => (btn && btn.isConnected ? btn : seletores.map(s => document.querySelector('#area ' + s)).find(Boolean) || null);

  function selecionado() {
    return App.cliente(App.rota.id) || App.faltaResponder()[0] || App.estado.clientes[0] || null;
  }

  // 'atualizado hoje, 18:42' | 'atualizado ontem, 09:10' | 'atualizado em 3 out 2026'
  function fmtAtualizado(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const hoje = new Date(); const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === hoje.toDateString()) return `atualizado hoje, ${hm}`;
    if (d.toDateString() === ontem.toDateString()) return `atualizado ontem, ${hm}`;
    return `atualizado em ${App.fmtDataCurta(iso)}`;
  }

  // ======================================================================
  // Lista (painel da esquerda)
  // ======================================================================
  function itemLista(c, ativo) {
    const n = App.pedidosDoCliente(c.id).length;
    const falta = c.conversa.estado === 'falta';
    const partes = [...(App.ehGrupo(c) ? ['Grupo'] : []), n ? plural(n, 'pedido', 'pedidos') : 'sem pedidos'];
    if (falta && c.conversa.desde) partes.push(App.fmtHa(c.conversa.desde));
    return `<button class="item ${ativo ? 'ativo' : ''}" data-cliente="${esc(c.id)}"${ativo ? ' aria-current="true"' : ''}>
      ${UI.avatar({ tam: 34, img: c.avatar, nome: c.nome })}
      <span class="cl-item-txt"><span class="t1 truncar">${esc(c.nome)}</span><span class="t2 truncar">${esc(partes.join(' · '))}</span></span>
      ${falta ? `<span class="cl-item-ponto" title="Falta responder">${UI.ponto('var(--vermelho)')}</span>` : ''}
    </button>`;
  }

  function renderLista(sel) {
    const falta = App.faltaResponder(), resp = App.respondidos();
    const grupo = (rotulo, cs) => cs.length
      ? `<div class="grupo-rot sobrelinha">${esc(rotulo)} · ${cs.length}</div>${cs.map(c => itemLista(c, c.id === sel.id)).join('')}`
      : '';
    return `<div class="bloco div-r cl-lista">
      <div class="bloco-cab cl-lista-cab"><h2 class="titulo-bloco cl-titulo">Clientes</h2><span class="contagem">${App.estado.clientes.length}</span></div>
      <div class="cl-lista-rolar" data-rolagem="lista-clientes">${grupo('Falta responder', falta)}${grupo('Respondidos', resp)}</div>
      <button class="btn btn-bloco btn-centro cl-add" data-add>${ic('usuarioMais', 17)}Adicionar pelo ID</button>
    </div>`;
  }

  // ======================================================================
  // Ficha (painel do meio)
  // ======================================================================
  function chipCapa(c) {
    const ps = App.pedidosDoCliente(c.id);
    const prod = ps.filter(p => p.etapa === 'comecado').length;
    const ativos = ps.filter(App.ativo).length;
    if (prod) return `${prod} em produção`;
    if (ativos) return plural(ativos, 'pedido ativo', 'pedidos ativos');
    return 'sem pedidos ativos';
  }

  // a receber do cliente: moeda principal primeiro; as outras vão no title
  function aReceberCliente(c) {
    const r = App.resumoCliente(c.id).aReceber || {};
    const principal = App.estado.config.moedaPadrao;
    const ent = Object.entries(r).filter(([, v]) => v > 0).sort((a, b) => (b[0] === principal) - (a[0] === principal));
    if (!ent.length) return null;
    return { texto: App.fmtValor(ent[0][1], ent[0][0]), todos: ent.map(([m, v]) => App.fmtValor(v, m)).join(' + '), mais: ent.length - 1 };
  }

  function fatos(c) {
    const res = App.resumoCliente(c.id);
    const ar = aReceberCliente(c);
    const media = res.ajustesMedia;
    const ajustes = media == null ? '' : media === 0 ? 'nenhum' : `${App.fmtNum(Math.round(media * 10) / 10)} por pedido`;
    const traco = '<span class="apagado">—</span>';
    // colunas no CSS (cl-fatos): viram 2×2 quando a ficha fica estreita
    return `<div class="fatos cl-fatos">
      <div class="fato"${ar ? ` title="${esc(ar.todos)}"` : ''}><span class="fato-rotulo">A receber</span>
        <span class="fato-valor truncar ${ar ? 'cl-receber' : ''}">${ar ? esc(ar.texto) + (ar.mais ? ` <span class="pequeno mudo">+${ar.mais}</span>` : '') : traco}</span></div>
      <div class="fato"${media != null ? ' title="Média de rodadas de ajuste nos pedidos concluídos"' : ''}><span class="fato-rotulo">Ajustes</span>
        <span class="fato-valor truncar">${ajustes ? esc(ajustes) : traco}</span></div>
      <button class="fato cl-fato-btn" data-pagavia title="Clique para editar como esse cliente paga"><span class="fato-rotulo">Paga via ${ic('lapis', 11, 2.4)}</span>
        <span class="fato-valor truncar">${c.pagaVia ? esc(c.pagaVia) : traco}</span></button>
      <div class="fato"><span class="fato-rotulo">Pedidos</span><span class="fato-valor">${res.total}</span></div>
    </div>`;
  }

  function linhaHistorico(p) {
    const idx = App.indiceEtapa(p.etapa);
    const fim = p.etapa === 'pago';
    const barras = App.ETAPAS.map((e, i) => `<span class="${fim || i < idx ? 'feito' : i === idx ? 'atual' : ''}"></span>`).join('');
    const pg = App.pagamento(p);
    const sub = [App.fmtMesAno(p.criadoEm), p.jogo].filter(Boolean).join(' · ');
    return `<div class="linha clicavel" data-pedido="${esc(p.id)}" role="button" tabindex="0" title="Abrir pedido">
      <div class="cl-cel"><div class="cl-ped-tit truncar">${esc(p.titulo)}</div><div class="cl-ped-sub truncar">${esc(sub)}</div></div>
      <div class="cl-cel cl-etapa"><div class="etapas-mini">${barras}</div><span class="truncar ${fim ? 'cor-verde' : 'cor-azul'}">${fim ? 'Concluído' : esc(App.rotuloEtapa(p.etapa))}</span></div>
      <div class="cl-cel cl-valor truncar">${p.valor ? esc(App.fmtValor(p.valor, p.moeda)) : '<span class="apagado">—</span>'}</div>
      <div class="cl-cel">${UI.pill(pg.rotulo, pg.tipo)}</div>
    </div>`;
  }

  function renderFicha(c) {
    const ps = App.pedidosDoCliente(c.id);
    const sub = [arroba(c), c.criadoEm ? 'cliente desde ' + App.fmtMesAno(c.criadoEm) : ''].filter(Boolean).join(' · ');
    // rolagem guardada por cliente: abrir outro cliente começa do topo
    return `<div class="bloco sem-pad cresce cl-ficha" data-rolagem="ficha-${esc(c.id)}">
      <div class="capa cl-capa" style="--cor-capa:${corCapa(c)}">
        <div class="cl-capa-txt"><h2 class="truncar" title="${esc(c.nome)}">${esc(c.nome)}</h2><div class="cl-capa-sub truncar">${esc(sub)}</div></div>
        <span class="chip">${esc(chipCapa(c))}</span>
      </div>
      <div class="cl-corpo">
        ${fatos(c)}
        <section class="cl-secao">
          <div class="bloco-cab"><h3 class="titulo-bloco">Histórico</h3>${ps.length ? `<span class="contagem">${plural(ps.length, 'pedido', 'pedidos')}</span>` : ''}
            <button class="link cl-cab-link" data-novo-pedido>${ic('mais', 14, 2.4)}Novo pedido</button></div>
          ${ps.length ? `<div class="tabela cl-tabela">
            <div class="tabela-cab"><span class="sobrelinha">Pedido</span><span class="sobrelinha">Etapa</span><span class="sobrelinha">Valor</span><span class="sobrelinha">Pagamento</span></div>
            <div class="lista">${ps.map(linhaHistorico).join('')}</div>
          </div>` : '<div class="cl-sem-pedidos">Nenhum pedido ainda</div>'}
        </section>
        <section class="cl-secao cl-notas">
          <div class="bloco-cab"><h3 class="titulo-bloco"><label for="cl-notas">Notas</label></h3><span class="cl-salva">salva sozinha</span></div>
          <textarea class="input cl-notas-txt" id="cl-notas" data-notas placeholder="Gostos, o que já combinaram, como prefere receber…">${esc(c.notas)}</textarea>
        </section>
      </div>
    </div>`;
  }

  // ======================================================================
  // Perfil (painel da direita)
  // ======================================================================
  function caixaGrupo(c) {
    if (!c.canalId) {
      return `<div class="caixa cl-caixa">
        <div class="cl-caixa-cab"><span class="sobrelinha">Grupo de DM</span></div>
        <div class="cl-rot">Sem o ID do grupo. Com ele, "Abrir no Discord" vai direto pra conversa.</div>
        <button class="link cl-link-acao" data-add-canal>${ic('mais', 14, 2.4)}<span data-rot>Adicionar ID do grupo</span></button>
      </div>`;
    }
    const criado = c.contaCriada || App.dataDoSnowflake(c.canalId);
    return `<div class="caixa cl-caixa">
      <div class="cl-caixa-cab"><span class="sobrelinha">Grupo de DM</span></div>
      <div class="cl-linha">
        <div class="cl-campo"><div class="cl-rot">ID do grupo</div><div class="cl-val cl-id truncar">${esc(c.canalId)}</div></div>
        <button class="btn btn-sec btn-peq btn-icone" data-copiar title="Copiar ID" aria-label="Copiar ID do grupo">${ic('copiar', 15)}</button>
      </div>
      ${criado ? `<div class="cl-campo"><div class="cl-rot">Grupo criado</div><div class="cl-val truncar">${esc(App.fmtDataCurta(criado))} · ${esc(App.anos(criado))}</div></div>` : ''}
      <div class="cl-rot cl-grupo-nota">O bot não entra em grupos, então o nome é você que define.</div>
    </div>`;
  }

  function caixaDiscord(c) {
    if (App.ehGrupo(c)) return caixaGrupo(c);
    if (!c.discordId) {
      return `<div class="caixa cl-caixa">
        <div class="cl-caixa-cab"><span class="sobrelinha">Discord</span></div>
        <div class="cl-rot">Sem ID do Discord. Com ele o app puxa nome, foto e abre a conversa.</div>
        <button class="link cl-link-acao" data-add-discord>${ic('mais', 14, 2.4)}<span data-rot>Adicionar ID</span></button>
      </div>`;
    }
    const criada = c.contaCriada || App.dataDoSnowflake(c.discordId);
    return `<div class="caixa cl-caixa">
      <div class="cl-caixa-cab"><span class="sobrelinha">Discord</span>${c.atualizadoEm ? `<span class="cl-atualizado truncar">${esc(fmtAtualizado(c.atualizadoEm))}</span>` : ''}</div>
      <div class="cl-linha">
        <div class="cl-campo"><div class="cl-rot">ID do usuário</div><div class="cl-val cl-id truncar">${esc(c.discordId)}</div></div>
        <button class="btn btn-sec btn-peq btn-icone" data-copiar title="Copiar ID" aria-label="Copiar ID do Discord">${ic('copiar', 15)}</button>
      </div>
      ${criada ? `<div class="cl-campo"><div class="cl-rot">Conta criada</div><div class="cl-val truncar">${esc(App.fmtDataCurta(criada))} · ${esc(App.anos(criada))}</div></div>` : ''}
    </div>`;
  }

  function caixaRoblox(c) {
    if (!temRoblox(c)) {
      return `<div class="caixa cl-caixa">
        <div class="cl-caixa-cab"><span class="sobrelinha">Roblox</span></div>
        <button class="link cl-link-acao" data-add-roblox>${ic('mais', 14, 2.4)}<span data-rot>Adicionar usuário do Roblox</span></button>
      </div>`;
    }
    const rb = c.roblox;
    const nome = rb.displayName || rb.username;
    const sub = ['@' + (rb.username || ''), rb.id ? 'ID ' + rb.id : ''].filter(Boolean).join(' · ');
    return `<div class="caixa cl-caixa">
      <div class="cl-caixa-cab"><span class="sobrelinha">Roblox</span></div>
      <div class="cl-linha">
        ${UI.avatar({ tam: 34, img: rb.avatar, nome, quadrado: true })}
        <div class="cl-campo"><div class="cl-val cl-val-rbx truncar">${esc(nome)}</div><div class="cl-rot truncar">${esc(sub)}</div></div>
        ${/^\d+$/.test(String(rb.id || '')) ? `<button class="btn btn-sec btn-peq btn-icone" data-rbx-abrir title="Abrir perfil no Roblox" aria-label="Abrir perfil no Roblox">${ic('externo', 15)}</button>` : ''}
      </div>
    </div>`;
  }

  function caixaConversa(c) {
    const falta = c.conversa.estado === 'falta';
    const ha = c.conversa.desde ? App.fmtHa(c.conversa.desde) : '';
    return `<div class="caixa cl-conversa">
      ${UI.avatar({ tam: 32, img: c.avatar, nome: c.nome, classe: falta ? 'anel-falta' : 'anel-ok' })}
      <div class="cl-campo">
        <div class="cl-conv-tit truncar">${falta ? 'Falta responder' : 'Respondido'}</div>
        <div class="cl-conv-sub truncar ${falta ? 'cor-vermelho' : 'cor-verde'}">${falta ? esc(ha ? 'Esperando ' + ha : 'Esperando') : esc(ha ? 'Em dia · ' + ha : 'Em dia')}</div>
      </div>
      <button class="btn btn-texto" data-conversa="${falta ? 'respondido' : 'falta'}" title="${falta ? 'Marcar como respondido' : 'Ele mandou mensagem nova'}">${falta ? 'Respondi' : 'Nova msg'}</button>
    </div>`;
  }

  function renderPerfil(c) {
    const ocupado = atualizando.has(c.id);
    const grupo = App.ehGrupo(c);
    const podeAtualizar = (!grupo && !!c.discordId) || temRoblox(c);
    const dicaAtualizar = !grupo && c.discordId ? 'puxa do Discord' : temRoblox(c) ? 'puxa do Roblox' : grupo ? 'grupo: manual' : 'sem ID';
    return `<div class="bloco sem-pad div-l cl-perfil">
      <div class="perfil-topo" style="--cor-capa:${corCapa(c)}"><div class="capa-mini"></div>${UI.avatar({ tam: 72, img: c.avatar, nome: c.nome })}</div>
      <div class="cl-perfil-corpo" data-rolagem="perfil-${esc(c.id)}">
        <div class="cl-perfil-id"><div class="cl-perfil-nome truncar" title="${esc(c.nome)}">${esc(c.nome)}</div><div class="cl-perfil-arroba truncar">${esc(arroba(c))}</div></div>
        ${caixaDiscord(c)}
        ${caixaRoblox(c)}
        ${caixaConversa(c)}
        <div class="cl-espaco"></div>
        <div class="cl-acoes">
          <button class="btn btn-acento btn-bloco" data-abrir-discord${App.temDiscord(c) ? (grupo ? ' title="Abre a conversa do grupo"' : '') : ` disabled title="${grupo ? 'Esse grupo não tem o ID salvo' : 'Esse cliente não tem ID do Discord'}"`}>${ic('externo', 17)}Abrir no Discord</button>
          <button class="btn btn-primario btn-bloco" data-novo-pedido>${ic('mais', 17, 2.4)}Novo pedido</button>
          <button class="btn btn-sec btn-bloco" data-atualizar${ocupado || !podeAtualizar ? ' disabled' : ''}>${ic('atualizar', 17)}<span data-rot>${ocupado ? 'Atualizando…' : 'Atualizar dados'}</span><span class="dica">${dicaAtualizar}</span></button>
          <button class="btn btn-bloco btn-centro cl-mais" data-mais aria-haspopup="menu"><span data-rot>Mais opções</span>${ic('chevB', 16)}</button>
        </div>
      </div>
    </div>`;
  }

  // ======================================================================
  // Ações da ficha
  // ======================================================================
  function novoPedido(c) {
    if (App.modais.novoPedido) App.modais.novoPedido(c.id);
    else UI.toast('O cadastro de pedido ainda não está disponível.', 'erro');
  }

  async function editarNome(c) {
    const v = await UI.perguntar({ titulo: 'Editar nome', sub: 'É assim que o cliente aparece no painel.', rotulo: 'Nome', valor: c.nome });
    if (v == null) return;
    const nome = v.trim();
    if (!nome) { UI.toast('O nome não pode ficar vazio.', 'erro'); return; }
    App.acoes.atualizarCliente(c.id, { nome });
  }

  async function editarPagaVia(c) {
    const v = await UI.perguntar({ titulo: 'Como esse cliente paga?', rotulo: 'Paga via', valor: c.pagaVia, placeholder: 'Gamepass, Pix, PayPal…' });
    if (v == null) return;
    App.acoes.atualizarCliente(c.id, { pagaVia: v.trim() });
  }

  // muda o rótulo de um botão/link enquanto algo assíncrono roda
  function ocupar(btn, texto) {
    if (!btn) return () => {};
    const rot = $('[data-rot]', btn) || btn;
    const antes = rot.textContent;
    btn.disabled = true; rot.textContent = texto;
    return () => { if (btn.isConnected) { btn.disabled = false; rot.textContent = antes; } };
  }

  async function adicionarDiscord(c, btn) {
    const v = await UI.perguntar({ titulo: 'Adicionar ID do Discord', sub: 'No Discord: botão direito no cliente → Copiar ID do usuário.', rotulo: 'ID do Discord', placeholder: 'Ex.: 284719306512384000', ok: 'Buscar' });
    if (v == null) return;
    const id = soDigitos(v);
    if (!ID_VALIDO.test(id)) { UI.toast('Esse ID não parece válido. Ele tem de 17 a 20 números.', 'erro'); return; }
    const outro = App.estado.clientes.find(x => x.discordId === id && x.id !== c.id);
    if (outro) { UI.toast(`Esse ID já é de ${outro.nome}.`, 'erro'); return; }
    const soltar = ocupar(botaoVivo(btn, '[data-add-discord]', '[data-mais]'), 'Buscando…');
    let r;
    try { r = await App.api.discord.usuario(id); } catch { r = { ok: false, codigo: 'rede', erro: 'Não deu pra falar com o Discord. Tente de novo.' }; }
    if (!r || !r.ok) {
      soltar();
      // sem bot / Discord fora do ar: o ID está certo, então salva igual ao modal "Novo cliente"
      if (r && FALHA_SEM_CULPA_DO_ID.has(r.codigo)) {
        App.acoes.atualizarCliente(c.id, { discordId: id, contaCriada: App.dataDoSnowflake(id), atualizadoEm: '' });
        UI.toast(FALHA_DO_BOT.has(r.codigo) ? 'ID salvo sem os dados do Discord. Configure o bot e use "Atualizar dados".' : 'ID salvo. Use "Atualizar dados" quando o Discord responder.');
        return;
      }
      UI.toast((r && r.erro) || 'Não deu pra buscar esse ID.', 'erro');
      return;
    }
    const d = r.dados || {};
    App.acoes.atualizarCliente(c.id, {
      discordId: id, username: d.username || '', globalName: d.globalName || '', avatar: d.avatar || c.avatar,
      corPerfil: d.corPerfil || c.corPerfil, contaCriada: d.contaCriada || App.dataDoSnowflake(id), atualizadoEm: App.agoraISO()
    });
    UI.toast('Discord conectado.', 'ok');
  }

  async function adicionarCanal(c) {
    const v = await UI.perguntar({
      titulo: c.canalId ? 'Trocar ID do grupo' : 'Adicionar ID do grupo',
      sub: 'No Discord: botão direito no grupo (na lista de conversas) → Copiar ID do canal.',
      rotulo: 'ID do grupo de DM', valor: c.canalId || '', placeholder: 'Ex.: 1093847561029384756', ok: 'Salvar'
    });
    if (v == null) return;
    const id = soDigitos(v);
    if (!ID_VALIDO.test(id)) { UI.toast('Esse ID não parece válido. Ele tem de 17 a 20 números.', 'erro'); return; }
    const outro = App.estado.clientes.find(x => (x.canalId === id || x.discordId === id) && x.id !== c.id);
    if (outro) { UI.toast(`Esse ID já é de ${outro.nome}.`, 'erro'); return; }
    App.acoes.atualizarCliente(c.id, { canalId: id, contaCriada: App.dataDoSnowflake(id) });
    UI.toast('ID do grupo salvo.', 'ok');
  }

  async function adicionarRoblox(c, btn) {
    const v = await UI.perguntar({
      titulo: temRoblox(c) ? 'Trocar usuário do Roblox' : 'Adicionar usuário do Roblox',
      sub: temRoblox(c) ? 'Deixe vazio para tirar o Roblox da ficha.' : '',
      rotulo: 'Usuário do Roblox', valor: temRoblox(c) ? c.roblox.username : '', placeholder: 'ex.: lunar_bloxx', ok: 'Buscar'
    });
    if (v == null) return;
    const nome = limparRoblox(v);
    if (!nome) {
      if (temRoblox(c)) { App.acoes.atualizarCliente(c.id, { roblox: null }); UI.toast('Roblox removido da ficha.', 'ok'); }
      return;
    }
    const soltar = ocupar(botaoVivo(btn, '[data-add-roblox]', '[data-mais]'), 'Buscando…');
    let r;
    try { r = await App.api.roblox.usuario(nome); } catch { r = { ok: false, erro: 'Não deu pra falar com o Roblox. Tente de novo.' }; }
    if (!r || !r.ok) { soltar(); UI.toast((r && r.erro) || 'Usuário do Roblox não encontrado.', 'erro'); return; }
    const d = r.dados || {};
    App.acoes.atualizarCliente(c.id, { roblox: { id: String(d.id || ''), username: d.username || nome, displayName: d.displayName || d.username || nome, avatar: d.avatar || '' } });
    UI.toast('Roblox conectado.', 'ok');
  }

  // um cliente por vez, mas vários clientes podem estar atualizando ao mesmo tempo
  async function atualizarDados(c, btn) {
    if (atualizando.has(c.id)) return;
    atualizando.add(c.id);
    ocupar(btn, 'Atualizando…');
    try { await App.atualizarDadosCliente(c.id); }
    catch { UI.toast('Não deu pra atualizar agora. Tente de novo.', 'erro'); }
    finally { atualizando.delete(c.id); App.redesenhar(); }
  }

  async function removerCliente(c) {
    const n = App.pedidosDoCliente(c.id).length;
    const ok = await UI.confirmar({
      titulo: `Remover ${c.nome}?`,
      texto: n
        ? `${n === 1 ? 'O pedido desse cliente também será apagado' : `Os ${n} pedidos desse cliente também serão apagados`}, junto com as imagens salvas. Não dá pra desfazer.`
        : 'A ficha e as notas serão apagadas. Não dá pra desfazer.',
      ok: 'Remover cliente', perigo: true
    });
    if (!ok) return;
    App.acoes.removerCliente(c.id);
    App.ir('clientes');
    UI.toast(`Cliente removido: ${c.nome}.`, 'ok');
  }

  function abrirMais(c, ancora) {
    const op = (id, icone, texto, extra = '') => `<button class="item ${extra}" data-op="${id}">${ic(icone, 16)}<span class="t1">${esc(texto)}</span></button>`;
    UI.menu(ancora, `<div class="menu-titulo sobrelinha">${esc(c.nome)}</div>
      ${op('nome', 'lapis', 'Editar nome')}
      ${op('pagavia', 'moeda', 'Editar "paga via"')}
      ${op('roblox', 'usuarioMais', temRoblox(c) ? 'Trocar usuário do Roblox' : 'Adicionar usuário do Roblox')}
      ${App.ehGrupo(c)
        ? (c.canalId ? op('copiar', 'copiar', 'Copiar ID do grupo') + op('canal', 'lapis', 'Trocar ID do grupo') : op('canal', 'discord', 'Adicionar ID do grupo'))
        : (c.discordId ? op('copiar', 'copiar', 'Copiar ID do Discord') : op('discord', 'discord', 'Adicionar ID do Discord'))}
      ${op('remover', 'lixo', 'Remover cliente', 'cl-menu-perigo')}`, (m, fechar) => {
      m.classList.add('cl-menu'); // estilos só deste menu (o .menu-flutuante é compartilhado)
      // no pé do painel o menu abriria para fora da janela: vira para cima
      const r = ancora.getBoundingClientRect();
      if (r.bottom + 8 + m.offsetHeight > window.innerHeight - 8) m.style.top = Math.max(8, r.top - 8 - m.offsetHeight) + 'px';
      $$('[data-op]', m).forEach(b => b.onclick = () => {
        fechar();
        const o = b.dataset.op;
        if (o === 'nome') editarNome(c);
        else if (o === 'pagavia') editarPagaVia(c);
        // sem botão próprio: o "Buscando…" aparece no link da caixa (se houver) ou no "Mais opções" (botaoVivo)
        else if (o === 'roblox') adicionarRoblox(c, null);
        else if (o === 'discord') adicionarDiscord(c, null);
        else if (o === 'canal') adicionarCanal(c);
        else if (o === 'copiar') App.copiar(idDiscordDe(c), App.ehGrupo(c) ? 'ID do grupo copiado.' : 'ID do Discord copiado.');
        else if (o === 'remover') removerCliente(c);
      });
    });
  }

  // ======================================================================
  // Tela
  // ======================================================================
  App.telas.clientes = {
    cheia: true,
    cabecalho() {
      const n = App.estado.clientes.length, m = App.faltaResponder().length;
      if (!n) return { titulo: 'Clientes', sub: 'nenhum cliente ainda' };
      return { titulo: 'Clientes', sub: `${plural(n, 'cliente', 'clientes')} · ${m ? `${m} esperando resposta` : 'ninguém esperando'}` };
    },
    render() {
      const c = selecionado();
      // fixa a escolha na rota: depois de "Respondi" a ficha não pula para outro cliente
      if (c && App.rota.id !== c.id) App.rota.id = c.id;
      if (!c) {
        return `<div class="bloco cl-vazio">${UI.vazio({
          icone: 'clientes', titulo: 'Nenhum cliente ainda',
          texto: 'Cole o ID do Discord da pessoa e o app puxa o nome e a foto sozinho. Tudo fica salvo só no seu computador.',
          acao: `<button class="btn btn-primario cl-vazio-btn" data-add>${ic('usuarioMais', 17)}Adicionar pelo ID do Discord</button>
            <ol class="cl-passos">
              <li><span class="num">1</span><b>Modo desenvolvedor</b>Ative no Discord em Configurações → Avançado.</li>
              <li><span class="num">2</span><b>Copie o ID</b>Botão direito na pessoa → Copiar ID do usuário.</li>
              <li><span class="num">3</span><b>Cole aqui</b>Nome e foto vêm sozinhos e ficam salvos.</li>
            </ol>`
        })}</div>`;
      }
      return `<div class="paineis cl-paineis">${renderLista(c)}${renderFicha(c)}${renderPerfil(c)}</div>`;
    },
    montar(area) {
      $$('[data-add]', area).forEach(b => b.onclick = () => App.modais.novoCliente());
      const c = selecionado();
      if (!c) return;

      $$('[data-cliente]', area).forEach(b => b.onclick = () => App.ir('clientes', b.dataset.cliente));
      $$('[data-pedido]', area).forEach(l => {
        l.onclick = () => App.ir('pedidos', l.dataset.pedido);
        l.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.ir('pedidos', l.dataset.pedido); } };
      });
      $$('[data-novo-pedido]', area).forEach(b => b.onclick = () => novoPedido(c));

      const notas = $('[data-notas]', area);
      if (notas) {
        const lembrar = () => { notasEmEdicao = { id: c.id, ini: notas.selectionStart, fim: notas.selectionEnd, rol: notas.scrollTop }; };
        notas.addEventListener('input', () => { lembrar(); App.acoes.atualizarCliente(c.id, { notas: notas.value }, { render: false }); });
        ['focus', 'keyup', 'mouseup', 'select', 'scroll'].forEach(ev => notas.addEventListener(ev, lembrar));
        // saiu de verdade (clicou fora) → esquece; se o textarea sumiu num redesenho, o novo herda o foco abaixo
        notas.addEventListener('blur', (e) => {
          const esquecer = () => { if (notasEmEdicao && notasEmEdicao.id === c.id) notasEmEdicao = null; };
          if (e.relatedTarget) esquecer(); // o foco foi pra outro controle
          else queueMicrotask(() => { if (notas.isConnected) esquecer(); });
        });
        const ed = notasEmEdicao;
        if (ed && ed.id === c.id) {
          notas.focus({ preventScroll: true });
          const n = notas.value.length;
          notas.setSelectionRange(Math.min(ed.ini, n), Math.min(ed.fim, n));
          notas.scrollTop = ed.rol;
          lembrar();
        } else notasEmEdicao = null;
      }

      const on = (sel, fn) => { const b = $(sel, area); if (b) b.onclick = (e) => fn(e.currentTarget); };
      on('[data-pagavia]', () => editarPagaVia(c));
      on('[data-copiar]', () => App.copiar(idDiscordDe(c), App.ehGrupo(c) ? 'ID do grupo copiado.' : 'ID do Discord copiado.'));
      on('[data-add-canal]', () => adicionarCanal(c));
      on('[data-add-discord]', (b) => adicionarDiscord(c, b));
      on('[data-add-roblox]', (b) => adicionarRoblox(c, b));
      on('[data-rbx-abrir]', () => App.api.sistema.abrirExterno(`https://www.roblox.com/users/${encodeURIComponent(c.roblox.id)}/profile`));
      on('[data-conversa]', (b) => App.acoes.marcarConversa(c.id, b.dataset.conversa));
      on('[data-abrir-discord]', () => App.abrirDiscord(c));
      on('[data-atualizar]', (b) => atualizarDados(c, b));
      on('[data-mais]', (b) => abrirMais(c, b));

      // cliente aberto de fora (busca, sino, conversas, novo cliente, "Respondi") pode estar fora da
      // parte visível da lista. O shell devolve a rolagem salva DEPOIS do montar(), por isso o microtask.
      const rol = $('.cl-lista-rolar', area);
      queueMicrotask(() => {
        const at = rol && rol.isConnected && $('.item.ativo', rol);
        if (!at) return;
        const r = at.getBoundingClientRect(), rr = rol.getBoundingClientRect();
        if (r.top < rr.top) {
          // escondido em cima: o 1º do grupo leva junto o rótulo do grupo
          const ant = at.previousElementSibling;
          const topo = ant && ant.classList.contains('grupo-rot') ? ant.getBoundingClientRect().top : r.top - 4;
          rol.scrollTop -= rr.top - topo;
        } else if (r.bottom > rr.bottom) rol.scrollTop += r.bottom - rr.bottom + 4;
        // visível: não mexe na rolagem que a pessoa deixou
      });
    }
  };

  // ======================================================================
  // Modal "Novo cliente" (compartilhado: cabeçalho, dashboard, busca…)
  // ======================================================================
  function caixaAchadoDiscord(d) {
    const nome = d.globalName || d.username || 'Sem nome';
    const criada = d.contaCriada || App.dataDoSnowflake(d.id);
    return `<div class="caixa nc-res">
      ${UI.avatar({ tam: 46, img: d.avatar, nome })}
      <div class="nc-res-txt">
        <div class="nc-res-nome truncar">${esc(nome)}</div>
        <div class="nc-res-sub truncar">@${esc(d.username || '')}</div>
        ${criada ? `<div class="nc-res-sub truncar">conta criada em ${esc(App.fmtDataCurta(criada))} · ${esc(App.anos(criada))}</div>` : ''}
      </div>
      <span class="pill verde">${ic('check', 13, 2.8)}Encontrado</span>
    </div>`;
  }

  function caixaJaSalvo(c) {
    return `<div class="caixa nc-res">
      ${UI.avatar({ tam: 46, img: c.avatar, nome: c.nome })}
      <div class="nc-res-txt">
        <div class="nc-res-nome truncar">${esc(c.nome)}</div>
        <div class="nc-res-sub truncar">Esse ID já está na sua lista${c.username ? ' · @' + esc(c.username) : ''}</div>
        <button class="link nc-abrir" data-abrir-ficha>Abrir ficha ${ic('chevD', 14, 2.4)}</button>
      </div>
      <span class="pill amarelo">Já salvo</span>
    </div>`;
  }

  function caixaAchadoRoblox(d) {
    const nome = d.displayName || d.username;
    return `<div class="caixa nc-res nc-res-peq">
      ${UI.avatar({ tam: 34, img: d.avatar, nome, quadrado: true })}
      <div class="nc-res-txt">
        <div class="nc-res-nome truncar">${esc(nome)}</div>
        <div class="nc-res-sub truncar">@${esc(d.username || '')}${d.id ? ' · ID ' + esc(d.id) : ''}</div>
      </div>
      <span class="pill verde">${ic('check', 13, 2.8)}Encontrado</span>
    </div>`;
  }

  App.modais.novoCliente = function () {
    // erroD: { id, codigo } da última busca no Discord que falhou; erroR: usuário do Roblox não achado
    const st = { tipo: 'pessoa', discord: null, existente: null, roblox: null, robloxNome: '', buscandoD: false, buscandoR: false, apelidoAuto: '', erroD: null, erroR: '' };

    const corpo = `
      <div class="nc-tipo" role="group" aria-label="Tipo de cliente">
        <button type="button" class="nc-tipo-op" data-tipo="pessoa" aria-pressed="true">${ic('clientes', 15)}Pessoa</button>
        <button type="button" class="nc-tipo-op" data-tipo="grupo" aria-pressed="false">${ic('msg', 15)}Grupo de DM</button>
      </div>
      <div class="campo oculto" data-so-grupo>
        <label for="nc-canal">ID do grupo de DM</label>
        <input class="input nc-id" id="nc-canal" data-canal inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="Ex.: 1093847561029384756">
        <div class="nc-erro" data-erro-c role="alert"></div>
        <div class="ajuda nc-ajuda">${ic('info', 14)}<span>No Discord: botão direito no grupo (na lista de conversas) → Copiar ID do canal. O bot não entra em grupos, então o nome do grupo é você que escreve aqui embaixo.</span></div>
        <div class="nc-slot" data-res-c></div>
      </div>
      <div class="campo" data-so-pessoa>
        <label for="nc-id">ID do Discord</label>
        <div class="linha-campos nc-linha">
          <input class="input nc-id" id="nc-id" data-id inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="Ex.: 284719306512384000" autofocus>
          <button class="btn btn-acento" data-buscar-d>${ic('busca', 16, 2.4)}<span data-rot>Buscar</span></button>
        </div>
        <div class="nc-erro" data-erro-d role="alert"></div>
        <div class="ajuda nc-ajuda">${ic('info', 14)}<span>No Discord: botão direito no cliente → Copiar ID do usuário. Precisa do Modo desenvolvedor (Configurações → Avançado).</span></div>
        <div class="nc-slot" data-res-d></div>
      </div>
      <div class="campo" data-so-pessoa>
        <label for="nc-rbx">Usuário do Roblox <span class="nc-opc">(opcional)</span></label>
        <div class="linha-campos nc-linha">
          <input class="input" id="nc-rbx" data-rbx autocomplete="off" spellcheck="false" placeholder="ex.: lunar_bloxx">
          <button class="btn btn-sec" data-buscar-r>${ic('busca', 16, 2.4)}<span data-rot>Buscar</span></button>
        </div>
        <div class="nc-erro" data-erro-r role="alert"></div>
        <div class="nc-slot" data-res-r></div>
      </div>
      <div class="campo">
        <label for="nc-apelido" data-rot-apelido>Como aparece no painel</label>
        <input class="input" id="nc-apelido" data-apelido autocomplete="off" placeholder="Nome que você vai ver nas listas">
      </div>
      <label class="marcador nc-marcador"><input type="checkbox" data-falta checked><span>Já entra como <span class="cor-vermelho forte">falta responder</span></span></label>`;

    const rodape = `<button class="btn btn-sec" data-cancelar>Cancelar</button>
      <button class="btn btn-primario" data-salvar disabled>${ic('check', 16, 2.6)}Salvar cliente</button>`;

    UI.modal({
      titulo: 'Novo cliente', sub: 'Cole o ID do Discord e o resto vem sozinho.', largura: 520, corpo, rodape,
      aoMontar: (el, fechar) => {
        const inpId = $('[data-id]', el), btnD = $('[data-buscar-d]', el), erroD = $('[data-erro-d]', el), resD = $('[data-res-d]', el);
        const inpR = $('[data-rbx]', el), btnR = $('[data-buscar-r]', el), erroR = $('[data-erro-r]', el), resR = $('[data-res-r]', el);
        const inpA = $('[data-apelido]', el), chkF = $('[data-falta]', el), btnSalvar = $('[data-salvar]', el);

        const inpC = $('[data-canal]', el), erroC = $('[data-erro-c]', el), resC = $('[data-res-c]', el);
        const ehGrupo = () => st.tipo === 'grupo';
        const canalAtual = () => soDigitos(inpC.value);
        const canalDono = (id) => App.estado.clientes.find(c => c.canalId === id || c.discordId === id);
        const idAtual = () => soDigitos(inpId.value);
        const nomeRoblox = () => limparRoblox(inpR.value);
        // a última busca DESTE ID falhou por algo que não é o ID: salva só com o ID (e o nome digitado)
        const salvaSemDados = () => !!(st.erroD && st.erroD.id === idAtual() && FALHA_SEM_CULPA_DO_ID.has(st.erroD.codigo));
        // o botão só fica aceso quando o clique consegue salvar de verdade
        const podeSalvar = () => {
          if (ehGrupo()) { const id = canalAtual(); return ID_VALIDO.test(id) && !canalDono(id) && !!inpA.value.trim(); }
          if (st.existente || st.buscandoD || st.buscandoR) return false;
          const id = idAtual(), apelido = inpA.value.trim();
          if (id && !ID_VALIDO.test(id)) return false;                          // ID incompleto
          if (st.erroD && st.erroD.id === id && !salvaSemDados()) return false; // ID recusado: não existe / inválido
          if (salvaSemDados() && !apelido) return false;                        // sem dados do Discord, o nome vem daqui
          if (st.erroR && st.erroR === nomeRoblox()) return false;              // Roblox não achado: corrigir ou apagar
          return !!(st.discord || apelido || id);
        };
        const atualizarBotao = () => { btnSalvar.disabled = !podeSalvar(); };

        function erro(alvo, msg, codigo, dica) {
          const cfg = codigo === 'sem-token' ? 'Configurar o bot agora' : codigo === 'token-invalido' ? 'Abrir Configurações' : '';
          // linha 1: ícone + erro; embaixo, alinhados ao texto: o atalho pra Configurações e a dica do que fazer
          const mais = (cfg ? `<button class="link" data-ir-config>${esc(cfg)}</button>` : '') + (dica ? `<span class="nc-erro-dica">${esc(dica)}</span>` : '');
          alvo.innerHTML = msg ? `${ic('alerta', 14)}<span>${esc(msg)}</span>${mais ? `<span class="nc-erro-mais">${mais}</span>` : ''}` : '';
          const l = $('[data-ir-config]', alvo);
          if (l) l.onclick = () => { fechar(); App.ir('config'); };
        }
        const ocuparBusca = (btn, sim) => { btn.disabled = sim; $('[data-rot]', btn).textContent = sim ? 'Buscando…' : 'Buscar'; };

        async function buscarDiscord() {
          if (st.buscandoD) return false;
          const id = soDigitos(inpId.value);
          inpId.value = id;
          st.discord = null; st.existente = null; st.erroD = null; resD.innerHTML = ''; erro(erroD, '');
          if (!id) { erro(erroD, 'Cole o ID do Discord primeiro.'); inpId.focus(); atualizarBotao(); return false; }
          if (!ID_VALIDO.test(id)) { erro(erroD, 'Esse ID não parece válido. Ele tem de 17 a 20 números.'); atualizarBotao(); return false; }
          const ja = App.estado.clientes.find(c => c.discordId === id);
          if (ja) {
            st.existente = ja;
            resD.innerHTML = caixaJaSalvo(ja);
            $('[data-abrir-ficha]', resD).onclick = () => { fechar(); App.ir('clientes', ja.id); };
            atualizarBotao();
            return false;
          }
          st.buscandoD = true; ocuparBusca(btnD, true); atualizarBotao();
          let r;
          try { r = await App.api.discord.usuario(id); } catch { r = { ok: false, codigo: 'rede', erro: 'Não deu pra falar com o Discord. Tente de novo.' }; }
          st.buscandoD = false; ocuparBusca(btnD, false);
          if (!el.isConnected) return false;
          if (soDigitos(inpId.value) !== id) { atualizarBotao(); return false; } // mudou enquanto buscava
          if (!r || !r.ok) {
            st.erroD = { id, codigo: (r && r.codigo) || 'http' };
            const dica = FALHA_SEM_CULPA_DO_ID.has(st.erroD.codigo)
              ? 'Dá pra salvar mesmo assim, só com o ID e o nome abaixo. Depois use "Atualizar dados" na ficha.'
              : 'Confira o ID ou apague o campo para salvar só com o nome.';
            erro(erroD, (r && r.erro) || 'Não deu pra buscar esse ID.', st.erroD.codigo, dica);
            atualizarBotao();
            return false;
          }
          st.discord = { ...r.dados, id };
          resD.innerHTML = caixaAchadoDiscord(st.discord);
          const sugestao = st.discord.globalName || st.discord.username || '';
          if (!inpA.value.trim() || inpA.value === st.apelidoAuto) { inpA.value = sugestao; st.apelidoAuto = sugestao; }
          atualizarBotao();
          return true;
        }

        async function buscarRoblox() {
          if (st.buscandoR) return false;
          const nome = limparRoblox(inpR.value);
          inpR.value = nome;
          st.roblox = null; st.robloxNome = ''; st.erroR = ''; resR.innerHTML = ''; erro(erroR, '');
          if (!nome) { atualizarBotao(); return true; } // é opcional
          st.buscandoR = true; ocuparBusca(btnR, true); atualizarBotao();
          let r;
          try { r = await App.api.roblox.usuario(nome); } catch { r = { ok: false, erro: 'Não deu pra falar com o Roblox. Tente de novo.' }; }
          st.buscandoR = false; ocuparBusca(btnR, false);
          if (!el.isConnected) return false;
          if (limparRoblox(inpR.value) !== nome) { atualizarBotao(); return false; }
          if (!r || !r.ok) {
            st.erroR = nome;
            erro(erroR, (r && r.erro) || 'Usuário do Roblox não encontrado.', null, 'Corrija o usuário ou apague o campo para salvar.');
            atualizarBotao();
            return false;
          }
          st.roblox = r.dados; st.robloxNome = nome;
          resR.innerHTML = caixaAchadoRoblox(r.dados);
          atualizarBotao();
          return true;
        }

        // grupo: o ID vale sozinho (não dá pra consultar), mostra a data de criação e avisa se já está na lista
        function conferirCanal() {
          const id = canalAtual();
          erro(erroC, ''); resC.innerHTML = '';
          if (!id) return;
          const dono = canalDono(id);
          if (dono) {
            resC.innerHTML = caixaJaSalvo(dono);
            $('[data-abrir-ficha]', resC).onclick = () => { fechar(); App.ir('clientes', dono.id); };
            return;
          }
          if (!ID_VALIDO.test(id)) return;
          const criado = App.dataDoSnowflake(id);
          resC.innerHTML = `<div class="caixa nc-res nc-res-peq">${UI.avatar({ tam: 34, nome: inpA.value.trim() || 'Grupo' })}
            <div class="nc-res-txt"><div class="nc-res-nome truncar">${esc(inpA.value.trim() || 'Grupo de DM')}</div>
            <div class="nc-res-sub truncar">grupo criado em ${esc(App.fmtDataCurta(criado))} · ${esc(App.anos(criado))}</div></div>
            <span class="pill verde">${ic('check', 13, 2.8)}ID válido</span></div>`;
        }
        function trocarTipo(tipo) {
          st.tipo = tipo;
          $$('[data-tipo]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.tipo === tipo ? 'true' : 'false'));
          $$('[data-so-pessoa]', el).forEach(n => n.classList.toggle('oculto', tipo === 'grupo'));
          $$('[data-so-grupo]', el).forEach(n => n.classList.toggle('oculto', tipo !== 'grupo'));
          $('[data-rot-apelido]', el).textContent = tipo === 'grupo' ? 'Nome do grupo' : 'Como aparece no painel';
          inpA.placeholder = tipo === 'grupo' ? 'Ex.: Equipe Lava Obby' : 'Nome que você vai ver nas listas';
          const sub = el.querySelector('.modal-cab .sub');
          if (sub) sub.textContent = tipo === 'grupo' ? 'Cole o ID do grupo de DM e dê um nome pra ele.' : 'Cole o ID do Discord e o resto vem sozinho.';
          if (tipo === 'grupo') { conferirCanal(); inpC.focus(); } else inpId.focus();
          atualizarBotao();
        }
        $$('[data-tipo]', el).forEach(b => b.onclick = () => trocarTipo(b.dataset.tipo));
        inpC.addEventListener('input', () => {
          const limpo = soDigitos(inpC.value);
          if (limpo !== inpC.value) inpC.value = limpo;
          conferirCanal(); atualizarBotao();
        });
        inpC.addEventListener('blur', () => { const id = canalAtual(); if (id && !ID_VALIDO.test(id) && el.isConnected) erro(erroC, 'Esse ID não parece válido. Ele tem de 17 a 20 números.'); });
        inpC.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inpA.focus(); } });

        async function salvar() {
          if (btnSalvar.disabled) return;
          if (ehGrupo()) {
            const canalId = canalAtual(), nome = inpA.value.trim();
            if (!ID_VALIDO.test(canalId) || canalDono(canalId) || !nome) { atualizarBotao(); return; }
            const novoId = App.acoes.novoCliente({ tipo: 'grupo', canalId, nome, contaCriada: App.dataDoSnowflake(canalId), faltaResponder: chkF.checked });
            App.acoes.atualizarCliente(novoId, { atualizadoEm: '' }, { render: false });
            fechar();
            App.ir('clientes', novoId);
            UI.toast(`Grupo adicionado: ${nome}.`, 'ok');
            return;
          }
          const id = idAtual();
          // ID que já está na lista (de outro modal, por exemplo): mostra o "Já salvo" em vez de duplicar
          if (id && App.estado.clientes.some(c => c.discordId === id)) { await buscarDiscord(); return; }
          // ID digitado mas não buscado (ou trocado depois): busca antes de salvar. Se o Discord falhar
          // por algo que não é o ID (bot não configurado, rede, limite), segue e salva só com o ID.
          if (id && (!st.discord || st.discord.id !== id) && !salvaSemDados()) {
            if (!(await buscarDiscord()) && !salvaSemDados()) return;
          }
          if (!el.isConnected) return;
          const rn = nomeRoblox();
          if (rn && (!st.roblox || st.robloxNome.toLowerCase() !== rn.toLowerCase())) { if (!(await buscarRoblox())) return; }
          if (!rn) st.roblox = null;
          if (!el.isConnected) return;
          const d = id && st.discord && st.discord.id === id ? st.discord : null;
          const semDados = !!id && !d;
          const nome = inpA.value.trim() || (d && (d.globalName || d.username)) || '';
          if (!nome) { atualizarBotao(); inpA.focus(); return; }
          const bot = semDados && st.erroD && FALHA_DO_BOT.has(st.erroD.codigo);
          const rb = st.roblox;
          const novoId = App.acoes.novoCliente({
            nome,
            discordId: id, username: d ? d.username || '' : '', globalName: d ? d.globalName || '' : '',
            avatar: d ? d.avatar || '' : '', corPerfil: d ? corValida(d.corPerfil) : '',
            contaCriada: d ? d.contaCriada || App.dataDoSnowflake(id) : id ? App.dataDoSnowflake(id) : '',
            roblox: rb ? { id: String(rb.id || ''), username: rb.username || '', displayName: rb.displayName || rb.username || '', avatar: rb.avatar || '' } : null,
            faltaResponder: chkF.checked
          });
          // o núcleo marca "atualizado agora" quando há ID; sem nada puxado do Discord isso enganaria
          if (semDados) App.acoes.atualizarCliente(novoId, { atualizadoEm: '' }, { render: false });
          fechar();
          App.ir('clientes', novoId);
          if (!semDados) UI.toast(`Cliente adicionado: ${nome}.`, 'ok');
          else UI.toast(bot ? 'Cliente salvo sem os dados do Discord. Configure o bot e use "Atualizar dados" na ficha.'
            : 'Cliente salvo sem os dados do Discord. Use "Atualizar dados" depois.');
        }

        inpId.addEventListener('input', () => {
          const limpo = soDigitos(inpId.value);
          if (limpo !== inpId.value) inpId.value = limpo; // cola "<@123…>" ou com espaços e fica só o número
          if ((st.discord && st.discord.id !== limpo) || (st.existente && st.existente.discordId !== limpo)) {
            st.discord = null; st.existente = null; resD.innerHTML = '';
          }
          // o erro do Discord vale para aquele ID: trocou o ID, ele some
          if (!st.erroD || st.erroD.id !== limpo) { st.erroD = null; erro(erroD, ''); }
          atualizarBotao();
        });
        // ID incompleto deixa o "Salvar" apagado: avisa o porquê ao sair do campo
        inpId.addEventListener('blur', () => {
          const id = idAtual();
          if (id && !ID_VALIDO.test(id) && !erroD.innerHTML && el.isConnected) erro(erroD, 'Esse ID não parece válido. Ele tem de 17 a 20 números.');
        });
        inpId.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarDiscord(); } });
        btnD.onclick = buscarDiscord;

        inpR.addEventListener('input', () => {
          if (st.roblox && st.robloxNome.toLowerCase() !== nomeRoblox().toLowerCase()) { st.roblox = null; resR.innerHTML = ''; }
          if (st.erroR !== nomeRoblox()) { st.erroR = ''; erro(erroR, ''); }
          atualizarBotao();
        });
        inpR.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarRoblox(); } });
        btnR.onclick = buscarRoblox;

        inpA.addEventListener('input', () => { if (ehGrupo()) conferirCanal(); atualizarBotao(); });
        inpA.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } });

        $('[data-cancelar]', el).onclick = fechar;
        btnSalvar.onclick = salvar;
      }
    });
  };
})();
