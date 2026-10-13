import type { AiContext } from "@/lib/ai.server";
import { classifyCustomerIntent } from "@/lib/hybrid-intent.server";
type Mode = "hybrid" | "ai_first" | "rules_only";
export type HybridSettings = { hybrid_mode?: Mode | null; hybrid_fallback_enabled?: boolean | null };
export type HybridDecision = { reply: string; productId: string | null; reason: string } | null;
const normalize = (v:string) => v.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const words = (s:string)=>` ${normalize(s)} `;
const containsPhrase = (text:string, phrase:string)=>words(text).includes(` ${normalize(phrase)} `);
const money = (n:number,c:string)=>`${c==="PYG"?"Gs.":c} ${Math.round(n).toLocaleString("es-PY")}`;
function findProduct(ctx:AiContext,text:string):AiContext["products"][number]|null {
  if(ctx.activeProductId){const p=ctx.products.find(p=>p.id===ctx.activeProductId);if(p)return p;}
  const hits=ctx.products.filter(p=>[p.name,...(p.keywords??[])].filter(k=>normalize(k).length>=4).some(k=>containsPhrase(text,k)));
  return hits.length===1?hits[0]:null;
}
/** Solo responde hechos verificables; consultas, reclamos y postventa siempre derivan a IA. */
export function decideHybridReply(args:{ctx:AiContext;text:string;mode:Mode;fallback?:boolean}):HybridDecision {
  const {ctx,text,mode}=args;
  if(mode==="ai_first"&&!args.fallback)return null;
  const normalized=normalize(text);
  if(!normalized||/^(imagen|audio|document|ubicacion compartida)/.test(normalized))return null;
  const intent=classifyCustomerIntent(text);
  if(intent==="order_status"||intent==="complex") {
    return args.fallback?{reply:"Entiendo tu consulta sobre el pedido. 🙏 Para confirmarte el estado o fecha real de entrega, un asesor debe revisar logística. No quiero darte una fecha sin verificar.",productId:ctx.activeProductId,reason:"postventa_segura"}:null;
  }
  const p=findProduct(ctx,text);
  const asksPrice=/\b(precio|cuanto cuesta|cuanto sale|vale|valor|promocion|oferta|opciones|presentaciones)\b/.test(normalized);
  const asksStock=/\b(stock|disponible|tienen|tenes|hay existencia)\b/.test(normalized);
  if(p&&(asksPrice||asksStock)){
    const options=[...(p.product_prices??[])].filter(o=>o.price>0).sort((a,b)=>a.sort_order-b.sort_order);
    if(asksStock&&Number(p.stock)<=0)return {reply:`😔 Por ahora *${p.name}* figura sin stock. ¿Querés que te ayude con otra opción?`,productId:p.id,reason:"catalogo_stock"};
    const list=options.length?options.map(o=>`• *${o.label}* — ${money(o.price,ctx.currency)}`).join("\n"):`• ${money(Number(p.promo_price??p.price),ctx.currency)}`;
    return {reply:`📦✨ *${p.name}*\n\n${list}\n\n😍 ¿Cuál opción preferís?`,productId:p.id,reason:"catalogo_precio"};
  }
  const faq=ctx.training.filter(t=>!["reglas","correccion"].includes(t.category)&&normalize(t.title).length>=12&&containsPhrase(text,t.title));
  if(faq.length===1&&faq[0].content.trim()&&faq[0].content.length<=1600)return{reply:faq[0].content.trim(),productId:p?.id??ctx.activeProductId,reason:"entrenamiento_exacto"};
  if(/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hola buenas)$/.test(normalized)){
    if(ctx.history.some(h=>h.role==="assistant"))return null;
    return{reply:`¡Holaa! 👋😊 ¡Bienvenido/a a *${ctx.businessName||"nuestra tienda"}*! ¿En qué te ayudo?`,productId:ctx.activeProductId,reason:"saludo"};
  }
  if(args.fallback)return{reply:"¡Gracias por escribirnos! 😊 Para responderte con información confirmada, un asesor debe revisar tu consulta.",productId:ctx.activeProductId,reason:"respaldo_seguro"};
  return null;
}
