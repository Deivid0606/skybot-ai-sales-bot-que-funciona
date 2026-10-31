import { timingSafeEqual } from "node:crypto";

/**
 * Estado del E-commerce (texto exacto) → estado del pedido en BOT SKY.
 * null = no cambia el estado del bot (solo se guarda el estado del E-commerce).
 */
export function botStateForEcommerceStatus(raw: string): string | null {
  const s = raw.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
  if (s === "ENTREGADO" || s === "ENCOMIENDA ENTREGADA") return "entregado";
  if (s === "DEVUELTO A DEPOSITO") return "devuelto_deposito";
  if (s === "REAGENDADO") return "reagendado";
  if (s === "EN RUTA") return "enviado";
  if (["CANCELADO", "CANCELO POR WHATSAPP", "NO DESEA", "RECHAZADO", "RECHAZADO EN EL LUGAR"].includes(s)) return "cancelado";
  return null; // PENDIENTE, NO CONTESTA y otros: se informa sin cambiar el estado
}

/** Compara la clave compartida sin filtrar información por tiempos. */
export function validEcommerceSecret(received: string | null): boolean {
  const expected = process.env.ECOMMERCE_STATUS_SECRET?.trim();
  if (!expected || !received) return false;
  const a = Buffer.from(received.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
