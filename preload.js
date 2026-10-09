const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  dados: {
    ler: () => ipcRenderer.invoke('dados:ler'),
    salvar: (estado) => ipcRenderer.invoke('dados:salvar', estado),
    abrirPasta: () => ipcRenderer.invoke('dados:abrirPasta'),
    exportar: () => ipcRenderer.invoke('dados:exportar'),
    importar: () => ipcRenderer.invoke('dados:importar'),
    // a nuvem trouxe dados novos (outro PC, outra conta): a tela recarrega
    onRecarregar: (cb) => ipcRenderer.on('dados:recarregar', () => cb())
  },
  conta: {
    estado: () => ipcRenderer.invoke('conta:estado'),
    entrar: (email, senha) => ipcRenderer.invoke('conta:entrar', email, senha),
    criar: (email, senha, nome) => ipcRenderer.invoke('conta:criar', email, senha, nome),
    sair: () => ipcRenderer.invoke('conta:sair'),
    sincronizar: () => ipcRenderer.invoke('conta:sincronizar'),
    onEstado: (cb) => ipcRenderer.on('conta:estado', (_e, st) => cb(st))
  },
  atualizacao: {
    estado: () => ipcRenderer.invoke('atualizacao:estado'),
    checar: () => ipcRenderer.invoke('atualizacao:checar'),
    instalar: () => ipcRenderer.invoke('atualizacao:instalar'),
    onEstado: (cb) => ipcRenderer.on('atualizacao:estado', (_e, st) => cb(st))
  },
  discord: {
    usuario: (id) => ipcRenderer.invoke('discord:usuario', id),
    tokenStatus: () => ipcRenderer.invoke('discord:tokenStatus'),
    salvarToken: (token) => ipcRenderer.invoke('discord:salvarToken', token),
    testarToken: () => ipcRenderer.invoke('discord:testarToken')
  },
  roblox: {
    usuario: (nome) => ipcRenderer.invoke('roblox:usuario', nome)
  },
  arquivos: {
    escolherImagens: (multiplas) => ipcRenderer.invoke('arquivos:escolherImagens', !!multiplas),
    importar: (opts) => ipcRenderer.invoke('arquivos:importar', opts),
    listar: (pedidoId, tipo) => ipcRenderer.invoke('arquivos:listar', pedidoId, tipo),
    abrirPasta: (pedidoId, tipo) => ipcRenderer.invoke('arquivos:abrirPasta', pedidoId, tipo),
    remover: (caminho) => ipcRenderer.invoke('arquivos:remover', caminho),
    removerPedido: (pedidoId) => ipcRenderer.invoke('arquivos:removerPedido', pedidoId),
    caminhoDe: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } }
  },
  sistema: {
    abrirExterno: (url) => ipcRenderer.invoke('sistema:abrirExterno', url),
    abrirDiscord: (id) => ipcRenderer.invoke('sistema:abrirDiscord', id),
    abrirCanal: (id) => ipcRenderer.invoke('sistema:abrirCanalDiscord', id),
    copiar: (texto) => ipcRenderer.invoke('sistema:copiar', texto)
  },
  janela: {
    tema: (tema) => ipcRenderer.send('janela:tema', tema)
  }
});
