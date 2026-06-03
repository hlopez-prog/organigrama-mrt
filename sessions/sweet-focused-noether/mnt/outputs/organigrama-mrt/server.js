/**
 * OrgChart MRT Corporativo — Servidor Backend
 * Tecnología: Node.js + Express
 * Almacenamiento: JSON persistente en disco
 * Deploy: Railway, Render, o local
 */

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const cors     = require('cors');
const multer   = require('multer');
const XLSX     = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Rutas de datos ──
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nodes.json');
const HIST_DIR  = path.join(DATA_DIR, 'history');

// Crear directorios si no existen
[DATA_DIR, HIST_DIR].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); });

// ── Middlewares ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ── Helpers ──
function readNodes() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) {
    console.error('Error leyendo datos:', e.message);
    return [];
  }
}

function writeNodes(nodes) {
  // Guardar historial antes de sobreescribir
  if (fs.existsSync(DATA_FILE)) {
    const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const hist = path.join(HIST_DIR, `nodes_${ts}.json`);
    fs.copyFileSync(DATA_FILE, hist);
    // Mantener solo los últimos 20 historiales
    const files = fs.readdirSync(HIST_DIR).sort();
    if (files.length > 20) {
      files.slice(0, files.length - 20).forEach(f => fs.unlinkSync(path.join(HIST_DIR, f)));
    }
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(nodes, null, 2), 'utf8');
}

function logAction(action, detail) {
  const entry = `[${new Date().toISOString()}] ${action}: ${detail}\n`;
  fs.appendFileSync(path.join(DATA_DIR, 'activity.log'), entry);
}

// ══════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════

// GET /api/nodes — obtener todos los nodos
app.get('/api/nodes', (req, res) => {
  try {
    const nodes = readNodes();
    res.json({ ok: true, data: nodes, total: nodes.length, ts: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/nodes — reemplazar todos los nodos (guardar estado completo)
app.put('/api/nodes', (req, res) => {
  try {
    const nodes = req.body;
    if (!Array.isArray(nodes)) return res.status(400).json({ ok: false, error: 'Se esperaba un array de nodos' });
    writeNodes(nodes);
    logAction('PUT /api/nodes', `Guardados ${nodes.length} nodos`);
    res.json({ ok: true, saved: nodes.length, ts: new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/nodes — agregar un nodo
app.post('/api/nodes', (req, res) => {
  try {
    const node = req.body;
    if (!node || !node.id) return res.status(400).json({ ok: false, error: 'ID requerido' });
    const nodes = readNodes();
    const idx = nodes.findIndex(n => n.id === String(node.id));
    if (idx > -1) {
      nodes[idx] = { ...nodes[idx], ...node };
      logAction('POST /api/nodes (update)', `ID: ${node.id} — ${node.nombre}`);
    } else {
      nodes.push(node);
      logAction('POST /api/nodes (create)', `ID: ${node.id} — ${node.nombre}`);
    }
    writeNodes(nodes);
    res.json({ ok: true, node, action: idx > -1 ? 'updated' : 'created' });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/nodes/:id — eliminar un nodo
app.delete('/api/nodes/:id', (req, res) => {
  try {
    const id = req.params.id;
    let nodes = readNodes();
    const before = nodes.length;
    nodes = nodes.filter(n => String(n.id) !== String(id));
    if (nodes.length === before) return res.status(404).json({ ok: false, error: 'Nodo no encontrado' });
    writeNodes(nodes);
    logAction('DELETE /api/nodes', `ID: ${id}`);
    res.json({ ok: true, deleted: id });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/import — importar desde Excel/CSV
app.post('/api/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return res.status(400).json({ ok: false, error: 'El archivo está vacío' });

    // Column mapping flexible
    const cols = Object.keys(rows[0]);
    const find = (keys) => cols.find(c => keys.some(k => c.toLowerCase().includes(k.toLowerCase()))) || '';

    const idCol       = find(['ID_Empleado','id','empleado']);
    const nombreCol   = find(['Nombre_Completo','nombre','name']);
    const puestoCol   = find(['Puesto','puesto','cargo','position']);
    const areaCol     = find(['rea','Area','depto','departamento']);
    const nivelCol    = find(['Nivel','nivel','level']);
    const managerCol  = find(['Reporta_A_ID','manager','jefe','reporta']);
    const ubicCol     = find(['bicaci','ubicacion','planta','location']);
    const estatusCol  = find(['Estatus','estatus','status']);

    const nodes = rows
      .filter(r => r[idCol] !== '' && r[idCol] !== undefined)
      .map((r, i) => {
        let nivel = String(r[nivelCol] || 'Operativo').trim();
        if (nivel.includes('Supervisi')) nivel = 'Supervisión';
        const mgr = String(r[managerCol] || '').trim();
        return {
          id:        String(r[idCol] || `IMP-${i+1}`).trim(),
          nombre:    String(r[nombreCol] || '').trim(),
          puesto:    String(r[puestoCol] || '').trim(),
          area:      String(r[areaCol] || '').trim(),
          nivel,
          manager:   mgr || null,
          ubicacion: String(r[ubicCol] || '').trim(),
          estatus:   String(r[estatusCol] || 'Activo').trim(),
          foto:      null,
        };
      });

    const mode = req.query.mode || 'replace'; // 'replace' | 'merge'
    if (mode === 'merge') {
      const existing = readNodes();
      const existMap = new Map(existing.map(n => [String(n.id), n]));
      nodes.forEach(n => existMap.set(String(n.id), n));
      writeNodes([...existMap.values()]);
      logAction('POST /api/import (merge)', `${nodes.length} registros, total: ${existMap.size}`);
      res.json({ ok: true, imported: nodes.length, total: existMap.size, mode: 'merge' });
    } else {
      writeNodes(nodes);
      logAction('POST /api/import (replace)', `${nodes.length} registros`);
      res.json({ ok: true, imported: nodes.length, total: nodes.length, mode: 'replace' });
    }
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/history — ver historial de cambios
app.get('/api/history', (req, res) => {
  try {
    const files = fs.existsSync(HIST_DIR)
      ? fs.readdirSync(HIST_DIR).sort().reverse().slice(0,10).map(f => ({
          file: f,
          date: f.replace('nodes_','').replace('.json','').replace(/-/g,':').replace('T',' '),
          size: Math.round(fs.statSync(path.join(HIST_DIR,f)).size/1024) + ' KB'
        }))
      : [];
    res.json({ ok: true, history: files });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/restore/:file — restaurar versión anterior
app.get('/api/restore/:file', (req, res) => {
  try {
    const src = path.join(HIST_DIR, req.params.file);
    if (!fs.existsSync(src)) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
    const nodes = JSON.parse(fs.readFileSync(src, 'utf8'));
    writeNodes(nodes);
    logAction('RESTORE', req.params.file);
    res.json({ ok: true, restored: req.params.file, total: nodes.length });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/status — estado del servidor
app.get('/api/status', (req, res) => {
  const nodes = readNodes();
  res.json({
    ok: true, status: 'online',
    total: nodes.length,
    activos: nodes.filter(n=>n.estatus==='Activo').length,
    vacantes: nodes.filter(n=>n.estatus==='Vacante').length,
    areas: [...new Set(nodes.map(n=>n.area).filter(Boolean))].length,
    uptime: Math.round(process.uptime()) + 's',
    ts: new Date().toISOString()
  });
});

// Fallback → index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Iniciar servidor ──
app.listen(PORT, () => {
  console.log(`\n✅  OrgChart MRT — Servidor corriendo`);
  console.log(`🌐  http://localhost:${PORT}`);
  console.log(`📂  Datos en: ${DATA_FILE}`);
  console.log(`📊  Nodos cargados: ${readNodes().length}\n`);
});
