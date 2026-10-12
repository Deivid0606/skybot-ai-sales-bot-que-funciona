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
  if(awaiting){const ordinal=n.match(/^(?:opcion|alternativa|presentacion)\s+(\d+)$/);
    if(ordinal)return options[Number(ordinal[1])-1]??null;}
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
  const chosen=selectOption(text,variants,s.awaiting==="variant");
  if(chosen)s.optionId=chosen.id;
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
  if(variants.length>1&&!selected)return answer(`📦 *${p.name}*\n${variants.map(o=>`• ${o.label}: ${money(o.price)}`).join("\n")}\n¿Cuál presentación preferís?`,"variant");
  if(variants.length===1)s.optionId=variants[0].id;
  if(!s.city)return answer("¿En qué ciudad estás para verificar la entrega?","city");
  const location=coverage.find(c=>c.city===s.city&&norm(c.department)===norm(s.department));
  if(!location && !s.city)return answer("¿Me confirmás tu ciudad para verificar cobertura?","city");
  const bank=ctx.training.find(t=>norm(t.title)==="datos bancarios")?.content?.trim()??"";
  const allowsOutsideAdvance=ctx.training.some(t=>/sin cobertura/i.test(t.content) && /pago anticipado/i.test(t.content));
  if(!s.paymentMethod){
    if(location?.active && /CONTRA ENTREGA/i.test(location.method))s.paymentMethod="contraentrega";
    else if(!location && allowsOutsideAdvance && bank)s.paymentMethod="anticipado";
    else if(location && /ANTICIPADO|TRANSFERENCIA/i.test(location.method))s.paymentMethod="anticipado";
    else return answer("La modalidad de entrega de tu ciudad necesita revisión. Un asesor te ayudará a confirmar cómo recibir el producto.",null,false,true);
  }
  if(s.paymentMethod==="contraentrega" && (!location || !location.active))return answer("Esta ciudad no figura entre las zonas habilitadas para pago al recibir. ¿Preferís consultar un envío por transportadora?",null,false,true);
  if(!s.quantity)return answer(`¿Cuántas unidades querés llevar${selected?` de ${selected.label}`:""}?`,"quantity");
  const total=priceFor(p,selected,s.quantity);
  if(!total)return answer("No encuentro un precio válido para esa cantidad. Un asesor debe revisar el pedido.",null,false,true);
  if(s.paymentMethod==="anticipado"){
    if(!bank)return answer("No tengo datos bancarios confirmados para tu negocio. Un asesor debe continuar.",null,false,true);
    if(!s.receiptPath)return answer(`💳 *Pago anticipado*\nProducto: ${p.name}${selected?` (${selected.label})`:""}\nCantidad: ${s.quantity}\nTotal: ${money(total)}\n\n${bank.slice(0,1600)}\n\nEnviame una foto o archivo del comprobante para adjuntarlo al pedido. El vendedor verificará la acreditación.`,"receipt");
    if(!s.customerName)return answer("Recibí el archivo para revisión. ¿Me indicás tu nombre y apellido?","name");
    return answer(`Comprobante adjunto para revisión. Pedido listo para registrar: *${p.name}* (${selected?.label??"presentación estándar"}), total ${money(total)}.`,null,true);
  }
  if(!s.customerName)return answer("¿Me indicás tu nombre y apellido?","name");
  if(location?.addressRequired&&!s.street)return answer("¿Cuál es la dirección de entrega y alguna referencia?","address");
  return answer(`Pedido listo para registrar: *${p.name}*${selected?` (${selected.label})`:""}, ${s.quantity} unidad(es), total ${money(total)}.`,null,true);
}
