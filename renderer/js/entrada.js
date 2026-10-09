// Tela de entrada (login / criar conta). Cobre o app até a pessoa entrar.
// A senha vai direto pro processo principal (App.api.conta); nada fica guardado na tela.
(function () {
  const esc = UI.esc, ic = UI.icone;
  const Entrada = window.Entrada = {};
  let el = null;
  let aba = 'entrar';
  let aviso = null;      // { tipo: 'erro'|'ok', texto }
  let adotar = null;     // { clientes, pedidos }: dados deste PC sem dono, esperando a pessoa dizer se são dela
  let podeLocal = false; // sem internet e sem conta ligada a este PC: dá pra seguir só local
  let nomeNovo = '';     // nome digitado no cadastro (vira o nome da saudação)

  const marca = () => `<div class="entrada-marca">${ic('logo', 34, 2.4).replace('class="ic"', 'class="ic logo"')}<h1 id="entrada-tit">Comissões</h1></div>`;
  const avisoHtml = () => `<div class="entrada-aviso ${aviso ? aviso.tipo : ''}" role="alert">${aviso ? `${ic(aviso.tipo === 'erro' ? 'alerta' : 'check', 15)}<span>${esc(aviso.texto)}</span>` : ''}</div>`;
  const botaoLocal = () => `<button type="button" class="btn btn-peq btn-bloco btn-centro" data-local>Continuar sem entrar (só neste PC)</button>`;
  const qtd = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function htmlAdotar() {
    return `<div class="entrada-caixa" role="dialog" aria-modal="true" aria-labelledby="entrada-tit">
      ${marca()}
      <p class="entrada-sub">Encontramos ${qtd(adotar.clientes, 'cliente', 'clientes')} e ${qtd(adotar.pedidos, 'pedido', 'pedidos')} neste computador. Guardar na sua conta?</p>
      ${avisoHtml()}
      <div class="entrada-form">
        <button type="button" class="btn btn-primario btn-bloco btn-centro" data-adotar="1">Guardar na minha conta</button>
        <button type="button" class="btn btn-sec btn-bloco btn-centro" data-adotar="0">Começar vazio</button>
      </div>
    </div>`;
  }

  function html() {
    if (adotar) return htmlAdotar();
    const criar = aba === 'criar';
    return `<div class="entrada-caixa" role="dialog" aria-modal="true" aria-labelledby="entrada-tit">
      ${marca()}
      <p class="entrada-sub">${criar ? 'Crie sua conta. Seus clientes e pedidos ficam guardados nela.' : 'Entre na sua conta pra ver seus clientes e pedidos.'}</p>
      <div class="seg" role="group" aria-label="Entrar ou criar conta">
        <button type="button" class="seg-op" data-aba="entrar" aria-pressed="${!criar}">Entrar</button>
        <button type="button" class="seg-op" data-aba="criar" aria-pressed="${criar}">Criar conta</button>
      </div>
      <form class="entrada-form" novalidate>
        ${criar ? `<div class="campo"><label for="en-nome">Seu nome</label><input class="input" id="en-nome" data-nome autocomplete="nickname" maxlength="40" placeholder="Como o app vai te chamar"></div>` : ''}
        <div class="campo"><label for="en-email">E-mail</label><input class="input" id="en-email" data-email type="email" autocomplete="email" spellcheck="false" placeholder="voce@email.com"></div>
        <div class="campo"><label for="en-senha">Senha</label><input class="input" id="en-senha" data-senha type="password" autocomplete="${criar ? 'new-password' : 'current-password'}" placeholder="${criar ? 'Pelo menos 6 caracteres' : 'Sua senha'}"></div>
        ${avisoHtml()}
        <button type="submit" class="btn btn-primario btn-bloco btn-centro" data-enviar>${criar ? 'Criar conta' : 'Entrar'}</button>
        ${podeLocal ? botaoLocal() : ''}
      </form>
      <p class="entrada-nota">${ic('info', 14)}<span>Depois de entrar, o app funciona mesmo sem internet. O que mudar sobe sozinho pra sua conta quando a conexão voltar.</span></p>
    </div>`;
  }

  // entrou (e respondeu sobre os dados do PC, se precisou): relê o que a conta trouxe e libera o app
  async function concluir(msg) {
    try { await App.recarregar(); } catch {}
    if (nomeNovo && !App.estado.config.nome) App.acoes.configurar({ nome: nomeNovo });
    Entrada.esconder();
    UI.toast(msg, 'ok');
  }

  function ligarLocal() {
    const b = el && el.querySelector('[data-local]');
    if (b) b.onclick = () => Entrada.esconder();
  }

  function montarAdotar() {
    const botoes = el.querySelectorAll('[data-adotar]');
    botoes.forEach(b => b.onclick = async () => {
      const sim = b.dataset.adotar === '1';
      botoes.forEach(x => { x.disabled = true; });
      let st = null;
      try { st = await App.api.conta.adotar(sim); } catch {}
      if (!el) return;
      if (!st) { botoes.forEach(x => { x.disabled = false; }); mostrarAviso('erro', 'Não deu certo. Tente de novo.'); return; }
      App.conta = st; adotar = null;
      await concluir(sim ? 'Conta conectada. Seus dados vão subir pra ela.' : 'Conta conectada. Os dados antigos ficaram numa cópia de segurança.');
    });
    setTimeout(() => { if (botoes[0]) botoes[0].focus(); }, 30);
  }

  function montar() {
    el.innerHTML = html();
    if (adotar) { montarAdotar(); return; }
    // trocar Entrar/Criar conta mantém o e-mail já digitado
    el.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { const em = el.querySelector('[data-email]').value; aba = b.dataset.aba; aviso = null; montar(); el.querySelector('[data-email]').value = em; });
    ligarLocal();
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
      if (!r || !r.ok) {
        btn.disabled = false; btn.textContent = aba === 'criar' ? 'Criar conta' : 'Entrar';
        mostrarAviso('erro', (r && r.erro) || 'Não deu certo.');
        // sem internet no primeiro uso: os dados deste PC não são de conta nenhuma ainda, dá pra seguir com eles
        if (r && r.semConexao && r.podeUsarLocal && !podeLocal) { podeLocal = true; btn.insertAdjacentHTML('afterend', botaoLocal()); ligarLocal(); }
        return;
      }
      if (r.precisaConfirmar) {
        aba = 'entrar'; aviso = { tipo: 'ok', texto: `Conta criada! Enviamos um link pra ${em}. Abra o e-mail, confirme e depois entre aqui.` };
        montar(); el.querySelector('[data-email]').value = em; return;
      }
      App.conta = r.estado || App.conta;
      nomeNovo = nome ? nome.value.trim() : '';
      // o PC já tinha dados sem dono: pergunta antes de juntar com a conta
      if (r.estado && r.estado.adotar) { adotar = r.estado.adotar; aviso = null; montar(); return; }
      await concluir(`Conta conectada: ${em}`);
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
    aviso = null; aba = 'entrar'; adotar = null; podeLocal = false; nomeNovo = '';
    document.body.classList.remove('sem-conta');
    App.redesenhar();
  };
  Entrada.aberta = () => !!el;

  // o app fechou com a pergunta dos dados sem dono em aberto: pergunta de novo.
  // e a sessão caiu logo ao abrir (revogada/vencida): mostra a entrada mesmo se o aviso chegou antes do shell ouvir
  const conferir = (st) => {
    if (!st || el) return;
    if (st.logado && st.adotar) { App.conta = st; adotar = st.adotar; Entrada.mostrar(); }
    else if (!st.logado && !st.semConta && App.conta && App.conta.logado) { App.conta = st; Entrada.mostrar('Você saiu da conta. Entre de novo quando quiser.'); }
  };
  if (App.api.conta.onEstado) App.api.conta.onEstado(conferir);
  window.addEventListener('DOMContentLoaded', () => { Promise.resolve(App.api.conta.estado()).then(conferir).catch(() => {}); });
})();
