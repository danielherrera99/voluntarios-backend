const xlsx = require('xlsx');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SPREADSHEET_ID = process.env.JERARQUIA_SPREADSHEET_ID || '1Z50oJaX9SfN5oAFAJYR8K51GY0DzvDwk2HQtqrdLSSw';
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=xlsx`;

function cleanDni(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\D/g, '').trim();
  if (s.length < 8 && s.length > 0) return s.padStart(8, '0');
  return s || null;
}

function cleanPhone(p) {
  if (!p) return null;
  const num = String(p).replace(/\D/g, '').trim();
  if (num.length === 9) return num;
  if (num.length > 9 && num.startsWith('51')) return num.slice(2, 11);
  return num || null;
}

function cleanStr(val) {
  if (!val) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

// Descargar Google Sheets como Buffer en memoria
function downloadSheetBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadSheetBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Error descargando Google Sheet (HTTP ${res.statusCode})`));
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', err => reject(err));
    }).on('error', err => reject(err));
  });
}

// Parsear dinámicamente las hojas del libro
async function fetchAndParseGoogleSheets() {
  const buffer = await downloadSheetBuffer(EXPORT_URL);
  const wb = xlsx.read(buffer, { type: 'buffer' });

  const records = [];
  let cuadrillaCounter = 1;

  for (let sIdx = 0; sIdx < wb.SheetNames.length; sIdx++) {
    const sheetName = wb.SheetNames[sIdx];
    if (sheetName === 'SANTA CRUZ') continue; // Omitir hoja vacía

    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    if (!rows || rows.length < 2) continue;

    const row1 = rows[1] || [];

    // Localizar columnas de nombres
    const nameCols = [];
    row1.forEach((val, i) => {
      if (val && String(val).toUpperCase().includes('APELLIDOS')) {
        nameCols.push(i);
      }
    });

    const respCol = nameCols[0] ?? 0;
    const liderCol = nameCols[1] ?? 5;
    const guiaCol = nameCols[2] ?? 10;

    function findCol(start, end, keywords) {
      for (let c = start; c < end; c++) {
        const h = String(row1[c] || '').toUpperCase();
        if (keywords.some(k => h.includes(k))) return c;
      }
      return -1;
    }

    const colMap = {
      resp: {
        nombre: respCol,
        dni: findCol(respCol, liderCol, ['DNI']),
        carta: findCol(respCol, liderCol, ['DOCUMENTOS', 'CARTA']),
        tel: findCol(respCol, liderCol, ['CELULAR', 'TELEF']),
        email: findCol(respCol, liderCol, ['CORREO', 'EMAIL'])
      },
      lider: {
        nombre: liderCol,
        dni: findCol(liderCol, guiaCol, ['DNI']),
        carta: findCol(liderCol, guiaCol, ['DOCUMENTOS', 'CARTA']),
        tel: findCol(liderCol, guiaCol, ['CELULAR', 'TELEF']),
        email: findCol(liderCol, guiaCol, ['CORREO', 'EMAIL'])
      },
      guia: {
        nombre: guiaCol,
        dni: findCol(guiaCol, guiaCol + 7, ['DNI']),
        carta: findCol(guiaCol, guiaCol + 7, ['DOCUMENTOS', 'CARTA']),
        tel: findCol(guiaCol, guiaCol + 7, ['CELULAR', 'TELEF']),
        email: findCol(guiaCol, guiaCol + 7, ['CORREO', 'EMAIL'])
      }
    };

    let currentResp = null;
    let currentLider = null;

    for (let r = 2; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.length === 0) continue;

      // Leer Responsable
      const rNom = cleanStr(row[colMap.resp.nombre]);
      if (rNom && rNom.length > 2 && !rNom.toUpperCase().includes('APELLIDOS')) {
        currentResp = {
          nombre: rNom.toUpperCase(),
          dni: colMap.resp.dni !== -1 ? cleanDni(row[colMap.resp.dni]) : null,
          carta: colMap.resp.carta !== -1 ? (cleanStr(row[colMap.resp.carta])?.toUpperCase() === 'SI' || cleanStr(row[colMap.resp.carta])?.toUpperCase() === 'SÍ') : false,
          telefono: colMap.resp.tel !== -1 ? cleanPhone(row[colMap.resp.tel]) : null,
          correo: colMap.resp.email !== -1 ? cleanStr(row[colMap.resp.email]) : null
        };
      }

      // Leer Líder
      const lNom = cleanStr(row[colMap.lider.nombre]);
      if (lNom && lNom.length > 2 && !lNom.toUpperCase().includes('APELLIDOS')) {
        currentLider = {
          nombre: lNom.toUpperCase(),
          dni: colMap.lider.dni !== -1 ? cleanDni(row[colMap.lider.dni]) : null,
          carta: colMap.lider.carta !== -1 ? (cleanStr(row[colMap.lider.carta])?.toUpperCase() === 'SI' || cleanStr(row[colMap.lider.carta])?.toUpperCase() === 'SÍ') : false,
          telefono: colMap.lider.tel !== -1 ? cleanPhone(row[colMap.lider.tel]) : null,
          correo: colMap.lider.email !== -1 ? cleanStr(row[colMap.lider.email]) : null
        };
      }

      // Leer Guía
      const gNom = cleanStr(row[colMap.guia.nombre]);
      if (gNom && gNom.length > 2 && !gNom.toUpperCase().includes('APELLIDOS')) {
        const gDni = colMap.guia.dni !== -1 ? cleanDni(row[colMap.guia.dni]) : null;
        const gCarta = colMap.guia.carta !== -1 ? (cleanStr(row[colMap.guia.carta])?.toUpperCase() === 'SI' || cleanStr(row[colMap.guia.carta])?.toUpperCase() === 'SÍ') : false;
        const gTel = colMap.guia.tel !== -1 ? cleanPhone(row[colMap.guia.tel]) : null;
        const gEmail = colMap.guia.email !== -1 ? cleanStr(row[colMap.guia.email]) : null;

        const rowStr = row.map(c => String(c || '').toUpperCase()).join(' ');
        if (rowStr.includes('NO CONTINUA') && !gDni && !gTel) continue;

        const cuadrillaCodigo = `CUA-${String(cuadrillaCounter).padStart(3, '0')}`;
        cuadrillaCounter++;

        records.push({
          cuadrilla_codigo: cuadrillaCodigo,
          responsable_nombre: currentResp ? currentResp.nombre : sheetName.toUpperCase(),
          responsable_dni: currentResp ? currentResp.dni : null,
          responsable_carta: currentResp ? currentResp.carta : false,
          responsable_telefono: currentResp ? currentResp.telefono : null,
          responsable_correo: currentResp ? currentResp.correo : null,

          lider_nombre: currentLider ? currentLider.nombre : (currentResp ? currentResp.nombre : sheetName.toUpperCase()),
          lider_dni: currentLider ? currentLider.dni : null,
          lider_carta: currentLider ? currentLider.carta : false,
          lider_telefono: currentLider ? currentLider.telefono : null,
          lider_correo: currentLider ? currentLider.correo : null,

          guia_nombre: gNom.toUpperCase(),
          guia_dni: gDni,
          guia_carta: gCarta,
          guia_telefono: gTel,
          guia_correo: gEmail,
          total_voluntarios: 9
        });
      }
    }
  }

  return records;
}

// Comparar lo descargado contra la base de datos actual (Diff Report)
function compareHierarchy(newRecords, currentDbRecords) {
  // Mapa de BD actual por clave única: preferir DNI, o nombre si no hay DNI
  const dbMapByDni = new Map();
  const dbMapByName = new Map();

  currentDbRecords.forEach(r => {
    if (r.guia_dni) dbMapByDni.set(r.guia_dni, r);
    dbMapByName.set(r.guia_nombre, r);
  });

  const newMapByDni = new Map();
  const newMapByName = new Map();

  newRecords.forEach(r => {
    if (r.guia_dni) newMapByDni.set(r.guia_dni, r);
    newMapByName.set(r.guia_nombre, r);
  });

  const nuevos = [];
  const modificados = [];
  const eliminados = [];

  // Detectar nuevos y modificados
  newRecords.forEach(n => {
    const existing = (n.guia_dni && dbMapByDni.get(n.guia_dni)) || dbMapByName.get(n.guia_nombre);

    if (!existing) {
      nuevos.push({
        guia_nombre: n.guia_nombre,
        guia_dni: n.guia_dni,
        guia_telefono: n.guia_telefono,
        lider_nombre: n.lider_nombre,
        responsable_nombre: n.responsable_nombre
      });
    } else {
      const cambios = [];
      if (n.guia_telefono !== existing.guia_telefono) {
        cambios.push(`Teléfono: ${existing.guia_telefono || 'Sin tel'} ➔ ${n.guia_telefono || 'Sin tel'}`);
      }
      if (n.guia_correo !== existing.guia_correo) {
        cambios.push(`Correo: ${existing.guia_correo || 'Sin correo'} ➔ ${n.guia_correo || 'Sin correo'}`);
      }
      if (n.guia_dni !== existing.guia_dni) {
        cambios.push(`DNI: ${existing.guia_dni || '-'} ➔ ${n.guia_dni || '-'}`);
      }
      if (n.lider_nombre !== existing.lider_nombre) {
        cambios.push(`Líder: ${existing.lider_nombre} ➔ ${n.lider_nombre}`);
      }
      if (n.guia_carta !== existing.guia_carta) {
        cambios.push(`Carta: ${existing.guia_carta ? 'SÍ' : 'NO'} ➔ ${n.guia_carta ? 'SÍ' : 'NO'}`);
      }

      if (cambios.length > 0) {
        modificados.push({
          guia_nombre: n.guia_nombre,
          guia_dni: n.guia_dni,
          lider_nombre: n.lider_nombre,
          cambios
        });
      }
    }
  });

  // Detectar eliminados
  currentDbRecords.forEach(c => {
    const stillExists = (c.guia_dni && newMapByDni.has(c.guia_dni)) || newMapByName.has(c.guia_nombre);
    if (!stillExists) {
      eliminados.push({
        guia_nombre: c.guia_nombre,
        guia_dni: c.guia_dni,
        lider_nombre: c.lider_nombre,
        responsable_nombre: c.responsable_nombre
      });
    }
  });

  // Estadísticas de líderes
  const currentLideres = new Set(currentDbRecords.map(r => r.lider_nombre));
  const newLideres = new Set(newRecords.map(r => r.lider_nombre));

  const lideresNuevos = [...newLideres].filter(l => !currentLideres.has(l));
  const lideresEliminados = [...currentLideres].filter(l => !newLideres.has(l));

  const hayCambios = nuevos.length > 0 || eliminados.length > 0 || modificados.length > 0;

  return {
    totalActual: currentDbRecords.length,
    totalNuevo: newRecords.length,
    totalResponsablesNuevo: new Set(newRecords.map(r => r.responsable_nombre)).size,
    totalLideresNuevo: newLideres.size,
    hayCambios,
    resumen: {
      totalNuevos: nuevos.length,
      totalEliminados: eliminados.length,
      totalModificados: modificados.length,
      totalLideresNuevos: lideresNuevos.length,
      totalLideresEliminados: lideresEliminados.length
    },
    nuevos,
    eliminados,
    modificados,
    lideresNuevos,
    lideresEliminados
  };
}

module.exports = {
  fetchAndParseGoogleSheets,
  compareHierarchy
};
