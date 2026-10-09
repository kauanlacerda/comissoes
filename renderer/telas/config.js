// Configurações: aparência (cube / quadrado), você e o trabalho, Discord, gamepass e dados.
// Mesmo HTML nos dois modos; no cube cada seção é um card, no of vira painel com divisórias.
(function () {
  const esc = UI.esc, ic = UI.icone;

  let rascunhoToken = '';   // token digitado e ainda não salvo (sobrevive a um redesenho)
  let statusToken = null;   // último status lido do processo principal (nunca o token em si)

  const PORTAL = 'https://discord.com/developers/applications';
  const limitar = (v, min, max, padrao) => { const n = parseInt(v, 10); return isNaN(n) ? padrao : Math.max(min, Math.min(max, n)); };

  // Botão do mouse apertado? O "change" de um campo dispara no mousedown do próximo clique
  // (o blur). Se redesenharmos aí, o botão apertado é destruído antes do mouseup e o clique
  // se perde. Então: salva na hora, redesenha só depois que o clique terminar.
  let apertado = false, redesenhoPendente = false;
  document.addEventListener('pointerdown', () => { apertado = true; }, true);
  document.addEventListener('pointerup', () => { apertado = false; }, true);
  document.addEventListener('pointercancel', () => { apertado = false; }, true);

  // Salva já (sem redesenhar) e redesenha depois, devolvendo o foco ao campo onde a pessoa
  // estava (lateral e cabeçalho mostram nome e alertas de prazo).
  function salvarComRender(patch) {
    App.mudar(e => { Object.assign(e.config, patch); }, { render: false });
    if (redesenhoPendente) return;
    redesenhoPendente = true;
    const redesenhar = () => setTimeout(() => {
      redesenhoPendente = false;
      const a = document.activeElement;
      const chave = a && a.closest && a.closest('#area') ? a.getAttribute('data-foco') : null;
      let sel = null;
      try { if (a && typeof a.selectionStart === 'number') sel = [a.selectionStart, a.selectionEnd]; } catch {}
      App.redesenhar();
      if (!chave) return;
      const n = document.querySelector(`#area [data-foco="${chave}"]`);
      if (!n) return;
      n.focus({ preventScroll: true });
      if (sel) { try { n.setSelectionRange(sel[0], sel[1]); } catch {} }
    }, 0);
    if (!apertado) { redesenhar(); return; }
    // o setTimeout depois do pointerup roda depois do click, então o botão ainda recebe o clique
    let feito = false;
    const soltar = () => {
      if (feito) return; feito = true;
      window.removeEventListener('pointerup', soltar, true);
      window.removeEventListener('pointercancel', soltar, true);
      redesenhar();
    };
    window.addEventListener('pointerup', soltar, true);
    window.addEventListener('pointercancel', soltar, true);
  }

  // ---------- Seções ----------
  function secao(titulo, desc, corpo, extraCls = '') {
    return `<section class="bloco div-b cfg-sec ${extraCls}">
      <div class="cfg-cab"><h2 class="titulo-bloco">${esc(titulo)}</h2>${desc ? `<p class="cfg-desc">${desc}</p>` : ''}</div>
      <div class="cfg-corpo">${corpo}</div>
    </section>`;
  }

  function miniatura(tipo) {
    const lat = '<i class="mt-lat"><b></b><b></b><b></b></i>';
    return `<span class="miniatura ${tipo}" aria-hidden="true">${lat}${tipo === 'cube'
      ? '<span class="mt-main"><span class="mt-linha"><i></i><i></i><i></i><i></i></span><span class="mt-linha mt-cresce"><i class="mt-col"></i><i></i></span></span>'
      : '<i class="mt-main"><span class="mt-linha"><i></i><i></i><i></i><i></i></span><span class="mt-linha mt-cresce"><i class="mt-col"></i><i></i></span></i>'}</span>`;
  }

  function opcaoTema(id, nome, desc, atual) {
    return `<button class="opcao-tema" data-escolher-tema="${id}" data-foco="tema-${id}" aria-pressed="${atual === id ? 'true' : 'false'}">
      ${miniatura(id)}
      <span class="cfg-tema-txt">
        <span class="cfg-tema-nome cfg-fonte-${id}">${esc(nome)}${atual === id ? `<span class="cfg-tema-uso">${ic('check', 13, 2.6)}Em uso</span>` : ''}</span>
        <span class="cfg-tema-desc">${esc(desc)}</span>
      </span>
    </button>`;
  }

  function aparencia(cfg) {
    const atual = cfg.tema === 'of' ? 'of' : 'cube';
    return secao('Aparência',
      'Troca o jeito do app inteiro: bordas, espaçamentos, fontes e como os painéis se organizam. Não é só a cor.',
      `<div class="opcoes-tema">
        ${opcaoTema('cube', 'Cube', 'Arredondado, cards soltos, fonte Manrope', atual)}
        ${opcaoTema('of', 'Quadrado', 'Painel único com divisórias, fonte Inter', atual)}
      </div>`);
  }

  function trabalho(cfg) {
    return secao('Você e o trabalho', 'Usado na saudação e nos avisos de prazo.',
      `<div class="cfg-campos">
        <div class="campo">
          <label for="cfg-nome">Seu nome</label>
          <input class="input" id="cfg-nome" type="text" maxlength="40" autocomplete="off" data-campo="nome" data-foco="nome" value="${esc(cfg.nome)}" placeholder="Como o app deve te chamar">
        </div>
        <div class="linha-campos">
          <div class="campo">
            <label for="cfg-prazo">Avisar prazo com antecedência</label>
            <input class="input" id="cfg-prazo" type="number" min="0" max="14" step="1" data-campo="prazoAlertaDias" data-foco="prazo" value="${esc(cfg.prazoAlertaDias ?? 2)}">
            <div class="ajuda">Dias antes do prazo pra aparecer em "Vence em breve" (0 = só no próprio dia).</div>
          </div>
        </div>
        <div class="campo cfg-campo-curto">
          <label for="cfg-moeda">Moeda padrão</label>
          <select class="input" id="cfg-moeda" data-campo="moedaPadrao" data-foco="moeda">
            ${App.MOEDAS.map(m => `<option value="${esc(m)}" ${cfg.moedaPadrao === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
          <div class="ajuda">Vem marcada nos pedidos novos e é a principal no total "A receber".</div>
        </div>
      </div>`);
  }

  function statusHtml(s) {
    if (!s) return `<span class="ponto" style="--cor:var(--mudo)"></span><span class="mudo">Verificando o token…</span>`;
    if (s.configurado) {
      return `<span class="ponto" style="--cor:var(--verde)"></span><span class="cor-verde forte">Token configurado ✓</span>
        <span class="mudo">${s.criptografado ? '(criptografado pelo Windows)' : '(salvo sem criptografia: o Windows não ofereceu)'}</span>
        <button class="link cor-vermelho cfg-remover" data-remover-token>Remover</button>`;
    }
    return `<span class="ponto" style="--cor:var(--amarelo)"></span><span class="forte">Nenhum token salvo</span>
      <span class="mudo">Sem ele o app não puxa foto e nome pelo ID.</span>`;
  }

  function discord() {
    return secao('Discord', 'Com um bot seu, basta colar o ID da pessoa que o app puxa a foto e o nome dela.',
      `<div class="cfg-status" data-token-status>${statusHtml(statusToken)}</div>
      <div class="campo">
        <label for="cfg-token">Token do bot</label>
        <div class="cfg-token-linha">
          <input class="input" id="cfg-token" type="password" autocomplete="off" spellcheck="false" data-token data-foco="token" value="${esc(rascunhoToken)}" placeholder="${statusToken && statusToken.configurado ? 'Cole um token novo pra trocar' : 'Cole aqui o token do bot'}">
          <button class="btn btn-primario" data-salvar-token>Salvar</button>
          <button class="btn btn-sec" data-testar-token>Testar</button>
        </div>
        <div class="ajuda">Fica guardado só neste computador e nunca mais aparece aqui depois de salvo.</div>
      </div>
      <div class="cfg-guias">
        <div class="caixa cfg-guia">
          <div class="cfg-guia-tit">Como criar o bot <span class="mudo">(2 min, grátis)</span></div>
          <ol>
            <li>Abra o <a class="link cfg-link-texto" href="${PORTAL}" data-portal>Portal de Desenvolvedores do <span class="cfg-junto">Discord ${ic('externo', 13, 2.2)}</span></a>.</li>
            <li>Clique em <b>New Application</b> e dê um nome qualquer.</li>
            <li>Na aba <b>Bot</b>, clique em <b>Reset Token</b>, copie e cole aqui em cima.</li>
            <li>Não precisa convidar o bot pra nenhum servidor.</li>
          </ol>
        </div>
        <div class="caixa cfg-guia">
          <div class="cfg-guia-tit">Como copiar o ID de alguém</div>
          <ol>
            <li>No Discord, vá em <b>Configurações → Avançado</b> e ligue o <b>Modo desenvolvedor</b>.</li>
            <li>Depois, clique com o botão direito na pessoa → <b>Copiar ID do usuário</b>.</li>
            <li>Cole o ID em <b>Novo cliente</b>.</li>
          </ol>
        </div>
      </div>`);
  }

  function previaMsg(cfg) {
    const valor = App.fmtValor(1500, 'Robux');   // gamepass é sempre em Robux
    const link = (cfg.linkGamepass || '').trim() || '(link do gamepass)';
    return String(cfg.msgGamepass || '').split('{valor}').join(valor).split('{link}').join(link);
  }

  function gamepass(cfg) {
    return secao('Gamepass', 'Pra cobrar em Robux: o pedido gera essa mensagem pronta pra você colar na DM.',
      `<div class="cfg-campos">
        <div class="campo">
          <label for="cfg-link">Link do gamepass</label>
          <input class="input" id="cfg-link" type="url" autocomplete="off" spellcheck="false" data-texto="linkGamepass" data-foco="link" value="${esc(cfg.linkGamepass)}" placeholder="https://www.roblox.com/game-pass/...">
        </div>
        <div class="campo">
          <label for="cfg-msg">Mensagem modelo</label>
          <textarea class="input" id="cfg-msg" rows="3" data-texto="msgGamepass" data-foco="msg">${esc(cfg.msgGamepass)}</textarea>
          <div class="ajuda"><code class="cfg-cod">{valor}</code> vira o valor do pedido e <code class="cfg-cod">{link}</code> vira o link acima.</div>
        </div>
        <div class="caixa cfg-previa"><div class="sobrelinha">Prévia</div><div class="cfg-previa-txt" data-previa>${esc(previaMsg(cfg))}</div></div>
      </div>`);
  }

  // ---------- Conta ----------
  const STATUS_SYNC = {
    ok: ['var(--verde)', (s) => s.ultimo ? 'Sincronizado ' + App.fmtHa(s.ultimo) : 'Sincronizado'],
    enviando: ['var(--azul-texto)', () => 'Enviando pra sua conta…'],
    offline: ['var(--amarelo)', () => 'Sem internet. As mudanças ficam guardadas aqui e sobem quando a conexão voltar.'],
    'sem-tabela': ['var(--vermelho)', () => 'A nuvem ainda não foi preparada (falta rodar o script no Supabase). Tudo continua salvo neste PC.'],
    erro: ['var(--vermelho)', () => 'Não deu pra sincronizar agora. O app tenta de novo sozinho em 1 minuto.'],
    desconectado: ['var(--mudo)', () => 'Desconectado'],
    'sem-nuvem': ['var(--mudo)', () => 'Esta versão ainda não tem a nuvem configurada. Tudo fica salvo neste PC.']
  };
  function conta() {
    const c = App.conta || {}, s = c.sync || {};
    const [cor, texto] = STATUS_SYNC[s.status] || STATUS_SYNC.desconectado;
    if (c.semConta) return secao('Conta', '', `<div class="cfg-sync">${UI.ponto(STATUS_SYNC[s.status] ? STATUS_SYNC[s.status][0] : 'var(--mudo)')}<span>${esc((STATUS_SYNC[s.status] || STATUS_SYNC['sem-nuvem'])[1](s))}</span></div>`);
    const quem = c.nome || c.email || 'Sua conta';
    return secao('Conta', 'Seus clientes e pedidos ficam guardados na sua conta. Pra usar em outro computador, é só entrar com o mesmo e-mail.',
      `<div class="cfg-conta">
        ${UI.avatar({ tam: 40, nome: quem })}
        <div class="cfg-conta-txt"><div class="forte truncar">${esc(quem)}</div>${c.nome && c.email ? `<div class="pequeno mudo truncar">${esc(c.email)}</div>` : ''}</div>
      </div>
      <div class="cfg-sync"${s.erro ? ` title="${esc(s.erro)}"` : ''}>${UI.ponto(cor)}<span>${esc(texto(s))}${s.pendente && s.status !== 'enviando' ? ' · há mudanças esperando envio' : ''}</span></div>
      <div class="cfg-botoes">
        <button class="btn btn-sec" data-sincronizar>${ic('atualizar', 16)}<span data-rot>Sincronizar agora</span></button>
        <button class="btn btn-sec" data-sair-conta>${ic('sair', 16)}Sair da conta</button>
      </div>`);
  }

  function dados() {
    return secao('Dados', '',
      `<p class="cfg-texto">Clientes, pedidos e configurações ficam neste computador e na sua conta. As <b>imagens</b> (fotos, thumbs e referências) ficam só neste computador. O app também guarda sozinho uma cópia de segurança por dia (as últimas 14).</p>
      <div class="cfg-botoes">
        <button class="btn btn-sec" data-abrir-pasta>${ic('pasta', 16)}Abrir pasta dos dados</button>
        <button class="btn btn-sec" data-exportar>${ic('upload', 16)}Exportar backup</button>
        <button class="btn btn-sec" data-importar>${ic('caixa', 16)}Importar backup</button>
      </div>`);
  }

  // ---------- Atualizações ----------
  function atualizacoes() {
    const a = App.atualizacao || {};
    const linhas = {
      dev: 'Rodando direto do código: a atualização automática só funciona no app instalado.',
      parado: 'Procura versão nova sozinho ao abrir e a cada 6 horas.',
      procurando: 'Procurando versão nova…',
      baixando: `Baixando a versão ${a.versao || ''}… ${a.pct || 0}%`,
      pronto: `Versão ${a.versao || ''} pronta pra instalar.`,
      atualizado: 'Você está na versão mais nova.',
      erro: 'Não deu pra procurar agora. O app tenta de novo sozinho mais tarde.'
    };
    const ocupado = ['dev', 'procurando', 'baixando'].includes(a.fase);
    return secao('Atualizações', '',
      `<p class="cfg-texto">${a.versaoAtual ? `<b>Versão ${esc(a.versaoAtual)}</b> · ` : ''}${esc(linhas[a.fase] || '')}</p>
      <div class="cfg-botoes">${a.fase === 'pronto'
        ? `<button class="btn btn-primario" data-instalar-update>${ic('atualizar', 16)}Reiniciar e atualizar</button>`
        : `<button class="btn btn-sec" data-checar-update${ocupado ? ' disabled' : ''}>${ic('atualizar', 16)}Procurar agora</button>`}</div>`, 'cfg-ultima');
  }

  // ---------- Discord: status e ações ----------
  async function atualizarStatus() {
    try { statusToken = await App.api.discord.tokenStatus(); } catch { statusToken = { configurado: false, criptografado: false }; }
    const el = document.querySelector('#area [data-token-status]');
    if (!el) return;
    el.innerHTML = statusHtml(statusToken);
    ligarRemover(el);
    const inp = document.querySelector('#area [data-token]');
    if (inp) inp.placeholder = statusToken.configurado ? 'Cole um token novo pra trocar' : 'Cole aqui o token do bot';
  }

  function ligarRemover(el) {
    const b = el.querySelector('[data-remover-token]');
    if (!b) return;
    b.addEventListener('click', async () => {
      const ok = await UI.confirmar({ titulo: 'Remover o token?', texto: 'Sem o token, o app não consegue mais puxar foto e nome pelo ID do Discord. Os clientes que você já tem continuam aqui.', ok: 'Remover token', perigo: true });
      if (!ok) return;
      try { await App.api.discord.salvarToken(''); UI.toast('Token removido.', 'ok'); } catch { UI.toast('Não deu pra remover o token.', 'erro'); }
      atualizarStatus();
    });
  }

  async function testar(btn, rotulo, prefixo = '') {
    btn.disabled = true; btn.textContent = rotulo;
    try {
      const r = await App.api.discord.testarToken();
      if (r && r.ok) UI.toast(`${prefixo}Conectado como ${r.bot}`, 'ok');
      else UI.toast(`${prefixo}${(r && r.erro) || 'Não deu pra conectar ao Discord.'}`, 'erro');
    } catch { UI.toast('Não deu pra testar agora.', 'erro'); }
    btn.disabled = false; btn.textContent = btn.hasAttribute('data-salvar-token') ? 'Salvar' : 'Testar';
  }

  async function salvarToken(area, depoisTestar) {
    const inp = area.querySelector('[data-token]');
    const t = (inp ? inp.value : '').trim();
    if (!t) return false;
    try {
      const r = await App.api.discord.salvarToken(t);
      if (r && r.ok === false) { UI.toast('Não deu pra salvar o token.', 'erro'); return false; }
    } catch { UI.toast('Não deu pra salvar o token.', 'erro'); return false; }
    rascunhoToken = '';
    if (inp) inp.value = '';
    if (!depoisTestar) UI.toast('Token salvo.', 'ok');
    atualizarStatus();
    return true;
  }

  // ---------- Tela ----------
  App.telas.config = {
    cheia: false,
    cabecalho() { return { titulo: 'Configurações', sub: App.conta.logado && !App.conta.semConta ? 'Salvo neste computador e na sua conta' : 'Salvo neste computador', botao: null }; },
    render() {
      const cfg = App.estado.config;
      return `<div class="cfg">${aparencia(cfg)}${conta()}${trabalho(cfg)}${discord()}${gamepass(cfg)}${dados()}${atualizacoes()}</div>`;
    },
    montar(area) {
      // Aparência
      area.querySelectorAll('[data-escolher-tema]').forEach(b => b.addEventListener('click', () => {
        const t = b.dataset.escolherTema;
        if (App.estado.config.tema !== t) App.definirTema(t);
      }));

      // Você e o trabalho
      const nome = area.querySelector('[data-campo="nome"]');
      nome.addEventListener('input', () => App.mudar(e => { e.config.nome = nome.value; }, { render: false }));
      nome.addEventListener('change', () => salvarComRender({ nome: nome.value.trim() }));

      const numeros = [['prazoAlertaDias', 0, 14, 2]];
      for (const [campo, min, max, padrao] of numeros) {
        const inp = area.querySelector(`[data-campo="${campo}"]`);
        inp.addEventListener('input', () => {
          const n = parseInt(inp.value, 10);
          if (!isNaN(n) && n >= min && n <= max) App.mudar(e => { e.config[campo] = n; }, { render: false });
        });
        inp.addEventListener('change', () => {
          const n = limitar(inp.value, min, max, App.estado.config[campo] != null ? App.estado.config[campo] : padrao);
          inp.value = n;
          salvarComRender({ [campo]: n });
        });
      }

      const moeda = area.querySelector('[data-campo="moedaPadrao"]');
      moeda.addEventListener('change', () => salvarComRender({ moedaPadrao: moeda.value }));

      // Discord
      const token = area.querySelector('[data-token]');
      token.addEventListener('input', () => { rascunhoToken = token.value; });
      token.addEventListener('keydown', (e) => { if (e.key === 'Enter') area.querySelector('[data-salvar-token]').click(); });
      area.querySelector('[data-salvar-token]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!token.value.trim()) { UI.toast('Cole o token do bot no campo primeiro.', 'erro'); token.focus(); return; }
        btn.disabled = true;
        const ok = await salvarToken(area, true);
        btn.disabled = false;
        if (ok) await testar(btn, 'Conferindo…', 'Token salvo. ');
      });
      area.querySelector('[data-testar-token]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        // se tem um token novo digitado, salva antes de testar (testar usa o token salvo)
        if (token.value.trim() && !(await salvarToken(area, true))) return;
        testar(btn, 'Testando…');
      });
      const portal = area.querySelector('[data-portal]');
      portal.addEventListener('click', (e) => { e.preventDefault(); App.api.sistema.abrirExterno(PORTAL); });
      portal.addEventListener('auxclick', (e) => e.preventDefault());
      ligarRemover(area.querySelector('[data-token-status]'));
      atualizarStatus();

      // Gamepass (salva enquanto digita, sem redesenhar)
      const previa = area.querySelector('[data-previa]');
      area.querySelectorAll('[data-texto]').forEach(inp => {
        const campo = inp.dataset.texto;
        inp.addEventListener('input', () => {
          App.mudar(e => { e.config[campo] = inp.value; }, { render: false });
          if (previa) previa.textContent = previaMsg(App.estado.config);
        });
        inp.addEventListener('change', () => {
          const v = inp.value.trim();
          if (v !== inp.value) { inp.value = v; App.mudar(e => { e.config[campo] = v; }, { render: false }); if (previa) previa.textContent = previaMsg(App.estado.config); }
        });
      });

      // Conta
      const sinc = area.querySelector('[data-sincronizar]');
      if (sinc) sinc.addEventListener('click', async () => {
        sinc.disabled = true; sinc.querySelector('[data-rot]').textContent = 'Sincronizando…';
        try {
          App.conta = await App.api.conta.sincronizar();
          const st = (App.conta.sync || {}).status;
          if (st === 'ok') UI.toast('Tudo sincronizado.', 'ok');
          else if (st === 'offline') UI.toast('Sem internet agora. As mudanças continuam guardadas aqui.', 'erro');
          else if (st === 'sem-tabela') UI.toast('A nuvem ainda não foi preparada no Supabase.', 'erro');
          else if (st === 'erro') UI.toast('Não deu pra sincronizar agora.', 'erro');
        } catch { UI.toast('Não deu pra sincronizar agora.', 'erro'); }
        App.redesenhar();
      });
      const sairConta = area.querySelector('[data-sair-conta]');
      if (sairConta) sairConta.addEventListener('click', async () => {
        const ok = await UI.confirmar({ titulo: 'Sair da conta?', texto: 'Seus dados continuam guardados na conta. Pra voltar, é só entrar de novo com o mesmo e-mail.', ok: 'Sair da conta' });
        if (!ok) return;
        let r = null;
        try { r = await App.api.conta.sair(); } catch {}
        App.conta = { ...App.conta, logado: false };
        Entrada.mostrar(r && r.ficouPendente ? 'Você saiu. Algumas mudanças não subiram (sem internet); elas continuam neste PC e sobem quando você entrar de novo.' : 'Você saiu da conta.');
      });

      // Atualizações
      const checar = area.querySelector('[data-checar-update]');
      if (checar) checar.addEventListener('click', async () => {
        checar.disabled = true;
        try { App.atualizacao = await App.api.atualizacao.checar(); } catch {}
        const f = App.atualizacao.fase;
        if (f === 'atualizado') UI.toast('Você já está na versão mais nova.', 'ok');
        else if (f === 'erro') UI.toast('Não deu pra procurar agora.', 'erro');
        App.avisoUpdate && App.avisoUpdate();
        App.redesenhar();
      });
      const instalar = area.querySelector('[data-instalar-update]');
      if (instalar) instalar.addEventListener('click', async () => {
        instalar.disabled = true;
        const ok = await App.api.atualizacao.instalar();
        if (!ok) { instalar.disabled = false; UI.toast('Não deu pra reiniciar agora. A versão nova entra quando você fechar o app.', 'erro'); }
      });

      // Dados
      area.querySelector('[data-abrir-pasta]').addEventListener('click', () => {
        Promise.resolve(App.api.dados.abrirPasta()).catch(() => UI.toast('Não deu pra abrir a pasta.', 'erro'));
      });
      area.querySelector('[data-exportar]').addEventListener('click', async () => {
        try {
          const r = await App.api.dados.exportar();
          if (r && r.ok) UI.toast(`Backup salvo em ${r.caminho}`, 'ok');
          else if (r && r.erro) UI.toast(r.erro, 'erro');
        } catch { UI.toast('Não deu pra exportar o backup.', 'erro'); }
      });
      area.querySelector('[data-importar]').addEventListener('click', async () => {
        const ok = await UI.confirmar({
          titulo: 'Importar um backup?',
          texto: 'Tudo que está no app agora (clientes, pedidos e configurações) será trocado pelo conteúdo do arquivo. Se quiser guardar o estado atual, exporte um backup antes.',
          ok: 'Escolher arquivo e substituir', perigo: true
        });
        if (!ok) return;
        try {
          const r = await App.api.dados.importar();
          if (r && r.ok) { App.substituirEstado(r.dados); UI.toast('Backup importado.', 'ok'); }
          else if (r && r.erro) UI.toast(r.erro, 'erro');
        } catch { UI.toast('Não deu pra importar o backup.', 'erro'); }
      });
    }
  };
})();
