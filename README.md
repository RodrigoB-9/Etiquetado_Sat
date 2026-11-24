# Inventario y etiquetas del laboratorio (Flask + MySQL)

Aplicación web que conserva la misma funcionalidad del HTML original de inventario/etiquetas, pero guarda la información en una base de datos **MySQL/MariaDB** para que pueda consultarse y editarse desde distintas computadoras sin perder datos.

## Archivos

- `app.py`: servidor Python (Flask) y API.
- `crear_bd.sql`: script para crear la base de datos y tablas.
- `templates/index.html`: interfaz principal.
- `static/style.css`: estilos.
- `static/app.js`: lógica de interfaz (búsqueda, formularios, etiquetas/QR, importación y exportación).
- `requirements.txt`: dependencias de Python.

## Requisitos

- Python 3.10+
- MySQL o MariaDB accesible desde las computadoras que usarán la app

## Instalación

1. Crear la base de datos (en el servidor MySQL):
   ```sql
   SOURCE crear_bd.sql;
   ```
   o ejecutar el contenido de `crear_bd.sql` desde phpMyAdmin/MySQL Workbench.

2. Instalar dependencias:
   ```bash
   pip install -r requirements.txt
   ```

3. Configurar la conexión a la base de datos (variables de entorno). Valores por defecto:
   - `DB_HOST=localhost`
   - `DB_PORT=3306`
   - `DB_USER=root`
   - `DB_PASSWORD=` (vacío)
   - `DB_NAME=inventario_laboratorio`

   Ejemplo en PowerShell (apuntando a un servidor MySQL en la red):
   ```powershell
   $env:DB_HOST="192.168.1.50"
   $env:DB_USER="inventario"
   $env:DB_PASSWORD="tu_clave"
   $env:DB_NAME="inventario_laboratorio"
   ```

4. Ejecutar la aplicación:
   ```bash
   python app.py
   ```
   Por defecto escucha en `http://0.0.0.0:5000`.

## Acceso desde otras computadoras

- Instala/ejecuta MySQL en una computadora o servidor accesible por la red y crea allí la base de datos con `crear_bd.sql`.
- En cada equipo donde corra `app.py`, configura `DB_HOST` con la IP o nombre del servidor MySQL.
- Abre el puerto 3306 en el servidor MySQL (solo dentro de la red de confianza) y permite el usuario de base de datos para conexiones remotas.
- Para usar la interfaz desde otros equipos, entra desde el navegador a `http://IP_DEL_EQUIPO_QUE_EJECUTA_APP:5000`.

## Funcionalidad incluida

- Búsqueda y filtros por área/estado.
- Alta y edición de registros con código automático `ÁREA-TIPO-SUBTIPO-0001` (correlativo sin reutilización).
- Catálogos de áreas, tipos y subtipos; y catálogo de ubicaciones.
- Generación de etiqueta con código QR e impresión.
- Exportación a CSV.
- Importación desde Excel/CSV (`.xlsx`, `.xls`, `.csv`) con validaciones y reporte de omitidos.
- Los datos se guardan en MySQL, por lo que permanecen disponibles entre equipos y sesiones.