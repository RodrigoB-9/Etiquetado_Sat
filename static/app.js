const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const ESTADOS = ['Disponible', 'En uso', 'En mantenimiento', 'Dañado', 'Baja'];
const RX = {
  codigo: /^[A-Z]{3}-[A-Z]{2}-[A-Z]{3}-\d{4}$/,
  ubic: /^[A-Z0-9]+(-[A-Z0-9]+)*$/,
  area: /^[A-Z]{3}$/,
  tipo: /^[A-Z]{2}$/,
  sub: /^[A-Z]{3}$/
};
const FIELDS = [
  ['nombre', 'Nombre *', 'text'],
  ['marca', 'Marca *', 'text'],
  ['modelo', 'Modelo *', 'text'],
  ['serie', 'Serie *', 'text'],
  ['categoria', 'Categoría *', 'text'],
  ['ubicacion', 'Ubicación *', 'ubic'],
  ['cantidad', 'Cantidad *', 'number'],
  ['estado', 'Estado *', 'estado'],
  ['custodio', 'Custodio (quién lo tiene)', 'text'],
  ['fechaCompra', 'Fecha de compra *', 'date'],
  ['costo', 'Costo de compra *', 'number'],
  ['proveedor', 'Proveedor *', 'text'],
  ['lote', 'Lote *', 'text'],
  ['caducidad', 'Caducidad', 'date']
];

let items = [];
let cfg = { areas: {}, tipos: {}, subtipos: {} };
let ubic = [];
let editing = null;
let busy = false;

function msg(t, bad) {
  const m = $('#msg');
  m.textContent = t || '';
  m.className = 'msg' + (bad ? ' err' : '');
  m.hidden = !t;
}

function opts(o, ph) {
  return (ph ? '<option value="">' + esc(ph) + '</option>' : '') +
    Object.keys(o || {}).sort().map(k => '<option value="' + esc(k) + '">' + esc(k) + ' · ' + esc(o[k]) + '</option>').join('');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const err = (data && data.error) ? data.error : ('Error HTTP ' + res.status);
    const e = new Error(err);
    e.payload = data;
    throw e;
  }
  return data;
}

async function bootstrap(silent = false) {
  try {
    const data = await api('/api/bootstrap', { method: 'GET', headers: {} });
    items = Array.isArray(data.items) ? data.items : [];
    cfg = data.cfg || { areas: {}, tipos: {}, subtipos: {} };
    ubic = Array.isArray(data.ubicaciones) ? data.ubicaciones : [];
    fill();
    render();
    if (!silent) msg('');
    return true;
  } catch (e) {
    if (!silent) msg('No se pudo conectar con la base de datos: ' + (e.message || e), 1);
    return false;
  }
}

function fill() {
  const a = $('#fa'), v = a.value;
  a.innerHTML = '<option value="">Todas las áreas</option>' + opts(cfg.areas);
  a.value = v;
  const e = $('#fe'), w = e.value;
  e.innerHTML = '<option value="">Todos los estados</option>' + ESTADOS.map(x => '<option>' + x + '</option>').join('');
  e.value = w;
}

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const fa = $('#fa').value;
  const fe = $('#fe').value;
  const list = items.filter(i =>
    (!fa || i.area === fa) &&
    (!fe || i.estado === fe) &&
    (!q || [i.codigo, i.nombre, i.marca, i.modelo, i.serie, i.categoria, i.ubicacion, i.custodio, i.proveedor, i.lote].join(' ').toLowerCase().includes(q))
  ).sort((a, b) => a.codigo < b.codigo ? -1 : 1);

  $('#tb').innerHTML = list.map(i => '<tr>' +
    '<td><code>' + esc(i.codigo) + '</code></td>' +
    '<td>' + esc(i.nombre) + '<br><small>' + esc(i.categoria) + '</small></td>' +
    '<td>' + esc([i.marca, i.modelo, i.serie].filter(Boolean).join(' / ')) + '</td>' +
    '<td>' + esc(i.ubicacion) + '</td>' +
    '<td>' + esc(i.cantidad) + '</td>' +
    '<td><span class="tag">' + esc(i.estado) + '</span></td>' +
    '<td>' + esc(i.custodio) + '</td>' +
    '<td style="white-space:nowrap"><button data-l="' + esc(i.codigo) + '">Etiqueta</button> <button class="wr" data-e="' + esc(i.codigo) + '">Editar</button> <button class="wr" data-d="' + esc(i.codigo) + '">Eliminar</button></td>' +
    '</tr>').join('') || '<tr><td colspan="8" style="color:var(--mu)">Sin registros que mostrar.</td></tr>';
  $('#cnt').textContent = list.length + ' de ' + items.length + ' registros';
}

['#q', '#fa', '#fe'].forEach(s => $(s).addEventListener('input', render));
$('#tb').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.l) label(b.dataset.l);
  if (b.dataset.e) openForm(b.dataset.e);
  if (b.dataset.d) openDelete(b.dataset.d);
});

function openDelete(codigo) {
  const i = items.find(x => x.codigo === codigo);
  const nombre = i ? i.nombre : '';
  dlg('Eliminar registro',
    '<p>Vas a eliminar el registro <code>' + esc(codigo) + '</code>' + (nombre ? ' — ' + esc(nombre) : '') + '.</p>' +
    '<p class="sub">Esta acción no se puede deshacer.</p>' +
    '<label>Contraseña<input id="del_pass" type="password" autocomplete="off"></label>' +
    '<p id="del_err" class="err"></p>' +
    '<div class="bar"><button type="button" id="del_cancel">Cancelar</button> <button type="button" class="p" id="del_ok" data-delcode="' + esc(codigo) + '">Eliminar</button></div>'
  );
  const pass = $('#del_pass');
  if (pass) pass.focus();
}

function label(c) {
  const i = items.find(x => x.codigo === c);
  if (!i) return;
  $('#qr').innerHTML = '';
  try { new QRCode($('#qr'), { text: c, width: 140, height: 140 }); } catch (e) { $('#qr').textContent = '(QR no disponible)'; }
  $('#lc').textContent = c;
  $('#ln').textContent = i.nombre || '';
  $('#dl').showModal();
}
$('#lx').onclick = () => $('#dl').close();
$('#lp').onclick = () => window.print();

function dlg(t, html) {
  $('#dkt').textContent = t;
  $('#dkb').innerHTML = html;
  if (!$('#dk').open) $('#dk').showModal();
}
$('#dkx').onclick = () => $('#dk').close();

/* ---------- formulario ---------- */
function openForm(code) {
  editing = code ? items.find(x => x.codigo === code) : null;
  const r = editing || {};
  $('#drt').textContent = editing ? 'Editar ' + code : 'Nuevo registro';
  $('#dre').textContent = '';
  let h = '';
  if (!editing) {
    h += '<div class="g"><label>Área *<select id="f_area">' + opts(cfg.areas, 'Elegir') + '</select></label>' +
         '<label>Tipo *<select id="f_tipo">' + opts(cfg.tipos, 'Elegir') + '</select></label>' +
         '<label>Subtipo *<select id="f_sub">' + opts(cfg.subtipos, 'Elegir') + '</select></label></div>' +
         '<p class="sub">El correlativo se asigna solo al guardar, sin repetirse.</p>';
  } else {
    h += '<p class="sub">El código no se puede cambiar.</p>';
  }
  h += '<div class="g">' + FIELDS.map(([k, l, t]) => {
    let inp;
    if (t === 'ubic') {
      inp = '<select id="f_' + k + '"><option value="">Seleccionar ubicación</option>' +
        ubic.map(u => '<option value="' + esc(u.codigo) + '">' + esc(u.codigo) + (u.nombre ? ' · ' + esc(u.nombre) : '') + '</option>').join('') +
        '</select>';
    } else if (t === 'estado') {
      inp = '<select id="f_' + k + '">' + ESTADOS.map(x => '<option>' + x + '</option>').join('') + '</select>';
    } else {
      const attrs = [];
      if (k === 'cantidad') attrs.push('min="1"', 'step="1"');
      if (k === 'costo') attrs.push('min="0"', 'step="0.01"');
      if (k !== 'custodio' && k !== 'caducidad') attrs.push('required');
      inp = '<input id="f_' + k + '" type="' + t + '"' + (attrs.length ? ' ' + attrs.join(' ') : '') + '>';
    }
    return '<label>' + l + inp + '</label>';
  }).join('') + '</div>';
  if (!editing) {
    h += '<p class="sub">Si la cantidad es mayor que 1, se generará un código distinto para cada unidad (cada registro con cantidad 1).</p>';
  }
  $('#drb').innerHTML = h;
  FIELDS.forEach(([k]) => {
    const el = $('#f_' + k);
    if (!el) return;
    const v = r[k];
    if (editing && k === 'cantidad') {
      el.value = 1;
      el.disabled = true;
      el.title = 'Cada registro corresponde a una unidad con su propio código';
    } else {
      el.value = v == null ? (k === 'cantidad' ? 1 : k === 'estado' ? 'Disponible' : '') : v;
    }
  });
  const fUbic = $('#f_ubicacion');
  if (fUbic) fUbic.required = true;
  $('#dr').showModal();
}

$('#bn').onclick = () => {
  if (!Object.keys(cfg.areas).length || !Object.keys(cfg.tipos).length || !Object.keys(cfg.subtipos).length) {
    dlg('Faltan categorías', '<p>Primero agrega al menos un área, un tipo y un subtipo en «Categorías».</p>');
    return;
  }
  openForm(null);
};
$('#drx').onclick = () => $('#dr').close();

function collect() {
  const o = {};
  for (const [k, l, t] of FIELDS) {
    const el = $('#f_' + k);
    let v = (el && el.value != null ? String(el.value) : '').trim();
    if (k === 'cantidad') {
      if (v === '' || !Number.isInteger(Number(v))) return { e: 'La cantidad debe ser un número entero (1 o más)' };
      v = Number(v);
      if (v < 1) return { e: 'La cantidad debe ser un número entero (1 o más)' };
      o[k] = v;
      continue;
    }
    if (k === 'costo') {
      if (v === '') return { e: 'El costo de compra es obligatorio' };
      const n = Number(v);
      if (!isFinite(n) || n < 0) return { e: 'El costo de compra debe ser un número válido' };
      o[k] = n;
      continue;
    }
    if (t === 'number' && v !== '') {
      const n = Number(v);
      if (!isFinite(n) || n < 0) return { e: l.replace(' *', '') + ' debe ser un número válido' };
      v = n;
    }
    o[k] = v;
  }

  if (!o.nombre) return { e: 'El nombre es obligatorio' };
  const obligatoriosTexto = [
    ['marca', 'La marca es obligatoria'],
    ['modelo', 'El modelo es obligatorio'],
    ['serie', 'La serie es obligatoria'],
    ['categoria', 'La categoría es obligatoria'],
    ['proveedor', 'El proveedor es obligatorio'],
    ['lote', 'El lote es obligatorio']
  ];
  for (const [k, msg] of obligatoriosTexto) {
    if (!o[k]) return { e: msg };
  }
  if (!o.ubicacion) return { e: 'La ubicación es obligatoria' };
  if (!ubic.some(u => u.codigo === o.ubicacion)) return { e: 'La ubicación no existe en el catálogo de ubicaciones' };
  if (!o.estado) return { e: 'El estado es obligatorio' };
  if (!o.fechaCompra) return { e: 'La fecha de compra es obligatoria' };
  if (o.fechaCompra && o.caducidad && o.caducidad < o.fechaCompra) return { e: 'La caducidad no puede ser anterior a la fecha de compra' };
  // custodio y caducidad son opcionales
  return { o };
}

$('#drs').onclick = async () => {
  if (busy) return;
  const er = $('#dre');
  er.textContent = '';
  const c = collect();
  if (c.e) { er.textContent = c.e; return; }
  busy = true; $('#drs').disabled = true;
  try {
    if (editing) {
      const payload = { ...c.o, cantidad: 1 };
      await api('/api/items/' + encodeURIComponent(editing.codigo), { method: 'PUT', body: JSON.stringify(payload) });
      $('#dr').close();
      await bootstrap(true);
    } else {
      const area = $('#f_area').value, tipo = $('#f_tipo').value, sub = $('#f_sub').value;
      if (!area || !tipo || !sub) { er.textContent = 'Elige área, tipo y subtipo'; return; }
      const res = await api('/api/items', { method: 'POST', body: JSON.stringify({ area, tipo, subtipo: sub, ...c.o }) });
      $('#dr').close();
      await bootstrap(true);
      const codigos = Array.isArray(res.codigos) ? res.codigos : (res.codigo ? [res.codigo] : []);
      if (codigos.length > 1) {
        dlg('Registros creados', '<p>Se generaron <b>' + codigos.length + '</b> códigos (uno por unidad):</p><p>' + codigos.map(x => '<code>' + esc(x) + '</code>').join(' ') + '</p><p class="sub">Puedes imprimir la etiqueta de cada uno desde la tabla.</p>');
      } else if (codigos[0]) {
        msg('Registro creado: ' + codigos[0]);
      }
    }
  } catch (e) {
    er.textContent = 'No se guardó: ' + (e.message || e);
  } finally {
    busy = false; $('#drs').disabled = false;
  }
};

/* ---------- categorías (catálogos) ---------- */
function renderCategorias() {
  const sec = (t, k, ph, len) => '<h3 style="margin:10px 0 4px">' + t + '</h3>' +
    '<p class="sub" style="margin:0 0 6px">' + Object.keys(cfg[k] || {}).sort().map(x =>
      '<span class="tag">' + esc(x) + ' · ' + esc(cfg[k][x]) +
      ' <button type="button" data-delcat="' + k + '" data-delkey="' + esc(x) + '" title="Eliminar">×</button></span>'
    ).join(' ') + '</p>' +
    '<div class="bar"><input id="c_' + k + 'k" placeholder="' + ph + '" maxlength="' + len + '" style="width:90px;text-transform:uppercase">' +
    '<input id="c_' + k + 'v" placeholder="Nombre" style="flex:1"><button data-c="' + k + '">Agregar</button></div>';
  dlg('Categorías',
    sec('Áreas', 'areas', 'ELE', 3) +
    sec('Tipos', 'tipos', 'EQ', 2) +
    sec('Subtipos', 'subtipos', 'MUL', 3) +
    '<p id="ce" class="err"></p><p class="sub">Las siglas definen el código del registro. Para eliminar una categoría se requiere contraseña; no se puede eliminar si hay registros que la usan.</p>'
  );
}
$('#bc').onclick = renderCategorias;

$('#dkb').addEventListener('click', async e => {
  const addCat = e.target.closest('button[data-c]');
  if (addCat) {
    const k = addCat.dataset.c;
    const rx = { areas: RX.area, tipos: RX.tipo, subtipos: RX.sub }[k];
    const key = $('#c_' + k + 'k').value.trim().toUpperCase();
    const val = $('#c_' + k + 'v').value.trim();
    const er = $('#ce');
    er.textContent = '';
    if (!rx.test(key)) { er.textContent = 'Las siglas deben ser ' + (k === 'tipos' ? '2' : '3') + ' letras mayúsculas sin acentos'; return; }
    if (!val) { er.textContent = 'Escribe el nombre'; return; }
    if (cfg[k] && cfg[k][key]) { er.textContent = 'Esas siglas ya existen'; return; }
    try {
      await api('/api/catalogos', { method: 'POST', body: JSON.stringify({ kind: k, key, value: val }) });
      await bootstrap(true);
      renderCategorias();
    } catch (x) { er.textContent = 'No se guardó: ' + (x.message || x); }
    return;
  }

  if (e.target.id === 'u_a') {
    const c = $('#u_c').value.trim().toUpperCase();
    const n = $('#u_n').value.trim();
    const er = $('#ue');
    er.textContent = '';
    if (!RX.ubic.test(c)) { er.textContent = 'Código inválido. Usa solo letras y números, sin espacios (ej. LAB1).'; return; }
    if (ubic.some(u => u.codigo === c)) { er.textContent = 'Esa ubicación ya existe'; return; }
    try {
      await api('/api/ubicaciones', { method: 'POST', body: JSON.stringify({ codigo: c, nombre: n }) });
      await bootstrap(true);
      renderUbicaciones();
    } catch (x) { er.textContent = 'No se guardó: ' + (x.message || x); }
    return;
  }

  const delCatBtn = e.target.closest('button[data-delcat]');
  if (delCatBtn) {
    const kind = delCatBtn.dataset.delcat;
    const key = delCatBtn.dataset.delkey;
    const nombre = (cfg[kind] && cfg[kind][key]) ? cfg[kind][key] : '';
    const kindLabel = { areas: 'área', tipos: 'tipo', subtipos: 'subtipo' }[kind] || 'categoría';
    dlg('Eliminar categoría',
      '<p>Vas a eliminar ' + kindLabel + ' <code>' + esc(key) + '</code>' + (nombre ? ' — ' + esc(nombre) : '') + '.</p>' +
      '<p class="sub">Se requiere contraseña. No se puede eliminar si hay registros que la usan.</p>' +
      '<label>Contraseña<input id="catdel_pass" type="password" autocomplete="off"></label>' +
      '<p id="catdel_err" class="err"></p>' +
      '<div class="bar"><button type="button" id="catdel_cancel">Volver</button> <button type="button" class="p" id="catdel_ok" data-kind="' + esc(kind) + '" data-key="' + esc(key) + '">Eliminar</button></div>'
    );
    const pass = $('#catdel_pass'); if (pass) pass.focus();
    return;
  }

  if (e.target.id === 'catdel_cancel') { renderCategorias(); return; }
  if (e.target.id === 'catdel_ok') {
    const kind = e.target.dataset.kind || '';
    const key = e.target.dataset.key || '';
    const passEl = $('#catdel_pass');
    const errEl = $('#catdel_err');
    const password = passEl ? passEl.value : '';
    if (errEl) errEl.textContent = '';
    if (!password) { if (errEl) errEl.textContent = 'Escribe la contraseña para eliminar.'; return; }
    try {
      await api('/api/catalogos/' + encodeURIComponent(kind) + '/' + encodeURIComponent(key), { method: 'DELETE', body: JSON.stringify({ password }) });
      await bootstrap(true);
      renderCategorias();
      msg('Categoría eliminada: ' + key);
    } catch (x) {
      if (errEl) errEl.textContent = x.message || 'No se pudo eliminar.';
    }
    return;
  }

  const delUbBtn = e.target.closest('button[data-delubic]');
  if (delUbBtn) {
    const codigo = delUbBtn.dataset.delubic;
    const u = ubic.find(x => x.codigo === codigo);
    const nombre = u ? u.nombre : '';
    dlg('Eliminar ubicación',
      '<p>Vas a eliminar la ubicación <code>' + esc(codigo) + '</code>' + (nombre ? ' — ' + esc(nombre) : '') + '.</p>' +
      '<p class="sub">Se requiere contraseña. No se puede eliminar si hay registros que la usan.</p>' +
      '<label>Contraseña<input id="ubidel_pass" type="password" autocomplete="off"></label>' +
      '<p id="ubidel_err" class="err"></p>' +
      '<div class="bar"><button type="button" id="ubidel_cancel">Volver</button> <button type="button" class="p" id="ubidel_ok" data-ubic="' + esc(codigo) + '">Eliminar</button></div>'
    );
    const pass = $('#ubidel_pass'); if (pass) pass.focus();
    return;
  }

  if (e.target.id === 'ubidel_cancel') { renderUbicaciones(); return; }
  if (e.target.id === 'ubidel_ok') {
    const codigo = e.target.dataset.ubic || '';
    const passEl = $('#ubidel_pass');
    const errEl = $('#ubidel_err');
    const password = passEl ? passEl.value : '';
    if (errEl) errEl.textContent = '';
    if (!password) { if (errEl) errEl.textContent = 'Escribe la contraseña para eliminar.'; return; }
    try {
      await api('/api/ubicaciones/' + encodeURIComponent(codigo), { method: 'DELETE', body: JSON.stringify({ password }) });
      await bootstrap(true);
      renderUbicaciones();
      msg('Ubicación eliminada: ' + codigo);
    } catch (x) {
      if (errEl) errEl.textContent = x.message || 'No se pudo eliminar.';
    }
    return;
  }

  if (e.target.id === 'del_cancel') {
    $('#dk').close();
    return;
  }

  if (e.target.id === 'del_ok') {
    const code = e.target.dataset.delcode || '';
    const passEl = $('#del_pass');
    const errEl = $('#del_err');
    const password = passEl ? passEl.value : '';
    if (errEl) errEl.textContent = '';
    if (!password) {
      if (errEl) errEl.textContent = 'Escribe la contraseña para eliminar.';
      return;
    }
    try {
      await api('/api/items/' + encodeURIComponent(code), { method: 'DELETE', body: JSON.stringify({ password }) });
      $('#dk').close();
      await bootstrap(true);
      msg('Registro eliminado: ' + code);
    } catch (x) {
      if (errEl) errEl.textContent = x.message || 'No se pudo eliminar.';
    }
  }
});

/* ---------- ubicaciones ---------- */
function renderUbicaciones() {
  dlg('Ubicaciones',
    '<p class="sub">Letras y números en mayúscula, sin espacios. Ejemplos: LAB1, R105.</p>' +
    '<div class="bar"><input id="u_c" placeholder="LAB1" style="text-transform:uppercase"><input id="u_n" placeholder="Descripción" style="flex:1"><button id="u_a">Agregar</button></div>' +
    '<p id="ue" class="err"></p>' +
    '<p class="sub">' + ubic.map(u =>
      '<span class="tag">' + esc(u.codigo) + (u.nombre ? ' · ' + esc(u.nombre) : '') +
      ' <button type="button" data-delubic="' + esc(u.codigo) + '" title="Eliminar">×</button></span>'
    ).join(' ') + '</p>'
  );
}
$('#bu').onclick = renderUbicaciones;

/* ---------- exportar ---------- */
$('#bx').onclick = () => { window.location.href = '/api/export.csv'; };

/* ---------- importar Excel ---------- */
$('#bi').onclick = () => $('#fi').click();
const nz = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dstr = v => {
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  return v == null ? '' : String(v).trim();
};

$('#fi').onchange = async ev => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f || busy) return;
  busy = true;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!raw.length) throw new Error('La hoja está vacía');
    const MAP = { codigo:'codigo', nombre:'nombre', marca:'marca', modelo:'modelo', serie:'serie', categoria:'categoria', ubicacion:'ubicacion', cantidad:'cantidad', estado:'estado', custodio:'custodio', fechacompra:'fechaCompra', costo:'costo', costodecompra:'costo', proveedor:'proveedor', lote:'lote', caducidad:'caducidad' };
    dlg('Importando…', '<p>Procesando ' + raw.length + ' filas. No cierres la página.</p>');
    const rows = raw.map(row => {
      const r = {};
      for (const k in row) {
        const m = MAP[nz(k)];
        if (m) r[m] = (m === 'fechaCompra' || m === 'caducidad') ? dstr(row[k]) : row[k];
      }
      // normaliza código/ubicación en texto
      if (r.codigo != null) r.codigo = String(r.codigo).trim();
      if (r.ubicacion != null) r.ubicacion = String(r.ubicacion).trim();
      return r;
    });
    const res = await api('/api/import', { method: 'POST', body: JSON.stringify({ rows }) });
    await bootstrap(true);
    const rep = res.messages || [];
    dlg('Importación terminada',
      '<p><b>' + (res.ok || 0) + '</b> registros importados, <b>' + (res.skip || 0) + '</b> omitidos.</p>' +
      (rep.length ? '<ul style="max-height:260px;overflow:auto">' + rep.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
    );
  } catch (e) {
    const p = e.payload || {};
    const extra = (typeof p.ok === 'number') ? ('<p>Se importaron ' + p.ok + ' registros antes del error.</p>') : '';
    dlg('No se pudo importar', '<p class="err">' + esc(e.message || e) + '</p>' + extra);
  } finally {
    busy = false;
  }
};

(async () => {
  await bootstrap(false);
  setInterval(() => bootstrap(true), 10000);
})();