/**
 * Fichas de la pestaña «Entrenamiento»: reglas de la tienda con interruptores.
 * Reemplazan lo que el vendedor escribía a mano (factura, tarjeta, cédula…).
 * Se convierten en una entrada de entrenamiento oficial (categoría
 * «reglas_tienda») que tiene prioridad sobre el texto libre.
 * El CIERRE de la venta no se configura acá: es fijo en el sistema.
 * Sin dependencias del servidor: se usa en el navegador y en el servidor.
 */
export const SALES_RULES_CATEGORY = "reglas_tienda";

export type SalesRules = {
  invoice: { enabled: boolean };
  card: { enabled: boolean; link: string };
  qr: { enabled: boolean };
  encomienda_ci: { enabled: boolean };
  catalog_on_greeting: { enabled: boolean };
  pickup: { enabled: boolean; address: string; hours: string };
  store_location: string;
  warranty: { enabled: boolean; days: number | null; note: string };
  discounts: { enabled: boolean; max_percent: number | null };
  wholesale: { enabled: boolean; min_qty: number | null; note: string };
  not_sold_message: string;
  human_handoff: { enabled: boolean; phone: string; when: string };
};

export const DEFAULT_NOT_SOLD_MESSAGE =
  "😊 Por el momento no contamos con ese producto. Tenemos otros que te pueden interesar: mirá nuestro catálogo.";

export function defaultSalesRules(): SalesRules {
  return {
    invoice: { enabled: false },
    card: { enabled: false, link: "" },
    qr: { enabled: false },
    encomienda_ci: { enabled: false },
    catalog_on_greeting: { enabled: true },
    pickup: { enabled: false, address: "", hours: "" },
    store_location: "",
    warranty: { enabled: false, days: null, note: "" },
    discounts: { enabled: false, max_percent: null },
    wholesale: { enabled: false, min_qty: null, note: "" },
    not_sold_message: DEFAULT_NOT_SOLD_MESSAGE,
    human_handoff: { enabled: false, phone: "", when: "" },
  };
}

const bool = (v: unknown, fallback: boolean) => typeof v === "boolean" ? v : fallback;
const text = (v: unknown, max = 300) => typeof v === "string" ? v.trim().slice(0, max) : "";
const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return v === null || v === "" || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, Math.round(n)));
};

/** Normaliza lo guardado (o lo que propuso la IA) al formato completo de las fichas. */
export function normalizeSalesRules(raw: unknown): SalesRules {
  const d = defaultSalesRules();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  return {
    invoice: { enabled: bool(r.invoice?.enabled, d.invoice.enabled) },
    card: { enabled: bool(r.card?.enabled, d.card.enabled), link: text(r.card?.link, 500) },
    qr: { enabled: bool(r.qr?.enabled, d.qr.enabled) },
    encomienda_ci: { enabled: bool(r.encomienda_ci?.enabled, d.encomienda_ci.enabled) },
    catalog_on_greeting: { enabled: bool(r.catalog_on_greeting?.enabled, d.catalog_on_greeting.enabled) },
    pickup: { enabled: bool(r.pickup?.enabled, false), address: text(r.pickup?.address), hours: text(r.pickup?.hours, 120) },
    store_location: text(r.store_location, 200),
    warranty: { enabled: bool(r.warranty?.enabled, false), days: num(r.warranty?.days, 1, 3650), note: text(r.warranty?.note) },
    discounts: { enabled: bool(r.discounts?.enabled, false), max_percent: num(r.discounts?.max_percent, 1, 90) },
    wholesale: { enabled: bool(r.wholesale?.enabled, false), min_qty: num(r.wholesale?.min_qty, 2, 100000), note: text(r.wholesale?.note) },
    not_sold_message: text(r.not_sold_message, 500) || d.not_sold_message,
    human_handoff: { enabled: bool(r.human_handoff?.enabled, false), phone: text(r.human_handoff?.phone, 40), when: text(r.human_handoff?.when, 200) },
  };
}

type TrainingEntry = {
  title: string; content: string; category: string; priority: number;
  prompt_content?: string | null;
  scope?: string | null; product_id?: string | null; keywords?: string[] | null; created_at?: string | null;
};

/**
 * Entrada de entrenamiento oficial con las fichas. Las frases sobre la cédula
 * de encomienda usan las palabras que ya reconocen los controles del bot.
 */
export function salesRulesTrainingEntry(rules: SalesRules, catalogUrl: string | null): TrainingEntry {
  const r = rules;
  const lines: string[] = [
    "REGLAS DE LA TIENDA (fichas de la pestaña Entrenamiento; tienen prioridad sobre cualquier otro texto del entrenamiento):",
    r.invoice.enabled
      ? "🧾 FACTURA LEGAL: SÍ emitimos factura legal. Si el cliente la quiere, pedir RUC y razón social y anotarlos en el pedido. No inventar timbrado ni decir que ya se emitió. La factura no cambia el total ni frena el pedido."
      : "🧾 FACTURA LEGAL: NO emitimos factura legal. Si la piden, decirlo con amabilidad y seguir con la venta. Nunca prometer factura.",
    r.card.enabled
      ? `💳 TARJETA DE CRÉDITO: SÍ, con link de pago.${r.card.link ? ` Link oficial: ${r.card.link}` : " Si no hay un link para el pedido, ofrecer que el responsable lo gestiona; nunca inventar un link."} Nunca pedir foto de la tarjeta, números, CVV ni códigos. Un link enviado no es un pago confirmado. No prometer cuotas.`
      : "💳 TARJETA DE CRÉDITO: NO aceptamos tarjeta. Ofrecer los otros medios de pago.",
    r.qr.enabled ? "📲 PAGO CON QR: SÍ aceptamos pago con QR." : "📲 PAGO CON QR: NO.",
    r.encomienda_ci.enabled
      ? "🪪 CÉDULA EN ENCOMIENDA: en encomienda es requisito obligatorio pedir el número de cédula del destinatario, siempre DESPUÉS de que el sistema confirme el pedido. Nunca antes."
      : "🪪 CÉDULA EN ENCOMIENDA: no se pide cédula.",
    r.catalog_on_greeting.enabled && catalogUrl
      ? `📦 CATÁLOGO: si el cliente saluda o pide información general SIN nombrar un producto, saludar y enviar el catálogo: ${catalogUrl} . Si ya nombró un producto, responder sobre ese producto y no mandar el catálogo. No mandarlo de nuevo en cada saludo.`
      : "📦 CATÁLOGO: no enviar el link del catálogo al saludar; preguntar qué producto le interesa.",
    r.pickup.enabled
      ? `🏬 RETIRO EN LOCAL: SÍ.${r.pickup.address ? ` Dirección: ${r.pickup.address}.` : ""}${r.pickup.hours ? ` Horario: ${r.pickup.hours}.` : ""}`
      : "🏬 RETIRO EN LOCAL: NO hay retiro en local; solo envíos.",
    r.store_location
      ? `📍 SI PREGUNTAN DE DÓNDE SON (la tienda, no la ciudad de entrega): «${r.store_location}». No inventar dirección ni sucursales.`
      : "",
    r.warranty.enabled
      ? `🔁 CAMBIOS Y GARANTÍA: SÍ${r.warranty.days ? `, ${r.warranty.days} días` : ""}.${r.warranty.note ? ` ${r.warranty.note}` : ""}`
      : "🔁 CAMBIOS Y GARANTÍA: no prometer garantía ni cambios; si preguntan, decir que se consulta con el responsable.",
    r.discounts.enabled && r.discounts.max_percent
      ? `💸 DESCUENTOS: se puede ofrecer hasta ${r.discounts.max_percent} % solo si el cliente lo pide o duda por el precio. Nunca más que eso.`
      : "💸 DESCUENTOS: NO hay descuentos fuera de las promociones del catálogo. Nunca bajar el precio.",
    r.wholesale.enabled
      ? `🛒 VENTA MAYORISTA: SÍ${r.wholesale.min_qty ? `, desde ${r.wholesale.min_qty} unidades` : ""}.${r.wholesale.note ? ` ${r.wholesale.note}` : " Precio mayorista a consultar con el responsable; no inventarlo."}`
      : "🛒 VENTA MAYORISTA: no hay precio mayorista.",
    `🚫 PRODUCTO QUE NO VENDEMOS: responder «${r.not_sold_message}»${r.catalog_on_greeting.enabled && catalogUrl ? ` y compartir el catálogo: ${catalogUrl}` : ""}. Nunca registrar pedidos de productos que no están en el catálogo.`,
    r.human_handoff.enabled
      ? `👤 PASAR A UNA PERSONA: ${r.human_handoff.when ? `cuando ${r.human_handoff.when}` : "si el cliente lo pide o hay un reclamo"}, avisar que lo atiende una persona${r.human_handoff.phone ? ` (WhatsApp ${r.human_handoff.phone})` : ""}.`
      : "",
    "El CIERRE (orden de los datos, registro del pedido y mensaje «PEDIDO CONFIRMADO») lo hace el sistema y no cambia con estas reglas.",
  ].filter(Boolean);
  return {
    title: "Reglas de la tienda (fichas)",
    content: lines.join("\n"),
    category: SALES_RULES_CATEGORY,
    priority: 100000,
    scope: "global", product_id: null, keywords: [], created_at: null,
  };
}

/** Catálogo público de la tienda. */
export function catalogUrlFor(workspaceId: string, baseUrl: string | null | undefined): string | null {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/c/${workspaceId}` : null;
}
