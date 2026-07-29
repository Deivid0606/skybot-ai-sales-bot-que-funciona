import type { Tables } from "@/integrations/supabase/types";

export const ORDER_STATES = [
  "nuevo",
  "confirmado",
  "cargado",
  "preparacion",
  "enviado",
  "entregado",
  "cancelado",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_TAGS: string[] = ["Ecommerce", "Drop", "Pago anticipado", "Pendiente de pago"];

export const PAYMENT_STATES = [
  "pendiente",
  "anticipado",
  "pagado",
  "contraentrega",
  "rechazado",
] as const;

const STATE_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  confirmado: "Confirmado",
  cargado: "Cargado",
  preparacion: "En preparación",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export function orderStateLabel(state: string) {
  return STATE_LABELS[state] ?? state;
}

export const ECOMMERCE_BASE_URL = "https://www.el-ecommercedcanpgroup.com/";

/** Departamentos de Paraguay con su nombre completo oficial. */
export const DEPARTAMENTOS_PY = [
  "Asunción",
  "Concepción",
  "San Pedro",
  "Cordillera",
  "Guairá",
  "Caaguazú",
  "Caazapá",
  "Itapúa",
  "Misiones",
  "Paraguarí",
  "Alto Paraná",
  "Central",
  "Ñeembucú",
  "Amambay",
  "Canindeyú",
  "Presidente Hayes",
  "Alto Paraguay",
  "Boquerón",
] as const;

const DEPT_ALIASES: Record<string, string> = {
  asu: "Asunción",
  asuncion: "Asunción",
  capital: "Asunción",
  cde: "Alto Paraná",
  "ciudad del este": "Alto Paraná",
  altoparana: "Alto Paraná",
  "alto parana": "Alto Paraná",
  ctral: "Central",
  central: "Central",
  itapua: "Itapúa",
  guaira: "Guairá",
  caaguazu: "Caaguazú",
  caazapa: "Caazapá",
  paraguari: "Paraguarí",
  neembucu: "Ñeembucú",
  canindeyu: "Canindeyú",
  "pdte hayes": "Presidente Hayes",
  "pte hayes": "Presidente Hayes",
  hayes: "Presidente Hayes",
  "alto paraguay": "Alto Paraguay",
  boqueron: "Boquerón",
  concepcion: "Concepción",
  "san pedro": "San Pedro",
  cordillera: "Cordillera",
  misiones: "Misiones",
  amambay: "Amambay",
};

/** Ciudades frecuentes → departamento, para completar cuando falta el dato. */
const CITY_TO_DEPT: Record<string, string> = {
  asuncion: "Asunción",
  luque: "Central",
  "san lorenzo": "Central",
  capiata: "Central",
  lambare: "Central",
  "fernando de la mora": "Central",
  "mariano roque alonso": "Central",
  limpio: "Central",
  itaugua: "Central",
  aregua: "Central",
  ypane: "Central",
  villaelisa: "Central",
  "villa elisa": "Central",
  nemby: "Central",
  "ciudad del este": "Alto Paraná",
  hernandarias: "Alto Paraná",
  "presidente franco": "Alto Paraná",
  minga: "Alto Paraná",
  encarnacion: "Itapúa",
  "coronel oviedo": "Caaguazú",
  caaguazu: "Caaguazú",
  "pedro juan caballero": "Amambay",
  concepcion: "Concepción",
  villarrica: "Guairá",
  paraguari: "Paraguarí",
  caacupe: "Cordillera",
};

const norm = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Devuelve el departamento completo a partir de un valor abreviado o de la ciudad. */
export function resolveDepartamento(departamento?: string | null, city?: string | null) {
  const raw = (departamento ?? "").trim();
  if (raw) {
    const key = norm(raw);
    const exact = DEPARTAMENTOS_PY.find((d) => norm(d) === key);
    if (exact) return exact;
    if (DEPT_ALIASES[key]) return DEPT_ALIASES[key];
    const partial = DEPARTAMENTOS_PY.find((d) => norm(d).startsWith(key) || key.startsWith(norm(d)));
    if (partial) return partial;
    return raw;
  }
  const cityKey = norm(city ?? "");
  return CITY_TO_DEPT[cityKey] ?? "";
}

/** Genera la URL de carga directa en la plataforma externa con todos los datos del pedido. */
export function buildEcommerceUrl(order: Tables<"orders">) {
  const departamento = resolveDepartamento(order.departamento, order.city);
  const entries: Record<string, string> = {
    origen: "bot-sky",
    pedido: order.order_number ?? "",
    nombre: order.customer_name ?? "",
    telefono: order.phone ?? "",
    ciudad: order.city ?? "",
    departamento,
    depto: departamento,
    calle: order.street ?? "",
    direccion: [order.street, order.district, order.city, departamento].filter(Boolean).join(", "),
    barrio: order.district ?? "",
    referencia: order.reference ?? "",
    producto: order.product_title ?? "",
    sku: order.sku ?? "",
    cantidad: String(order.quantity ?? 1),
    precio: String(order.price ?? 0),
    total: String(order.total ?? 0),
    pago: order.payment_method ?? "",
    estado_pago: order.payment_status ?? "",
    estado: order.status ?? "",
    anuncio: order.ad_id ?? "",
    observacion: order.observations ?? "",
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) if (v) params.set(k, v);
  return `${ECOMMERCE_BASE_URL}?${params.toString()}`;
}
