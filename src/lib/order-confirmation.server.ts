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
  // «transferencia» = ciudad con pago al recibir donde el cliente eligió transferir (envío a domicilio).
  const payment = /^transferencia$/i.test(String(order.payment_method ?? "").trim())
    ? "Transferencia (mandanos el comprobante por acá cuando transfieras)"
    : isAdvance ? "Anticipado por transferencia" : "Al recibir";
  const codTransfer = /^transferencia$/i.test(String(order.payment_method ?? "").trim());
  const shipping = codTransfer
    ? (args.deliveryMethod?.trim().replace(/\s*CONTRA\s*ENTREGA,?\s*PAGO AL RECIBIR/i, " A DOMICILIO").trim() || "Envío a domicilio")
    : args.deliveryMethod?.trim() || (isAdvance ? "Encomienda / modalidad habilitada" : "Contraentrega");
  const product = [args.productName, args.productOption?.trim()].filter(Boolean).join(" — ");
  const city = [order.city, order.departamento].filter(Boolean).join(" — ");
  const address = args.address?.trim() || order.street?.trim() || "";
  // Package presentation is not the number of physical pieces inside the box.
  const optionLabel = String(args.productOption ?? "").trim();
  const boxLabel = /^(?:1|un|una)\s+caja\b/i.test(optionLabel);
  const packContainsTwoBases = boxLabel && /\b(?:1|una)\s+caja\s+(?:trae|contiene|incluye)\s+(?:2|dos)\s+bases\b/i.test(String(args.packageCopy ?? ""));
  // Envío y descuento reales del pedido (los anota el registro en las observaciones):
  // envío de la ciudad o delivery del producto, y descuento por pago anticipado.
  const obs = String((created as { observations?: string | null }).observations ?? "");
  const obsFee = obs.match(/ENVÍO:\s*([\d.]+)\s*Gs/);
  const shippingFee = obsFee ? Number(obsFee[1].replace(/\D/g, "")) : Number(args.shippingFee) || 0;
  const productDelivery = /delivery del producto/i.test(obs);
  const requestedDelivery = obs.match(/ENTREGA:\s*(?:para\s+)?([^|\n]+)/i)?.[1]?.trim();
  const obsDiscount = obs.match(/DESCUENTO\s+(\d+(?:[.,]\d+)?)%\s+POR PAGO ANTICIPADO:\s*−?([\d.]+)\s*Gs/);
  const discountPct = obsDiscount ? obsDiscount[1] : "";
  const discount = obsDiscount ? Number(obsDiscount[2].replace(/\D/g, "")) : 0;
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
    ...(shippingFee > 0 || discount > 0
      ? [`🛍️ Productos: ${formatGs(Number(created.total) - shippingFee + discount)}`,
        ...(shippingFee > 0 ? [`🚚 ${productDelivery ? "Delivery" : "Costo de envío"}: ${formatGs(shippingFee)}`] : []),
        ...(discount > 0 ? [`💸 Descuento ${discountPct}% por pago anticipado: −${formatGs(discount)}`] : [])] : []),
    `💰 Total${shippingFee > 0 ? " con envío" : ""}: ${formatGs(created.total)}`,
    `📍 Ciudad: ${city}`,
    ...(address ? [`🏠 Dirección: ${address}`] : []),
    `📱 Teléfono: ${created.phone}`,
    `💵 Pago: ${payment}`,
    `🚚 Envío: ${shipping}`,
    ...(requestedDelivery ? [`📅 Fecha solicitada: ${requestedDelivery} (sujeta a confirmación de la tienda)`] : []),
    ...(isAdvance ? [`📎 Comprobante: ${args.paymentStatus === "pagado" ? "Pago acreditado" : "Recibido, pendiente de verificación bancaria"}`] : []),
    ...(isAdvance && Number.isSafeInteger(args.pendingCreditGs) && Number(args.pendingCreditGs) > 0
      ? [`💚 Excedente documentado: ${formatGs(Number(args.pendingCreditGs))}, pendiente de acreditación para futuras compras.`] : []),
    `🧾 Pedido N.º: ${created.order_number}`,
    "",
    "¡Muchas gracias por tu compra! 😊",
    ...(args.requestRecipientCi ? ["", RECIPIENT_CI_QUESTION] : []),
  ].join("\n");
}
