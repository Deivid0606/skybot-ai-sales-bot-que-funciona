/** BOT SKY: flujo determinista por conversación. No usa APIs de IA.
 * No confirma pagos: un comprobante requiere revisión humana.
 */
import type { AiContext } from "@/lib/ai.server";

type Product = AiContext["products"][number];
type Option = Product["product_prices"][number];
export type SaleState = {
  productId?: string | null;
  optionId?: string | null;
  quantity?: number | null;
  city?: string | null;
  department?: string | null;
  customerName?: string | null;
  street?: string | null;
  paymentMethod?: string | null;
  awaiting?: string | null;
  receiptPath?: string | null;
};
export type SaleStep = {
  reply: string;
  state: SaleState;
  productId: string | null;
  complete: boolean;
  needsAi: boolean;
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const money = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
const opts = (p: Product) => [...(p.product_prices ?? [])].filter(o => o.price > 0).sort((a,b) => a.sort_order-b.sort_order);
const units = (s: string) => s.match(/\b\d+(?:[.,]\d+)?\s*(?:litros?|lts?|l|ml|kg|kilos?|cm|mm)\b/);

export type Coverage = { city:string; department:string; aliases:string[]; active:boolean; method:string; addressRequired:boolean };
/** Extrae SOLAMENTE bloques explícitos de la sección de cobertura activa del workspace. */
export function parseCoverage(training: AiContext["training"]): Coverage[] {
  const entry = training.find(t => norm(t.title) === "ciudades y cobertura");
  if (!entry) return [];
  const lines = entry.content.split(/\r?\n/);
  const out: Coverage[] = [];
  let section = "";
  let cur: Partial<Coverage> | null = null;
  const push = () => { if (cur?.city && cur.department && typeof cur.active === "boolean") out.push({
    city:cur.city, department:cur.department, aliases:cur.aliases ?? [], active:cur.active,
    method:cur.method ?? "", addressRequired:cur.addressRequired ?? true,
  }); };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^ZONAS CON COBERTURA$/i.test(line)) { section="yes"; continue; }
    if (/^ZONAS SIN COBERTURA$/i.test(line)) { section="no"; continue; }
    if (/^FIN DEL ENTRENAMIENTO/i.test(line)) { push(); break; }
    if (!section) continue;
    if (line.startsWith("📍")) { push(); cur={ city:line.slice(2).trim(), aliases:[], active:section==="yes" }; continue; }
    if (!cur) continue;
    if (line.startsWith("✅")) cur.aliases=line.slice(1).split(",").map(s=>s.trim()).filter(Boolean);
    else if (/^DEPARTAMENTO\s*:/i.test(line)) cur.department=line.split(":").slice(1).join(":").trim();
    else if (/^COBERTURA\s*:/i.test(line)) cur.active=/^\s*(?:SI|SÍ)\s*$/i.test(line.split(":").slice(1).join(":").trim());
    else if (/^MODALIDAD\s*:/i.test(line)) cur.method=line.split(":").slice(1).join(":").trim();
    else if (/^DIRECCI[OÓ]N_REQUERIDA\s*:/i.test(line)) cur.addressRequired=/^\s*s[ií]\s*$/i.test(line.split(":").slice(1).join(":"));
  }
  // Si no hay marcador final, conservar el último bloque.
  if (out.length === 0 && cur?.city) push();
  return out;
}
function cityIn(text:string, coverage:Coverage[]): Coverage | null {
  const normalized=norm(text);
  const hits=coverage.filter(c=>[c.city,...c.aliases].some(alias=>{
    const n=norm(alias);
    return n.length>=3 && (` ${normalized} `.includes(` ${n} `));
  }));
  return hits.length===1?hits[0]:null;
}
function selectProduct(ctx:AiContext,text:string):Product|null {
  const n=norm(text);
  const candidates=ctx.products.filter(p=>[p.name,...(p.keywords??[])].some(x=>{
    const k=norm(x);return k.length>=4&&` ${n} `.includes(` ${k} `);
  }));
  return candidates.length===1?candidates[0]:null;
}
function selectOption(text:string, options:Option[], awaiting=false):Option|null {
  if (options.length===1) return options[0];
  const n=norm(text);
  const matches=options.filter(o=>{
    const label=norm(o.label), specific=units(label);
    if(specific){const digits=specific[0].match(/\d+(?:[.,]\d+)?/)?.[0]??"";
      const unit=specific[0].replace(/^[\d.,\s]+/,"");
      if(new RegExp(`\\b${digits}\\s*(?:${unit}|litros?|lts?|l)\\b`).test(n))return true;
      if(awaiting && new RegExp(`^(?:el|la|de|el de|la de|quiero el de|quiero la de)\\s+${digits}$`).test(n))return true;
      return false;
    }
    return label.length>=3&&` ${n} `.includes(` ${label} `);
  });
  if(matches.length===1)return matches[0];
  if(awaiting){
    // Precio escrito por el cliente: «el de 179.900», «179900», «Gs 179.900».
    // Exigir una sola opción coincidente; nunca tomar montos parciales.
    const priceNumbers = (text.match(/\d[\d.,]*/g) ?? [])
      .map(x => Number(x.replace(/[^0-9]/g, "")))
      .filter(x => Number.isFinite(x));
    const byPrice = options.filter(o => priceNumbers.includes(Math.round(o.price)));
    if (byPrice.length === 1) return byPrice[0];
    // Si las variantes son paquetes de unidades («1 unidad», «2 unidades»),
    // «uno quiero» y «1» eligen el paquete. NO aplicar a «2 litros».
    const unitOptions = options.every(o => /\b(?:unidades?|piezas?)\b/.test(norm(o.label)));
    if (unitOptions) {
      const unitWord: Record<string,number>={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5};
      const m=n.match(/^(?:(?:quiero|dame|llevo|mandame|necesito|pido)\s+)?(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)(?:\s+(?:quiero|unidades?|piezas?|por favor))?$/);
      if(m){const count=unitWord[m[1]]??Number(m[1]);
        const byCount=options.filter(o=>o.quantity===count && /\b(?:unidades?|piezas?)\b/.test(norm(o.label)));
        if(byCount.length===1)return byCount[0];
      }
    }
    const ordinal=n.match(/^(?:opcion|alternativa|presentacion)\s+(\d+)$/);
    if(ordinal)return options[Number(ordinal[1])-1]??null;
  }
  return null;
}
function countOf(text:string, expecting:boolean):number|null {
  const n=norm(text);
  const word:Record<string,number>={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6};
  const m=n.match(/\b(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)\s*(?:unidades?|piezas?)\b/)
    ?? n.match(/\b(?:quiero|llevo|dame|necesito|mandame|pido)\s+(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)\b/)
    ?? (expecting ? n.match(/^(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)$/) : null);
  if(!m)return null;
  const num=word[m[1]]??Number(m[1]);return Number.isInteger(num)&&num>0&&num<=100?num:null;
}
function humanName(text:string, expecting:boolean):string|null {
  const cleaned=text.trim().replace(/^(?:me llamo|mi nombre es|soy)\s+/i, "").trim();
  if(!expecting&&!/^(?:me llamo|mi nombre es)\s+/i.test(text))return null;
  if(!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[\s'-]+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,5}$/.test(cleaned))return null;
  if(/\b(?:quiero|litros|gracias|buenas|cuanto|precio|ciudad|calle)\b/i.test(cleaned))return null;
  return cleaned;
}
function priceFor(p:Product,option:Option|null,quantity:number):number|null {
  if(option){
    // En product_prices.quantity está la cantidad de unidades de un paquete.
    // No se interpreta como capacidad en litros.
    if(quantity===option.quantity)return option.price;
    const exact=opts(p).find(o=>o.quantity===quantity && norm(o.label)===norm(option.label));
    if(exact)return exact.price;
    if(option.quantity===1)return option.price*quantity;
    return null; // Paquete de N unidades: no inventar precio para cantidad distinta.
  }
  const n=Number(p.promo_price??p.price);return n>0?n*quantity:null;
}
export function advanceRuleSale(ctx:AiContext, text:string, existing:SaleState={}, mediaPath?:string|null):SaleStep|null {
  const n=norm(text);
  if(!n || /^\[?(?:audio|video|sticker)/.test(n))return null;
  let s:SaleState={...existing};
  const direct=selectProduct(ctx,text);
  if(direct && direct.id!==s.productId) s={productId:direct.id};
  const p=ctx.products.find(x=>x.id===s.productId)??(ctx.activeProductId?ctx.products.find(x=>x.id===ctx.activeProductId):undefined);
  if(!p)return null;
  s.productId=p.id;
  const variants=opts(p);
  // Cuando se esperaba una variante y el cliente escribió un precio inexistente,
  // aclarar la diferencia sin volver a enviar el mismo listado completo.
  // Solo tratar como precio cifras de al menos 4 dígitos (nunca "quiero 1").
  if (s.awaiting === "variant" && variants.length > 1) {
    const amounts = (text.match(/\d[\d.,]*/g) ?? [])
      .map(raw => Number(raw.replace(/[^0-9]/g, "")))
      .filter(value => Number.isFinite(value) && value >= 1000);
    if (amounts.length === 1 && !variants.some(o => Math.round(o.price) === amounts[0])) {
      const nearest = [...variants].sort((a,b) => Math.abs(a.price-amounts[0])-Math.abs(b.price-amounts[0]))[0];
      if (nearest && Math.abs(nearest.price - amounts[0]) <= Math.max(1000,nearest.price * 0.02)) {
        s.awaiting="variant";
        return {reply:`😊 ¿Te referís a *${nearest.label}* por *${money(nearest.price)}*? 💰 Confirmame esa opción y seguimos con tu pedido. 🙌`, state:s, productId:p.id, complete:false, needsAi:false};
      }
    }
  }
  const chosen=selectOption(text,variants,s.awaiting==="variant");
  if(chosen) {
    s.optionId=chosen.id;
    // Una opción etiquetada «N unidades» es un paquete, distinto de «N litros».
    if (/\b(?:unidades?|piezas?)\b/.test(norm(chosen.label))) s.quantity=chosen.quantity;
  }
  // NO interpretar "5 litros" como cantidad cinco.
  const expectingQuantity=s.awaiting==="quantity";
  if(!units(n)) {
    const q=countOf(text,expectingQuantity);
    if(q)s.quantity=q;
  } else {
    // "uno de 5 litros" sí comunica cantidad 1 explícita.
    const match=n.match(/\b(un|uno|una|dos|tres|\d+)\s+de\s+\d+\s*(?:litros?|l|lts?)\b/);
    if(match)s.quantity=({un:1,uno:1,una:1,dos:2,tres:3}[match[1]]??Number(match[1]));
  }
  const coverage=parseCoverage(ctx.training);
  const match=cityIn(text,coverage);
  if(match){s.city=match.city;s.department=match.department;}
  else if(s.awaiting==="city" && n.length>=3 && n.length<=55 && /^[a-z ]+$/.test(n)) {
    // Una ciudad ausente de la lista NO significa cobertura, pero se conserva
    // la respuesta del cliente para tramitar un envío fuera de cobertura.
    s.city=text.trim(); s.department=null;
  }
  if(s.awaiting==="name" || /^\s*(?:me llamo|mi nombre es)\b/i.test(text)) {
    const name=humanName(text,s.awaiting==="name");if(name)s.customerName=name;
  }
  if(s.awaiting==="address" && !match && n.length>=6 && !/^(?:si|no|hola|gracias)$/.test(n))s.street=text.trim();
  if(/\b(?:transferencia|transferir|anticipado|deposito|giro)\b/.test(n))s.paymentMethod="anticipado";
  if(mediaPath && (s.awaiting==="receipt" || /comprobante|transferi|pague/.test(n)))s.receiptPath=mediaPath;
  const selected=variants.find(o=>o.id===s.optionId)??null;
  const answer=(reply:string,awaitKey:string|null,complete=false,needsAi=false):SaleStep=>{
    s.awaiting=awaitKey;return {reply,state:s,productId:p.id,complete,needsAi};
  };
  if(variants.length>1&&!selected)return answer(`📦✨ *${p.name}*\n\n${variants.map(o=>`• *${o.label}* — ${money(o.price)} 💰`).join("\n")}\n\n😍 ¡Elegí la opción que más te guste! ¿Cuál preferís?`,"variant");
  if(variants.length===1)s.optionId=variants[0].id;
  if(!s.city)return answer("🚚 ¡Genial! 😊 ¿En qué ciudad estás para verificar la entrega?","city");
  const location=coverage.find(c=>c.city===s.city&&norm(c.department)===norm(s.department));
  if(!location && !s.city)return answer("📍 ¿Me confirmás tu ciudad para verificar si llegamos hasta vos? 😊","city");
  const bank=ctx.training.find(t=>norm(t.title)==="datos bancarios")?.content?.trim()??"";
  const allowsOutsideAdvance=ctx.training.some(t=>/sin cobertura/i.test(t.content) && /pago anticipado/i.test(t.content));
  if(!s.paymentMethod){
    if(location?.active && /CONTRA ENTREGA/i.test(location.method))s.paymentMethod="contraentrega";
    else if(!location && allowsOutsideAdvance && bank)s.paymentMethod="anticipado";
    else if(location && /ANTICIPADO|TRANSFERENCIA/i.test(location.method))s.paymentMethod="anticipado";
    else return answer("📍 ¡Gracias por pasarme tu ciudad! 😊 Un asesor necesita revisar la modalidad de entrega para darte una información correcta. 🙌",null,false,true);
  }
  if(s.paymentMethod==="contraentrega" && (!location || !location.active))return answer("🚚 Por ahora, esa ciudad no figura en nuestras zonas habilitadas para pagar al recibir. 😊 ¿Querés que consultemos si hay otra forma de envío?",null,false,true);
  if(!s.quantity)return answer(`📦 ¡Buenísimo! 😍 ¿Cuántas unidades querés llevar${selected?` de *${selected.label}*`:""}?`,"quantity");
  const total=priceFor(p,selected,s.quantity);
  if(!total)return answer("💰 Para esa cantidad todavía no tengo un precio confirmado. 😊 Un asesor puede revisarlo para evitar cobrarte de más.",null,false,true);
  if(s.paymentMethod==="anticipado"){
    if(!bank)return answer("💳 Todavía no tengo los datos bancarios confirmados. 😊 Un asesor te ayudará a continuar de forma segura.",null,false,true);
    if(!s.receiptPath)return answer(`💳✨ *¡Ya casi está tu pedido!*\n\n📦 *Producto:* ${p.name}${selected?` (${selected.label})`:""}\n🔢 *Cantidad:* ${s.quantity}\n💰 *Total:* ${money(total)}\n\n🏦 *Datos para el pago:*\n${bank.slice(0,1600)}\n\n📸 Cuando hagas la transferencia, enviame el comprobante para adjuntarlo. 😊 El vendedor revisará la acreditación antes de confirmarla.`,"receipt");
    if(!s.customerName)return answer("📸 ¡Recibí tu comprobante! 😊 Quedará pendiente de verificación. ¿Me indicás tu nombre y apellido para completar el pedido?","name");
    return answer(`✅📸 ¡Gracias! Tu comprobante quedó adjunto para revisión. 📦 *${p.name}* (${selected?.label??"presentación estándar"}), total *${money(total)}*. El vendedor verificará el pago. 😊`,null,true);
  }
  if(!s.customerName)return answer("😊 ¡Perfecto! ¿Me indicás tu nombre y apellido para preparar el pedido?","name");
  if(location?.addressRequired&&!s.street)return answer("📍 ¡Gracias! 😊 ¿Me pasás la dirección de entrega y alguna referencia cercana (colegio, negocio o número de casa)? 🏠","address");
  return answer(`📦✨ *¡Ya tengo los datos de tu pedido!*\n🛍️ ${p.name}${selected?` (${selected.label})`:""}\n🔢 Cantidad: ${s.quantity}\n💰 Total: *${money(total)}*\n✅ Voy a registrarlo ahora. 😊`,null,true);
}
