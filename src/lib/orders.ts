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

/** Genera la URL de carga directa en la plataforma externa. */
export function buildEcommerceUrl(order: Tables<"orders">) {
  const params = new URLSearchParams({
    origen: "seller-skyline",
    nombre: order.customer_name ?? "",
    telefono: order.phone ?? "",
    ciudad: order.city ?? "",
    departamento: order.departamento ?? "",
    calle: order.street ?? "",
    barrio: order.district ?? "",
    producto: order.product_title ?? "",
    cantidad: String(order.quantity ?? 1),
    total: String(order.total ?? 0),
    pago: order.payment_method ?? "",
    observacion: order.observations ?? "",
  });
  return `${ECOMMERCE_BASE_URL}?${params.toString()}`;
}
