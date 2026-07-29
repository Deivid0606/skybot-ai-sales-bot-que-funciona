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

/**
 * Genera la URL de carga directa en la plataforma externa.
 * La plataforma sólo procesa los parámetros si `origen=seller-skyline`
 * y usa las claves: nombre, telefono, ciudad, calle, producto, cantidad, total, pago.
 */
export function buildEcommerceUrl(order: Tables<"orders">) {
  const departamento = resolveDepartamento(order.departamento, order.city);
  const observacion = [
    order.observations ?? "",
    order.district ? `Barrio: ${order.district}` : "",
    order.reference ? `Referencia: ${order.reference}` : "",
    order.sku ? `SKU: ${order.sku}` : "",
    order.order_number ? `Pedido: ${order.order_number}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const entries: Record<string, string> = {
    // clave requerida por la app externa para prellenar el formulario
    origen: "seller-skyline",
    nombre: order.customer_name ?? "",
    telefono: order.phone ?? "",
    ciudad: order.city ?? "",
    calle: order.street ?? "",
    producto: order.product_title ?? "",
    cantidad: String(order.quantity ?? 1),
    total: String(order.total ?? 0),
    pago: order.payment_method ?? "",
    // extras (ignorados si la plataforma no los usa)
    departamento,
    depto: departamento,
    barrio: order.district ?? "",
    referencia: order.reference ?? "",
    email: "",
    sku: order.sku ?? "",
    precio: String(order.price ?? 0),
    pedido: order.order_number ?? "",
    estado_pago: order.payment_status ?? "",
    anuncio: order.ad_id ?? "",
    obs: observacion,
    observacion,
  };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) if (v) params.set(k, v);
  return `${ECOMMERCE_BASE_URL}?${params.toString()}`;
}
