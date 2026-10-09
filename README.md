# Comissões

Painel pra organizar clientes e pedidos de GFX (thumbs, ícones, banners).
Cada pessoa tem a **própria conta**: os dados ficam no computador e também guardados na conta.

## Instalar

1. Baixe o instalador mais novo em **https://github.com/kauanlacerda/comissoes/releases/latest**
   (o arquivo `Comissoes-<versão>-instalador.exe`).
2. Abra o arquivo. Se o Windows avisar "o Windows protegeu o computador", clique em
   **Mais informações → Executar assim mesmo** (o app não tem assinatura paga, por isso o aviso).
3. Ele instala só pro seu usuário, sem pedir administrador, e cria atalhos na área de trabalho e no menu Iniciar.

Desinstalar pelo Windows **não apaga** seus dados.

## Conta

Na primeira vez, o app pede pra **Entrar** ou **Criar conta** (e-mail e senha).
- Seus clientes e pedidos ficam guardados na sua conta. Em outro computador, é só entrar com o mesmo e-mail.
- Depois de entrar, o app funciona mesmo **sem internet**. O que mudar sobe sozinho quando a conexão voltar.
- Cada conta só enxerga os próprios dados.
- As **imagens** (fotos, thumbs e referências) ficam só no computador onde foram colocadas.

## Atualizações

O app procura versão nova sozinho (ao abrir e a cada 6 horas), baixa em segundo plano
e avisa **"Versão X pronta"**. Clique em **Reiniciar**, ou deixe que ela entre quando você fechar o app.
Em **Configurações → Atualizações** dá pra procurar na hora.

Pra rodar direto do código (desenvolvimento): `iniciar.bat` ou `npm start`.
Não deixe a versão instalada e a do código abertas ao mesmo tempo: elas usam os mesmos dados.

## Configurar o Discord (uma vez, 2 minutos)

O app puxa o **nome e a foto** do cliente pelo ID do Discord usando um bot seu.
O bot não precisa entrar em nenhum servidor e não lê mensagens de ninguém.

1. Abra https://discord.com/developers/applications e clique em **New Application**. Dê qualquer nome.
2. Vá na aba **Bot**, clique em **Reset Token** e copie o token.
3. No app: **Configurações → Discord**, cole o token, clique em **Salvar** e depois em **Testar**.

O token fica guardado criptografado pelo Windows e nunca mais aparece na tela.
Cada pessoa usa o próprio bot (o token não vai pra conta nem pra nuvem).

## Adicionar um cliente

1. No Discord: **Configurações → Avançado → Modo desenvolvedor** (liga uma vez só).
2. Botão direito no cliente → **Copiar ID do usuário**.
3. No app: **Novo cliente**, cole o ID e clique em **Buscar**. O nome e a foto vêm sozinhos.
4. Se quiser, coloque o usuário do Roblox (opcional) pra ter o avatar e o ID dele.

## Grupo de DM como cliente

Quando o pedido rola num grupo de DM, você pode cadastrar o grupo:

1. Em **Novo cliente**, escolha **Grupo de DM**.
2. No Discord, clique com o botão direito no grupo (na lista de conversas) e escolha **Copiar ID do canal**.
3. Cole o ID e escreva o nome do grupo.

O bot não consegue entrar em grupos, então o nome é você que define. O ID serve pra **Abrir no Discord** cair direto na conversa do grupo. O app também mostra a data em que o grupo foi criado.

## Pedidos

Cada pedido está **A fazer** ou **Feito**, e **Pago** ou **Não pago**. Só isso.
Você arrasta as thumbs nos espaços do pedido, clica em **Marcar como feito** quando terminar
e em **Marcar como pago** quando o cliente pagar. O **A receber** soma tudo que ainda não foi pago.

## "Falta responder"

O app não lê suas DMs (o Discord não permite isso de forma segura).
Por isso a marcação é manual: quando o cliente te chamar, marque **Nova msg**;
quando você responder, clique em **Respondi**. O app mostra há quanto tempo cada um está esperando.

## Visual

**Configurações → Aparência** troca entre:
- **Cube**: arredondado, cards soltos.
- **Quadrado**: painel único com divisórias, cantos retos.

Muda bordas, espaçamentos, fontes e a organização dos painéis, não só a cor.

## Onde ficam os dados

`%APPDATA%\Comissões\`:
- `comissoes-dados.json`: clientes, pedidos e configurações.
- `backups\`: uma cópia por dia, guarda as últimas 14.
- `midia\`: fotos de perfil baixadas do Discord e do Roblox.
- `pedidos\<id>\referencias` e `pedidos\<id>\entrega`: imagens de cada pedido.

Em **Configurações → Dados** dá pra abrir a pasta, exportar e importar um backup.

## Para o dono do app: nuvem (Supabase) e versões

- A nuvem é um projeto Supabase. O endereço e a chave pública ("anon") ficam em `nuvem.json`.
  Sem eles o app funciona só no computador, sem login.
- A tabela é criada uma vez, colando `docs/supabase-comissoes.sql` no **SQL Editor** do Supabase e clicando em **Run**.
- Publicar uma versão: aumentar `version` no `package.json`, commit, criar a tag `vX.Y.Z` e enviar pro GitHub.
  O GitHub Actions gera o instalador e publica em Releases; os apps instalados se atualizam sozinhos.

## Para desenvolver

- `npm start`: abre o app.
- `node tools/testar-app.js`: teste de integração do app real, com dados temporários.
- `node tools/testar-conta.js`: testa conta e sincronização contra uma nuvem falsa (sem internet).
- `node_modules\.bin\electron tools\capturar.js <pasta> ambos`: fotos de todas as telas nos dois visuais, com dados de exemplo.
- `node tools/servir.js 5180`, depois abrir `http://localhost:5180/renderer/index.html?semente=1`: interface no navegador, em modo simulado.
- `npm run build`: gera o instalador em `dist\`.
- `docs/CONTRATO.md`: como as telas são organizadas.
