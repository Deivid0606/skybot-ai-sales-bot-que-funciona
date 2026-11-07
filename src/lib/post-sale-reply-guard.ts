/**
 * Final post-sale output guard.
 * Once an order is persisted, AI may answer shipping questions but must NEVER
 * restart checkout or issue a new confirmation whose contents disagree with orders.
 * Applies to WhatsApp webhook and manual inbox AI execution.
 */
export const isPostSaleCheckoutReply=(reply:string):boolean =>
  /(?:✅\s*)?PEDIDO\s+(?:CONFIRMADO|REGISTRADO)|(?:para\s+registrar|para\s+confirmar|para\s+completar|para\s+preparar)\s+(?:tu|su|el)\s+pedido|(?:me\s+pas[aá]s?|envi[aá]me|compart[ií]me|indic[aá]me|confirm[aá]me|necesito\s+que\s+me\s+confirmes)[^\n.!?]{0,105}(?:nombre\s+y\s+apellido|ciudad|direcci[oó]n|ubicaci[oó]n|cantidad)|(?:nombre\s+y\s+apellido|ciudad\s+de\s+entrega|direcci[oó]n\s+(?:con|\(|de\s+entrega))\s*:|(?:pasame|pas[aá]me)\s+lo\s+que\s+falte/i.test(reply);

/** Returns unchanged AI content when safe; otherwise deterministic safe post-sale note. */
export function safePostSaleReply(args:{
  reply:string; customerText:string; orderNumber?:string|null; orderStatus?:string|null;
}):{reply:string;corrected:boolean} {
  const text=String(args.reply??"").trim();
  if(text && !isPostSaleCheckoutReply(text))return {reply:text,corrected:false};
  const id=String(args.orderNumber??"").trim();
  const orderRef=id?`El pedido N.º ${id} ya está registrado.`:"Tu pedido ya está registrado.";
  const message=String(args.customerText??"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const looksAddress=/\b(?:calle|avenida|av\.?|barrio|casa\s*\d+|esquina|casi|entre|referencia|gps|ubicacion|maps|domicilio|direccion)\b/.test(message);
  const sent=/^(?:enviado|entregado|en transito|en tránsito|despachado|cargado)$/i.test(String(args.orderStatus??""));
  const response=looksAddress
    ? sent
      ? `📍 Recibí tu dirección o referencia adicional. ${orderRef} Como ya está en proceso logístico, un asesor debe comprobar si todavía es posible actualizar la entrega; no te voy a prometer el cambio sin verificarlo.`
      : `📍 Recibí tu dirección o referencia adicional. ${orderRef} La tienda debe verificar el cambio antes de aplicarlo; no necesitás registrar otra compra.`
    : `✅ ${orderRef} No hace falta volver a proporcionar los datos ni confirmar una segunda venta. Si necesitás un cambio en la entrega, podés indicarlo para que la tienda lo revise.`;
  return {reply:response,corrected:true};
}
