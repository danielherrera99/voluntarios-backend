const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'diocesis.db.json');

function createInitialSeed() {
  return {
    users: [],
    pastorals: [
      {
        id: 'pas-juvenil',
        code: 'PJ-01',
        name: 'Pastoral Juvenil Diocesana',
        shortName: 'Pastoral Juvenil',
        coordinatorName: 'Fátima Elizabeth Gonzales Fiestas',
        adviserName: 'Pbro. Luis Alberto Vásquez',
        parishCount: 28,
        focusArea: 'Comisión Diocesana de Juventud · Articulación Parroquial',
        status: 'Activa',
        accentColor: '#8D4999',
        description:
          'Comisión Diocesana encargada de acompañar, formar y articular a los grupos juveniles de todas las parroquias y zonas pastorales de la Diócesis de Chiclayo.',
        createdAt: '2024-01-15',
      },
      {
        id: 'pas-vocacional',
        code: 'PV-02',
        name: 'Pastoral Vocacional',
        shortName: 'Vocacional',
        coordinatorName: 'Carlos Eduardo Mera',
        adviserName: 'Pbro. José Manuel Guevara',
        parishCount: 18,
        focusArea: 'Discernimiento Sacerdotal, Consagrado y Laical',
        status: 'Activa',
        accentColor: '#0A6EB4',
        description:
          'Acompañamiento cercano para jóvenes en discernimiento vocacional, jornadas de oración por las vocaciones y encuentros pre-seminario.',
        createdAt: '2024-02-01',
      },
      {
        id: 'pas-catequesis',
        code: 'PC-03',
        name: 'Pastoral de Catequesis y Confirmación',
        shortName: 'Catequesis',
        coordinatorName: 'Lucía del Pilar Tantaleán',
        adviserName: 'Hna. Rosa Elena Quispe',
        parishCount: 34,
        focusArea: 'Iniciación Cristiana y Formación de Catequistas',
        status: 'Activa',
        accentColor: '#109A51',
        description:
          'Escuela diocesana de catequistas jóvenes, materiales formativos para Confirmación y acompañamiento sacramental en parroquias.',
        createdAt: '2024-02-10',
      },
      {
        id: 'pas-universitaria',
        code: 'PU-04',
        name: 'Pastoral Universitaria',
        shortName: 'Universitaria',
        coordinatorName: 'Diego Sebastián Chicoma',
        adviserName: 'Pbro. Martín Requejo',
        parishCount: 9,
        focusArea: 'Universidades e Institutos de Lambayeque',
        status: 'Activa',
        accentColor: '#E6332A',
        description:
          'Presencia evangelizadora en campus universitarios e institutos superiores de Chiclayo y Lambayeque mediante diálogos de fe, cultura y servicio.',
        createdAt: '2024-03-04',
      },
      {
        id: 'pas-social',
        code: 'PS-05',
        name: 'Pastoral Social y Cáritas Juvenil',
        shortName: 'Pastoral Social',
        coordinatorName: 'Andrea Paola Huamán',
        adviserName: 'Diác. Pedro Pablo Larios',
        parishCount: 22,
        focusArea: 'Misiones Solidarias, Ollas Comunes y Ecología Integral',
        status: 'Activa',
        accentColor: '#109A51',
        description:
          'Voluntariado juvenil en zonas vulnerables de Chiclayo, campañas solidarias, visitas a hospitales y brigadas misioneras rurales.',
        createdAt: '2024-03-20',
      },
      {
        id: 'pas-familiar',
        code: 'PF-06',
        name: 'Pastoral Familiar y Noviazgos',
        shortName: 'Pastoral Familiar',
        coordinatorName: 'Mateo & Valeria Silva',
        adviserName: 'Pbro. Jorge Luis Sandoval',
        parishCount: 16,
        focusArea: 'Noviazgos Cristianos y Matrimonios Jóvenes',
        status: 'En Formación',
        accentColor: '#0A6EB4',
        description:
          'Espacios de formación para noviazgos con propósito, preparación matrimonial y acompañamiento a familias jóvenes de la diócesis.',
        createdAt: '2024-05-12',
      },
      {
        id: 'pas-liturgia',
        code: 'PL-07',
        name: 'Pastoral Litúrgica y Coros Juveniles',
        shortName: 'Liturgia y Coros',
        coordinatorName: 'Gabriel Antonio Llontop',
        adviserName: 'Pbro. César Augusto Ñiquen',
        parishCount: 25,
        focusArea: 'Animación Litúrgica, Música Sacra y Acólitos',
        status: 'Activa',
        accentColor: '#8D4999',
        description:
          'Coordinación de coros juveniles diocesanos, formación litúrgica y animación musical de las misas y vigilias diocesanas.',
        createdAt: '2024-06-01',
      },
      {
        id: 'pas-movimientos',
        code: 'PM-08',
        name: 'Movimientos y Grupos Parroquiales',
        shortName: 'Movimientos',
        coordinatorName: 'Fiorella Milagros Bances',
        adviserName: 'Pbro. Luis Alberto Vásquez',
        parishCount: 19,
        focusArea: 'Comunión de Carismas, Emaús, Juan XXIII y Misiones',
        status: 'Activa',
        accentColor: '#E6332A',
        description:
          'Mesa de comunión que integra a los diversos movimientos juveniles, hermandades y grupos parroquiales de nuestra iglesia local.',
        createdAt: '2024-07-08',
      },
    ],
    members: [
      {
        id: 'mem-01',
        fullName: 'Fátima Elizabeth Gonzales Fiestas',
        roleTitle: 'Sub Coordinadora Diocesana',
        pastoralId: 'pas-juvenil',
        parish: 'Catedral Santa María',
        decanato: 'Zona Chiclayo Centro',
        zona: 'Zona Chiclayo Centro',
        phone: '978 412 309',
        email: 'fatima.gonzales@pjchiclayo.org',
        birthDate: '1999-11-28',
        joinedDate: '2020-03-14',
        status: 'Activo',
      },
      {
        id: 'mem-02',
        fullName: 'Kevin Alexander Santisteban',
        roleTitle: 'Coordinador Parroquial Juvenil',
        pastoralId: 'pas-juvenil',
        parish: 'P. San José Obrero',
        decanato: 'Zona Chiclayo Sur',
        zona: 'Zona Chiclayo Sur',
        phone: '945 218 740',
        email: 'kevin.santisteban@pjchiclayo.org',
        birthDate: '2001-11-05',
        joinedDate: '2023-11-05',
        status: 'Activo',
      },
    ],
    prospects: [],
    events: [
      {
        id: 'evt-01',
        title: 'Aniversario Pastoral Juvenil P. San José Obrero (3 Años)',
        pastoralId: 'pas-juvenil',
        parishHost: 'P. San José Obrero',
        eventType: 'Aniversario',
        date: '2026-11-05',
        time: '19:00',
        location: 'Templo Parroquial San José Obrero, Chiclayo',
        capacity: 180,
        registeredCount: 164,
        isPublic: true,
        status: 'Realizado',
        description: 'Misa de acción de gracias y compartir fraterno por los 3 años de servicio y entrega juvenil.',
      },
      {
        id: 'evt-02',
        title: 'Asamblea Diocesana de Coordinadores de Pastoral Juvenil',
        pastoralId: 'pas-juvenil',
        parishHost: 'Catedral Santa María',
        eventType: 'Asamblea',
        date: '2026-12-06',
        time: '09:00',
        location: 'Auditorio Obispado de Chiclayo',
        capacity: 120,
        registeredCount: 88,
        isPublic: true,
        status: 'Programado',
        description: 'Evaluación anual del plan pastoral diocesano 2026 y proyección de misiones de verano 2027.',
      },
      {
        id: 'evt-03',
        title: 'Vigilia Diocesana de la Inmaculada Concepción',
        pastoralId: 'pas-liturgia',
        parishHost: 'Catedral Santa María',
        eventType: 'Jornada',
        date: '2026-12-07',
        time: '20:00',
        location: 'Atrio de la Iglesia Catedral de Chiclayo',
        capacity: 450,
        registeredCount: 310,
        isPublic: true,
        status: 'Programado',
        description: 'Adoración eucarística, animación del Coro Juvenil Diocesano y consagración juvenil a María.',
      },
      {
        id: 'evt-04',
        title: 'Campaña Solidaria Navidad del Niño Lambayecano',
        pastoralId: 'pas-social',
        parishHost: 'P. Nuestra Señora de la Paz',
        eventType: 'Misión',
        date: '2026-12-19',
        time: '08:30',
        location: 'Sectores rurales de Mórrope y Olmos',
        capacity: 90,
        registeredCount: 62,
        isPublic: true,
        status: 'Programado',
        description: 'Jornada misionera juvenil con chocolatada, catequesis navideña y entrega de víveres.',
      },
    ],
    finances: [
      {
        id: 'fin-01',
        date: '2026-11-02',
        type: 'Ingreso',
        pastoralId: 'pas-juvenil',
        concept: 'Aporte parroquial para Asamblea Diocesana',
        category: 'Cuotas Parroquiales',
        amountPen: 1450.0,
        reference: 'REC-2026-041',
        recordedBy: 'Tesorería CDJ',
      },
    ],
    documents: [
      {
        id: 'doc-01',
        title: 'Prospecto General Comisión Diocesana de Juventud 2026–2027',
        docType: 'Prospecto',
        pastoralId: 'pas-juvenil',
        summary: 'Guía institucional con los lineamientos, estructura de zonas pastorales y calendario juvenil.',
        date: '2026-10-15',
        author: 'Comisión Diocesana de Juventud',
      },
    ],
  };
}

let cachedDb = null;

function ensureDb() {
  if (cachedDb) return cachedDb;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialSeed();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    cachedDb = initial;
    return cachedDb;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    cachedDb = JSON.parse(raw);
    return cachedDb;
  } catch (e) {
    const fallback = createInitialSeed();
    cachedDb = fallback;
    return fallback;
  }
}

function getDb() {
  return ensureDb();
}

function saveDb(mutator) {
  const current = ensureDb();
  mutator(current);
  cachedDb = current;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(current, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error guardando diocesis.db.json:', err);
  }
}

function makeId(prefix = 'id') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function findUserByEmail(email) {
  const db = ensureDb();
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

function findUserById(id) {
  const db = ensureDb();
  return db.users.find((u) => u.id === id);
}

module.exports = {
  getDb,
  saveDb,
  makeId,
  findUserByEmail,
  findUserById,
};
