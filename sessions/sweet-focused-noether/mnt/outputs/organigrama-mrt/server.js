/**
 * OrgChart MRT Corporativo — Servidor Backend v2.0
 * Autenticación por roles: admin / user
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const cors    = require('cors');
const multer  = require('multer');
const XLSX    = require('xlsx');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nodes.json');
const HIST_DIR  = path.join(DATA_DIR, 'history');

[DATA_DIR, HIST_DIR].forEach(function(d) { if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); });

// ── USERS (override with env vars on Railway) ──
var USERS = {
  admin:   { password: process.env.ADMIN_PASS || 'admin123', role:'admin', name:'Administrador RRHH' },
  usuario: { password: process.env.USER_PASS  || 'mrt2024',  role:'user',  name:'Usuario Consulta' }
};

// In-memory sessions
var SESSIONS = new Map();
var SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

function createSession(username) {
  var token   = crypto.randomBytes(32).toString('hex');
  var user    = USERS[username];
  var expires = Date.now() + SESSION_TTL;
  SESSIONS.set(token, { username: username, role: user.role, name: user.name, expires: expires });
  SESSIONS.forEach(function(s, t) { if(s.expires < Date.now()) SESSIONS.delete(t); });
  return token;
}

function getSession(req) {
  var auth  = req.headers['authorization'] || '';
  var token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies ? req.cookies.session : null);
  if(!token) return null;
  var s = SESSIONS.get(token);
  if(!s || s.expires < Date.now()) { SESSIONS.delete(token); return null; }
  return s;
}

function requireAuth(req, res, next) {
  var session = getSession(req);
  if(!session) return res.status(401).json({ ok:false, error:'No autenticado. Inicia sesión.' });
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  var session = getSession(req);
  if(!session) return res.status(401).json({ ok:false, error:'No autenticado.' });
  if(session.role !== 'admin') return res.status(403).json({ ok:false, error:'Acción solo permitida para administradores.' });
  req.session = session;
  next();
}

// ── Middlewares ──
app.use(cors({ credentials:true, origin:true }));
app.use(express.json({ limit:'10mb' }));
app.use(function(req, res, next) {
  req.cookies = {};
  var raw = req.headers.cookie || '';
  raw.split(';').forEach(function(part) {
    var eqIdx = part.indexOf('=');
    if(eqIdx > -1) {
      var k = part.slice(0, eqIdx).trim();
      var v = decodeURIComponent(part.slice(eqIdx+1).trim());
      req.cookies[k] = v;
    }
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15*1024*1024 } });

// ── Data helpers ──
function readNodes() {
  try {
    if(!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) { console.error('readNodes error:', e.message); return []; }
}

function writeNodes(nodes) {
  if(fs.existsSync(DATA_FILE)) {
    var ts   = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    var hist = path.join(HIST_DIR, 'nodes_' + ts + '.json');
    fs.copyFileSync(DATA_FILE, hist);
    var files = fs.readdirSync(HIST_DIR).sort();
    if(files.length > 20) files.slice(0, files.length-20).forEach(function(f){ fs.unlinkSync(path.join(HIST_DIR,f)); });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(nodes, null, 2), 'utf8');
}

function logAction(action, detail, user) {
  var entry = '[' + new Date().toISOString() + '] [' + (user||'system') + '] ' + action + ': ' + detail + '\n';
  try { fs.appendFileSync(path.join(DATA_DIR, 'activity.log'), entry); } catch(e) {}
}

// ════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════

app.post('/api/login', function(req, res) {
  var username = (req.body.username || '').toLowerCase().trim();
  var password = req.body.password || '';
  if(!username || !password) return res.status(400).json({ ok:false, error:'Usuario y contraseña requeridos' });
  var user = USERS[username];
  if(!user || user.password !== password) return res.status(401).json({ ok:false, error:'Usuario o contraseña incorrectos' });
  var token = createSession(username);
  logAction('LOGIN', username, username);
  res.json({ ok:true, token:token, role:user.role, name:user.name, username:username });
});

app.post('/api/logout', function(req, res) {
  var auth  = req.headers['authorization'] || '';
  var token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if(token) { SESSIONS.delete(token); }
  res.json({ ok:true });
});

app.get('/api/me', function(req, res) {
  var s = getSession(req);
  if(!s) return res.json({ ok:false, authenticated:false });
  res.json({ ok:true, authenticated:true, role:s.role, name:s.name, username:s.username });
});

// ════════════════════════════════════════
//  DATA ROUTES
// ════════════════════════════════════════

app.get('/api/nodes', requireAuth, function(req, res) {
  try {
    var nodes = readNodes();
    res.json({ ok:true, data:nodes, total:nodes.length, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.put('/api/nodes', requireAdmin, function(req, res) {
  try {
    var nodes = req.body;
    if(!Array.isArray(nodes)) return res.status(400).json({ ok:false, error:'Se esperaba un array' });
    writeNodes(nodes);
    logAction('PUT /api/nodes', 'Guardados ' + nodes.length + ' nodos', req.session.username);
    res.json({ ok:true, saved:nodes.length, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/nodes', requireAdmin, function(req, res) {
  try {
    var node  = req.body;
    if(!node || !node.id) return res.status(400).json({ ok:false, error:'ID requerido' });
    var nodes = readNodes();
    var idx   = nodes.findIndex(function(n){ return n.id === String(node.id); });
    if(idx > -1) { nodes[idx] = Object.assign({}, nodes[idx], node); }
    else         { nodes.push(node); }
    writeNodes(nodes);
    logAction('UPSERT node', 'ID:' + node.id, req.session.username);
    res.json({ ok:true, node:node, action: idx > -1 ? 'updated' : 'created' });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.delete('/api/nodes/:id', requireAdmin, function(req, res) {
  try {
    var id    = req.params.id;
    var nodes = readNodes();
    var before = nodes.length;
    nodes = nodes.filter(function(n){ return String(n.id) !== String(id); });
    if(nodes.length === before) return res.status(404).json({ ok:false, error:'Nodo no encontrado' });
    writeNodes(nodes);
    logAction('DELETE node', 'ID:' + id, req.session.username);
    res.json({ ok:true, deleted:id });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.post('/api/import', requireAdmin, upload.single('file'), function(req, res) {
  try {
    if(!req.file) return res.status(400).json({ ok:false, error:'No se recibio archivo' });
    var wb   = XLSX.read(req.file.buffer, { type:'buffer' });
    var ws   = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
    if(!rows.length) return res.status(400).json({ ok:false, error:'Archivo vacio' });
    var cols = Object.keys(rows[0]);
    function fc(keys) {
      return cols.find(function(c){
        return keys.some(function(k){ return c.toLowerCase().indexOf(k.toLowerCase()) > -1; });
      }) || '';
    }
    var idCol = fc(['ID_Empleado','id']);
    var nmCol = fc(['Nombre','name']);
    var ptCol = fc(['Puesto','puesto']);
    var arCol = fc(['rea','Area']);
    var nvCol = fc(['Nivel']);
    var mgCol = fc(['Reporta','manager']);
    var ubCol = fc(['bicaci','ubicacion']);
    var esCol = fc(['Estatus','status']);
    var nodes = rows.filter(function(r){ return r[idCol]; }).map(function(r, i) {
      var nivel = String(r[nvCol] || 'Operativo').trim();
      if(nivel.indexOf('Supervisi') > -1) nivel = 'Supervisión';
      var mgr = String(r[mgCol] || '').trim();
      return { id:String(r[idCol]||('IMP-'+(i+1))).trim(), nombre:String(r[nmCol]||'').trim(),
        puesto:String(r[ptCol]||'').trim(), area:String(r[arCol]||'').trim(), nivel:nivel,
        manager:mgr||null, ubicacion:String(r[ubCol]||'').trim(), estatus:String(r[esCol]||'Activo').trim(), foto:null };
    });
    writeNodes(nodes);
    logAction('IMPORT', nodes.length + ' registros', req.session.username);
    res.json({ ok:true, imported:nodes.length });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('/api/status', function(req, res) {
  var nodes = readNodes();
  res.json({ ok:true, status:'online', total:nodes.length,
    activos:  nodes.filter(function(n){ return n.estatus==='Activo'; }).length,
    vacantes: nodes.filter(function(n){ return n.estatus==='Vacante'; }).length,
    uptime:   Math.round(process.uptime()) + 's', ts:new Date().toISOString() });
});

app.get('/api/history', requireAdmin, function(req, res) {
  try {
    var files = fs.existsSync(HIST_DIR)
      ? fs.readdirSync(HIST_DIR).sort().reverse().slice(0,10).map(function(f){
          return { file:f, date:f.replace('nodes_','').replace('.json','').replace(/-/g,':').replace('T',' '),
            size: Math.round(fs.statSync(path.join(HIST_DIR,f)).size/1024) + ' KB' }; })
      : [];
    res.json({ ok:true, history:files });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
  console.log('\n✅  OrgChart MRT v2.0 — Con autenticación');
  console.log('🌐  http://localhost:' + PORT);
  console.log('🔐  Admin: admin / ' + USERS.admin.password);
  console.log('👤  User:  usuario / ' + USERS.usuario.password);
  console.log('📊  Nodos: ' + readNodes().length + '\n');
});
