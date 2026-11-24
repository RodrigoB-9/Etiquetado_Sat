import csv
import io
import os
import re
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import mysql.connector
from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "inventario_laboratorio"),
}

ESTADOS = ["Disponible", "En uso", "En mantenimiento", "Dañado", "Baja"]
RX_CODIGO = re.compile(r"^[A-Z]{3}-[A-Z]{2}-[A-Z]{3}-\d{4}$")
RX_UBIC = re.compile(r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$")
RX_AREA = re.compile(r"^[A-Z]{3}$")
RX_TIPO = re.compile(r"^[A-Z]{2}$")
RX_SUB = re.compile(r"^[A-Z]{3}$")

CAMPOS_ITEM = [
    "nombre", "marca", "modelo", "serie", "categoria", "ubicacion",
    "cantidad", "estado", "custodio", "fecha_compra", "costo",
    "proveedor", "lote", "caducidad",
]
CAMPOS_EXPORT = [
    "codigo", "nombre", "marca", "modelo", "serie", "categoria", "ubicacion",
    "cantidad", "estado", "custodio", "fecha_compra", "costo", "proveedor",
    "lote", "caducidad",
]


def conectar():
    return mysql.connector.connect(**DB_CONFIG)


@contextmanager
def obtener_bd():
    conn = conectar()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def consultar_todos(sql, params=None):
    conn = conectar()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params or ())
        return cur.fetchall()
    finally:
        conn.close()


def formatear_fecha(valor):
    if valor is None:
        return ""
    if isinstance(valor, (datetime, date)):
        return valor.strftime("%Y-%m-%d")
    return str(valor)


def formatear_costo(valor):
    if valor is None:
        return ""
    if isinstance(valor, Decimal):
        txt = format(valor, "f")
        if "." in txt:
            txt = txt.rstrip("0").rstrip(".")
        return txt
    return str(valor)


def serializar_item(fila):
    return {
        "codigo": fila["codigo"],
        "area": fila["area"],
        "tipo": fila["tipo"],
        "subtipo": fila["subtipo"],
        "nombre": fila["nombre"],
        "marca": fila["marca"] or "",
        "modelo": fila["modelo"] or "",
        "serie": fila["serie"] or "",
        "categoria": fila["categoria"] or "",
        "ubicacion": fila["ubicacion"] or "",
        "cantidad": fila["cantidad"],
        "estado": fila["estado"],
        "custodio": fila["custodio"] or "",
        "fechaCompra": formatear_fecha(fila.get("fecha_compra")),
        "costo": formatear_costo(fila.get("costo")),
        "proveedor": fila["proveedor"] or "",
        "lote": fila["lote"] or "",
        "caducidad": formatear_fecha(fila.get("caducidad")),
        "creado": fila["creado"].isoformat(sep=" ", timespec="seconds") if fila.get("creado") else "",
        "actualizado": fila["actualizado"].isoformat(sep=" ", timespec="seconds") if fila.get("actualizado") else "",
    }


def cargar_catalogos(cur):
    cur.execute("SELECT codigo, nombre FROM catalogo_areas")
    areas = {r["codigo"]: r["nombre"] for r in cur.fetchall()}
    cur.execute("SELECT codigo, nombre FROM catalogo_tipos")
    tipos = {r["codigo"]: r["nombre"] for r in cur.fetchall()}
    cur.execute("SELECT codigo, nombre FROM catalogo_subtipos")
    subtipos = {r["codigo"]: r["nombre"] for r in cur.fetchall()}
    return {"areas": areas, "tipos": tipos, "subtipos": subtipos}


def cargar_ubicaciones(cur):
    cur.execute("SELECT codigo, nombre FROM ubicaciones ORDER BY codigo")
    return [{"codigo": r["codigo"], "nombre": r["nombre"] or ""} for r in cur.fetchall()]


def parsear_fecha(valor, nombre):
    if valor in (None, ""):
        return None
    if isinstance(valor, str):
        valor = valor.strip()
        if not valor:
            return None
        try:
            return datetime.strptime(valor, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"{nombre} debe tener formato AAAA-MM-DD")
    raise ValueError(f"{nombre} no es válida")


def validar_y_normalizar_item(data, ubicaciones_validas, parcial=False):
    out = {}
    texto_campos = ["nombre", "marca", "modelo", "serie", "categoria", "ubicacion", "custodio", "proveedor", "lote", "estado"]
    for campo in texto_campos:
        if campo in data or not parcial:
            valor = data.get(campo, "")
            if valor is None:
                valor = ""
            if not isinstance(valor, str):
                valor = str(valor)
            out[campo] = valor.strip()

    # cantidad
    if "cantidad" in data or not parcial:
        raw_cant = data.get("cantidad", 1)
        if raw_cant == "" or raw_cant is None:
            raise ValueError("La cantidad debe ser un número entero (1 o más)")
        try:
            cant_num = float(raw_cant)
            if not cant_num.is_integer():
                raise ValueError()
            cant = int(cant_num)
        except Exception:
            raise ValueError("La cantidad debe ser un número entero (1 o más)")
        if cant < 1:
            raise ValueError("La cantidad debe ser un número entero (1 o más)")
        out["cantidad"] = cant

    estado = out.get("estado") or "Disponible"
    if estado not in ESTADOS:
        raise ValueError("Estado no reconocido")
    out["estado"] = estado

    
    obligatorios = [
        ("nombre", "El nombre es obligatorio"),
        ("marca", "La marca es obligatoria"),
        ("modelo", "El modelo es obligatorio"),
        ("serie", "La serie es obligatoria"),
        ("categoria", "La categoría es obligatoria"),
        ("proveedor", "El proveedor es obligatorio"),
        ("lote", "El lote es obligatorio"),
    ]
    for campo, msg in obligatorios:
        if not out.get(campo, "").strip():
            raise ValueError(msg)
    out["custodio"] = out.get("custodio", "").strip()

    ubic = out.get("ubicacion", "").strip().upper()
    if not ubic:
        raise ValueError("La ubicación es obligatoria")
    if ubic not in ubicaciones_validas:
        raise ValueError("La ubicación no existe en el catálogo de ubicaciones")
    out["ubicacion"] = ubic

    fecha_compra_raw = data.get("fecha_compra", data.get("fechaCompra", ""))
    caducidad_raw = data.get("caducidad", "")
    if fecha_compra_raw in (None, ""):
        raise ValueError("La fecha de compra es obligatoria")
    fecha_compra = parsear_fecha(fecha_compra_raw, "La fecha de compra")
    caducidad = parsear_fecha(caducidad_raw, "La caducidad") if caducidad_raw not in (None, "") else None
    if fecha_compra and caducidad and caducidad < fecha_compra:
        raise ValueError("La caducidad no puede ser anterior a la fecha de compra")
    out["fecha_compra"] = fecha_compra
    out["caducidad"] = caducidad

    raw_costo = data.get("costo", "")
    if raw_costo in (None, ""):
        raise ValueError("El costo de compra es obligatorio")
    try:
        costo = Decimal(str(raw_costo))
    except (InvalidOperation, ValueError):
        raise ValueError("El costo debe ser un número válido")
    if costo < 0:
        raise ValueError("El costo debe ser un número válido")
    out["costo"] = costo

    return out


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/bootstrap")
def api_bootstrap():
    conn = conectar()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM items ORDER BY codigo")
        items = [serializar_item(r) for r in cur.fetchall()]
        cfg = cargar_catalogos(cur)
        ubicaciones = cargar_ubicaciones(cur)
        return jsonify({"items": items, "cfg": cfg, "ubicaciones": ubicaciones})
    finally:
        conn.close()


@app.post("/api/items")
def api_crear_item():
    data = request.get_json(silent=True) or {}
    area = (data.get("area") or "").strip().upper()
    tipo = (data.get("tipo") or "").strip().upper()
    subtipo = (data.get("subtipo") or "").strip().upper()
    if not (RX_AREA.match(area) and RX_TIPO.match(tipo) and RX_SUB.match(subtipo)):
        return jsonify({"error": "Elige área, tipo y subtipo válidos"}), 400
    prefijo = f"{area}-{tipo}-{subtipo}"

    try:
        with obtener_bd() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT 1 FROM catalogo_areas WHERE codigo=%s", (area,))
            if not cur.fetchone():
                return jsonify({"error": "El área no existe en el catálogo"}), 400
            cur.execute("SELECT 1 FROM catalogo_tipos WHERE codigo=%s", (tipo,))
            if not cur.fetchone():
                return jsonify({"error": "El tipo no existe en el catálogo"}), 400
            cur.execute("SELECT 1 FROM catalogo_subtipos WHERE codigo=%s", (subtipo,))
            if not cur.fetchone():
                return jsonify({"error": "El subtipo no existe en el catálogo"}), 400

            cur.execute("SELECT codigo FROM ubicaciones")
            ubicaciones_validas = {r["codigo"] for r in cur.fetchall()}
            try:
                campos = validar_y_normalizar_item(data, ubicaciones_validas)
            except ValueError as e:
                return jsonify({"error": str(e)}), 400

            unidades = int(campos.get("cantidad", 1))
            if unidades < 1:
                return jsonify({"error": "La cantidad debe ser un número entero (1 o más)"}), 400
            if unidades > 9999:
                return jsonify({"error": "La cantidad solicitada es demasiado alta"}), 400

            
            cur.execute("SELECT ultimo_numero FROM contadores WHERE prefijo=%s FOR UPDATE", (prefijo,))
            row = cur.fetchone()
            n = row["ultimo_numero"] if row else 0
            codigos = []
            for _ in range(unidades):
                codigo = None
                while True:
                    n += 1
                    if n > 9999:
                        return jsonify({"error": f"Se agotaron los correlativos de {prefijo}"}), 400
                    candidato = f"{prefijo}-{n:04d}"
                    cur.execute("SELECT 1 FROM items WHERE codigo=%s", (candidato,))
                    if not cur.fetchone():
                        codigo = candidato
                        break
                codigos.append(codigo)

            if row:
                cur.execute("UPDATE contadores SET ultimo_numero=%s WHERE prefijo=%s", (n, prefijo))
            else:
                cur.execute("INSERT INTO contadores (prefijo, ultimo_numero) VALUES (%s, %s)", (prefijo, n))

            ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            for codigo in codigos:
                cur.execute(
                    """
                    INSERT INTO items (
                        codigo, area, tipo, subtipo, nombre, marca, modelo, serie, categoria,
                        ubicacion, cantidad, estado, custodio, fecha_compra, costo, proveedor,
                        lote, caducidad, creado, actualizado
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        codigo, area, tipo, subtipo,
                        campos["nombre"], campos["marca"], campos["modelo"], campos["serie"], campos["categoria"],
                        campos["ubicacion"], 1, campos["estado"], campos["custodio"],
                        campos["fecha_compra"], campos["costo"], campos["proveedor"],
                        campos["lote"], campos["caducidad"], ahora, ahora,
                    ),
                )
        return jsonify({"ok": True, "codigos": codigos})
    except mysql.connector.Error as e:
        return jsonify({"error": f"Error de base de datos: {e.msg}"}), 500


@app.post("/api/catalogos")
def api_agregar_catalogo():
    data = request.get_json(silent=True) or {}
    kind = (data.get("kind") or "").strip()
    key = (data.get("key") or "").strip().upper()
    value = (data.get("value") or "").strip()
    reglas = {
        "areas": (RX_AREA, "catalogo_areas", "3 letras mayúsculas"),
        "tipos": (RX_TIPO, "catalogo_tipos", "2 letras mayúsculas"),
        "subtipos": (RX_SUB, "catalogo_subtipos", "3 letras mayúsculas"),
    }
    if kind not in reglas:
        return jsonify({"error": "Tipo de catálogo inválido"}), 400
    rx, tabla, desc = reglas[kind]
    if not rx.match(key):
        return jsonify({"error": f"Las siglas deben ser {desc} sin acentos"}), 400
    if not value:
        return jsonify({"error": "Escribe el nombre"}), 400
    try:
        with obtener_bd() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute(f"SELECT 1 FROM {tabla} WHERE codigo=%s", (key,))
            if cur.fetchone():
                return jsonify({"error": "Esas siglas ya existen"}), 400
            cur.execute(f"INSERT INTO {tabla} (codigo, nombre) VALUES (%s, %s)", (key, value))
        return jsonify({"ok": True})
    except mysql.connector.Error as e:
        return jsonify({"error": f"Error de base de datos: {e.msg}"}), 500


@app.post("/api/ubicaciones")
def api_agregar_ubicacion():
    data = request.get_json(silent=True) or {}
    codigo = (data.get("codigo") or "").strip().upper()
    nombre = (data.get("nombre") or "").strip()
    if not RX_UBIC.match(codigo):
        return jsonify({"error": "Código inválido. Usa solo letras y números, sin espacios (ej. LAB1)."}), 400
    try:
        with obtener_bd() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT 1 FROM ubicaciones WHERE codigo=%s", (codigo,))
            if cur.fetchone():
                return jsonify({"error": "Esa ubicación ya existe"}), 400
            cur.execute("INSERT INTO ubicaciones (codigo, nombre) VALUES (%s, %s)", (codigo, nombre))
        return jsonify({"ok": True})
    except mysql.connector.Error as e:
        return jsonify({"error": f"Error de base de datos: {e.msg}"}), 500



@app.delete("/api/catalogos/<kind>/<key>")
def api_eliminar_catalogo(kind, key):
    data = request.get_json(silent=True) or {}
    if data.get("password") != DELETE_PASSWORD:
        return jsonify({"error": "Contrase\u00f1a incorrecta"}), 403
    kind = (kind or "").strip()
    key = (key or "").strip().upper()
    reglas = {
        "areas": (RX_AREA, "catalogo_areas"),
        "tipos": (RX_TIPO, "catalogo_tipos"),
        "subtipos": (RX_SUB, "catalogo_subtipos"),
    }
    if kind not in reglas:
        return jsonify({"error": "Tipo de categor\u00eda inv\u00e1lido"}), 400
    rx, tabla = reglas[kind]
    if not rx.match(key):
        return jsonify({"error": "C\u00f3digo inv\u00e1lido"}), 400
    try:
        with obtener_bd() as conn:
            cur = conn.cursor()
            cur.execute(f"DELETE FROM {tabla} WHERE codigo=%s", (key,))
            if cur.rowcount == 0:
                return jsonify({"error": "La categor\u00eda no existe"}), 404
        return jsonify({"ok": True})
    except mysql.connector.Error as e:
        if getattr(e, "errno", None) == 1451 or isinstance(e, mysql.connector.IntegrityError):
            return jsonify({"error": "No se puede eliminar porque hay registros que la usan"}), 409
        return jsonify({"error": f"Error de base de datos: {e.msg}"}), 500


@app.delete("/api/ubicaciones/<codigo>")
def api_eliminar_ubicacion(codigo):
    data = request.get_json(silent=True) or {}
    if data.get("password") != DELETE_PASSWORD:
        return jsonify({"error": "Contrase\u00f1a incorrecta"}), 403
    codigo = (codigo or "").strip().upper()
    if not RX_UBIC.match(codigo):
        return jsonify({"error": "C\u00f3digo inv\u00e1lido"}), 400
    try:
        with obtener_bd() as conn:
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT 1 FROM items WHERE ubicacion=%s LIMIT 1", (codigo,))
            if cur.fetchone():
                return jsonify({"error": "No se puede eliminar porque hay registros que usan esta ubicaci\u00f3n"}), 409
            cur.execute("DELETE FROM ubicaciones WHERE codigo=%s", (codigo,))
            if cur.rowcount == 0:
                return jsonify({"error": "La ubicaci\u00f3n no existe"}), 404
        return jsonify({"ok": True})
    except mysql.connector.Error as e:
        return jsonify({"error": f"Error de base de datos: {e.msg}"}), 500


def csv_celda(valor):
    v = "" if valor is None else str(valor)
    if re.match(r"^[=+\-@]", v) and not re.match(r"^-?\d+(\.\d+)?$", v):
        v = "'" + v
    return '"' + v.replace('"', '""') + '"'


@app.get("/api/export.csv")
def api_exportar_csv():
    filas = consultar_todos("SELECT * FROM items ORDER BY codigo")
    lineas = [",".join(CAMPOS_EXPORT)]
    for f in filas:
        item = serializar_item(f)
        lineas.append(",".join(csv_celda(item.get(c, "")) for c in CAMPOS_EXPORT))
    contenido = "\ufeff" + "\r\n".join(lineas)
    return Response(
        contenido,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=inventario.csv"},
    )


def normalizar_estado_import(valor):
    if valor is None or str(valor).strip() == "":
        return "Disponible"
    txt = str(valor).strip().lower()
    for e in ESTADOS:
        if e.lower() == txt:
            return e
    return None


@app.post("/api/import")
def api_importar():
    payload = request.get_json(silent=True) or {}
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return jsonify({"error": "Formato de importación inválido"}), 400

    ok = 0
    skip = 0
    mensajes = []
    max_por_prefijo = {}

    try:
        with obtener_bd() as conn:
            cur = conn.cursor(dictionary=True)
            cfg = cargar_catalogos(cur)
            cur.execute("SELECT codigo FROM ubicaciones")
            ubic_set = {r["codigo"] for r in cur.fetchall()}

            for idx, row in enumerate(rows, start=2):  # fila 1 = encabezados
                if not isinstance(row, dict):
                    row = {}
                code = str(row.get("codigo") or "").strip().upper()
                nombre = str(row.get("nombre") or "").strip()

                if not code and not nombre:
                    continue

                def rechazar(motivo):
                    nonlocal skip
                    skip += 1
                    suf = f" ({code})" if code else ""
                    mensajes.append(f"Fila {idx}{suf}: {motivo}")

                if not RX_CODIGO.match(code):
                    rechazar("código vacío o con formato inválido")
                    continue
                a, t, s, c = code.split("-")
                if a not in cfg["areas"] or t not in cfg["tipos"] or s not in cfg["subtipos"]:
                    rechazar("área, tipo o subtipo no existen en los catálogos")
                    continue
                if not nombre:
                    rechazar("falta el nombre")
                    continue

                raw_cant = row.get("cantidad", 1)
                if raw_cant == "" or raw_cant is None:
                    cant = 1
                else:
                    try:
                        cant_num = float(raw_cant) if not isinstance(raw_cant, bool) else None
                        if cant_num is None or not cant_num.is_integer():
                            raise ValueError()
                        cant = int(cant_num)
                    except Exception:
                        rechazar("cantidad inválida")
                        continue
                if cant < 0:
                    rechazar("cantidad inválida")
                    continue

                estado = normalizar_estado_import(row.get("estado"))
                if estado is None:
                    rechazar(f"estado no reconocido: {row.get('estado')}")
                    continue

                raw_costo = row.get("costo", "")
                if raw_costo in (None, ""):
                    costo = None
                else:
                    try:
                        costo = Decimal(str(raw_costo))
                        if costo < 0:
                            raise ValueError()
                    except Exception:
                        rechazar("costo inválido")
                        continue

                ub = str(row.get("ubicacion") or "").strip().upper()
                if ub:
                    if not RX_UBIC.match(ub):
                        rechazar("ubicación con formato inválido")
                        continue
                    if ub not in ubic_set:
                        cur.execute("INSERT INTO ubicaciones (codigo, nombre) VALUES (%s, %s)", (ub, ""))
                        ubic_set.add(ub)

                try:
                    fecha_compra = parsear_fecha(row.get("fechaCompra") or row.get("fecha_compra") or "", "fechaCompra") if (row.get("fechaCompra") or row.get("fecha_compra")) not in (None, "") else None
                    caducidad = parsear_fecha(row.get("caducidad") or "", "caducidad") if row.get("caducidad") not in (None, "") else None
                except ValueError:
                    
                    fecha_compra = None
                    caducidad = None
                if fecha_compra and caducidad and caducidad < fecha_compra:
                    caducidad = caducidad  

                cur.execute("SELECT 1 FROM items WHERE codigo=%s", (code,))
                if cur.fetchone():
                    rechazar("ya existe, no se sobrescribe")
                    continue

                ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                def T(x):
                    return "" if x is None else str(x).strip()

                cur.execute(
                    """
                    INSERT INTO items (
                        codigo, area, tipo, subtipo, nombre, marca, modelo, serie, categoria,
                        ubicacion, cantidad, estado, custodio, fecha_compra, costo, proveedor,
                        lote, caducidad, creado, actualizado
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        code, a, t, s, nombre, T(row.get("marca")), T(row.get("modelo")),
                        T(row.get("serie")), T(row.get("categoria")), ub, cant, estado,
                        T(row.get("custodio")), fecha_compra, costo, T(row.get("proveedor")),
                        T(row.get("lote")), caducidad, ahora, ahora,
                    ),
                )
                prefijo = f"{a}-{t}-{s}"
                corr = int(c)
                if corr > max_por_prefijo.get(prefijo, 0):
                    max_por_prefijo[prefijo] = corr
                ok += 1

            for prefijo, max_n in max_por_prefijo.items():
                cur.execute("SELECT ultimo_numero FROM contadores WHERE prefijo=%s FOR UPDATE", (prefijo,))
                r = cur.fetchone()
                if r:
                    if int(r["ultimo_numero"]) < max_n:
                        cur.execute("UPDATE contadores SET ultimo_numero=%s WHERE prefijo=%s", (max_n, prefijo))
                else:
                    cur.execute("INSERT INTO contadores (prefijo, ultimo_numero) VALUES (%s, %s)", (prefijo, max_n))

        return jsonify({"ok": ok, "skip": skip, "messages": mensajes})
    except mysql.connector.Error as e:
        return jsonify({"error": f"Error de base de datos: {e.msg}", "ok": ok, "skip": skip, "messages": mensajes}), 500



DELETE_PASSWORD = "BORRAR2026!"


@app.delete("/api/items/<codigo>")
def api_eliminar_item(codigo):
    codigo = (codigo or "").strip().upper()
    if not RX_CODIGO.match(codigo):
        return jsonify({"error": "Código inválido"}), 400
    data = request.get_json(silent=True) or {}
    if data.get("password") != DELETE_PASSWORD:
        return jsonify({"error": "Contraseña incorrecta"}), 403
    try:
        with obtener_bd() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM items WHERE codigo=%s", (codigo,))
            if cur.rowcount == 0:
                return jsonify({"error": "El registro no existe"}), 404
        return jsonify({"ok": True})
    except mysql.connector.Error as e:
        return jsonify({"error": f"Error de base de datos: {e.msg}"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)