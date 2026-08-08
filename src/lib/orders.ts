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

export const ORDER_TAGS: string[] = [
  "Ecommerce",
  "Drop",
  "Pago anticipado",
  "Pendiente de pago",
];

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

export const ECOMMERCE_BASE_URL =
  "https://www.el-ecommercedcanpgroup.com/";

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
  "san antonio": "Central",
  ita: "Central",
  guarambare: "Central",

  "ciudad del este": "Alto Paraná",
  hernandarias: "Alto Paraná",
  "presidente franco": "Alto Paraná",
  "puerto presidente franco": "Alto Paraná",
  minga: "Alto Paraná",
  "minga guazu": "Alto Paraná",
  "santa rita": "Alto Paraná",
  yguazu: "Alto Paraná",

  encarnacion: "Itapúa",

  "coronel oviedo": "Caaguazú",
  caaguazu: "Caaguazú",

  "pedro juan caballero": "Amambay",

  concepcion: "Concepción",

  villarrica: "Guairá",

  paraguari: "Paraguarí",
  pirayu: "Paraguarí",
  yaguarón: "Paraguarí",
  yaguaron: "Paraguarí",
  villeta: "Paraguarí",

  caacupe: "Cordillera",
  altos: "Cordillera",
  atyra: "Cordillera",
  atyrá: "Cordillera",
  emboscada: "Cordillera",
  "eusebio ayala": "Cordillera",
  "loma grande": "Cordillera",
  piribebuy: "Cordillera",
  "san bernardino": "Cordillera",
  tobari: "Cordillera",
  tobatii: "Cordillera",
  tobato: "Cordillera",
  tobata: "Cordillera",
  "tob ati": "Cordillera",
  "tob atí": "Cordillera",
  tobati: "Cordillera",

  "benjamin aceval": "Presidente Hayes",
  "benjamín aceval": "Presidente Hayes",
  remansito: "Presidente Hayes",
  "villa hayes": "Presidente Hayes",
};

const norm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

export function resolveDepartamento(
  departamento?: string | null,
  city?: string | null,
) {
  const raw = (departamento ?? "").trim();

  if (raw) {
    const key = norm(raw);

    const exact = DEPARTAMENTOS_PY.find(
      (department) => norm(department) === key,
    );

    if (exact) {
      return exact;
    }

    if (DEPT_ALIASES[key]) {
      return DEPT_ALIASES[key];
    }

    const partial = DEPARTAMENTOS_PY.find(
      (department) =>
        norm(department).startsWith(key) ||
        key.startsWith(norm(department)),
    );

    if (partial) {
      return partial;
    }

    return raw;
  }

  const cityKey = norm(city ?? "");

  return CITY_TO_DEPT[cityKey] ?? "";
}

function departamentoForEcommerce(
  departamento?: string | null,
  city?: string | null,
) {
  const resolved = resolveDepartamento(
    departamento,
    city,
  );

  if (norm(resolved) === "asuncion") {
    return "Capital";
  }

  return resolved;
}

export function buildEcommerceUrl(
  order: Tables<"orders">,
) {
  const departamento = departamentoForEcommerce(
    order.departamento,
    order.city,
  );

  /**
   * SOLO nombre del producto en observaciones.
   */
  const observacion = order.product_title
    ? `Producto: ${order.product_title}`
    : "";

  const entries: Record<string, string> = {
    origen: "seller-skyline",

    nombre: order.customer_name ?? "",
    cliente: order.customer_name ?? "",

    telefono: order.phone ?? "",
    phone: order.phone ?? "",

    departamento,
    depto: departamento,

    ciudad: order.city ?? "",
    city: order.city ?? "",

    calle: order.street ?? "",
    street: order.street ?? "",

    barrio: order.district ?? "",
    district: order.district ?? "",

    referencia: order.reference ?? "",
    reference: order.reference ?? "",

    producto: order.product_title ?? "",
    product_title: order.product_title ?? "",

    producto_id: order.product_id ?? "",
    product_id: order.product_id ?? "",

    sku: order.sku ?? "",

    cantidad: String(order.quantity ?? 1),
    qty: String(order.quantity ?? 1),

    precio: String(order.price ?? 0),
    price: String(order.price ?? 0),

    total: String(order.total ?? 0),
    total_gs: String(order.total ?? 0),

    pago: order.payment_method ?? "",
    payment_method: order.payment_method ?? "",

    estado_pago: order.payment_status ?? "",
    payment_status: order.payment_status ?? "",

    pedido: order.order_number ?? "",
    order_number: order.order_number ?? "",

    anuncio: order.ad_id ?? "",
    ad_id: order.ad_id ?? "",

    comprobante: order.receipt_url ?? "",
    receipt_url: order.receipt_url ?? "",

    email: "",

    obs: observacion,
    observacion: observacion,
  };

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    const cleanValue = String(value ?? "").trim();

    if (cleanValue) {
      params.set(key, cleanValue);
    }
  }

  return `${ECOMMERCE_BASE_URL}?${params.toString()}`;
}
