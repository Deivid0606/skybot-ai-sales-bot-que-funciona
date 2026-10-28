/**
 * Ciudades de Paraguay con su departamento, para los formularios manuales.
 * Solo geografía: NO define cobertura ni forma de pago (eso sale del entrenamiento).
 */
export type PyCity = { city: string; department: string };

const RAW: Record<string, string[]> = {
  "Asunción": ["Asunción"],
  "Central": [
    "Areguá", "Capiatá", "Fernando de la Mora", "Guarambaré", "Itá", "Itauguá", "J. Augusto Saldívar",
    "Lambaré", "Limpio", "Luque", "Mariano Roque Alonso", "Nueva Italia", "Ñemby", "San Antonio",
    "San Lorenzo", "Villa Elisa", "Villeta", "Ypacaraí", "Ypané",
  ],
  "Cordillera": [
    "Altos", "Arroyos y Esteros", "Atyrá", "Caacupé", "Caraguatay", "Emboscada", "Eusebio Ayala",
    "Isla Pucú", "Itacurubí de la Cordillera", "Piribebuy", "San Bernardino", "Santa Elena", "Tobatí", "Valenzuela",
  ],
  "Paraguarí": ["Carapeguá", "Paraguarí", "Pirayú", "Quiindy", "Sapucai", "Yaguarón", "Ybycuí", "Acahay", "Caapucú"],
  "Alto Paraná": [
    "Ciudad del Este", "Hernandarias", "Juan León Mallorquín", "Minga Guazú", "Minga Porá", "Naranjal",
    "Presidente Franco", "Santa Rita", "Santa Rosa del Monday", "Itakyry", "Juan E. O'Leary",
  ],
  "Itapúa": [
    "Encarnación", "Bella Vista", "Cambyretá", "Capitán Miranda", "Carmen del Paraná", "Coronel Bogado",
    "Fram", "Hohenau", "María Auxiliadora", "Natalio", "Obligado", "San Pedro del Paraná", "Trinidad", "Edelira",
  ],
  "Caaguazú": ["Caaguazú", "Coronel Oviedo", "Doctor Juan Eulogio Estigarribia", "Repatriación", "Yhú", "José Domingo Ocampos"],
  "Guairá": ["Villarrica", "Independencia", "Colonia Independencia", "Mbocayaty", "Iturbe", "Paso Yobái"],
  "Concepción": ["Concepción", "Horqueta", "Yby Yaú", "Loreto", "Belén"],
  "San Pedro": ["San Pedro del Ycuamandiyú", "San Estanislao", "Santa Rosa del Aguaray", "Choré", "Guayaibí", "Lima", "Itacurubí del Rosario"],
  "Amambay": ["Pedro Juan Caballero", "Capitán Bado", "Bella Vista Norte"],
  "Canindeyú": ["Salto del Guairá", "Curuguaty", "Katueté", "La Paloma", "Ypejhú", "Corpus Christi"],
  "Caazapá": ["Caazapá", "San Juan Nepomuceno", "Yuty", "General Higinio Morínigo"],
  "Misiones": ["San Juan Bautista", "San Ignacio", "Ayolas", "Santa Rosa", "Santiago", "San Miguel"],
  "Ñeembucú": ["Pilar", "Alberdi", "Humaitá", "Mayor Martínez"],
  "Presidente Hayes": ["Villa Hayes", "Benjamín Aceval", "Puerto Pinasco", "Nanawa"],
  "Boquerón": ["Filadelfia", "Loma Plata", "Mariscal Estigarribia"],
  "Alto Paraguay": ["Fuerte Olimpo", "Bahía Negra"],
};

export const PY_CITIES: PyCity[] = Object.entries(RAW)
  .flatMap(([department, cities]) => cities.map((city) => ({ city, department })))
  .sort((a, b) => a.city.localeCompare(b.city, "es"));

const key = (v: string) =>
  v.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

/** Texto mostrado en el listado: "Ñemby — Central". */
export const cityOptionLabel = (c: PyCity) => `${c.city} — ${c.department}`;

/** Devuelve ciudad + departamento si lo escrito/elegido coincide con una ciudad conocida. */
export function findPyCity(value: string): PyCity | null {
  const k = key(value.split("—")[0] ?? "");
  if (!k) return null;
  return PY_CITIES.find((c) => key(c.city) === k) ?? null;
}
