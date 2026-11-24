-- Base de datos para Inventario y etiquetas del laboratorio
-- Ejecutar en MySQL/MariaDB antes de iniciar la aplicación.

CREATE DATABASE IF NOT EXISTS inventario_laboratorio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE inventario_laboratorio;

CREATE TABLE IF NOT EXISTS catalogo_areas (
  codigo CHAR(3) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalogo_tipos (
  codigo CHAR(2) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalogo_subtipos (
  codigo CHAR(3) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ubicaciones (
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(120) NOT NULL DEFAULT '',
  PRIMARY KEY (codigo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contadores (
  prefijo CHAR(10) NOT NULL, -- formato AAA-TT-SSS
  ultimo_numero INT NOT NULL DEFAULT 0,
  PRIMARY KEY (prefijo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (
  codigo CHAR(15) NOT NULL, -- formato AAA-TT-SSS-0001
  area CHAR(3) NOT NULL,
  tipo CHAR(2) NOT NULL,
  subtipo CHAR(3) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  marca VARCHAR(120) NOT NULL DEFAULT '',
  modelo VARCHAR(120) NOT NULL DEFAULT '',
  serie VARCHAR(120) NOT NULL DEFAULT '',
  categoria VARCHAR(120) NOT NULL DEFAULT '',
  ubicacion VARCHAR(40) NOT NULL DEFAULT '',
  cantidad INT NOT NULL DEFAULT 1,
  estado VARCHAR(30) NOT NULL DEFAULT 'Disponible',
  custodio VARCHAR(120) NOT NULL DEFAULT '',
  fecha_compra DATE NULL,
  costo DECIMAL(12,2) NULL,
  proveedor VARCHAR(120) NOT NULL DEFAULT '',
  lote VARCHAR(120) NOT NULL DEFAULT '',
  caducidad DATE NULL,
  creado DATETIME NOT NULL,
  actualizado DATETIME NOT NULL,
  PRIMARY KEY (codigo),
  CONSTRAINT fk_items_area FOREIGN KEY (area) REFERENCES catalogo_areas(codigo),
  CONSTRAINT fk_items_tipo FOREIGN KEY (tipo) REFERENCES catalogo_tipos(codigo),
  CONSTRAINT fk_items_subtipo FOREIGN KEY (subtipo) REFERENCES catalogo_subtipos(codigo),
  CONSTRAINT chk_items_cantidad CHECK (cantidad >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_items_area ON items(area);
CREATE INDEX idx_items_estado ON items(estado);
CREATE INDEX idx_items_ubicacion ON items(ubicacion);