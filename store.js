// Persistência local: um JSON em %APPDATA%/Comissões/comissoes-dados.json.
// Gravação atômica (arquivo temporário + rename) e um backup por dia (guarda 14).
const fs = require('fs');
const path = require('path');

const VAZIO = { versao: 1, config: {}, clientes: [], pedidos: [] };

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'comissoes-dados.json');
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        versao: 1,
        config: raw.config && typeof raw.config === 'object' ? raw.config : {},
        clientes: Array.isArray(raw.clientes) ? raw.clientes : [],
        pedidos: Array.isArray(raw.pedidos) ? raw.pedidos : []
      };
    } catch (e) {
      if (fs.existsSync(this.file)) {
        // arquivo corrompido: guarda uma cópia pra não perder nada e começa limpo
        try { fs.copyFileSync(this.file, this.file + '.corrompido-' + Date.now()); } catch {}
      }
      return JSON.parse(JSON.stringify(VAZIO));
    }
  }

  get() { return this.data; }

  set(novo) {
    if (!novo || typeof novo !== 'object') return false;
    this.data = {
      versao: 1,
      config: novo.config && typeof novo.config === 'object' ? novo.config : {},
      clientes: Array.isArray(novo.clientes) ? novo.clientes : [],
      pedidos: Array.isArray(novo.pedidos) ? novo.pedidos : []
    };
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    this._backupDiario();
    return true;
  }

  _backupDiario() {
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
      const d = new Date();
      const nome = `comissoes-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
      const alvo = path.join(this.backupDir, nome);
      if (!fs.existsSync(alvo)) fs.copyFileSync(this.file, alvo);
      const todos = fs.readdirSync(this.backupDir).filter(f => f.startsWith('comissoes-') && f.endsWith('.json')).sort();
      while (todos.length > 14) { fs.unlinkSync(path.join(this.backupDir, todos.shift())); }
    } catch {}
  }
}

module.exports = Store;
