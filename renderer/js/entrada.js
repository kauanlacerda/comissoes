// Tela de entrada (login / criar conta). Cobre o app até a pessoa entrar.
// A senha vai direto pro processo principal (App.api.conta); nada fica guardado na tela.
(function () {
  const esc = UI.esc, ic = UI.icone;
  const Entrada = window.Entrada = {};
  let el = null;
  let aba = 'entrar';
  let aviso = null; // { tipo: 'erro'|'ok', texto }

  function html() {
    const criar = aba === 'criar';
    return `<div class="entrada-caixa" role="dialog" aria-modal="true" aria-labelledby="entrada-tit">
      <div class="entrada-marca">${ic('logo', 34, 2.4).replace('class="ic"', 'class="ic logo"')}<h1 id="entrada-tit">Comissões</h1></div>
      <p class="entrada-sub">${criar ? 'Crie sua conta. Seus clientes e pedidos ficam guardados nela.' : 'Entre na sua conta pra ver seus clientes e pedidos.'}</p>
      <div class="seg" role="group" aria-label="Entrar ou criar conta">
        <button type="button" class="seg-op" data-aba="entrar" aria-pressed="${!criar}">Entrar</button>
        <button type="button" class="seg-op" data-aba="criar" aria-pressed="${criar}">Criar conta</button>
      </div>
      <form class="entrada-form" novalidate>
        ${criar ? `<div class="campo"><label for="en-nome">Seu nome</label><input class="input" id="en-nome" data-nome autocomplete="nickname" maxlength="40" placeholder="Como o app vai te chamar"></div>` : ''}
        <div class="campo"><label for="en-email">E-mail</label><input class="input" id="en-email" data-email type="email" autocomplete="email" spellcheck="false" placeholder="voce@email.com"></div>
        <div class="campo"><label for="en-senha">Senha</label><input class="input" id="en-senha" data-senha type="password" autocomplete="${criar ? 'new-password' : 'current-password'}" placeholder="${criar ? 'Pelo menos 6 caracteres' : 'Sua senha'}"></div>
        <div class="entrada-aviso ${aviso ? aviso.tipo : ''}" role="alert">${aviso ? `${ic(aviso.tipo === 'erro' ? 'alerta' : 'check', 15)}<span>${esc(aviso.texto)}</span>` : ''}</div>
        <button type="submit" class="btn btn-primario btn-bloco btn-centro" data-enviar>${criar ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <p class="entrada-nota">${ic('info', 14)}<span>Depois de entrar, o app funciona mesmo sem internet. O que mudar sobe sozinho pra sua conta quando a conexão voltar.</span></p>
    </div>`;
  }

  function montar() {
    el.innerHTML = html();
    el.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { aba = b.dataset.aba; aviso = null; montar(); });
    const form = el.querySelector('form');
    const btn = el.querySelector('[data-enviar]');
    const email = el.querySelector('[data-email]'), senha = el.querySelector('[data-senha]'), nome = el.querySelector('[data-nome]');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const em = email.value.trim(), se = senha.value;
      if (!/^\S+@\S+\.\S+$/.test(em)) { mostrarAviso('erro', 'Esse e-mail não parece válido.'); email.focus(); return; }
      if (se.length < 6) { mostrarAviso('erro', 'A senha precisa ter pelo menos 6 caracteres.'); senha.focus(); return; }
      btn.disabled = true; btn.textContent = aba === 'criar' ? 'Criando…' : 'Entrando…';
      let r;
      try { r = aba === 'criar' ? await App.api.conta.criar(em, se, nome ? nome.value.trim() : '') : await App.api.conta.entrar(em, se); }
      catch { r = { ok: false, erro: 'Não deu certo. Tente de novo.' }; }
      if (!el) return;
      if (!r || !r.ok) { btn.disabled = false; btn.textContent = aba === 'criar' ? 'Criar conta' : 'Entrar'; mostrarAviso('erro', (r && r.erro) || 'Não deu certo.'); return; }
      if (r.precisaConfirmar) {
        aba = 'entrar'; aviso = { tipo: 'ok', texto: `Conta criada! Enviamos um link pra ${em}. Abra o e-mail, confirme e depois entre aqui.` };
        montar(); el.querySelector('[data-email]').value = em; return;
      }
      App.conta = r.estado || App.conta;
      // nome escolhido no cadastro vira o nome da saudação (se ainda não tinha)
      if (nome && nome.value.trim() && !App.estado.config.nome) App.acoes.configurar({ nome: nome.value.trim() });
      Entrada.esconder();
      UI.toast(`Conta conectada: ${em}`, 'ok');
    };
    setTimeout(() => { const alvo = (nome && !nome.value) ? nome : (!email.value ? email : senha); alvo.focus(); }, 30);
  }

  function mostrarAviso(tipo, texto) {
    aviso = { tipo, texto };
    const a = el && el.querySelector('.entrada-aviso');
    if (a) { a.className = 'entrada-aviso ' + tipo; a.innerHTML = `${ic(tipo === 'erro' ? 'alerta' : 'check', 15)}<span>${esc(texto)}</span>`; }
  }

  Entrada.mostrar = (mensagem) => {
    if (!el) { el = document.createElement('div'); el.className = 'entrada'; document.body.appendChild(el); }
    aviso = mensagem ? { tipo: 'ok', texto: mensagem } : aviso;
    document.body.classList.add('sem-conta');
    montar();
  };
  Entrada.esconder = () => {
    if (el) { el.remove(); el = null; }
    aviso = null; aba = 'entrar';
    document.body.classList.remove('sem-conta');
    App.redesenhar();
  };
  Entrada.aberta = () => !!el;
})();
