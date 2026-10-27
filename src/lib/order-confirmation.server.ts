import { RECIPIENT_CI_QUESTION } from "./recipient-ci.server";
import { formatGs } from "@/lib/format";
import type { AiOrder } from "@/lib/ai.server";

type RegisteredOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  phone: string;
  total: number;
};

type ConfirmationArgs = {
  created: RegisteredOrder;
  order: AiOrder;
  productName: string;
  productOption?: string | null;
  savedQuantity: number;
  paymentStatus?: string | null;
  deliveryMethod?: string | null;
  address?: string | null;
  requestRecipientCi?: boolean;
};

/** Solo invocar después del INSERT confirmado en orders. */
export function buildRegisteredOrderConfirmation(args: ConfirmationArgs): string {
  const { created, order } = args;
  const isAdvance = /anticip|transfer|deposit|giro/i.test(order.payment_method ?? "");
  const payment = isAdvance ? "Anticipado por transferencia" : "Al recibir";
  const shipping = args.deliveryMethod?.trim() || (isAdvance ? "Encomienda / modalidad habilitada" : "Contraentrega");
  const product = [args.productName, args.productOption?.trim()].filter(Boolean).join(" — ");
  const city = [order.city, order.departamento].filter(Boolean).join(" — ");
  const address = args.address?.trim() || order.street?.trim() || "";
  return [
    "✅ PEDIDO CONFIRMADO 🎉",
    "",
    `👤 Cliente: ${created.customer_name}`,
    `📦 Producto: ${product}`,
    `🔢 Cantidad: ${args.savedQuantity} unidad${args.savedQuantity === 1 ? "" : "es"}`,
    `💰 Total: ${formatGs(created.total)}`,
    `📍 Ciudad: ${city}`,
    ...(address ? [`🏠 Dirección: ${address}`] : []),
    `📱 Teléfono: ${created.phone}`,
    `💵 Pago: ${payment}`,
    `🚚 Envío: ${shipping}`,
    ...(isAdvance ? [`📎 Comprobante: ${args.paymentStatus === "pagado" ? "Pago acreditado" : "Recibido, pendiente de verificación bancaria"}`] : []),
    `🧾 Pedido N.º: ${created.order_number}`,
    "",
    "¡Muchas gracias por tu compra! 😊",
    ...(args.requestRecipientCi ? ["", RECIPIENT_CI_QUESTION] : []),
  ].join("\n");
}
