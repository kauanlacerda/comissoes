// Servidor estático para testar a interface no navegador (modo simulado).
// Uso: node tools/servir.js [porta]  →  http://localhost:5180/renderer/index.html?semente=1
const http = require('http');
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const porta = +process.argv[2] || 5180;
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let alvo = path.join(raiz, url === '/' ? '/renderer/index.html' : url);
  if (!alvo.startsWith(raiz)) { res.writeHead(403); return res.end(); }
  fs.readFile(alvo, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(porta, () => console.log('servindo ' + raiz + ' em http://localhost:' + porta));
