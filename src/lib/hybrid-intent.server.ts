/** Enrutamiento de intención antes de modificar el estado de una venta. */
export type CustomerIntent = "price" | "order_status" | "complex" | "checkout";
const normalize = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
export function classifyCustomerIntent(raw: string): CustomerIntent {
  const s = normalize(raw);
  // Priorizar interpretación humana/IA ante solicitudes de asesor o malestar.
  if (/\b(?:supervisor|asesor|operador|persona real|atencion humana|reclamar|reclamo|no me da confianza|no confio|no entiendo|no es correcto|me estas repitiendo|ya te dije|ya te pase|deja de repetir|quiero hablar con alguien)\b/.test(s)) return "complex";
  // Se debe entender como consulta, no como dato de checkout.
  if (/\b(?:ser[aá] que|sera que|podrias|pueden|podran|se puede)\b/.test(s) && /\b(?:hoy|manana|delivery|entrega|envio|llegar|garantia|retirar)\b/.test(s)) return "complex";
  // RECLAMOS Y POSTVENTA: prioridad por encima de precios y checkout.
  if (/\b(?:mi pedido|mis pedidos|el pedido|hice el pedido|habia hecho|ya hice|ya pedi|hice la compra|pedido desde|pedido la semana|hace una semana|la otra semana|semana pasada|donde esta|seguimiento|guia de envio|estado del pedido|recibir mi pedido|reciba mi pedido|entrega de mi pedido|mi compra|mi paquete|me lo entregan|me van a entregar|podran entregar|pueden enviar hoy|pueden entregar hoy|vienen a traer|esperando mi pedido|pedido que hice|me llegara|ya les pase|ya te pase|ya envie mi ubicacion)\b/.test(s)) return "order_status";
  if (/\b(?:no podre confiar|no puedo confiar|perdi la confianza|voy a comprar en otro|conseguir de otro lugar|me estan dando vueltas|no cumplieron|incumplimiento|quiero reclamar|voy a cancelar|cancelen|estoy esperando|sigo esperando|ya paso|me prometieron|no me llego|aun no llega|todavia no llega|no cumplieron|molesta|enojada|reclamo|demora en entrega)\b/.test(s)) return "order_status";
  if (/\b(?:delivery|envio|entrega|encomienda|repartidor|reparto|llegada)\b/.test(s) && /\b(?:hoy|manana|cuando|cuanto|seria|sale|precio|costo|tarda|demora|hora|podran|pueden|puedo|traer|venir|van a)\b/.test(s)) return "complex";
  // Ubicación compartida o recordatorio de GPS: nunca es un nombre.
  if (/^\s*📍\s*ubicacion compartida/i.test(raw)) return "checkout";
  if (/\b(?:ya te pase|ya le pase|ya envie|ya comparti|te mande)\b/.test(s) && /\b(?:ubicacion|localizacion|maps)\b/.test(s)) return "complex";
  // Consultas sobre tiempo de entrega son preguntas, NO nombres, cantidades ni direcciones.
  if (/\b(?:cuando|para cuando|en cuantos dias|cuantos dias|que dia|a que hora)\b/.test(s) && /\b(?:llega|llegaria|llegan|llegue|entrega|entregan|entregaria|envian|envio|recibo|recibir|tarda|demora)\b/.test(s)) return "complex";
  if (/\b(?:te estoy preguntando|me estas entendiendo|no me respondiste|responde mi pregunta)\b/.test(s)) return "complex";
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
    "\nCONSULTA SOBRE PEDIDO EXISTENTE / POSTVENTA. NO OFREZCAS PROMOCIONES NI PIDAS CANTIDAD, CIUDAD, NOMBRE O DIRECCION DE NUEVO. No prometas prioridad logística, contacto del delivery, transferencia al delivery, llegada hoy o fechas sin verificación. Si el cliente está molesto, reconoce el reclamo y proponé revisión humana SIN decir que la gestionaste. Si responde `ojalá`, `ah`, `ok` o saluda, contestá brevemente sin iniciar compra. Usa EXCLUSIVAMENTE estos datos verificados en la tabla orders del workspace actual: " + JSON.stringify(verified) +
    "\nSi la lista está vacía, indica que no encontraste un pedido asociado a ese WhatsApp y pide número de pedido para revisión humana. Nunca inventes guía, entrega, fecha, transportista o estado. No generes un pedido nuevo ni señales sale_closed por esta consulta. Responde en español paraguayo cordial con emojis moderados."};
}

/** Añade exclusivamente el contexto de venta pendiente para que la IA pueda contestar
 * y después invitar a continuar, sin inventar datos ni modificar el estado guardado.
 */
export function addPendingSaleContext(
  ctx: import("@/lib/ai.server").AiContext,
  sale: import("@/lib/rule-sales.server").SaleState
): import("@/lib/ai.server").AiContext {
  if (!sale.productId || !sale.city && !sale.quantity && !sale.customerName) return ctx;
  const product = ctx.products.find(p => p.id === sale.productId);
  const needed = [!sale.city ? "ciudad" : null,
    !sale.quantity ? "cantidad" : null,
    !sale.customerName ? "nombre y apellido" : null,
    !sale.street ? "dirección de entrega (cuando la cobertura la requiera)" : null
  ].filter(Boolean);
  const resume = needed.length ? `Si corresponde retomar la compra, invitá de forma natural a facilitar únicamente lo pendiente: ${needed.join(", ")}.` : "Si la venta está completa, no solicites más datos ni confirmes un pedido sin comprobar que fue registrado.";
  return {...ctx, systemInstruction: ctx.systemInstruction + `
CONVERSACIÓN HÍBRIDA: El cliente acaba de realizar una CONSULTA; respondé su pregunta PRIMERO, de forma clara y cordial con emojis moderados. No trates preguntas como nombres o direcciones. Podés cerrar tu respuesta con UNA invitación breve a seguir comprando, sin insistir. No inventes fechas/plazos, cobertura, precios ni estados. Si un plazo no está explícitamente en el entrenamiento, indicá que depende de la ciudad y la logística y que no hay fecha confirmada. No afirmes que el pedido está registrado si no consultaste PEDIDOS. No crees un pedido desde esta consulta. Producto en curso: ${product?.name ?? "no determinado"}. Ciudad aportada: ${sale.city ?? "sin indicar"}. Nombre aportado: ${sale.customerName ? "sí" : "no"}. Cantidad aportada: ${sale.quantity ?? "sin indicar"}. Dirección aportada: ${sale.street ? "sí" : "no"}. ${resume}`};
}


/** BOT SKY: GPS sin geocodificación. El cliente confirma la ciudad. Sin APIs ni cartografía. */
export function validCoords(latitude:number,longitude:number):boolean {
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180;
}
export function coordinatesFromText(text:string):{latitude:number;longitude:number}|null {
  let decoded=text;
  try {decoded=decodeURIComponent(text);}catch { /* Enlaces sin codificación válida */ }
  const m=decoded.match(/(?:[?&](?:query|q|ll|center)=|\/@)(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i)
    ?? decoded.match(/\b(-?2[0-9]\.\d{4,})\s*,\s*(-?5[4-9]\.\d{4,})\b/);
  if(!m)return null;
  const latitude=Number(m[1]), longitude=Number(m[2]);
  return validCoords(latitude,longitude)?{latitude,longitude}:null;
}
