/** Enrutamiento de intención antes de modificar el estado de una venta. */
export type CustomerIntent = "price" | "order_status" | "complex" | "checkout";
const normalize = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
export function classifyCustomerIntent(raw: string): CustomerIntent {
  const s = normalize(raw);
  if (/\b(?:mi pedido|mis pedidos|el pedido|pedido que hice|mi compra|mi envio|mi entrega|mi paquete|donde esta|cuando llega|cuando me llega|estado del pedido|seguimiento|numero de pedido|guia de envio)\b/.test(s)) return "order_status";
  if (/\b(?:precio|precios|cuanto cuesta|cuanto sale|cuanto vale|cuanto es|que cuesta|que sale|valor|costo|costos|cuanto me sale|a cuanto|y el precio|diga(?:me)? (?:el|su) precio)\b/.test(s)) return "price";
  if (/\b(?:sirve para|funciona para|como funciona|como se usa|puedo usar|puede triturar|que diferencia|cual es mejor|recomendas|recomienda|garantia|falla|defecto|devolucion|reembolso|reclamo|quiero cambiar|quiero cancelar|necesito ayuda|tengo una duda|no funciona|es compatible|material|potencia|duracion|caracteristicas|cuando entregan)\b/.test(s)) return "complex";
  // Preguntas genuinas no comerciales; una respuesta como "qué calle" se procesa por código.
  if (/[?¿]/.test(raw) && !/\b(?:quiero|llevo|dame|mandame|uno|una|dos|1|2|litros|unidad|soy de|calle|direc|nombre)\b/.test(s)) return "complex";
  return "checkout";
}

/** Contexto privado, verificado en Supabase, para responder sobre un pedido existente. */
export async function addVerifiedOrderContext(
  supabase: any, ctx: import("@/lib/ai.server").AiContext,
  workspaceId: string, phone: string | null | undefined
): Promise<import("@/lib/ai.server").AiContext> {
  if (!phone) return {...ctx, systemInstruction: ctx.systemInstruction + "\nCONSULTA DE PEDIDO: no hay un teléfono disponible para buscar el pedido. Pedí el número de pedido. No inventes estados."};
  const digits=phone.replace(/\D/g, "");
  // Buscar SOLO pedidos de este workspace y de este número.
  const phones=[phone, digits, digits.startsWith("595") ? "0"+digits.slice(3) : digits].filter(Boolean);
  const {data, error}=await supabase.from("orders")
    .select("order_number,product_title,quantity,total,status,payment_status,city,created_at")
    .eq("workspace_id",workspaceId).in("phone",[...new Set(phones)])
    .order("created_at",{ascending:false}).limit(3);
  if(error) throw error;
  const verified=(data??[]).map((o:any)=>({numero:o.order_number,producto:o.product_title,cantidad:o.quantity,total:o.total,estado:o.status,estado_pago:o.payment_status,ciudad:o.city,creado:o.created_at}));
  return {...ctx, systemInstruction: ctx.systemInstruction +
    "\nCONSULTA SOBRE PEDIDO EXISTENTE. Usa EXCLUSIVAMENTE estos datos verificados en la tabla orders del workspace actual: " + JSON.stringify(verified) +
    "\nSi la lista está vacía, indica que no encontraste un pedido asociado a ese WhatsApp y pide número de pedido para revisión humana. Nunca inventes guía, entrega, fecha, transportista o estado. No generes un pedido nuevo ni señales sale_closed por esta consulta. Responde en español paraguayo cordial con emojis moderados."};
}
