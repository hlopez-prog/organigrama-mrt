/**
 * OrgChart MRT Corporativo - Servidor Backend v3.0
 * Almacenamiento: GitHub API (nodes.json en el repo)
 * Hosting: Render (gratis)
 * Auth: admin / usuario con tokens en memoria
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');
const multer  = require('multer');
const XLSX    = require('xlsx');
const crypto  = require('crypto');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

const GH_TOKEN  = process.env.GITHUB_TOKEN || '';
const GH_REPO   = process.env.GITHUB_REPO  || 'hlopez-prog/organigrama-mrt';
const GH_FILE   = process.env.GITHUB_FILE  || 'sessions/sweet-focused-noether/mnt/outputs/organigrama-mrt/data/nodes.json';
const GH_BRANCH = 'master';

const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nodes.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

var _cache     = null;
var _cacheTime = 0;
var CACHE_TTL  = 30 * 1000;

function ghRequest(method, endpoint, body) {
  return new Promise(function(resolve, reject) {
    var payload = body ? JSON.stringify(body) : '';
    var opts = {
      hostname: 'api.github.com',
      path    : endpoint,
      method  : method,
      headers : {
        'Authorization': 'token ' + GH_TOKEN,
        'Accept'       : 'application/vnd.github.v3+json',
        'User-Agent'   : 'OrgChart-MRT/3.0',
        'Content-Type' : 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    var req = https.request(opts, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function readNodes() {
  if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache;
  if (GH_TOKEN) {
    try {
      var r = await ghRequest('GET', '/repos/' + GH_REPO + '/contents/' + GH_FILE + '?ref=' + GH_BRANCH);
      if (r && r.content) {
        var nodes = JSON.parse(Buffer.from(r.content, 'base64').toString('utf8'));
        _cache = nodes; _cacheTime = Date.now();
        return nodes;
      }
    } catch(e) { console.error('[GitHub] readNodes error:', e.message); }
  }
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    var nodes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    _cache = nodes; _cacheTime = Date.now();
    return nodes;
  } catch(e) { return []; }
}

async function writeNodes(nodes) {
  _cache = nodes; _cacheTime = Date.now();
  if (GH_TOKEN) {
    try {
      var current = await ghRequest('GET', '/repos/' + GH_REPO + '/contents/' + GH_FILE + '?ref=' + GH_BRANCH);
      var content = Buffer.from(JSON.stringify(nodes, null, 2)).toString('base64');
      var body = { message: 'Organigrama actualizado ' + new Date().toISOString().slice(0,16).replace('T',' '), content: content, branch: GH_BRANCH };
      if (current && current.sha) body.sha = current.sha;
      var result = await ghRequest('PUT', '/repos/' + GH_REPO + '/contents/' + GH_FILE, body);
      if (result && result.content) console.log('[GitHub] Guardados', nodes.length, 'nodos');
      return;
    } catch(e) { console.error('[GitHub] writeNodes error:', e.message); }
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(nodes, null, 2), 'utf8');
}

function logAction(action, detail, user) {
  console.log('[' + new Date().toISOString() + '] [' + (user || 'system') + '] ' + action + ': ' + detail);
}

var USERS = {
  admin:   { password: process.env.ADMIN_PASS || 'admin123', role: 'admin', name: 'Administrador RRHH' },
  usuario: { password: process.env.USER_PASS  || 'mrt2024',  role: 'user',  name: 'Usuario Consulta'  }
};

var SESSIONS    = new Map();
var SESSION_TTL = 8 * 60 * 60 * 1000;

function createSession(username) {
  var token   = crypto.randomBytes(32).toString('hex');
  var user    = USERS[username];
  var expires = Date.now() + SESSION_TTL;
  SESSIONS.set(token, { username: username, role: user.role, name: user.name, expires: expires });
  SESSIONS.forEach(function(s, t) { if (s.expires < Date.now()) SESSIONS.delete(t); });
  return token;
}

function getSession(req) {
  var auth  = req.headers['authorization'] || '';
  var token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies ? req.cookies.session : null);
  if (!token) return null;
  var s = SESSIONS.get(token);
  if (!s || s.expires < Date.now()) { SESSIONS.delete(token); return null; }
  return s;
}

function requireAuth(req, res, next) {
  var s = getSession(req);
  if (!s) return res.status(401).json({ ok: false, error: 'No autenticado. Inicia sesion.' });
  req.session = s; next();
}

function requireAdmin(req, res, next) {
  var s = getSession(req);
  if (!s) return res.status(401).json({ ok: false, error: 'No autenticado.' });
  if (s.role !== 'admin') return res.status(403).json({ ok: false, error: 'Solo administradores.' });
  req.session = s; next();
}

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(function(req, res, next) {
  req.cookies = {};
  (req.headers.cookie || '').split(';').forEach(function(part) {
    var i = part.indexOf('=');
    if (i > -1) req.cookies[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15*1024*1024 } });

app.post('/api/login', function(req, res) {
  var username = (req.body.username || '').toLowerCase().trim();
  var password = req.body.password || '';
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Usuario y contrasena requeridos' });
  var user = USERS[username];
  if (!user || user.password !== password) return res.status(401).json({ ok: false, error: 'Usuario o contrasena incorrectos' });
  var token = createSession(username);
  logAction('LOGIN', username, username);
  res.json({ ok: true, token: token, role: user.role, name: user.name, username: username });
});

app.post('/api/logout', function(req, res) {
  var auth  = req.headers['authorization'] || '';
  var token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) SESSIONS.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', function(req, res) {
  var s = getSession(req);
  if (!s) return res.json({ ok: false, authenticated: false });
  res.json({ ok: true, authenticated: true, role: s.role, name: s.name, username: s.username });
});

app.get('/api/nodes', requireAuth, async function(req, res) {
  try {
    var nodes = await readNodes();
    res.json({ ok: true, data: nodes, total: nodes.length, ts: new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/nodes', requireAdmin, async function(req, res) {
  try {
    var nodes = req.body;
    if (!Array.isArray(nodes)) return res.status(400).json({ ok: false, error: 'Se esperaba un array' });
    await writeNodes(nodes);
    logAction('PUT /api/nodes', 'Guardados ' + nodes.length + ' nodos', req.session.username);
    res.json({ ok: true, saved: nodes.length, ts: new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/nodes', requireAdmin, async function(req, res) {
  try {
    var node  = req.body;
    if (!node || !node.id) return res.status(400).json({ ok: false, error: 'ID requerido' });
    var nodes = await readNodes();
    var idx   = nodes.findIndex(function(n) { return n.id === String(node.id); });
    if (idx > -1) { nodes[idx] = Object.assign({}, nodes[idx], node); }
    else          { nodes.push(node); }
    await writeNodes(nodes);
    logAction('UPSERT node', 'ID:' + node.id, req.session.username);
    res.json({ ok: true, node: node, action: idx > -1 ? 'updated' : 'created' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/nodes/:id', requireAdmin, async function(req, res) {
  try {
    var id     = req.params.id;
    var nodes  = await readNodes();
    var before = nodes.length;
    nodes = nodes.filter(function(n) { return String(n.id) !== String(id); });
    if (nodes.length === before) return res.status(404).json({ ok: false, error: 'Nodo no encontrado' });
    await writeNodes(nodes);
    logAction('DELETE node', 'ID:' + id, req.session.username);
    res.json({ ok: true, deleted: id });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/import', requireAdmin, upload.single('file'), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibio archivo' });
    var wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    var ws   = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return res.status(400).json({ ok: false, error: 'Archivo vacio' });
    var cols = Object.keys(rows[0]);
    function fc(keys) {
      return cols.find(function(c) { return keys.some(function(k) { return c.toLowerCase().indexOf(k.toLowerCase()) > -1; }); }) || '';
    }
    var idCol = fc(['ID_Empleado','id']);
    var nmCol = fc(['Nombre','name']);
    var ptCol = fc(['Puesto','puesto']);
    var arCol = fc(['rea','Area']);
    var nvCol = fc(['Nivel']);
    var mgCol = fc(['Reporta','manager']);
    var ubCol = fc(['bicaci','ubicacion']);
    var esCol = fc(['Estatus','status']);
    var diCol = fc(['irecci','direccion']);
    var nodes = rows.filter(function(r) { return r[idCol]; }).map(function(r, i) {
      var nivel = String(r[nvCol] || 'Operativo').trim();
      if (nivel.indexOf('Supervisi') > -1) nivel = 'Supervision';
      return {
        id: String(r[idCol] || ('IMP-' + (i+1))).trim(),
        nombre: String(r[nmCol] || '').trim(),
        puesto: String(r[ptCol] || '').trim(),
        area: String(r[arCol] || '').trim(),
        nivel: nivel,
        manager: String(r[mgCol] || '').trim() || null,
        ubicacion: String(r[ubCol] || '').trim(),
        estatus: String(r[esCol] || 'Activo').trim(),
        direccion: String(r[diCol] || '').trim(),
        foto: null
      };
    });
    await writeNodes(nodes);
    logAction('IMPORT', nodes.length + ' registros', req.session.username);
    res.json({ ok: true, imported: nodes.length });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/status', async function(req, res) {
  var nodes = await readNodes();
  res.json({
    ok: true, status: 'online', version: '3.0',
    storage: GH_TOKEN ? 'GitHub API (' + GH_REPO + ')' : 'archivo JSON local',
    total: nodes.length,
    activos: nodes.filter(function(n) { return n.estatus === 'Activo'; }).length,
    vacantes: nodes.filter(function(n) { return n.estatus === 'Vacante'; }).length,
    uptime: Math.round(process.uptime()) + 's',
    ts: new Date().toISOString()
  });
});

app.get('/api/history', requireAdmin, function(req, res) {
  res.json({ ok: true, history: [],
    message: GH_TOKEN ? 'Ver commits en github.com/' + GH_REPO + '/commits/master' : 'Sin historial en modo local'
  });
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async function() {
  var nodes = await readNodes();
  console.log('');
  console.log('  OrgChart MRT Corporativo v3.0');
  console.log('  URL    : http://localhost:' + PORT);
  console.log('  Storage: ' + (GH_TOKEN ? 'GitHub API [' + GH_REPO + ']' : 'archivo local'));
  console.log('  Nodos  : ' + nodes.length);
  console.log('  Admin  : admin / ' + USERS.admin.password);
  console.log('  Usuario: usuario / ' + USERS.usuario.password);
  console.log('');
});
