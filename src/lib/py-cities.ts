/**
 * Ciudades (distritos) de Paraguay con su departamento.
 * Solo geografía: NO define cobertura ni forma de pago (eso sale del
 * entrenamiento de cada vendedor). Sirve para reconocer que lo que escribió
 * el cliente es una CIUDAD real y no un barrio.
 */
export type PyCity = { city: string; department: string };

const RAW: Record<string, string[]> = {
  "Capital": ["Asunción"],
  "Central": [
    "Areguá", "Capiatá", "Fernando de la Mora", "Guarambaré", "Itá", "Itauguá", "J. Augusto Saldívar",
    "Lambaré", "Limpio", "Luque", "Mariano Roque Alonso", "Nueva Italia", "Ñemby", "San Antonio",
    "San Lorenzo", "Villa Elisa", "Villeta", "Ypacaraí", "Ypané",
  ],
  "Concepción": [
    "Concepción", "Belén", "Horqueta", "Loreto", "San Carlos del Apa", "San Lázaro", "Yby Yaú", "Azotey",
    "Sargento José Félix López", "San Alfredo", "Paso Barreto", "Arroyito",
  ],
  "San Pedro": [
    "San Pedro del Ycuamandiyú", "Antequera", "Choré", "General Elizardo Aquino", "Itacurubí del Rosario", "Lima",
    "Nueva Germania", "San Estanislao", "San Pablo", "Tacuatí", "Unión", "25 de Diciembre", "Villa del Rosario",
    "General Francisco Isidoro Resquín", "Yataity del Norte", "Guayaibí", "Capiibary", "Santa Rosa del Aguaray",
    "Yrybucuá", "Liberación", "San Vicente Pancholo", "San José del Rosario",
  ],
  "Cordillera": [
    "Caacupé", "Altos", "Arroyos y Esteros", "Atyrá", "Caraguatay", "Emboscada", "Eusebio Ayala", "Isla Pucú",
    "Itacurubí de la Cordillera", "Juan de Mena", "Loma Grande", "Mbocayaty del Yhaguy", "Nueva Colombia",
    "Piribebuy", "Primero de Marzo", "San Bernardino", "San José Obrero", "Santa Elena", "Tobatí", "Valenzuela",
  ],
  "Guairá": [
    "Villarrica", "Borja", "Mauricio José Troche", "Coronel Martínez", "Félix Pérez Cardozo",
    "General Eugenio A. Garay", "Colonia Independencia", "Independencia", "Itapé", "Iturbe", "José A. Fassardi",
    "Mbocayaty", "Natalicio Talavera", "Ñumí", "San Salvador", "Yataity", "Doctor Bottrell", "Paso Yobái", "Tebicuary",
  ],
  "Caaguazú": [
    "Coronel Oviedo", "Caaguazú", "Carayaó", "Doctor Cecilio Báez", "Santa Rosa del Mbutuy", "Doctor Juan Manuel Frutos",
    "Repatriación", "Nueva Londres", "San Joaquín", "San José de los Arroyos", "Yhú", "Doctor Juan Eulogio Estigarribia",
    "R. I. 3 Corrales", "Raúl Arsenio Oviedo", "José Domingo Ocampos", "Mariscal Francisco Solano López",
    "La Pastora", "3 de Febrero", "Simón Bolívar", "Vaquería", "Tembiaporá", "Nueva Toledo",
  ],
  "Caazapá": [
    "Caazapá", "Abaí", "Buena Vista", "Doctor Moisés S. Bertoni", "General Higinio Morínigo", "Maciel",
    "San Juan Nepomuceno", "Tavaí", "Yegros", "Yuty", "3 de Mayo",
  ],
  "Itapúa": [
    "Encarnación", "Alto Verá", "Bella Vista", "Cambyretá", "Capitán Meza", "Capitán Miranda", "Carlos Antonio López",
    "Carmen del Paraná", "Coronel Bogado", "Edelira", "Fram", "General Artigas", "General Delgado", "Hohenau",
    "Itapúa Poty", "Jesús", "José Leandro Oviedo", "La Paz", "Mayor Julio D. Otaño", "Natalio", "Nueva Alborada",
    "Obligado", "Pirapó", "San Cosme y Damián", "San Juan del Paraná", "San Pedro del Paraná", "San Rafael del Paraná",
    "Tomás Romero Pereira", "Trinidad", "Yatytay",
  ],
  "Misiones": [
    "San Juan Bautista", "Ayolas", "San Ignacio", "San Miguel", "San Patricio", "Santa María", "Santa Rosa",
    "Santiago", "Villa Florida", "Yabebyry",
  ],
  "Paraguarí": [
    "Paraguarí", "Acahay", "Caapucú", "Caballero", "Carapeguá", "Escobar", "La Colmena", "Mbuyapey", "Pirayú",
    "Quiindy", "Quyquyhó", "San Roque González de Santa Cruz", "Sapucai", "Tebicuary-mí", "Yaguarón", "Ybycuí",
    "Ybytymí", "María Antonia",
  ],
  "Alto Paraná": [
    "Ciudad del Este", "Presidente Franco", "Domingo Martínez de Irala", "Juan León Mallorquín", "Hernandarias",
    "Itakyry", "Juan E. O'Leary", "Ñacunday", "Yguazú", "Los Cedrales", "Minga Guazú", "San Cristóbal", "Santa Rita",
    "Naranjal", "Santa Rosa del Monday", "Minga Porá", "Mbaracayú", "San Alberto", "Iruña", "Santa Fe del Paraná",
    "Tavapy", "Doctor Raúl Peña",
  ],
  "Ñeembucú": [
    "Pilar", "Alberdi", "Cerrito", "Desmochados", "General José Eduvigis Díaz", "Guazú Cuá", "Humaitá", "Isla Umbú",
    "Laureles", "Mayor José J. Martínez", "Paso de Patria", "San Juan Bautista del Ñeembucú", "Tacuaras",
    "Villa Franca", "Villa Oliva", "Villalbín",
  ],
  "Amambay": ["Pedro Juan Caballero", "Bella Vista Norte", "Capitán Bado", "Zanja Pytã", "Karapaí"],
  "Canindeyú": [
    "Salto del Guairá", "Corpus Christi", "Curuguaty", "General Francisco Caballero Álvarez", "Itanará", "Katueté",
    "La Paloma del Espíritu Santo", "Nueva Esperanza", "Yasy Cañy", "Ybyrarobaná", "Ypejhú", "Villa Ygatimí",
    "Yby Pytã", "Laurel", "Maracaná", "Puerto Adela",
  ],
  "Presidente Hayes": [
    "Villa Hayes", "Remansito", "Benjamín Aceval", "Puerto Pinasco", "Nanawa", "José Falcón",
    "Teniente Primero Manuel Irala Fernández", "Teniente Esteban Martínez", "General José María Bruguez",
  ],
  "Boquerón": ["Filadelfia", "Loma Plata", "Mariscal Estigarribia", "Boquerón"],
  "Alto Paraguay": ["Fuerte Olimpo", "Bahía Negra", "Puerto Casado", "Carmelo Peralta"],
};

export const PY_CITIES: PyCity[] = Object.entries(RAW)
  .flatMap(([department, cities]) => cities.map((city) => ({ city, department: department === "Capital" ? "Distrito Capital" : department })))
  .sort((a, b) => a.city.localeCompare(b.city, "es"));

const key = (v: string) =>
  v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/ñ/g, "n").replace(/\s+/g, " ").trim();

/** Texto mostrado en el listado: "Ñemby — Central". */
export const cityOptionLabel = (c: PyCity) => `${c.city} — ${c.department}`;

/** Devuelve ciudad + departamento si lo escrito/elegido coincide con una ciudad conocida. */
export function findPyCity(value: string): PyCity | null {
  const k = key(value.split("—")[0] ?? "");
  if (!k) return null;
  return PY_CITIES.find((c) => key(c.city) === k) ?? null;
}

/** Formas populares o abreviadas con que los clientes escriben la ciudad. */
const POPULAR: Record<string, string[]> = {
  "Ciudad del Este": ["cde", "c d e", "ciudad del este"],
  "San Estanislao": ["santani"],
  "Mauricio José Troche": ["capitan mauricio jose troche", "cap mauricio jose troche", "troche"],
  "Doctor Juan Eulogio Estigarribia": ["campo 9", "campo9", "campo nueve", "j eulogio estigarribia", "juan eulogio estigarribia",
    "jota eulogio", "eulogio estigarribia", "dr j eulogio estigarribia"],
  "J. Augusto Saldívar": ["j augusto saldivar", "augusto saldivar", "jota augusto", "j a saldivar"],
  "Pedro Juan Caballero": ["pedro juan", "pjc"],
  "Mariano Roque Alonso": ["mra", "mariano r alonso", "mariano roque", "m r alonso"],
  "Fernando de la Mora": ["fdo de la mora", "fernando de la mora", "fdo mora", "fdm", "f d la mora", "fernando zona norte", "fernando zona sur",
    "frenando de la mora", "fernando d l mora", "fernando d la mora", "fdo d la mora", "fernando de la mor"],
  "General Francisco Isidoro Resquín": ["isidoro resquin", "general resquin", "gral resquin", "resquin"],
  "Coronel Oviedo": ["cnel oviedo", "oviedo"],
  "Juan León Mallorquín": ["mallorquin", "km 41"],
  "Presidente Franco": ["pdte franco", "pte franco", "pto franco"],
  "Juan E. O'Leary": ["juan e oleary", "oleary", "o leary"],
  "Doctor Cecilio Báez": ["cecilio baez"],
  "Doctor Juan Manuel Frutos": ["juan manuel frutos"],
  "Doctor Moisés S. Bertoni": ["moises bertoni"],
  "Doctor Raúl Peña": ["raul pena"],
  "Doctor Bottrell": ["bottrell"],
  "Sargento José Félix López": ["puentesino"],
  "3 de Febrero": ["tres de febrero"],
  "25 de Diciembre": ["veinticinco de diciembre"],
  "3 de Mayo": ["tres de mayo"],
  "Primero de Marzo": ["1 de marzo", "1ro de marzo"],
  "Mariscal Estigarribia": ["mcal estigarribia"],
  "Villa Ygatimí": ["ygatimi"],
  "La Paloma del Espíritu Santo": ["la paloma"],
  "Teniente Primero Manuel Irala Fernández": ["irala fernandez"],
  "General José Eduvigis Díaz": ["general diaz"],
  "Santa Rosa del Aguaray": ["aguaray"],
  "San Juan Bautista": ["san juan misiones"],
  // Barrios muy conocidos que los clientes dan como si fueran la ciudad («para Reducto»).
  // Solo barrios con un nombre que no se repite como ciudad ni como apellido común.
  "San Lorenzo": ["reducto", "barcequillo"],
  "Asunción": ["asu", "asun", "asuncion py", "villa morra", "recoleta", "sajonia", "mburucuya", "carmelitas", "tembetary",
    "zeballos cue", "tablada nueva", "chacarita", "loma pyta", "ycua sati", "pinoza", "banado sur", "manora",
    "ytay", "villa aurelia"],
  "Luque": ["mora cue", "itapuami"],
  // Abreviaturas y grafías que escriben los clientes (auditoría de chats reales).
  "Ypacaraí": ["ipacarai", "ipacaray", "ypacaray", "ypakarai", "ipakarai"],
  "Eusebio Ayala": ["barrero grande", "barrero"],
  "Santa Rita": ["sta rita"],
  "Santa Rosa del Aguaray": ["sta rosa del aguaray"],
  "Minga Guazú": ["minguazu", "minga guasu", "mingaguazu"],
  "Hernandarias": ["hernandaria", "hernandaris"],
  "Guayaibí": ["guajayvi", "guajayvy", "guayaivi", "guajaivi"],
  "San Lázaro": ["vallemi", "valle mi"],
  "Caaguazú": ["czu"],
};

/**
 * Nombres que también son palabras o apellidos comunes («limpio», «Escobar»,
 * «Santiago»): solo cuentan como ciudad si el mensaje es justo ese nombre o
 * viene con una señal de lugar («vivo en», «soy de», «en», «ciudad de»…).
 */
const AMBIGUOUS = new Set(["limpio", "altos", "jesus", "caballero", "union", "lima", "laurel", "natalio", "escobar",
  "borja", "yegros", "maciel", "iturbe", "santiago", "trinidad", "belen", "la paz", "liberacion", "san miguel",
  "santa maria", "fram", "abai", "cerrito", "laureles", "tacuaras", "desmochados", "maracana", "boqueron",
  "independencia", "buena vista", "san pablo", "san antonio", "santa elena", "oviedo", "pilar", "loreto",
  "alberdi", "obligado", "naranjal", "nueva esperanza", "san alberto", "san cristobal", "santa rosa", "la pastora",
  "simon bolivar", "san joaquin", "san salvador", "la colmena", "vaqueria", "repatriacion", "arroyito", "yataity",
  "san lorenzo", "san ignacio", "san patricio", "santa rita", "pedro juan"]);

const DEPARTMENTS = ["Concepción", "San Pedro", "Cordillera", "Guairá", "Caaguazú", "Caazapá", "Itapúa", "Misiones",
  "Paraguarí", "Alto Paraná", "Central", "Ñeembucú", "Amambay", "Canindeyú", "Presidente Hayes", "Boquerón", "Alto Paraguay"];

/** Departamento mencionado en el texto («del departamento del Guairá», «Alto Paraná», «dto central»). */
export function departmentIn(text: string): string | null {
  const t = ` ${key(text)} `;
  const hits = DEPARTMENTS.filter(d => t.includes(` ${key(d)} `));
  // «Alto Paraná» contiene «Paraná» pero no otro departamento; «San Pedro» puede ser ciudad: se acepta igual.
  return hits.length === 1 ? hits[0] : hits.sort((a, b) => key(b).length - key(a).length)[0] ?? null;
}

/** Formas populares de escribir una ciudad («CDE», «Santaní», «PJC»…). */
export function cityAliases(city: string): string[] {
  return POPULAR[city] ?? [];
}

type Place = PyCity & { alias: string };
const PLACES: Place[] = PY_CITIES.flatMap(c => {
  const aliases = new Set([key(c.city), ...(POPULAR[c.city] ?? []).map(key)]);
  // «Doctor …», «General …», «Coronel …»: también se escriben sin el título.
  const bare = key(c.city).replace(/^(?:doctor|dr|general|gral|coronel|cnel|capitan|cap|mayor|teniente|sargento|mariscal|mcal|presidente|pdte)\s+/, "");
  if (bare.split(" ").length >= 2 && bare.length >= 8) aliases.add(bare);
  // Con la inicial: «F de la Mora», «S Lorenzo», «M Roque Alonso» (solo si el resto es largo y único).
  for (const name of [key(c.city), bare]) {
    const [first, ...rest] = name.split(" ");
    const tail = rest.join(" ");
    if (first.length >= 3 && tail.replace(/^(?:de|del|de la|de los)\s+/, "").length >= 5 && !/^\d/.test(first)) aliases.add(`${first[0]} ${tail}`);
  }
  return [...aliases].filter(a => a.length >= 3).map(alias => ({ ...c, alias }));
});
// Una inicial que coincide con DOS ciudades («S Antonio»…) no sirve: se descarta.
{
  const count = new Map<string, number>();
  for (const p of PLACES) count.set(p.alias, (count.get(p.alias) ?? 0) + (/^[a-z] /.test(p.alias) ? 1 : 0));
  for (let i = PLACES.length - 1; i >= 0; i--) if ((count.get(PLACES[i].alias) ?? 0) > 1) PLACES.splice(i, 1);
}

function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 1;
}

const PLACE_CUE = /\b(?:vivo en|soy de|estoy en|estoy n|desde|para|ciudad|ciudad de|departamento|dpto|depto|dto|barrio|zona|en|de la ciudad|localidad|distrito|envian|envias|envio|envios|mandan|llega|llegan|delivery|deliveri|cobertura|entregan)\b/;

/** Ciudades que también son apellidos o palabras comunes («Maciel», «Escobar», «Limpio»). */
export function isAmbiguousPlaceName(name: string): boolean {
  return AMBIGUOUS.has(key(name));
}
/** El texto trae una señal de lugar («soy de», «para», «envían a», «ciudad»…). */
export function hasPlaceCue(text: string): boolean {
  return PLACE_CUE.test(key(text));
}

/**
 * Ciudad real de Paraguay nombrada en el texto (en cualquier posición), o null
 * si no hay ninguna o es ambigua. Un barrio junto a la ciudad («Concepción
 * barrio Inmaculada») devuelve la ciudad.
 */
/** Distancia de edición con transposiciones («cuidad» ↔ «ciudad» cuenta 1). */
function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

export function findParaguayPlace(text: string): PyCity | null {
  const t = key(text);
  if (!t || t.length > 220) return null;
  const padded = ` ${t} `;
  const cue = PLACE_CUE.test(t);
  // «Sii san lorenso», «Ok, Luque», «Dale es en Limpio»: lo que queda después de
  // las palabras de confirmación es la respuesta (la ciudad sola).
  const core = t.replace(/^(?:(?:s+i+|sip|ok|okey|okay|dale|bueno|bien|claro|ya|perfecto|listo|exacto|correcto|es|en|para|desde|a|de|soy|vivo|estoy|seria|sería)\s+)+/, "")
    .replace(/\s+(?:paraguay|paragauy|paraguai|py|gracias|porfa|por favor|nomas|noma)$/, "").trim();
  // El departamento de esa ciudad en el mismo mensaje («Pilar Ñeembucú») también la confirma.
  const depSaid = (dep: string) => padded.includes(` ${key(dep)} `);
  let hits = PLACES.filter(p => padded.includes(` ${p.alias} `) &&
    (!AMBIGUOUS.has(p.alias) || cue || t === p.alias || core === p.alias || (depSaid(p.department) && key(p.department) !== p.alias)));
  if (!hits.length) {
    // Errores de tipeo de 1 letra en nombres largos («Ypakarai», «ciudad del est»).
    const words = t.split(" ");
    hits = PLACES.filter(p => {
      if (p.alias.length < 6 || AMBIGUOUS.has(p.alias)) return false;
      const size = p.alias.split(" ").length;
      for (let i = 0; i + size <= words.length; i++) if (oneEdit(words.slice(i, i + size).join(" "), p.alias)) return true;
      return false;
    });
  }
  if (!hits.length) {
    // El mensaje ENTERO es una ciudad mal escrita («Cuidad de leste», «San lorenso»,
    // «Ciudad deleste py»): se compara sin espacios, con hasta 2 errores en nombres largos.
    const whole = core.replace(/\s+/g, "");
    if (whole.length >= 7 && whole.length <= 30) {
      let best = 99; let found: Place[] = [];
      for (const p of PLACES) {
        const alias = p.alias.replace(/\s+/g, "");
        if (alias.length < 8 || Math.abs(alias.length - whole.length) > 2) continue;
        const d = osaDistance(whole, alias);
        if (d > (alias.length >= 10 ? 2 : 1)) continue;
        if (d < best) { best = d; found = [p]; } else if (d === best) found.push(p);
      }
      hits = found;
    }
  }
  // «Barrio San Pablo», «B° Santa Rosa», «Compañía Itá»: el nombre que sigue a
  // barrio/compañía/zona es el BARRIO, no la ciudad.
  hits = hits.filter(h => !new RegExp(` (?:barrio|bario|varrio|b|compania|cia|zona|asentamiento|loteamiento) ${h.alias} `).test(padded));
  // «Del departamento de Paraguarí»: es el departamento, no su ciudad capital.
  if (/\b(?:departamento|dpto|depto|dto)\b/.test(t)) hits = hits.filter(h => h.alias !== key(h.department));
  // Quedarse con el nombre más largo («Santa Rosa del Aguaray» y no «Santa Rosa»).
  hits = hits.filter(h => !hits.some(o => o !== h && o.alias.length > h.alias.length && ` ${o.alias} `.includes(` ${h.alias} `)));
  let unique = hits.filter((h, i) => hits.findIndex(o => o.city === h.city && o.department === h.department) === i);
  if (unique.length > 1) {
    const dep = departmentIn(text);
    if (dep) unique = unique.filter(u => u.department === dep);
  }
  // Un nombre de departamento que coincide con su capital («Concepción», «Caaguazú»): la ciudad.
  return unique.length === 1 ? { city: unique[0].city, department: unique[0].department } : null;
}


const NOT_A_CITY_TOKEN = new Set(["para", "san", "santa", "villa", "puerto", "doctor", "general", "coronel", "capitan", "nueva", "nuevo",
  "colonia", "mayor", "presidente", "teniente", "ciudad", "barrio", "zona", "del", "las", "los", "que", "con", "por", "una", "uno"]);

/**
 * ¿Lo que escribió el cliente respalda la ciudad que entendió la IA? Acepta la
 * ciudad exacta, alias, errores de tipeo (hasta 2 letras en nombres largos) y
 * abreviaturas («Asu» → Asunción, «Hernamdaria…» → Hernandarias).
 */
export function textSupportsCity(city: string, texts: string[]): boolean {
  const target = PY_CITIES.find(c => key(c.city) === key(city));
  if (!target) return false;
  const aliases = PLACES.filter(p => p.city === target.city && p.department === target.department).map(p => p.alias);
  const compactAliases = aliases.map(a => a.replace(/\s+/g, ""));
  for (const text of texts) {
    if (findParaguayPlace(text)?.city === target.city) return true;
    const words = key(text).replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2").split(" ").filter(Boolean);
    for (let size = 1; size <= 4; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        const win = words.slice(i, i + size).join("");
        if (win.length < 3) continue;
        for (const alias of compactAliases) {
          if (alias.length >= 6 && Math.abs(alias.length - win.length) <= 2 && osaDistance(win, alias) <= (alias.length >= 8 ? 2 : 1)) return true;
          // Abreviatura o palabra pegada: «asu» → asuncion, «hernamdariabarrio» → hernandarias.
          if (size === 1 && win.length >= 3 && !NOT_A_CITY_TOKEN.has(win) && alias.length >= 6 &&
              (alias.startsWith(win) || (win.length >= alias.length && osaDistance(win.slice(0, alias.length), alias) <= 2))) return true;
        }
      }
    }
  }
  return false;
}
