/** BOT SKY: flujo determinista por conversación. No usa APIs de IA.
 * No confirma pagos: un comprobante requiere revisión humana.
 */
import type { AiContext } from "@/lib/ai.server";

type Product = AiContext["products"][number];
type Option = Product["product_prices"][number];
export type SaleState = {
  productId?: string | null;
  optionId?: string | null;
  cartLines?: Array<{ optionId: string; quantity: number }>;
  quantity?: number | null;
  city?: string | null;
  department?: string | null;
  cityVerified?: boolean;
  coverageStatus?: "covered" | "uncovered" | "unknown";
  customerName?: string | null;
  street?: string | null;
  locationUrl?: string | null;
  alternatePhone?: string | null;
  paymentMethod?: string | null;
  awaiting?: string | null;
  receiptPath?: string | null;
  /** Documentos recibidos de esta compra. No representan pagos acreditados. */
  receiptDocuments?: Array<{path:string; amountGs:number; operation:string|null}>;
  receiptReview?: string | null;
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
  // Leer solamente el entrenamiento ACTIVO del workspace; no inventar ciudades.
  // Algunos exportadores agregan números/emojis al título o separadores a los encabezados.
  const entries = training.filter(t => {
    const title = norm(t.title);
    const body = String(t.content ?? "");
    return (/ciudades? y cobertura|cobertura de ciudades|zonas? de cobertura/.test(title) ||
      (/zonas con cobertura/i.test(body) && /DEPARTAMENTO\s*:/i.test(body)));
  });
  const out: Coverage[] = [];
  for (const entry of entries) {
    let section: "yes" | "no" | "" = "";
    let current: Partial<Coverage> | null = null;
    const flush = () => {
      if (current?.city && current.department && typeof current.active === "boolean") {
        out.push({city:current.city,department:current.department,
          aliases:current.aliases ?? [],active:current.active,
          method:current.method ?? "",addressRequired:current.addressRequired ?? true});
      }
      current = null;
    };
    for (const raw of String(entry.content ?? "").split(/\r?\n/)) {
      const line = raw.trim().replace(/^[#*\-\s]+/, "").replace(/[\s*_]+$/, "").trim();
      if (/^ZONAS CON COBERTURA\s*:?$/i.test(line)) {flush();section="yes";continue;}
      if (/^ZONAS SIN COBERTURA\s*:?$/i.test(line)) {flush();section="no";continue;}
      if (/^FIN DEL ENTRENAMIENTO/i.test(line)) {flush();break;}
      if (!section) continue;
      const city = line.match(/^📍\s*(.+)$/u);
      if (city) {flush();current={city:city[1].trim(),aliases:[],active:section==="yes"};continue;}
      if (!current) continue;
      if (/^✅/u.test(line)) current.aliases=line.replace(/^✅\s*/u,"").split(",").map(x=>x.trim()).filter(Boolean);
      else if (/^DEPARTAMENTO\s*:/i.test(line)) current.department=line.split(":").slice(1).join(":").trim();
      else if (/^COBERTURA\s*:/i.test(line)) current.active=/^s[ií]$/i.test(line.split(":").slice(1).join(":").trim());
      else if (/^MODALIDAD\s*:/i.test(line)) current.method=line.split(":").slice(1).join(":").trim();
      else if (/^DIRECCI[OÓ]N_REQUERIDA\s*:/i.test(line)) current.addressRequired=/^s[ií]$/i.test(line.split(":").slice(1).join(":").trim());
    }
    flush();
  }
  // Una misma ciudad/departamento repetida con políticas contradictorias no es verificable.
  const unique = out.filter((c,i)=>out.findIndex(x=>norm(x.city)===norm(c.city) && norm(x.department)===norm(c.department))===i);
  return unique.filter(c=>!out.some(x=>norm(x.city)===norm(c.city) && norm(x.department)===norm(c.department) &&
    (x.active!==c.active || norm(x.method)!==norm(c.method) || x.addressRequired!==c.addressRequired)));
}

function cityIn(text:string, coverage:Coverage[]): Coverage | null {
  const normalized=norm(text);
  const hits=coverage.filter(c=>[c.city,...c.aliases].some(alias=>{
    const n=norm(alias);
    return n.length>=3 && (` ${normalized} `.includes(` ${n} `));
  }));
  // Una ciudad registrada varias veces (por ejemplo, alias y sección) es una
  // coincidencia única SOLO cuando el departamento también coincide.
  const unique = hits.filter((c, i) => hits.findIndex(x=>norm(x.city)===norm(c.city) && norm(x.department)===norm(c.department))===i);
  return unique.length===1?unique[0]:null;
}
/** Solo usar para ciudad/departamento devueltos por geocodificación confiable. */
export function verifiedCoverage(city:string, department:string, coverage:Coverage[]):Coverage|null {
  const ci=norm(city), dep=norm(department);
  const depEquivalent=(a:string,b:string)=>a===b || (ci==="asuncion" && ["asuncion","distrito capital","capital"].includes(a) && ["asuncion","distrito capital","capital"].includes(b));
  const matches=coverage.filter(c => [c.city,...c.aliases].some(a=>norm(a)===ci) && depEquivalent(norm(c.department),dep));
  return matches.length===1 ? matches[0] : null;
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
  // Las cajas son presentaciones comerciales (no contar los soportes internos).
  // «Quiero 1», «Una caja» y «1 caja» indican el mismo paquete si existe
  // UNA única presentación de una caja.
  const boxes = options.every(o => /\b(?:caja(?:s)?|pack(?:s)?|combo(?:s)?)\b/.test(norm(o.label)));
  if (boxes) {
    const boxWords: Record<string,number> = {un:1,uno:1,una:1,dos:2,tres:3,cuatro:4};
    const boxMatch = n.match(/^(?:(?:quiero|dame|llevo|mandame|necesito|pido|me llevo)\s+)?(\d{1,2}|un|uno|una|dos|tres|cuatro)(?:\s+(?:caja(?:s)?|pack(?:s)?|combo(?:s)?|quiero|nomas|por favor))?$/)
      ?? n.match(/^(?:el|la)\s+de\s+(\d{1,2})\s+caja(?:s)?$/);
    if (boxMatch) {
      const count=boxWords[boxMatch[1]]??Number(boxMatch[1]);
      const selectedBoxes=options.filter(o=>{
        const label=norm(o.label);
        const number=label.match(/\b(\d{1,2}|un|una|uno|dos|tres|cuatro)\s+caja(?:s)?\b/);
        return number && (boxWords[number[1]]??Number(number[1]))===count;
      });
      if(selectedBoxes.length===1)return selectedBoxes[0];
    }
  }
  // Un pedido de 1 o 2 unidades es selección del paquete comercial,
  // incluso cuando el estado "awaiting=variant" aún no se persistió.
  // No hacer esto para etiquetas de capacidad como "2 litros".
  const packages = options.every(o => /\b(?:unidad(?:es)?|piezas?)\b/.test(norm(o.label)));
  if (packages) {
    const wordNumbers: Record<string, number> = {un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5};
    const numberPhrase = n.match(/^(?:(?:yo\s+)?(?:quiero|dame|llevo|mandame|necesito|pido|me llevo|quiero llevar)\s+)?(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)(?:\s+(?:unidad(?:es)?|piezas?|quiero|por ahora|nom[aá]s|nada mas|por favor))?$/)
      ?? n.match(/^(?:el|la)\s+de\s+(\d{1,3})\s+unidad(?:es)?$/)
      ?? n.match(/^(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)\s+(?:quiero|por ahora|nomas|nada mas)$/);
    if (numberPhrase) {
      const count = wordNumbers[numberPhrase[1]] ?? Number(numberPhrase[1]);
      const selectedPackages = options.filter(o => o.quantity === count);
      if (selectedPackages.length === 1) return selectedPackages[0];
    }
  }
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
  if(awaiting || packages){
    // Precio escrito por el cliente: «el de 179.900», «179900», «Gs 179.900».
    // Exigir una sola opción coincidente; nunca tomar montos parciales.
    const priceNumbers = (text.match(/\d[\d.,]*/g) ?? [])
      .map(x => Number(x.replace(/[^0-9]/g, "")))
      .filter(x => Number.isFinite(x));
    const byPrice = options.filter(o => priceNumbers.includes(Math.round(o.price)));
    if (byPrice.length === 1) return byPrice[0];
    // Si las variantes son paquetes de unidades («1 unidad», «2 unidades»),
    // «uno quiero» y «1» eligen el paquete. NO aplicar a «2 litros».
    const unitOptions = options.every(o => /\b(?:unidad(?:es)?|piezas?)\b/.test(norm(o.label)));
    if (unitOptions) {
      const unitWord: Record<string,number>={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5};
      const m=n.match(/^(?:(?:quiero|dame|llevo|mandame|necesito|pido)\s+)?(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)(?:\s+(?:quiero|unidad(?:es)?|piezas?|por favor))?$/);
      if(m){const count=unitWord[m[1]]??Number(m[1]);
        const byCount=options.filter(o=>o.quantity===count && /\b(?:unidad(?:es)?|piezas?)\b/.test(norm(o.label)));
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
  const m=n.match(/\b(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)\s*(?:unidad(?:es)?|piezas?)\b/)
    ?? n.match(/\b(?:quiero|llevo|dame|necesito|mandame|pido)\s+(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)\b/)
    ?? (expecting ? n.match(/^(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)$/) : null);
  if(!m)return null;
  const num=word[m[1]]??Number(m[1]);return Number.isInteger(num)&&num>0&&num<=100?num:null;
}
function humanName(text:string, expecting:boolean):string|null {
  const cleaned=text.trim().replace(/^(?:me llamo|mi nombre es|soy)\s+/i, "").trim();
  if(!expecting&&!/^(?:me llamo|mi nombre es)\s+/i.test(text))return null;
  if(!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[\s'-]+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,5}$/.test(cleaned))return null;
  if(/\b(?:quiero|litros|gracias|buenas|cuanto|cuando|llegaria|llega|entrega|pedido|precio|ciudad|calle|preguntando|garantia|tarda|demora|necesito|saber|como|donde|favor|dale|ok|esta|bien|si|no|perfecto|listo|ubicacion|maps|numero|direccion)\b/i.test(cleaned))return null;
  return cleaned;
}
/** Extrae solo información reconocible, sin adivinar nombres o domicilios. */
function extractCheckoutDetails(raw:string, expecting:boolean):{name?:string;street?:string;alternatePhone?:string} {
  const text=raw.trim();
  if(!expecting || !text || /[¿?]/.test(text) || /^(?:s[ií]|dale|ok|claro|perfecto|est[aá] bien|gracias|por favor|listo)(?:\s|[!.]|$)/i.test(text)) return {};
  const output:{name?:string;street?:string;alternatePhone?:string}={};
  // WhatsApp: si se incluye un número secundario, es opcional. Nunca se exige.
  const phone=text.match(/(?:otro\s+n[uú]mero|n[uú]mero\s+alternativo|tel[eé]fono\s+alternativo|contacto\s+alternativo)\s*(?::|es)?\s*(\+?\d[\d\s-]{7,17}\d)/i);
  if(phone) output.alternatePhone=phone[1].replace(/[^\d+]/g, "");
  const cleaned=text.replace(/(?:otro\s+n[uú]mero|n[uú]mero\s+alternativo|tel[eé]fono\s+alternativo|contacto\s+alternativo)\s*(?::|es)?\s*\+?\d[\d\s-]{7,17}\d/ig, "").trim();
  // Admite: "Juan Pérez, calle ...", "Soy Juan Pérez, vivo en ...", y campos etiquetados.
  const nameLabel=cleaned.match(/(?:nombre(?:\s+y\s+apellido)?\s*[:=-]\s*|me\s+llamo\s+|soy\s+)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '-]+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,4})(?=\s*[,;\n]|\s+(?:direcci[oó]n|calle|av(?:enida)?\.?|vivo\s+en)\b|$)/i);
  // Un punto seguido de otra oración puede separar nombre y domicilio: "Bernardino Roa. Maskoy 1364".
  const parts=cleaned.split(/[,;\n]+|\.\s+(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/).map(t=>t.trim()).filter(Boolean);
  const first=parts[0]?.replace(/^(?:mi\s+nombre\s+es|nombre\s*[:=-]|soy)\s*/i, "");
  const rawName=nameLabel?.[1] || (first && humanName(first,true) ? first : null);
  if(rawName && humanName(rawName,true)) output.name=rawName.trim();
  let addr=cleaned.match(/(?:direcci[oó]n\s*[:=-]\s*|vivo\s+en\s+)(.+)$/i)?.[1]?.trim();
  if(!addr && parts.length>1 && output.name) addr=parts.slice(1).join(", ");
  if(!addr && !output.name && /\b(?:calle|avenida|av\.|ruta|barrio|casa|frente|esquina|casi)\b/i.test(cleaned)) addr=cleaned;
  const map=cleaned.match(/https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.[^\s/]+\/maps|maps\.google\.[^\s/]+)\/[^\s,;]+/i);
  if(map) addr=[addr && !addr.includes(map[0]) ? addr : null, map[0]].filter(Boolean).join(" | ");
  if(addr) {
    addr=addr.replace(/(?:otro\s+n[uú]mero|contacto\s+alternativo)\s*[:=-]?.*$/i,"").trim();
    if(addr.length>=8 && !/^(?:no\s+tengo|no\s+hay|no\s+se)$/i.test(addr)) output.street=addr;
  }
  return output;
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
/** Política configurable por workspace: nunca aplica globalmente a otras tiendas. */
export function sellerUsesFirstOffer(ctx: Pick<AiContext, "training">): boolean {
  return ctx.training.some(entry => /(?:usar|utilizar|aplicar|seleccionar|tomar|asumir)\s+(?:autom[aá]ticamente\s+)?(?:la\s+)?primera\s+(?:promoci[oó]n|opci[oó]n|oferta)/i.test(entry.content));
}

export function advanceRuleSale(ctx:AiContext, text:string, existing:SaleState={}, mediaPath?:string|null, sharedLocationUrl?:string|null):SaleStep|null {
  const n=norm(text);
  const isNudge = /^[\s¿?!.¡]+$/.test(text) || /^(?:me responden|me respondes|siguen ahi|seguimos|y entonces)$/i.test(n);
  if ((!n && !isNudge) || /^\[?(?:audio|video|sticker)/.test(n))return null;
  // Barrera adicional: una pregunta nunca se almacena como nombre o dirección,
  // incluso si está pendiente un dato personal. El enrutador híbrido la atenderá.
  if ((!isNudge && /[¿?]/.test(text) && !/https?:\/\//i.test(text)) || /\b(?:cuando me llega|cuando me llegaria|cuando llegaria|cuando entregan|cuando me entregan|cuanto tarda|cuanto demora|te estoy preguntando|dime el precio|decime el precio|y el precio|que garantia|tiene garantia)\b/.test(n)) return null;
  // Consultas de delivery no deben disparar la selección de variantes.
  if (/\b(?:delivery|delibery|delibari|envio|entrega|flete)\b/.test(n) &&
      /\b(?:cuando|cuanto|cuantos|cuanta|sale|seria|costo|precio|tarda|demora|llega|llegaria)\b/.test(n)) return null;
  // No transformar consultas o solicitudes de un humano en datos de compra.
  if (/\b(?:supervisor|asesor|persona real|atencion humana|reclamo|no me da confianza|ya te dije|no quiero repetir)\b/.test(n)) return null;
  let s:SaleState={...existing};
  // Una ubicación GPS válida pertenece a esta conversación; no es un nombre ni una ciudad.
  const gpsUrl = sharedLocationUrl || (text.match(/https?:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i)?.[0] ?? null);
  if (gpsUrl) s.locationUrl = gpsUrl;
  const direct=selectProduct(ctx,text);
  if(direct && direct.id!==s.productId) s={productId:direct.id};
  const p=ctx.products.find(x=>x.id===s.productId)??(ctx.activeProductId?ctx.products.find(x=>x.id===ctx.activeProductId):undefined);
  if(!p)return null;
  s.productId=p.id;
  const variants=opts(p);
  // «?» después de una selección no es una pregunta técnica: continuar la
  // compra pendiente sin borrar producto, variante, cantidad, ciudad o GPS.
  // No registrar pedidos ni elegir una variante por inferencia.
  if (isNudge && !s.quantity && !s.optionId && !s.cartLines?.length && variants.length > 1) {
    s.awaiting="variant";
    return {reply:`😊 ¡Estoy acá! Para *${p.name}* tenemos:\n${variants.map(v=>`• ${v.label} — ${money(v.price)}`).join("\n")}\n\n¿Cuál preferís?`,state:s,productId:p.id,complete:false,needsAi:false};
  }
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
  // Variantes de UN MISMO producto: carrito en estado persistido, sin IA.
  // «ambos» acepta todas las presentaciones únicamente cuando hay exactamente dos.
  if (variants.length > 1 && variants.every(v => Boolean(units(norm(v.label))))) {
    const mentioned = variants.filter(v => {
      const cap=units(norm(v.label));return Boolean(cap && n.includes(cap[0]));
    });
    const both = /\b(?:ambos|ambas|los dos|las dos|uno de cada|una de cada)\b/.test(n);
    if (mentioned.length > 1 || (both && variants.length === 2)) {
      const targets = mentioned.length > 1 ? mentioned : variants;
      const words:Record<string,number>={un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5};
      const cart = targets.map(v => {
        const capacity=units(norm(v.label))![0];
        const m=n.match(new RegExp(`\\b(\\d{1,2}|un|uno|una|dos|tres|cuatro|cinco)\\s+(?:de\\s+)?${capacity.replace(/\s+/g,'\\s*')}\\b`));
        const q=m ? (words[m[1]]??Number(m[1])) : 1;
        return {optionId:v.id,quantity:q};
      });
      if(cart.some(c=>!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>25))return {
        reply:'📦 Confirmame la cantidad de cada presentación para preparar tu pedido.',
        state:s,productId:p.id,complete:false,needsAi:false
      };
      s.cartLines=cart;s.optionId=cart[0].optionId;
      s.quantity=cart.reduce((sum,c)=>sum+c.quantity,0);
    }
    // Nunca cambiar el carrito por una respuesta suelta «Ok» o por repetir «ambos».
  }
  const chosen=s.cartLines?.length ? null : selectOption(text,variants,s.awaiting==="variant");
  if(chosen) {
    s.optionId=chosen.id;
    // Una opción etiquetada «N unidades» es un paquete, distinto de «N litros».
    if (/\b(?:unidad(?:es)?|piezas?|caja(?:s)?|pack(?:s)?)\b/.test(norm(chosen.label))) s.quantity=chosen.quantity;
  }
  // NO interpretar "5 litros" como cantidad cinco.
  const expectingQuantity=s.awaiting==="quantity";
  if(!units(n)) {
    const q=countOf(text,expectingQuantity);
    if(q && !s.cartLines?.length)s.quantity=q;
  } else {
    // "uno de 5 litros" sí comunica cantidad 1 explícita.
    const match=n.match(/\b(un|uno|una|dos|tres|\d+)\s+de\s+\d+\s*(?:litros?|l|lts?)\b/);
    if(match&&!s.cartLines?.length)s.quantity=({un:1,uno:1,una:1,dos:2,tres:3}[match[1]]??Number(match[1]));
  }
  const coverage=parseCoverage(ctx.training);
  const match=cityIn(text,coverage);
  if(match && !gpsUrl && !/\b(?:calle|esquina|casi|barrio|referencia)\b/.test(n)){s.city=match.city;s.department=match.department;s.cityVerified=true;s.coverageStatus=match.active?"covered":"uncovered";}
  else if(s.awaiting==="city" && !gpsUrl && !s.cityVerified && n.length>=3 && n.length<=55 && /^[a-z ]+$/.test(n)) {
    // Puede ser una ciudad no registrada o una frase ambigua. No inventar cobertura.
    // No conservar como ciudad verificada ni convertirla en pago anticipado.
    s.coverageStatus="unknown";
  }

  if(s.awaiting==="details" || s.awaiting==="address" || s.awaiting==="name") {
    const details=extractCheckoutDetails(text,true);
    if(details.name && !s.customerName)s.customerName=details.name;
    if(details.street && (!s.street || s.street === s.locationUrl))s.street=details.street;
    if(details.alternatePhone)s.alternatePhone=details.alternatePhone;
  }
  if(s.awaiting==="name" || /^\s*(?:me llamo|mi nombre es)\b/i.test(text)) {
    const name=humanName(text,s.awaiting==="name");if(name)s.customerName=name;
  }
  if(s.awaiting==="address" && !match && !gpsUrl && n.length>=6 && !/^(?:si|no|hola|gracias|si por favor|dale|ok)$/.test(n) && !/\b(?:ubicacion|maps|pedido|precio|llega|ya te|ya le|pase|comparti|envie|mand[eé])\b/.test(n))s.street=text.trim();
  if(/\b(?:transferencia|transferir|anticipado|deposito|giro)\b/.test(n))s.paymentMethod="anticipado";
  if(mediaPath && /^\s*(?:\[imagen\]\s*)?COMPROBANTE\b/i.test(text) &&
     (s.awaiting==="receipt" || s.paymentMethod==="anticipado")) s.receiptPath=mediaPath;
  // Usar la primera promoción solo si ESTA tienda lo instruyó, sin pisar una
  // elección explícita, capacidad/modelo ni una cantidad previa.
  if (sellerUsesFirstOffer(ctx) && !s.optionId && !s.cartLines?.length && !s.quantity && variants.length > 0 &&
      !variants.some(v => Boolean(units(norm(v.label))))) {
    const first=variants[0];
    s.optionId=first.id;
    s.quantity=first.quantity;
  }
  const selected=variants.find(o=>o.id===s.optionId)??null;
  const answer=(reply:string,awaitKey:string|null,complete=false,needsAi=false):SaleStep=>{
    s.awaiting=awaitKey;return {reply,state:s,productId:p.id,complete,needsAi};
  };
  // El cliente pide tiempo para decidir: conservar la ciudad sin insistir con ofertas.
  if (/\b(?:lo hablo|voy a hablar|consulto y te confirmo|te confirmo despues|te aviso|voy a consultar|lo consulto|lo pienso)\b/.test(n)
      && !/\b(?:quiero|llevo|compro|pedir)\s+(?:\d+|un|una|dos|tres)\b/.test(n)) {
    return answer("¡Claro! 😊 Tomate tu tiempo. Ya guardé los datos que me pasaste; cuando decidas, me escribís y continuamos. 💚", "variant");
  }
  // En híbrido, si la presentación ya pidió ciudad y el cliente la confirmó,
  // priorizar la cobertura. Las variantes se solicitan después, sin suponer precio.
  if (existing.awaiting === "city" && s.cityVerified && s.city &&
      variants.length > 1 && !selected && !s.cartLines?.length) {
    const cityCoverage = verifiedCoverage(s.city, s.department ?? "", coverage);
    if (!cityCoverage || (!cityCoverage.active && !/ANTICIPADO|TRANSFERENCIA/i.test(cityCoverage.method))) {
      return answer("📍 Para esa ciudad no tengo una modalidad habilitada de entrega confirmada. Un asesor revisará las opciones.", null, false, true);
    }
    return answer(`📍 ¡Gracias! Ciudad registrada: *${s.city}*. 🚚\n\n📦 Para continuar, elegí la presentación de *${p.name}*:\n${variants.map(v=>`• ${v.label} — ${money(v.price)}`).join("\n")}\n\n¿Cuál preferís?`, "variant");
  }
  if(variants.length>1&&!selected&&!s.cartLines?.length)return answer(`📦✨ *${p.name}*\n\n${variants.map(o=>`• *${o.label}* — ${money(o.price)} 💰`).join("\n")}\n\n😍 ¡Elegí la opción que más te guste! ¿Cuál preferís?`,"variant");
  if(variants.length===1)s.optionId=variants[0].id;
  if(!s.city || !s.cityVerified || !s.department){
    if(s.awaiting==="city" && !isNudge && !gpsUrl && !/^\s*📍/.test(text)) {
      return answer("📍 Todavía no pude confirmar tu ciudad con nuestra lista de cobertura. 😊 Un asesor puede verificarla; no te pediré pago anticipado sin confirmación.",null,false,true);
    }
    return answer(s.locationUrl ? "📍 ¡Ya tengo tu ubicación guardada! 😊 ¿En qué *ciudad* estás para confirmar la cobertura? 🚚" : "🚚 ¡Genial! 😊 ¿En qué ciudad estás para verificar la entrega?","city");
  }
  const location=coverage.find(c=>norm(c.city)===norm(s.city)&&norm(c.department)===norm(s.department));
  if(!location) return answer("📍 Necesito verificar tu ciudad y departamento antes de informar cobertura o formas de pago. ¿Podés confirmar tu ciudad? 😊", "city");
  if(!location.active && !/ANTICIPADO|TRANSFERENCIA/i.test(location.method)) return answer("📍 Tu ciudad está identificada, pero actualmente no figura en las zonas de contraentrega. Un asesor puede revisar opciones disponibles; no voy a pedirte pago anticipado sin tu elección. 😊",null,false,true);
  if(!location && !s.city)return answer("📍 ¿Me confirmás tu ciudad para verificar si llegamos hasta vos? 😊","city");
  const bank=ctx.training.find(t=>norm(t.title)==="datos bancarios")?.content?.trim()??"";
  if(!s.paymentMethod){
    if(location?.active && /CONTRA ENTREGA/i.test(location.method))s.paymentMethod="contraentrega";
    // Nunca activar pago anticipado por falta de coincidencia de cobertura.
    else if(location && /ANTICIPADO|TRANSFERENCIA/i.test(location.method))s.paymentMethod="anticipado";
    else return answer("📍 ¡Gracias por pasarme tu ciudad! 😊 Un asesor necesita revisar la modalidad de entrega para darte una información correcta. 🙌",null,false,true);
  }
  if(s.paymentMethod==="contraentrega" && (!location || !location.active))return answer("🚚 Por ahora, esa ciudad no figura en nuestras zonas habilitadas para pagar al recibir. 😊 ¿Querés que consultemos si hay otra forma de envío?",null,false,true);
  if(!s.quantity)return answer(`📦 ¡Buenísimo! 😍 ¿Cuántas unidades querés llevar${selected?` de *${selected.label}*`:""}?`,"quantity");
  const total=s.cartLines?.length ? s.cartLines.reduce((sum,line)=>{const v=variants.find(o=>o.id===line.optionId);return sum+(v?Number(v.price)*line.quantity:NaN);},0) : priceFor(p,selected,s.quantity);
  if(!total)return answer("💰 Para esa cantidad todavía no tengo un precio confirmado. 😊 Un asesor puede revisarlo para evitar cobrarte de más.",null,false,true);
  const summaryLabel=s.cartLines?.length ? s.cartLines.map(line=>{const v=variants.find(o=>o.id===line.optionId);return `${line.quantity} x ${v?.label??"variante"}`;}).join(" + ") : selected?.label??"presentación estándar";
  if(s.paymentMethod==="anticipado"){
    if(!bank)return answer("💳 Todavía no tengo los datos bancarios confirmados. 😊 Un asesor te ayudará a continuar de forma segura.",null,false,true);
    if(!s.receiptPath)return answer(`💳✨ *¡Ya casi está tu pedido!*\n\n📦 *Producto:* ${p.name}${s.cartLines?.length?` (${summaryLabel})`:selected?` (${selected.label})`:""}\n🔢 *Cantidad:* ${s.quantity}\n💰 *Total:* ${money(total)}\n\n🏦 *Datos para el pago:*\n${bank.slice(0,1600)}\n\n📸 Cuando hagas la transferencia, enviame el comprobante para adjuntarlo. 😊 El vendedor revisará la acreditación antes de confirmarla.`,"receipt");
    if(!s.customerName)return answer("📸 ¡Recibí tu comprobante! 😊 Quedará pendiente de verificación. ¿Me indicás tu nombre y apellido para completar el pedido?","name");
    return answer(`✅📸 ¡Gracias! Tu comprobante quedó adjunto para revisión. 📦 *${p.name}* (${summaryLabel}), total *${money(total)}*. El vendedor verificará el pago. 😊`,null,true);
  }
  // Un solo mensaje de requisitos una vez elegidos producto, precio, cantidad y ciudad.
  // El contacto alternativo NO bloquea el cierre. La ciudad ya debe haberse verificado.
  const needsAddress=location?.addressRequired !== false;
  // La ubicación GPS sirve como referencia de domicilio; no identifica ciudad sin geocodificación verificada.
  if (s.locationUrl && !s.street) s.street=s.locationUrl;
  else if(s.locationUrl && s.street && !s.street.includes(s.locationUrl)) s.street += ` | GPS: ${s.locationUrl}`;
  if(!s.customerName || (needsAddress && !s.street)) {
    if(s.awaiting==="details" || s.awaiting==="address" || s.awaiting==="name") {
      if(!s.customerName && s.street)return answer("¡Recibí tu dirección! 🏠💚 Solo me falta tu *nombre y apellido* para registrar el pedido. 😊","details");
      if(s.customerName && needsAddress && !s.street)return answer(`¡Gracias, ${s.customerName}! 😍 Solo me falta tu *dirección completa* o ubicación de Google Maps. 📍 Si tenés, agregá una referencia cercana.`,"details");
    }
    if (!needsAddress) return answer("😊 ¿Me compartís tu nombre y apellido para registrar el pedido?", "name");
    if (!s.customerName) return answer(`¡Oikoite! 😍🚚 Tenemos cobertura en *${s.city}*. ¿Me pasás tu nombre y apellido?`, "name");
    return answer("🏠 ¿Me pasás tu dirección o ubicación para completar el pedido?", "address");
  }
  return answer(`📦✨ *¡Ya tengo los datos de tu pedido!*\n🛍️ ${p.name}${s.cartLines?.length?` (${summaryLabel})`:selected?` (${selected.label})`:""}\n🔢 Cantidad: ${s.quantity}\n💰 Total: *${money(total)}*\n✅ Voy a registrarlo ahora. 😊`,null,true);
}
