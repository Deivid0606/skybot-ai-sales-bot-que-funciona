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
  packageCopy?: string | null;
  items?: Array<{title:string;sku?:string|null;quantity:number;price:number}>;
  savedQuantity: number;
  paymentStatus?: string | null;
  deliveryMethod?: string | null;
  address?: string | null;
  requestRecipientCi?: boolean;
  recipientCi?: string | null;
  /** Costo de envío incluido en el total (pestaña Zonas de cobertura). */
  shippingFee?: number;
  /** Excedente DOCUMENTADO, aún no disponible para gastar hasta verificar acreditación. */
  pendingCreditGs?: number;
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
  // Package presentation is not the number of physical pieces inside the box.
  const optionLabel = String(args.productOption ?? "").trim();
  const boxLabel = /^(?:1|un|una)\s+caja\b/i.test(optionLabel);
  const packContainsTwoBases = boxLabel && /\b(?:1|una)\s+caja\s+(?:trae|contiene|incluye)\s+(?:2|dos)\s+bases\b/i.test(String(args.packageCopy ?? ""));
  const multi = (args.items??[]).length>1;
  const itemLines = multi ? (args.items??[]).flatMap((item,index)=>[
    `📦 ${index+1}. ${item.title}`,
    `🔢 Cantidad: ${item.quantity}`,
    `💰 Subtotal: ${formatGs(Number(item.quantity)*Number(item.price))}`,
    ...(item.sku ? [`SKU: ${item.sku}`] : []),
  ]) : [];
  const quantityDescription = boxLabel && args.savedQuantity === 1
    ? packContainsTwoBases ? "1 caja (contiene 2 bases)" : optionLabel
    : `${args.savedQuantity} unidad${args.savedQuantity === 1 ? "" : "es"}`;
  return [
    "✅ PEDIDO CONFIRMADO 🎉",
    "",
    `${isAdvance ? "👤 Destinatario" : "👤 Cliente"}: ${created.customer_name}`,
    ...(args.recipientCi && /^[0-9]{4,9}$/.test(args.recipientCi.replace(/[^0-9]/g,""))
      ? [`🪪 Cédula: ${args.recipientCi.replace(/[^0-9]/g,"")}`] : []),
    ...(multi ? itemLines : [`📦 Producto: ${product}`,`🔢 Cantidad: ${quantityDescription}`]),
    ...(Number(args.shippingFee) > 0 && Number(created.total) > Number(args.shippingFee)
      ? [`🛍️ Productos: ${formatGs(Number(created.total) - Number(args.shippingFee))}`, `🚚 Costo de envío: ${formatGs(Number(args.shippingFee))}`] : []),
    `💰 Total${Number(args.shippingFee) > 0 ? " con envío" : ""}: ${formatGs(created.total)}`,
    `📍 Ciudad: ${city}`,
    ...(address ? [`🏠 Dirección: ${address}`] : []),
    `📱 Teléfono: ${created.phone}`,
    `💵 Pago: ${payment}`,
    `🚚 Envío: ${shipping}`,
    ...(isAdvance ? [`📎 Comprobante: ${args.paymentStatus === "pagado" ? "Pago acreditado" : "Recibido, pendiente de verificación bancaria"}`] : []),
    ...(isAdvance && Number.isSafeInteger(args.pendingCreditGs) && Number(args.pendingCreditGs) > 0
      ? [`💚 Excedente documentado: ${formatGs(Number(args.pendingCreditGs))}, pendiente de acreditación para futuras compras.`] : []),
    `🧾 Pedido N.º: ${created.order_number}`,
    "",
    "¡Muchas gracias por tu compra! 😊",
    ...(args.requestRecipientCi ? ["", RECIPIENT_CI_QUESTION] : []),
  ].join("\n");
}
