# Contrato das telas — Comissões

App Electron pessoal para um freelancer de GFX Roblox organizar **clientes** (que chegam por DM do Discord) e **pedidos** (thumbs, ícones, banners). Tudo local, sem servidor. Interface em **português do Brasil**.

## Dois modos visuais (obrigatório funcionar nos dois)

`<html data-tema="cube">` = arredondado, blocos/cards soltos com espaço entre eles, Manrope, rótulos em CAIXA ALTA.
`<html data-tema="of">` = quadrado, a `.area` vira UM painel e os blocos viram painéis colados separados por linhas finas, Inter, rótulos em caixa normal.

A troca é **só por CSS** (`renderer/css/base.css`). As telas geram o MESMO HTML nos dois modos. Por isso:
- Use as classes da base (abaixo). No CSS da sua tela use **só tokens** `var(--...)`, nunca cor fixa. Se precisar diferenciar, escreva `html[data-tema="of"] .sua-classe { ... }`.
- Divisórias do modo `of` vêm das classes `div-b`, `div-t`, `div-r`, `div-l` (no `cube` elas não fazem nada). Ponha-as onde, no modo `of`, deve haver uma linha entre painéis.

### Referências visuais (Figma, aprovadas pelo usuário — LEIA com a ferramenta Read)
Pasta: `C:\Users\klsak\.claude\projects\C--Users-klsak-OneDrive-Documentos-celular\08da427e-0b76-4007-bb4d-ee8fc0a490a3\tool-results\`
| Tela | Modo cube | Modo of |
|---|---|---|
| Dashboard | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791550971023-rt7no6.png` | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791552198278-i8oda5.png` |
| Pedido | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791550971023-wjcdbx.png` | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791552198278-3mdh85.png` |
| Ficha do cliente | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791550971023-736g0k.png` | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791552198278-mag8h6.png` |
| Modal Novo cliente | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791549967269-wyyzc5.png` | `mcp-58452f93-ef5a-45e5-956e-fec67269fc8a-blob-1791552198278-ew186m.png` |
(algumas estão em 60% de escala; a janela real é 1400×860). A barra lateral e o cabeçalho já existem (`js/shell.js`) — você faz só o conteúdo da `.area`.

## Arquivos
```
main.js / preload.js / store.js     processo principal (NÃO mexa)
renderer/index.html                 carrega tudo (NÃO mexa)
renderer/css/base.css               tokens + componentes dos 2 modos (NÃO mexa)
renderer/js/ui.js                   UI.* (NÃO mexa)
renderer/js/nucleo.js               App.* estado/regras (NÃO mexa)
renderer/js/shell.js                lateral, cabeçalho, busca, sino (NÃO mexa)
renderer/telas/<sua-tela>.js/.css   SEU trabalho (só os seus arquivos)
```
Se precisar de algo que não existe na base, implemente localmente no seu arquivo (função privada dentro do seu IIFE). Não edite arquivos de outros.

## Como registrar uma tela
```js
(function () {
  const esc = UI.esc, ic = UI.icone;
  App.telas.minhaTela = {
    cheia: false,              // true = a .area não rola; sua tela gerencia a rolagem interna (painéis)
    cabecalho() {               // título no topo; botao:null esconde o botão; sem botao = "Novo cliente"
      return { titulo: 'Pedidos', sub: '5 ativos', botao: { rotulo: 'Novo pedido', icone: 'mais', acao: () => App.modais.novoPedido() }, pilha: false };
    },
    render() { return `...html...`; },   // string; chamado a cada mudança de estado
    montar(area) { /* liga eventos com addEventListener / onclick */ }
  };
})();
```
- `render()` roda de novo a cada `App.mudar` (redesenha a tela toda). Elementos roláveis que devem manter a rolagem: `data-rolagem="nome-unico"`.
- Enquanto a pessoa DIGITA (notas, campos), salve com `{ render: false }` (ex.: `App.acoes.atualizarCliente(id, { notas }, { render: false })`) senão o campo perde o foco.
- **Segurança:** todo dado vindo de cliente/Discord/usuário passa por `esc()` antes de entrar no HTML. Nada de handler inline (`onclick="..."`) — a CSP bloqueia; use `montar()`.
- Rota atual: `App.rota = { tela, id, ...extra }`. Navegar: `App.ir('pedidos', pedidoId)`, `App.ir('clientes', clienteId)`, `App.ir('pedidos', null, { grupo: 'producao' })`, `App.ir('config')`.

## Dados (`App.estado`)
```js
config:  { tema:'cube'|'of', nome, vagas:3, ocupado:false, prazoAlertaDias:2, moedaPadrao:'Robux', linkGamepass:'', msgGamepass:'... {valor} ... {link}', lateralRecolhida }
clientes: [{ id, criadoEm, nome /*apelido mostrado*/, tipo:'pessoa'|'grupo', canalId /*grupo de DM: ID do canal*/, discordId /*só pessoa*/, username, globalName, avatar /*url local ou ''*/, corPerfil /*'#hex' ou ''*/,
             contaCriada /*ISO*/, atualizadoEm, roblox: null | { id, username, displayName, avatar }, conversa: { estado:'falta'|'respondido', desde:ISO },
             notas, pagaVia }]
pedidos:  [{ id, criadoEm, clienteId, titulo, jogo, qtd /*nº de entregas, 1–12*/, etapa:'aceito'|'comecado'|'entregue'|'aprovado'|'pago',
             valor, moeda:'Robux'|'R$'|'US$', recebido, prazo:'AAAA-MM-DD'|'' , rodada /*começa em 1*/, ajustes:[{em, rodada, texto}],
             entregas: [ {caminho,url} | null ] /*tamanho qtd*/, notas, etapaEm:{etapa:ISO}, concluidoEm }]
```
Pagamento é paralelo à etapa (`recebido` vs `valor`). "Aprovado" + tudo pago vira "Pago" sozinho.

## API do núcleo (`App`)
Seletores: `App.cliente(id)`, `App.pedido(id)`, `App.pedidosDoCliente(id)`, `App.pedidosAtivos()`, `App.ativo(p)`, `App.ETAPAS` [{id, rotulo}], `App.GRUPOS` [{id:'aceitos'|'producao'|'entregues'|'aguardando'|'concluidos', rotulo, cor, etapa}], `App.grupoDe(p)`, `App.indiceEtapa(etapa)`, `App.rotuloEtapa(etapa)`, `App.pagamento(p)` → `{chave:'sem'|'nao'|'metade'|'parcial'|'pago', rotulo, tipo /*classe da pill*/}`, `App.falta(p)` (quanto falta receber), `App.faltaResponder()` (clientes esperando, mais antigo primeiro), `App.respondidos()`, `App.vagas()` → `{usadas,total}`, `App.aReceber()` → `{porMoeda:{Robux:n,'R$':n}, pedidos:n}`, `App.venceEmBreve()`, `App.atrasados()`, `App.proximasEntregas()`, `App.entreguesNoPedido(p)`, `App.resumoCliente(id)` → `{total, ativos, concluidos, ajustesMedia|null, aReceber:{moeda:n}}`, `App.alertas()`.

Ações (únicas que mudam dados; todas salvam sozinhas): `App.acoes.novoCliente(d)`→id, `atualizarCliente(id, patch, opts)`, `removerCliente(id)`, `marcarConversa(id,'falta'|'respondido')`, `novoPedido(d)`→id (`d = {clienteId,titulo,jogo,qtd,valor,moeda,recebido,prazo,etapa}`), `atualizarPedido(id, patch, opts)`, `mudarEtapa(id, etapa)`, `registrarPagamento(id, quantia)`, `pedirAjuste(id, texto)`, `definirEntrega(id, indice, {caminho,url}|null)`, `removerPedido(id)`, `configurar(patch)`. `App.definirTema('cube'|'of')`.

Utilidades: `App.hoje()`, `App.diasAte(ymd)`, `App.fmtDia(ymd)` 'dom, 11', `App.fmtDiaLongo(ymd)` 'domingo, 11', `App.fmtDataLonga(date)` '9 de outubro de 2026', `App.fmtDataCurta(iso)` '24 fev 2017', `App.fmtMesAno(iso)` 'ago 2026', `App.fmtPrazoRel(ymd)` 'em 2 dias'/'hoje'/'atrasado 1 dia', `App.fmtHa(iso)` 'há 3 h', `App.anos(iso)` '9 anos', `App.fmtValor(n, moeda)` '4.800 Robux'/'R$ 90', `App.fmtNum(n)`, `App.saudacao()`, `App.MES_LONGO` ['janeiro',...], `App.SEM` ['dom',...].
Alto nível: `App.ehGrupo(c)`, `App.temDiscord(c)`, `App.abrirDiscord(cliente)` (grupo abre a conversa pelo canal), `App.copiar(texto, aviso)`, `App.atualizarDadosCliente(id)` (puxa Discord/Roblox de novo), `App.abrirBusca()`.
Modais compartilhados ficam em `App.modais` (cada um definido pela tela dona): `novoCliente()` (clientes.js), `novoPedido(clienteId?)`, `editarPedido(id)`, `registrarPagamento(id)` (pedidos.js). Sempre cheque se existe antes de chamar.

## API do processo principal (`App.api`) — tudo assíncrono
`App.api.discord.usuario(id)` → `{ok, dados:{id, username, globalName, avatar /*url local*/, corPerfil, contaCriada}, codigo?, erro?}` (codigo: 'id-invalido'|'sem-token'|'token-invalido'|'nao-encontrado'|'limite'|'rede'|'http').
`App.api.discord.tokenStatus()` → `{configurado, criptografado}`; `salvarToken(t)`; `testarToken()` → `{ok, bot|erro}`.
`App.api.roblox.usuario(nomeDeUsuario)` → `{ok, dados:{id, username, displayName, avatar}, erro?}`.
`App.api.arquivos.escolherImagens(multiplas)` → `[caminhos]`; `importar({pedidoId, tipo:'referencias'|'entrega', caminho, slot})` → `{ok, caminho, url, nome}|{ok:false, erro}`; `listar(pedidoId, tipo)` → `[{nome, caminho, url}]`; `abrirPasta(pedidoId, tipo)`; `remover(caminho)`; `caminhoDe(fileDoDragDrop)` → caminho no disco.
`App.api.sistema.abrirExterno(urlHttps)`, `abrirDiscord(discordId)`, `abrirCanal(canalId)`, `copiar(texto)`. `App.api.dados.abrirPasta()`, `exportar()`, `importar()` → `{ok, dados}` (após importar chame `App.substituirEstado(r.dados)`).
No navegador (teste) essas chamadas são simuladas: Discord devolve um cliente falso, arquivos avisam "só no app".

## UI (`UI`)
`UI.esc(s)`, `UI.icone(nome, tam=18, traco=2)` — nomes: dashboard pedidos clientes config recolher busca sino sair chevE chevD chevC chevB chevrons mais check relogio externo copiar atualizar upload enviar joinha dinheiro moeda pasta imagem x info lixo lapis calendario msg usuarioMais caixa logo alerta responder discord pincel paleta.
`UI.avatar({tam, img, nome, classe, quadrado})` (classe `anel-falta`/`anel-ok` = anel colorido só no cube), `UI.ponto(corCss)`, `UI.pill(texto, tipo /*neutra|azul|verde|amarelo|vermelho*/)`, `UI.vazio({icone, titulo, texto, acao /*html*/})`, `UI.toast(msg, ''|'ok'|'erro')`, `UI.modal({titulo, sub, corpo, rodape, largura, aoMontar(el, fechar), aoFechar})` → fechar, `UI.confirmar({titulo, texto, ok, perigo})` → Promise<bool>, `UI.perguntar({titulo, sub, rotulo, valor, multilinha, ok, tipo, placeholder})` → Promise<string|null>, `UI.menu(ancoraEl, html, aoMontar(el, fechar))`, `UI.corDe(texto)`, `UI.iniciais(nome)`.

## Classes da base (catálogo)
Layout: `.bloco` (+`.sem-pad` `.rolar`), `.div-b/.div-t/.div-r/.div-l`, `.linha-grade` (flex com gap), `.coluna`, `.cresce`, `.paineis` (painéis lado a lado, filhos `.bloco` em coluna), `.bloco-cab` (título+contagem+link), `.titulo-bloco`, `.contagem`, `.link`, `.sobrelinha` (rótulo pequeno; MAIÚSCULO no cube), `.mudo .suave .apagado .pequeno .forte .truncar`, `.cor-vermelho .cor-verde .cor-azul .cor-amarelo`.
Resumo: `.stats > .stat(.destaque) > .stat-texto > (.stat-rotulo [.ponto] | .stat-valor | .stat-legenda)` + `.stat-tile` (style `--cor:...`, só aparece no of) — escreva o rótulo ANTES do valor no HTML; o of reordena sozinho.
Listas: `.lista > .linha(.clicavel)` (card no cube, linha fina no of), `.barra-status` (style `--cor`, só cube), `.ponto-status` (só of), `.tabela` + `.tabela-cab` + `.tabela .linha` com `style="--colunas: 1.4fr 190px 110px 130px"`. Itens selecionáveis: `.item(.ativo) > .t1/.t2`, rótulo de grupo `.grupo-rot.sobrelinha`.
Avatares/pills: `.avatar`, `.ponto`, `.pill.(neutra|azul|verde|amarelo|vermelho)`, `.chip` (selo azul na capa).
Etapas: `.etapas-mini > span(.feito|.atual)` ×5; `.etapas > button.etapa(.feito|.atual) > .barra + .nome`.
Botões: `.btn` + `.btn-primario` (ação principal, 1 por painel) | `.btn-acento` (secundária destacada: no of vira contorno azul) | `.btn-sec` (neutra) | `.btn-perigo` | `.btn-texto` (link de ação: RESPONDI) ; modificadores `.btn-icone .btn-peq .btn-bloco .btn-centro`; dica à direita `<span class="dica">`. `.btn-circ` (setas do calendário). Desabilitado: atributo `disabled`.
Campos: `.campo > label + .input` (`input/select/textarea.input`), `.campo .ajuda`, `.linha-campos` (lado a lado), `.marcador` (checkbox com texto), `button.chave[aria-pressed]` (interruptor).
Caixas: `.caixa` (interna: fundo no cube, contorno no of), `.caixa-alerta`, `.fatos[style=--n:3] > .fato > .fato-rotulo + .fato-valor` (rótulo antes; of reordena), `.capa[style=--cor-capa:#hex] > h2...` (capa com arte no cube; plana no of), `.perfil-topo[style=--cor-capa] > .capa-mini + .avatar`.
Imagens: `.slots > .slot(.cheio|.arrastando) > img | .num + texto`, botão `.remover` dentro do slot.
Calendário: `.cal-cab`, `.cal-grade > .cal-semana ×7 + .cal-dia(.hoje|.fora) > span + .marca-prazo(.atrasado)`.
Vazio: `UI.vazio(...)`. Config: `.opcoes-tema > button.opcao-tema[aria-pressed] > .miniatura.(cube|of) > i...`.

## Verificar seu trabalho (OBRIGATÓRIO antes de terminar)
1. `node --check renderer/telas/<arquivo>.js`
2. Capturar nos DOIS modos com dados de exemplo (abre o app real do Electron, simulado):
   `cd C:\dev\comissoes && node_modules\.bin\electron tools\capturar.js <pastaSaida> ambos <telas>`
   telas possíveis: `dashboard,pedidos,pedido,clientes,ficha,config,novo-cliente,novo-pedido,busca`. Erros de console aparecem no fim da saída — devem ser zero.
   Use uma pasta de saída SÓ SUA (ex.: `...\scratchpad\cap-<sua-tela>`).
3. Abra os PNGs com Read e compare com as referências do Figma acima nos dois modos. Corrija até ficar fiel e sem nada cortado/sobreposto.
4. Teste também o estado VAZIO (sem nenhum cliente/pedido): acrescente `-vazio` ao nome da tela na captura, ex.: `dashboard-vazio,pedidos-vazio,clientes-vazio`. Tem que aparecer um `UI.vazio` útil, com o botão da próxima ação.
