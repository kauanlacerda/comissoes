// Componentes visuais compartilhados. Tudo que vira HTML passa por UI.esc().
(function () {
  const UI = window.UI = {};

  UI.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Ícones (traço, cor = currentColor) ----------
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pedidos: '<path d="M4 6l1.5 1.5L8 5"/><path d="M4 12l1.5 1.5L8 11"/><path d="M4 18l1.5 1.5L8 17"/><path d="M12 6h8"/><path d="M12 12h8"/><path d="M12 18h8"/>',
    clientes: '<circle cx="10" cy="8" r="3.5"/><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
    config: '<path d="M4 7h10"/><path d="M18 7h2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    recolher: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 10l-2 2 2 2"/>',
    expandir: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M13 10l2 2-2 2"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    sino: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sair: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/>',
    chevE: '<path d="M15 6l-6 6 6 6"/>', chevD: '<path d="M9 6l6 6-6 6"/>', chevC: '<path d="M6 15l6-6 6 6"/>', chevB: '<path d="M6 9l6 6 6-6"/>',
    chevrons: '<path d="M8 10l4-4 4 4"/><path d="M8 14l4 4 4-4"/>',
    mais: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    externo: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
    atualizar: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    enviar: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    joinha: '<path d="M7 10v11"/><path d="M15 5.9L14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
    dinheiro: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    moeda: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15 9.5c-.6-.9-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.6-3-1.6"/>',
    pasta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    lixo: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    lapis: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    usuarioMais: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20v-1.5A3.5 3.5 0 0 1 6.5 15h5a3.5 3.5 0 0 1 3.5 3.5V20"/><path d="M19 8v6"/><path d="M16 11h6"/>',
    caixa: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    logo: '<rect x="3" y="3" width="18" height="18" rx="5.5"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    alerta: '<path d="M12 3l9.5 16.5h-19z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    responder: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    discord: '<path d="M8.5 7.5c2.3-.7 4.7-.7 7 0"/><path d="M8 17c2.6 1 5.4 1 8 0"/><path d="M7.5 7.8C6 10 5.3 12.6 5.5 15.7c1 1 2.3 1.7 3.7 2.1l1-1.8"/><path d="M16.5 7.8c1.5 2.2 2.2 4.8 2 7.9-1 1-2.3 1.7-3.7 2.1l-1-1.8"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/>',
    pincel: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    paleta: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/><path d="M12 21a2 2 0 0 1 0-4h1.5a2 2 0 0 0 0-4"/>'
  };
  UI.icone = (nome, tam = 18, traco = 2) =>
    `<svg class="ic" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[nome] || ''}</svg>`;

  // ---------- Avatar ----------
  const CORES = ['#5b47a8', '#1f5a70', '#7a5524', '#245a45', '#7a2f49', '#2d4270', '#4f5a24', '#6b3a7a'];
  UI.corDe = (texto) => { let h = 0; for (const c of String(texto || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; };
  // primeira LETRA/número de cada palavra (nome do Discord pode começar com emoji)
  UI.iniciais = (nome) => {
    const ini = (s) => ((String(s).match(/[\p{L}\p{N}]/u) || [''])[0]);
    const p = String(nome || '').trim().split(/\s+/).filter(w => ini(w));
    return ((ini(p[0] || '') || '?') + (p.length > 1 ? ini(p[p.length - 1]) : '')).toUpperCase();
  };
  // opts: { tam, img, nome, classe, quadrado }
  UI.avatar = ({ tam = 36, img = '', nome = '', classe = '', quadrado = false } = {}) => {
    const conteudo = img ? `<img src="${UI.esc(img)}" alt="">` : '';
    return `<span class="avatar ${quadrado ? 'quadrado' : ''} ${classe}" style="--t:${tam}px;--cor-avatar:${UI.corDe(nome)}">${UI.esc(UI.iniciais(nome))}${conteudo}</span>`;
  };
  // avatar com fallback: a imagem cobre as iniciais quando carrega
  const css = document.createElement('style');
  css.textContent = '.avatar{position:relative}.avatar img{position:absolute;inset:0}';
  document.head.appendChild(css);
  // imagem que falha (arquivo apagado, offline) some e deixa as iniciais à mostra — sem handler inline (CSP)
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest('.avatar, .slot, .ref')) t.remove(); }, true);

  UI.ponto = (cor) => `<span class="ponto" style="--cor:${cor}"></span>`;
  UI.pill = (texto, tipo = 'neutra') => `<span class="pill ${tipo}">${UI.esc(texto)}</span>`;

  // ---------- Vazio ----------
  UI.vazio = ({ icone = 'info', titulo = '', texto = '', acao = '' } = {}) =>
    `<div class="vazio"><div class="ic-vazio">${UI.icone(icone, 22)}</div><h3>${UI.esc(titulo)}</h3>${texto ? `<p>${UI.esc(texto)}</p>` : ''}${acao}</div>`;

  // ---------- Toast ----------
  UI.toast = (msg, tipo = '') => {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + tipo; t.textContent = msg; t.setAttribute('role', 'status');
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, tipo === 'erro' ? 5000 : 2800);
  };

  // ---------- Modal ----------
  // UI.modal({ titulo, sub, corpo (html), rodape (html), largura, aoMontar(el, fechar), aoFechar() }) → fechar()
  const pilhaModais = [];
  UI.modal = ({ titulo = '', sub = '', corpo = '', rodape = '', largura = 520, aoMontar, aoFechar } = {}) => {
    const fundo = document.createElement('div');
    fundo.className = 'fundo-modal';
    // tira o foco do botão que abriu (senão Enter abre um segundo modal igual) e devolve ao fechar
    const abridor = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    if (abridor) abridor.blur();
    fundo.innerHTML = `<div class="modal" tabindex="-1" role="dialog" aria-modal="true" aria-label="${UI.esc(titulo)}" style="--largura:${largura}px">
      <div class="modal-cab"><div class="tit"><h2>${UI.esc(titulo)}</h2>${sub ? `<div class="sub">${UI.esc(sub)}</div>` : ''}</div>
      <button class="btn btn-sec btn-peq btn-icone" data-fechar aria-label="Fechar">${UI.icone('x', 18, 2.2)}</button></div>
      <div class="modal-corpo">${corpo}</div>${rodape ? `<div class="modal-rodape">${rodape}</div>` : ''}</div>`;
    document.body.appendChild(fundo);
    let fechado = false;
    const fechar = () => {
      if (fechado) return; fechado = true;
      fundo.remove();
      const i = pilhaModais.indexOf(fechar); if (i >= 0) pilhaModais.splice(i, 1);
      if (abridor && abridor.isConnected) { try { abridor.focus({ preventScroll: true }); } catch {} }
      if (aoFechar) aoFechar();
    };
    pilhaModais.push(fechar);
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
    fundo.querySelector('[data-fechar]').addEventListener('click', fechar);
    const el = fundo.querySelector('.modal');
    if (aoMontar) aoMontar(el, fechar);
    const foco = el.querySelector('[autofocus]') || el.querySelector('input, textarea, select') || el;
    setTimeout(() => { if (fundo.isConnected) foco.focus(); }, 30);
    return fechar;
  };
  UI.fecharModalTopo = () => { const f = pilhaModais[pilhaModais.length - 1]; if (f) { f(); return true; } return false; };
  UI.temModal = () => pilhaModais.length > 0;

  // UI.confirmar({ titulo, texto, ok, perigo }) → Promise<boolean>
  UI.confirmar = ({ titulo = 'Tem certeza?', texto = '', ok = 'Confirmar', perigo = false } = {}) => new Promise((res) => {
    let resposta = false;
    UI.modal({
      titulo, largura: 420,
      corpo: texto ? `<p class="suave" style="margin:0;line-height:1.55">${UI.esc(texto)}</p>` : '',
      // Enter confirma só o que não é destrutivo
      rodape: `<button class="btn btn-sec" data-nao>Cancelar</button><button class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" data-sim ${perigo ? '' : 'autofocus'}>${UI.esc(ok)}</button>`,
      aoMontar: (el, fechar) => {
        el.querySelector('[data-nao]').onclick = fechar;
        el.querySelector('[data-sim]').onclick = () => { resposta = true; fechar(); };
      },
      aoFechar: () => res(resposta)
    });
  });

  // UI.perguntar({ titulo, sub, rotulo, valor, multilinha, ok, tipo }) → Promise<string|null>
  UI.perguntar = ({ titulo = '', sub = '', rotulo = '', valor = '', multilinha = false, ok = 'Salvar', tipo = 'text', placeholder = '' } = {}) => new Promise((res) => {
    let resposta = null;
    const campo = multilinha
      ? `<textarea class="input" data-v rows="4" placeholder="${UI.esc(placeholder)}">${UI.esc(valor)}</textarea>`
      : `<input class="input" data-v type="${tipo}" value="${UI.esc(valor)}" placeholder="${UI.esc(placeholder)}">`;
    UI.modal({
      titulo, sub, largura: 460,
      corpo: `<div class="campo">${rotulo ? `<label>${UI.esc(rotulo)}</label>` : ''}${campo}</div>`,
      rodape: `<button class="btn btn-sec" data-nao>Cancelar</button><button class="btn btn-primario" data-sim>${UI.esc(ok)}</button>`,
      aoMontar: (el, fechar) => {
        const inp = el.querySelector('[data-v]');
        const enviar = () => { resposta = inp.value; fechar(); };
        el.querySelector('[data-nao]').onclick = fechar;
        el.querySelector('[data-sim]').onclick = enviar;
        if (!multilinha) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
      },
      aoFechar: () => res(resposta)
    });
  });

  // ---------- Menu flutuante (ancorado num elemento) ----------
  let menuAberto = null;
  UI.fecharMenu = () => { if (menuAberto) { menuAberto.remove(); menuAberto = null; } };
  // UI.menu(ancora, html, aoMontar(el, fechar))
  UI.menu = (ancora, html, aoMontar) => {
    UI.fecharMenu();
    const m = document.createElement('div');
    m.className = 'menu-flutuante';
    m.innerHTML = html;
    document.body.appendChild(m);
    const r = ancora.getBoundingClientRect();
    const larg = m.offsetWidth;
    m.style.top = (r.bottom + 8) + 'px';
    m.style.left = Math.max(12, Math.min(window.innerWidth - larg - 12, r.right - larg)) + 'px';
    menuAberto = m;
    if (aoMontar) aoMontar(m, UI.fecharMenu);
    setTimeout(() => document.addEventListener('mousedown', function fora(e) {
      if (menuAberto && !menuAberto.contains(e.target) && !ancora.contains(e.target)) { UI.fecharMenu(); document.removeEventListener('mousedown', fora); }
      if (!menuAberto) document.removeEventListener('mousedown', fora);
    }), 0);
    return UI.fecharMenu;
  };
})();
