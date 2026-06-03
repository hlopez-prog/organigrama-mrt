# OrgChart MRT — Instrucciones de Despliegue en Internet

## ¿Qué es esto?
Un servidor Node.js que publica el organigrama en internet.
Todos en RRHH entran desde su navegador a una URL fija.
Los cambios se guardan automáticamente en el servidor.

---

## OPCIÓN A — Railway (recomendado, gratis)

### Paso 1 — Crear cuenta en GitHub
1. Ve a https://github.com y crea una cuenta gratuita (si no tienes)

### Paso 2 — Subir el proyecto a GitHub
1. Ve a https://github.com/new
2. Nombre del repositorio: `organigrama-mrt`
3. Privado (recomendado)
4. Clic en **Create repository**
5. Sigue las instrucciones para subir esta carpeta:
```bash
cd organigrama-mrt
git init
git add .
git commit -m "Organigrama MRT inicial"
git remote add origin https://github.com/TU_USUARIO/organigrama-mrt.git
git push -u origin main
```

### Paso 3 — Desplegar en Railway
1. Ve a https://railway.app
2. Inicia sesión con tu cuenta de GitHub
3. Clic en **New Project**
4. Selecciona **Deploy from GitHub repo**
5. Elige `organigrama-mrt`
6. Railway detecta automáticamente que es Node.js
7. Clic en **Deploy**

### Paso 4 — Agregar volumen persistente (IMPORTANTE)
Sin esto, los cambios se pierden al reiniciar el servidor:
1. En Railway, abre tu proyecto
2. Ve a la pestaña **Settings** → **Volumes**
3. Clic en **Add Volume**
4. Mount path: `/app/data`
5. Clic en **Create**
6. El servidor se reinicia automáticamente

### Paso 5 — Obtener tu URL
1. En Railway, ve a **Settings** → **Networking**
2. Clic en **Generate Domain**
3. Tu URL será algo como: `https://organigrama-mrt-production.up.railway.app`
4. Comparte esa URL con tu equipo de RRHH

---

## OPCIÓN B — Render (alternativa gratuita)

### Paso 1-2 — Igual que Railway (GitHub)

### Paso 3 — Desplegar en Render
1. Ve a https://render.com
2. Inicia sesión con GitHub
3. **New** → **Web Service**
4. Conecta `organigrama-mrt`
5. Build Command: `npm install`
6. Start Command: `npm start`
7. Clic en **Create Web Service**

### Paso 4 — Disco persistente
1. En Render, ve a tu servicio → **Disks**
2. **Add Disk**
3. Name: `data-volume`
4. Mount Path: `/opt/render/project/src/data`
5. Size: 1 GB (gratis)

---

## OPCIÓN C — Probar localmente primero

En tu computadora, abre PowerShell en la carpeta `organigrama-mrt`:

```bash
npm install
npm start
```

Abre el navegador en: http://localhost:3000

---

## ¿Cómo funciona la persistencia?

```
Usuario edita nodo
       ↓
Frontend guarda automáticamente (800ms después del último cambio)
       ↓
API PUT /api/nodes → servidor recibe el array completo
       ↓
server.js escribe en data/nodes.json
       ↓
Cualquier usuario que recargue la página ve los datos actualizados
```

## Historial de cambios

El servidor guarda automáticamente los últimos 20 estados del organigrama
en `data/history/`. Si hay un error, puedes restaurar desde:

```
GET /api/history          → ver versiones disponibles
GET /api/restore/ARCHIVO  → restaurar una versión
```

## Variables de entorno opcionales

```
PORT=3000          # Puerto del servidor (Railway lo pone automáticamente)
```
