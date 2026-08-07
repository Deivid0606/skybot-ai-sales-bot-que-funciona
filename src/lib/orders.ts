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

/**
 * Departamentos usados internamente por BOT SKY.
 */
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

/**
 * Ciudades frecuentes → departamento.
 *
 * Se usa como respaldo cuando el pedido no tiene
 * departamento guardado.
 */
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
  tob ati: "Cordillera",
  tob atí: "Cordillera",
  "tobatí": "Cordillera",

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

/**
 * Devuelve el departamento completo a partir de:
 *
 * 1. order.departamento
 * 2. alias
 * 3. ciudad
 */
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

/**
 * La otra plataforma llama "Capital" al departamento
 * correspondiente a Asunción.
 *
 * BOT SKY usa "Asunción".
 *
 * Convertimos solamente al generar la URL externa.
 */
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

/**
 * Construye la URL que abre el formulario de la
 * plataforma Ecommerce.
 *
 * Enviamos:
 *
 * - cliente
 * - teléfono
 * - departamento
 * - ciudad
 * - calle
 * - barrio
 * - referencia
 * - producto
 * - product_id
 * - sku
 * - cantidad
 * - precio
 * - total
 * - forma de pago
 * - estado de pago
 * - pedido original
 * - anuncio
 * - comprobante
 * - observaciones
 *
 * La app receptora puede utilizar product_id, sku o
 * producto para identificar automáticamente el artículo.
 */
export function buildEcommerceUrl(
  order: Tables<"orders">,
) {
  const departamento = departamentoForEcommerce(
    order.departamento,
    order.city,
  );

  /**
   * Observación completa.
   *
   * Mandamos también los datos importantes dentro de
   * observación como respaldo, pero la app receptora
   * debe usar primero los parámetros específicos.
   */
  const observacion = [
    order.observations ?? "",

    order.product_title
      ? `Producto: ${order.product_title}`
      : "",

    order.payment_method
      ? `Forma de pago: ${order.payment_method}`
      : "",

    order.district
      ? `Barrio: ${order.district}`
      : "",

    order.reference
      ? `Referencia: ${order.reference}`
      : "",

    order.sku
      ? `SKU: ${order.sku}`
      : "",

    order.order_number
      ? `Pedido BOT SKY: ${order.order_number}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const entries: Record<string, string> = {
    /**
     * Identificador obligatorio.
     */
    origen: "seller-skyline",

    /**
     * Cliente.
     */
    nombre: order.customer_name ?? "",
    cliente: order.customer_name ?? "",

    /**
     * Teléfono.
     */
    telefono: order.phone ?? "",
    phone: order.phone ?? "",

    /**
     * Ubicación.
     */
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

    /**
     * Producto.
     *
     * Se mandan varias formas para que la app receptora
     * pueda identificar el producto con prioridad:
     *
     * 1. product_id
     * 2. sku
     * 3. título
     */
    producto: order.product_title ?? "",
    product_title: order.product_title ?? "",

    producto_id: order.product_id ?? "",
    product_id: order.product_id ?? "",

    sku: order.sku ?? "",

    /**
     * Cantidad y precios.
     */
    cantidad: String(order.quantity ?? 1),
    qty: String(order.quantity ?? 1),

    precio: String(order.price ?? 0),
    price: String(order.price ?? 0),

    total: String(order.total ?? 0),
    total_gs: String(order.total ?? 0),

    /**
     * Pago.
     */
    pago: order.payment_method ?? "",
    payment_method: order.payment_method ?? "",

    estado_pago:
      order.payment_status ?? "",

    payment_status:
      order.payment_status ?? "",

    /**
     * Pedido de origen.
     */
    pedido: order.order_number ?? "",
    order_number:
      order.order_number ?? "",

    /**
     * Anuncio.
     */
    anuncio: order.ad_id ?? "",
    ad_id: order.ad_id ?? "",

    /**
     * Comprobante.
     */
    comprobante:
      order.receipt_url ?? "",

    receipt_url:
      order.receipt_url ?? "",

    /**
     * Actualmente orders no tiene email del cliente,
     * por eso queda vacío.
     */
    email: "",

    /**
     * Observación.
     */
    obs: observacion,
    observacion,
  };

  const params = new URLSearchParams();

  /**
   * No mandamos parámetros vacíos.
   */
  for (const [key, value] of Object.entries(
    entries,
  )) {
    const cleanValue = String(
      value ?? "",
    ).trim();

    if (cleanValue) {
      params.set(key, cleanValue);
    }
  }

  return `${ECOMMERCE_BASE_URL}?${params.toString()}`;
}
