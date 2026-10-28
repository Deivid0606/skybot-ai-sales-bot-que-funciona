/** BOT SKY: extractor/validador de estado. No redacta preguntas comerciales. */
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
  /** CI real del destinatario, proveniente únicamente del cliente. */
  recipientCi?: string | null;
  street?: string | null;
  locationUrl?: string | null;
  alternatePhone?: string | null;
  paymentMethod?: string | null;
  awaiting?: string | null;
  receiptPath?: string | null;
  /** Documentos recibidos de esta compra. No representan pagos acreditados. */
  receiptDocuments?: Array<{path:string; amountGs:number; operation:string|null}>;
  receiptAnalysisAttemptedPaths?: string[];
  receiptReview?: string | null;
  /** Horario o indicaciones de entrega dichas por el cliente (no es dirección). */
  deliveryNotes?: string | null;
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
  const clean = unique.filter(c=>!out.some(x=>norm(x.city)===norm(c.city) && norm(x.department)===norm(c.department) &&
    (x.active!==c.active || norm(x.method)!==norm(c.method) || x.addressRequired!==c.addressRequired)));
  // No agregar ciudades nacionales al listado de contraentrega.
  // Las localidades fuera de la lista se resuelven desde el pedido y la política del vendedor.
  return clean;
}

/** La modalidad se obtiene de la ficha de cobertura ACTIVA DEL VENDEDOR.
 * Una ciudad con contraentrega no puede convertirse silenciosamente en anticipado.
 * No usar esta función para inferir municipio desde GPS.
 */
export function deliveryPolicyForCity(city: string | null | undefined, department: string | null | undefined, training: AiContext["training"]) {
  if (!city || !department) return null;
  const place = verifiedCoverage(city, department, parseCoverage(training));
  if (!place) return null;
  const method = norm(place.method);
  const contraentrega = place.active && /contra entrega|contraentrega|pago al recibir/.test(method);
  const anticipado = /encomienda|anticipado|transferencia/.test(method) && !contraentrega;
  return { ...place, paymentMethod: contraentrega ? "contraentrega" as const : anticipado ? "anticipado" as const : null };
}


/**
 * ÚLTIMA BARRERA DE COBERTURA (WhatsApp + Inbox).
 * La IA puede redactar la conversación, pero no puede sustituir la modalidad
 * comprobada en el entrenamiento del workspace. Esta barrera se ejecuta
 * inmediatamente antes de enviar mensajes AUTOMÁTICOS, nunca sobre mensajes
 * manuales ni sobre pedidos ya confirmados por el backend.
 */
export function enforceVerifiedPaymentReply(args: {
  reply: string;
  city: string | null | undefined;
  department: string | null | undefined;
  cityVerified: boolean | null | undefined;
  training: AiContext["training"];
  saleState?: SaleState | null;
  productId?: string | null;
  products?: AiContext["products"];
}): {reply:string;corrected:boolean;paymentMethod:"contraentrega"|"anticipado"|null} {
  // Validador sin respuestas comerciales: ante contradicción el llamador
  // debe pedir UNA nueva redacción a la IA, nunca fabricar preguntas aquí.
  const reply=String(args.reply??"").trim();
  const policy=args.cityVerified && args.city && args.department
    ? deliveryPolicyForCity(args.city,args.department,args.training):null;
  const normalized=norm(reply);
  const promisesCod=/\b(?:tenemos|contamos|disponemos|ofrecemos|hay|podes|podras|paga|pagas|pagar|se paga)\b.{0,95}\b(?:contra entrega|contraentrega|pago al recibir|al recibir|cuando recibas|cuando llegue|al delivery)\b|\b(?:pago al recibir|contra entrega|contraentrega)\b.{0,80}\b(?:disponible|habilitado|para (?:tu|esa|esta) (?:zona|ciudad))\b/.test(normalized);
  const wrongCod=policy?.paymentMethod==="contraentrega" &&
    /\b(?:encomienda|pago anticipado|pagar por transferencia|transferencia obligatoria|datos bancarios|cuenta bancaria|no tenemos contra entrega|no hay contra entrega|comprobante de transferencia|comprobante de pago|comprobante|banco|titular|alias eko|cuenta desde|nro de cuenta|realices el pago)\b/.test(normalized);
  const wrongAdvance=policy?.paymentMethod==="anticipado" && promisesCod;
  return {reply,corrected:Boolean((promisesCod && policy?.paymentMethod!=="contraentrega")||wrongCod||wrongAdvance),paymentMethod:policy?.paymentMethod??null};
}

/** Requisito configurado por entrenamiento para encomienda; se recoge DESPUÉS del comprobante y ANTES del INSERT. */
export function sellerRequiresEncomiendaCi(training: AiContext["training"]): boolean {
  return training.some(entry => /encomienda/i.test(entry.content) &&
    /(?:n[uú]mero de c[eé]dula del destinatario|c[eé]dula de identidad del destinatario|c[eé]dula del destinatario)/i.test(entry.content) &&
    /(?:obligatori[oa]|requisito|exigir|solicitar|pedir|datos obligatorios)/i.test(entry.content));
}

export function isValidRecipientCi(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw=value.trim();
  if (!/^[0-9.\s-]+$/.test(raw)) return false;
  const digits=raw.replace(/[^0-9]/g,"");
  return digits.length >= 4 && digits.length <= 9;
}

/** Jamás extraer CI de una imagen/comprobante, alias bancario, teléfono ni código de operación. */
export function extractRecipientCiFromCustomerText(text: string, awaitingCi=false): string | null {
  if (/^\s*(?:\[imagen\]|COMPROBANTE|\[documento\]|\[audio\])/i.test(text)) return null;
  const raw=text.trim();
  if (/\b(?:alias|cuenta|banco|titular|beneficiario|operaci[oó]n|celular|tel[eé]fono|whatsapp)\b/i.test(raw)) return null;
  const explicit=raw.match(/(?:\bc[eé]dula\b|\bc\.?\s*i\.?(?=\s|[:=#-]|\d|$))(?:\s+(?:del\s+destinatario|de\s+identidad))?(?:\s*(?:n[uú]mero|nro\.?|es|ser[ií]a))?\s*[:#=-]?\s*(\S.*)$/im);
  const candidate=explicit?.[1] ?? (awaitingCi && /^[0-9.\s-]{4,16}$/.test(raw) ? raw : null);
  if (!candidate || !isValidRecipientCi(candidate)) return null;
  return candidate.replace(/[^0-9]/g,"");
}

/** La dirección domiciliaria jamás es requisito de encomienda anticipada. */
export function isEncomiendaAdvanceOrder(training: AiContext["training"], city: unknown, department: unknown, payment: unknown): boolean {
  if (!/anticip|transfer|deposit|giro/i.test(String(payment ?? ""))) return false;
  const location=verifiedCoverage(String(city??""),String(department??""),parseCoverage(training));
  if (location) return /encomienda/i.test(location.method) || !location.active;
  return sellerAllowsNationwideAdvance(training) && Boolean(String(city??"").trim() && String(department??"").trim());
}

/** Solo el entrenamiento ACTIVO del vendedor puede autorizar encomienda nacional. */
export function sellerAllowsNationwideAdvance(training: AiContext["training"]): boolean {
  return training.some(entry => {
    const body = String(entry.content ?? "");
    return /(?:todo\s+(?:el\s+)?paraguay|(?:cualquier|todas\s+las)\s+ciudad(?:es)?\s+(?:del\s+)?paraguay|encomienda\s+nacional|encomienda\s+a\s+todo\s+paraguay|ciudad(?:es)?\s+(?:de\s+)?paraguay\s+(?:que|sin|fuera))/i.test(body) &&
      /encomienda/i.test(body) && /(?:anticipado|transferencia|pagar\s+antes)/i.test(body);
  });
}

/** Referencia geográfica: identificar localidades no incluidas en la lista de
 * CONTRAENTREGA. Esta tabla NO habilita cobertura ni confirma transportistas.
 * Cualquier destino no reconocido se debe aclarar con ciudad y departamento.
 */
export function nationwideDestinationFromText(text: string): {city:string;department:string}|null {
  const normalized = norm(text);
  const paraguayanCities = [
    {city:"Capitán Bado",department:"Amambay",aliases:["capitan bado"]},
    {city:"Pedro Juan Caballero",department:"Amambay",aliases:["pedro juan caballero","pedro juan","pjc"]},
    // Geografía, NO cobertura ni transportista: permite conservar el destino explícito.
    {city:"Curuguaty",department:"Canindeyú",aliases:["curuguaty"]},
    {city:"Encarnación",department:"Itapúa",aliases:["encarnacion"]},
    {city:"Ciudad del Este",department:"Alto Paraná",aliases:["ciudad del este","cde"]},
    {city:"Hernandarias",department:"Alto Paraná",aliases:["hernandarias"]},
    {city:"Presidente Franco",department:"Alto Paraná",aliases:["presidente franco","pdte franco"]},
    {city:"Minga Guazú",department:"Alto Paraná",aliases:["minga guazu"]},
    {city:"Santa Rita",department:"Alto Paraná",aliases:["santa rita"]},
    {city:"Coronel Oviedo",department:"Caaguazú",aliases:["coronel oviedo","cnel oviedo"]},
    {city:"Caaguazú",department:"Caaguazú",aliases:["caaguazu"]},
    {city:"Villarrica",department:"Guairá",aliases:["villarrica"]},
    {city:"Concepción",department:"Concepción",aliases:["concepcion"]},
    {city:"Horqueta",department:"Concepción",aliases:["horqueta"]},
    {city:"San Pedro del Ycuamandiyú",department:"San Pedro",aliases:["san pedro del ycuamandiyu"]},
    {city:"Santa Rosa del Aguaray",department:"San Pedro",aliases:["santa rosa del aguaray"]},
    {city:"San Estanislao",department:"San Pedro",aliases:["san estanislao","santani"]},
    {city:"Pilar",department:"Ñeembucú",aliases:["pilar"]},
    {city:"Caazapá",department:"Caazapá",aliases:["caazapa"]},
    {city:"San Juan Bautista",department:"Misiones",aliases:["san juan bautista"]},
    {city:"San Ignacio",department:"Misiones",aliases:["san ignacio"]},
    {city:"Ayolas",department:"Misiones",aliases:["ayolas"]},
    {city:"Paraguarí",department:"Paraguarí",aliases:["paraguari"]},
    {city:"Carapeguá",department:"Paraguarí",aliases:["carapegua"]},
    {city:"Caacupé",department:"Cordillera",aliases:["caacupe"]},
    {city:"Salto del Guairá",department:"Canindeyú",aliases:["salto del guaira"]},
    {city:"Hohenau",department:"Itapúa",aliases:["hohenau"]},
    {city:"Obligado",department:"Itapúa",aliases:["obligado"]},
    {city:"Bella Vista",department:"Itapúa",aliases:["bella vista"]},
    {city:"Cambyretá",department:"Itapúa",aliases:["cambyreta"]},
    {city:"María Auxiliadora",department:"Itapúa",aliases:["maria auxiliadora"]},
    {city:"Coronel Bogado",department:"Itapúa",aliases:["coronel bogado"]},
    {city:"Filadelfia",department:"Boquerón",aliases:["filadelfia"]},
    {city:"Loma Plata",department:"Boquerón",aliases:["loma plata"]},
    {city:"Villa Hayes",department:"Presidente Hayes",aliases:["villa hayes"]},
    {city:"Fuerte Olimpo",department:"Alto Paraguay",aliases:["fuerte olimpo"]},
  ];
  const matches = paraguayanCities.filter(place => place.aliases.some(alias =>
    (` ${normalized} `).includes(` ${alias} `)));
  if (matches.length !== 1) return null;
  // "¿Y Pedro Juan?" es una consulta, NO un cambio de dirección confirmado.
  const direct = matches[0].aliases.includes(normalized) ||
    /\b(?:ciudad de|soy de|vivo en|enviar a|envien a|mandar a|destino|entrega (?:en|a)|para)\b/.test(normalized);
  return direct ? {city:matches[0].city,department:matches[0].department} : null;
}

/** No se consideran destinos confirmados los nombres incompletos o dudosos. */
function declaredDestination(text:string): {city:string;department:string}|null {
  const s=text.trim().replace(/^(?:soy\s+de|vivo\s+en|para|enviar\s+a|mandar\s+a|a\s+)\s*/i,"");
  const m=s.match(/^([\p{L}][\p{L} .'-]{2,55}?)\s*(?:,|\s+del?\s+departamento\s+de|\s+depto\.?\s+|\s+-\s+)\s*([\p{L}][\p{L} .'-]{2,40})\s*[.!]?$/iu);
  if(!m)return null;
  const city=m[1].trim(),department=m[2].trim();
  if(/\b(?:calle|barrio|casi|esquina|ruta|direccion|ubicacion)\b/i.test(city))return null;
  return {city,department};
}

function cityIn(text:string, coverage:Coverage[]): Coverage | null {
  const normalized=norm(text);
  // Preguntas sobre pago no son declaraciones de una ciudad.
  if (!normalized || /^(?:se paga|puedo pagar|pago al recibir|es contra entrega|envio gratis|cuanto cuesta)/.test(normalized)) return null;
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
    ?? n.match(/\bcada\s+(?:uno|una)\b[\s,.;y]*(\d{1,2}|dos|tres|cuatro|cinco|seis)\b/)
    ?? n.match(/\b(\d{1,2}|dos|tres|cuatro|cinco|seis)\s+(?:cajas?|packs?|juegos?)\b/)
    ?? (expecting ? n.match(/^(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis)$/) ?? n.match(/(?:^|,)\s*(dos|tres|cuatro|cinco|seis)\s*$/) : null);
  if(!m)return null;
  const num=word[m[1]]??Number(m[1]);return Number.isInteger(num)&&num>0&&num<=100?num:null;
}
/** Palabras que indican lugar, horario o pedido: nunca forman parte de un nombre. */
const NOT_A_NAME=/\b(?:estoy|estamos|en|aeropuerto|trabajo|oficina|empresa|salgo|almorzar|almuerzo|horas?|hs|hasta|desde|avisa|avisame|avisas|traigas|traer|trae|aca|aqui|alla|cerca|frente|casa|shopping|colegio|hospital|terminal|cada|unidades?|cajas?)\b/;
const PLACE_REF=/\b(?:aeropuerto|trabajo|oficina|empresa|shopping|colegio|escuela|universidad|hospital|sanatorio|terminal|supermercado|estacion|iglesia|plaza|frente|al lado|esquina|casi)\b/;
const SCHEDULE_REF=/\b(?:\d{1,2}\s*(?::|\.|h)\s*\d{2}|\d{1,2}\s*(?:hs|horas?)|de\s+\d{1,2}\s+a\s+\d{1,2}|hasta\s+las|almorzar|almuerzo|salgo|horario)\b/;
/** Mensaje que solo indica horario (p. ej. «Salgo a almorzar 12:30 a 13:30»). */
export function isScheduleOnly(text:string):boolean {
  const n=norm(text);
  return SCHEDULE_REF.test(n) && !PLACE_REF.test(n) && !/\b(?:calle|avenida|av|ruta|barrio|casa|nro|numero)\b/.test(n) && !/https?:\/\//.test(text);
}
export function isPlaceReference(text:string):boolean { return PLACE_REF.test(norm(text)); }
function humanName(text:string, expecting:boolean):string|null {
  const cleaned=text.trim().replace(/^(?:me llamo|mi nombre es|soy)\s+/i, "").replace(/\s+soy\s*$/i, "").trim();
  if(NOT_A_NAME.test(norm(cleaned)))return null;
  if(!expecting&&!/^(?:me llamo|mi nombre es)\s+/i.test(text))return null;
  if(!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[\s'-]+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,5}$/.test(cleaned))return null;
  if(/\b(?:pago|pagos|pagar|pago al recibir|recibir|recibo|transferencia|transferir|efectivo|contado|contra|contraentrega|deposito|giro|comprobante|tarjeta|cuota|cuotas|envio|delivery|direccion|dirección|avenida|avda|calle|si|no|ok|dale|listo|gracias|hola|buenas|precio|costo|cuanto|foto|disponible|unidad|und|quiero|tenes|tienen)\b/i.test(norm(cleaned)))return null;
  if(/\b(?:quiero|litros|gracias|buenas|cuanto|cuando|llegaria|llega|entrega|pedido|precio|ciudad|calle|preguntando|garantia|tarda|demora|necesito|saber|como|donde|favor|dale|ok|esta|bien|si|no|perfecto|listo|ubicacion|maps|numero|direccion)\b/i.test(cleaned))return null;
  return cleaned;
}
/** Extrae solo información reconocible, sin adivinar nombres o domicilios. */
function extractCheckoutDetails(raw:string, expecting:boolean, city?:string|null):{name?:string;street?:string;alternatePhone?:string} {
  const text=raw.trim();
  if(!expecting || !text || /[¿?]/.test(text) || /^(?:s[ií]|dale|ok|claro|perfecto|est[aá] bien|gracias|por favor|listo)(?:\s|[!.]|$)/i.test(text)) return {};
  const output:{name?:string;street?:string;alternatePhone?:string}={};
  // WhatsApp: si se incluye un número secundario, es opcional. Nunca se exige.
  const phone=text.match(/(?:otro\s+n[uú]mero|n[uú]mero\s+alternativo|tel[eé]fono\s+alternativo|contacto\s+alternativo)\s*(?::|es)?\s*(\+?\d[\d\s-]{7,17}\d)/i);
  if(phone) output.alternatePhone=phone[1].replace(/[^\d+]/g, "");
  // Teléfono suelto en su propia línea (p. ej. «0981-385913»); nunca la cédula.
  if(!output.alternatePhone) {
    const bare=(text.split(/[\n;]+/).map(t=>t.trim()).find(t=>/^\+?0?\d[\d\s-]{6,}$/.test(t)) ?? null);
    if(bare) output.alternatePhone=bare.replace(/[^\d+]/g, "");
  }
  const cleaned=text.replace(/(?:otro\s+n[uú]mero|n[uú]mero\s+alternativo|tel[eé]fono\s+alternativo|contacto\s+alternativo)\s*(?::|es)?\s*\+?\d[\d\s-]{7,17}\d/ig, "").trim();
  // Admite: "Juan Pérez, calle ...", "Soy Juan Pérez, vivo en ...", y campos etiquetados.
  const nameLabel=cleaned.match(/(?:nombre(?:\s+y\s+apellido)?\s*[:=-]\s*|me\s+llamo\s+|soy\s+)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '-]+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){1,4})(?=\s*[,;\n]|\s+(?:direcci[oó]n|calle|av(?:enida)?\.?|vivo\s+en)\b|$)/i);
  // Un punto seguido de otra oración puede separar nombre y domicilio: "Bernardino Roa. Maskoy 1364".
  const parts=cleaned.split(/[,;\n]+|\.\s+(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/).map(t=>t.trim()).filter(Boolean);
  const first=parts[0]?.replace(/^(?:mi\s+nombre\s+es|nombre\s*[:=-]|soy)\s*/i, "");
  const rawName=nameLabel?.[1] || (first && humanName(first,true) ? first : null);
  if(rawName && humanName(rawName,true) && !(city && norm(rawName)===norm(city))) output.name=rawName.trim();
  let addr=cleaned.match(/(?:direcci[oó]n\s*[:=-]\s*|vivo\s+en\s+)(.+)$/i)?.[1]?.trim();
  if(!addr && parts.length>1 && output.name) {
    // Nunca tomar la cédula, un teléfono suelto ni la propia ciudad como dirección.
    const rest=parts.slice(1).filter(t=>!/^(?:\b(?:ci|c[eé]dula|c\.?\s*i\.?)\b|\+?0?\d[\d\s.-]*$)/i.test(t) && !(city && norm(t)===norm(city)));
    if(rest.length) addr=rest.join(", ");
  }
  if(!addr && !output.name && /\b(?:calle|avenida|av\.|ruta|barrio|casa|frente|esquina|casi)\b/i.test(cleaned)) addr=cleaned;
  const map=cleaned.match(/https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.[^\s/]+\/maps|maps\.google\.[^\s/]+)\/[^\s,;]+/i);
  if(map) addr=[addr && !addr.includes(map[0]) ? addr : null, map[0]].filter(Boolean).join(" | ");
  if(addr) {
    addr=addr.replace(/(?:otro\s+n[uú]mero|contacto\s+alternativo)\s*[:=-]?.*$/i,"").trim();
    if(addr.length>=8 && !isScheduleOnly(addr) && !/^(?:no\s+tengo|no\s+hay|no\s+se)$/i.test(addr)) output.street=addr;
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
  // Audios: la transcripción suele confundir «litros» con «libros».
  if (/\blibros?\b/i.test(text) && ctx.products.some(p=>/litro/i.test(JSON.stringify(p)))) {
    text = text.replace(/\blibro(s?)\b/gi, "litro$1");
  }
  // Un mensaje (sobre todo un audio) puede traer ciudad + dirección Y además una
  // pregunta («¿Cuándo me traen?»). Guardar los datos de la parte afirmativa;
  // la IA igual responde la pregunta con el mensaje completo.
  if (/[¿?]/.test(text) && !/https?:\/\//i.test(text)) {
    const declarative = text
      .replace(/¿[^?]*\?/g, " ")
      .split(/(?<=[.!\n])/)
      .filter(part => !/\?\s*$/.test(part.trim()))
      .join(" ")
      .replace(/\s+/g, " ").trim();
    if (declarative.length >= 3 && !/[¿?]/.test(declarative)) {
      return advanceRuleSale(ctx, declarative, existing, mediaPath, sharedLocationUrl);
    }
  }
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
  const ci=extractRecipientCiFromCustomerText(text,s.awaiting==="recipient_ci");
  if (ci) s.recipientCi=ci;
  const variants=opts(p);
  // «?» después de una selección no es una pregunta técnica: continuar la
  // compra pendiente sin borrar producto, variante, cantidad, ciudad o GPS.
  // No registrar pedidos ni elegir una variante por inferencia.
  if (isNudge && !s.quantity && !s.optionId && !s.cartLines?.length && variants.length > 1) {
    s.awaiting="variant";
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
      if(cart.some(c=>!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>25)) {
        s.awaiting="variant";
        return {reply:"",state:s,productId:p.id,complete:false,needsAi:true};
      }
      s.cartLines=cart;s.optionId=cart[0].optionId;
      s.quantity=cart.reduce((sum,c)=>sum+c.quantity,0);
    }
    // Nunca cambiar el carrito por una respuesta suelta «Ok» o por repetir «ambos».
  }
  // Dato técnico: una sola respuesta puede incluir presentación y ciudad,
  // p.ej. «2 para Capiatá». Separarlas ANTES de reconocer la variante evita
  // perder la elección y NO genera preguntas ni mensajes comerciales.
  const coverage=parseCoverage(ctx.training);
  const match=cityIn(text,coverage);
  const destinationAlias = match
    ? [match.city,...match.aliases].map(alias=>norm(alias)).filter(alias=>alias.length>=3)
        .sort((a,b)=>b.length-a.length).find(alias=>n.endsWith(` para ${alias}`))
    : null;
  const selectionText=destinationAlias
    ? n.slice(0,-(` para ${destinationAlias}`).length).trim()
    : text;
  const chosen=s.cartLines?.length ? null : selectOption(selectionText,variants,s.awaiting==="variant");
  if(chosen) {
    s.optionId=chosen.id;
    // Una opción etiquetada «N unidades» es un paquete, distinto de «N litros».
    if (/\b(?:unidad(?:es)?|piezas?|caja(?:s)?|pack(?:s)?)\b/.test(norm(chosen.label))) s.quantity=chosen.quantity;
  }
  // NO interpretar "5 litros" como cantidad cinco.
  const expectingQuantity=s.awaiting==="quantity";
  if(!units(n)) {
    const q=countOf(selectionText,expectingQuantity);
    // «2 cajas (8 unidades)» selecciona el paquete que INCLUYE 8 unidades.
    // El «2» es el número de cajas, no una cantidad adicional para recalcular
    // el precio oficial del paquete. No pisar quantity de product_prices.
    const chosePackage = Boolean(chosen && /\b(?:caja(?:s)?|pack(?:s)?|combo(?:s)?)\b/.test(norm(chosen.label)) && chosen.quantity > 1);
    if(q && !s.cartLines?.length && !chosePackage)s.quantity=q;
  } else {
    // "uno de 5 litros" sí comunica cantidad 1 explícita.
    const match=n.match(/\b(un|uno|una|dos|tres|\d+)\s+de\s+\d+\s*(?:litros?|l|lts?)\b/);
    if(match&&!s.cartLines?.length)s.quantity=({un:1,uno:1,una:1,dos:2,tres:3}[match[1]]??Number(match[1]));
  }
  const nationalDestination = sellerAllowsNationwideAdvance(ctx.training) && !gpsUrl
    ? nationwideDestinationFromText(text) : null;
  const hasAddressWords=/\b(?:calle|esquina|casi|barrio|referencia|avenida|avda|av|cuadras?|direccion)\b/.test(n);
  // Mensaje completo: «Estoy en la ciudad de X … Mi dirección es …». Tomar
  // ciudad Y dirección del mismo mensaje en lugar de quedarse sin responder.
  // «En Fernando de la Mora, zona sur, … esquina …»: la ciudad viene al inicio,
  // antes de la primera coma/punto, aunque después haya palabras de dirección.
  const leadSegment = text.split(/[,.;\n]/)[0] ?? "";
  const leadCity = match ? cityIn(leadSegment, coverage) : null;
  const explicitCity=/\b(?:ciudad de|vivo en|soy de|estoy (?:en|n) (?:la ciudad de )?|departamento|depto)\b/.test(n) || s.awaiting==="city" ||
    Boolean(leadCity && match && norm(leadCity.city)===norm(match.city)) || Boolean(match && !s.cityVerified && s.productId);
  if(match && !gpsUrl && (!hasAddressWords || explicitCity)){
    s.city=match.city;s.department=match.department;s.cityVerified=true;s.coverageStatus=match.active?"covered":"uncovered";
    if(hasAddressWords && (!s.street || s.street===s.locationUrl)){
      const addr=text.match(/(?:mi\s+)?direcci[oó]n\s*(?:es|:)?\s*(.{6,200})/i)?.[1]
        ?? text.match(/\b((?:calle|avenida|avda\.?|av\.?|barrio)\s.{4,200})/i)?.[1];
      if(addr)s.street=addr.trim().replace(/[.\s]+$/,"");
    }
  }
  else if(nationalDestination && !/\b(?:calle|esquina|casi|barrio|referencia)\b/.test(n)) {
    // Municipio/departamento de referencia, no disponibilidad de transporte.
    s.city=nationalDestination.city;s.department=nationalDestination.department;
    s.cityVerified=true;s.coverageStatus="uncovered";s.paymentMethod="anticipado";
  }
  else if(s.awaiting==="city" && !gpsUrl && !s.cityVerified) {
    // Mensaje multilínea (nombre, cédula, teléfono y ciudad juntos): la ciudad
    // es la línea que coincide con la lista de cobertura.
    const lineHit=text.split(/[\n;]+/).map(t=>t.trim()).find(line=>{
      const ln=norm(line);
      return ln.length>=3 && ln.length<=45 && /^[a-z ]+$/.test(ln) && cityIn(line,coverage);
    });
    const lineCoverage=lineHit ? cityIn(lineHit,coverage) : null;
    if(lineCoverage) {
      s.city=lineCoverage.city;s.department=lineCoverage.department;s.cityVerified=true;s.coverageStatus=lineCoverage.active?"covered":"uncovered";
    } else if(n.length>=3 && n.length<=55 && /^[a-z ]+$/.test(n)) {
      // La ciudad sola no determina el departamento. Solicitar aclaración, sin inventar.
      s.city = text.trim();
      s.department = null;
      s.cityVerified = false;
      s.coverageStatus="unknown";
    }
  }

  if (!match && sellerAllowsNationwideAdvance(ctx.training) && !gpsUrl &&
      (s.awaiting === "city" || (s.city && !s.cityVerified))) {
    const destination=declaredDestination(text);
    if(destination) {
      const listed=verifiedCoverage(destination.city,destination.department,coverage);
      s.city=listed?.city ?? destination.city;
      s.department=listed?.department ?? destination.department;
      s.cityVerified=true; // Ciudad/departamento declarados por el cliente; no equivale a verificación logística.
      s.coverageStatus=listed?.active ? "covered" : "uncovered";
    } else if(s.city && !s.cityVerified && /^[\p{L} .'-]{3,45}$/u.test(text.trim()) &&
             !/\b(?:quiero|litros|gracias|costo|pedido|precio|envio)\b/i.test(text)) {
      const candidate=verifiedCoverage(s.city,text.trim(),coverage);
      s.department=candidate?.department ?? text.trim();
      s.cityVerified=true; // Declarado expresamente, pendiente de confirmación logística real.
      s.coverageStatus=candidate?.active ? "covered" : "uncovered";
    }
  }
  if(s.cityVerified && (s.awaiting==="details" || s.awaiting==="address" || s.awaiting==="name" || s.awaiting==="city")) {
    const details=extractCheckoutDetails(text,true,s.city);
    if(details.name && !s.customerName)s.customerName=details.name;
    if(details.street && (!s.street || s.street === s.locationUrl))s.street=details.street;
    if(details.alternatePhone && !s.alternatePhone)s.alternatePhone=details.alternatePhone;
  }
  if(s.cityVerified && (s.awaiting==="name" || /^\s*(?:me llamo|mi nombre es)\b/i.test(text))) {
    const name=humanName(text,s.awaiting==="name");if(name)s.customerName=name;
  }
  // Horario de entrega: se guarda aparte y nunca reemplaza la dirección.
  if(s.cityVerified && SCHEDULE_REF.test(n)) {
    const note=text.trim().slice(0,200);
    if(!(s.deliveryNotes??"").includes(note)) s.deliveryNotes=[s.deliveryNotes,note].filter(Boolean).join(" · ");
  }
  // Lugar de entrega dicho en cualquier momento («Estoy en el aeropuerto…», «traémelo a mi trabajo…»).
  if(s.cityVerified && !gpsUrl && isPlaceReference(text) && !/[¿?]/.test(text) && (!s.street || s.street===s.locationUrl)) {
    s.street=text.trim().replace(/[,;.]?\s*(?:me\s+avis\w*|avisame|avisas)\b.*$/i,"").replace(/^(?:y\s+)?(?:estoy\s+en|quiero\s+que\s+me\s+traigas\s+(?:en|a))\s+/i,"").trim() || text.trim();
  }
  if(s.cityVerified && s.awaiting==="address" && !isScheduleOnly(text) && !match && !gpsUrl && n.length>=6 && !/^(?:si|no|hola|gracias|si por favor|dale|ok)$/.test(n) && !/\b(?:ubicacion|maps|pedido|precio|llega|ya te|ya le|pase|comparti|envie|mand[eé])\b/.test(n))s.street=text.trim();
  if(/\b(?:transferencia|transferir|anticipado|deposito|giro)\b/.test(n))s.paymentMethod="anticipado";
  // El mensaje del cliente no puede cambiar la política logística de la ciudad.
  // Mantener la modalidad oficial incluso si el estado previo traía un dato incorrecto.
  if (s.cityVerified) {
    const policy = deliveryPolicyForCity(s.city,s.department,ctx.training);
    if (policy?.paymentMethod) s.paymentMethod = policy.paymentMethod;
  }
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
  // BOT SKY: el código únicamente extrae y conserva datos. El TEXTO de cada
  // consulta y pregunta de venta lo genera la IA usando el entrenamiento.
  if (variants.length === 1 && !s.optionId) s.optionId=variants[0].id;
  const selected=variants.find(o=>o.id===s.optionId)??null;
  const location=s.city && s.department ? verifiedCoverage(s.city,s.department,coverage):null;
  const national=s.cityVerified && Boolean(s.city && s.department) &&
    sellerAllowsNationwideAdvance(ctx.training) && !location?.active;
  if(location?.active && /contra entrega|contraentrega/i.test(norm(location.method)))s.paymentMethod="contraentrega";
  else if(s.cityVerified && (national || (location && /encomienda|anticipado|transferencia/i.test(norm(location.method)))))s.paymentMethod="anticipado";
  // Nunca usar un comprobante simplemente adjunto como validación del importe.
  const receiptVerified=Boolean(s.receiptPath && !s.receiptReview && s.receiptDocuments?.length);
  const encomienda=isEncomiendaAdvanceOrder(ctx.training,s.city,s.department,s.paymentMethod);
  void encomienda; // la cédula de encomienda se pide después de confirmar el pedido
  const needsAddress=s.paymentMethod==="contraentrega" && location?.addressRequired!==false;
  const validPrice=Boolean(s.cartLines?.length || (selected && priceFor(p,selected,s.quantity??0)) ||
    (variants.length===0 && s.quantity && priceFor(p,null,s.quantity)));
  if (variants.length>1 && !selected && !s.cartLines?.length) s.awaiting="variant";
  else if (!s.city || !s.cityVerified || !s.department) s.awaiting="city";
  else if (!s.quantity || s.quantity<1 || !validPrice) s.awaiting="quantity";
  else if (!s.paymentMethod) s.awaiting="payment";
  else if (s.paymentMethod==="anticipado" && !receiptVerified) s.awaiting="receipt";
  else if (!s.customerName) s.awaiting="name";
  else if (needsAddress && !s.street && !s.locationUrl) s.awaiting="address";
  else s.awaiting=null;
  const complete=Boolean(s.awaiting===null && s.cityVerified &&
    (location?.active || national || Boolean(location && /encomienda|anticipado|transferencia/i.test(norm(location.method)))));
  return {reply:"",state:s,productId:p.id,complete,needsAi:true};
}


/** Detecta marcadores de plantilla que la IA nunca debe enviar al cliente. */
export function hasTemplatePlaceholder(reply: string): boolean {
  return /\[(?:PRECIO|URL|NOMBRE|TOTAL|MONTO|CIUDAD|PRODUCTO)[^\]]*\]|URL_DE_LA_IMAGEN|\(URL[^)]*\)/i.test(reply);
}

/** Respaldo determinista: en ciudades con pago al recibir, quitar datos bancarios y pedido de comprobante. */
export function stripBankDetailsForCod(reply: string): string {
  return reply.split("\n")
    .filter(l => !/(?:banco|titular|c[eé]dula|cuenta desde|alias|eko|comprobante|realices el pago|transferencia)/i.test(l))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
