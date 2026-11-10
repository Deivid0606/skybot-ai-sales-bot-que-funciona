import { getGeminiCandidates, wellFormedJson, isKeyTemporarilyUnavailable, markKeyUnavailable, type AiContext } from "@/lib/ai.server";
import { findParaguayPlace } from "@/lib/py-cities";
import { normalizeNoShipping, cityIn, parseCoverage, nationwideDestinationFromText, deliveryPolicyForCity, sellerAllowsNationwideAdvance, type SaleState } from "@/lib/rule-sales.server";
import { isValidCustomerName, isValidDeliveryAddress } from "@/lib/sale-reconciliation.server";

/**
 * La IA ENTIENDE la compra (como funcionaba antes): lee la conversación y
 * devuelve lo que el cliente dijo, en cualquier redacción. El código solo
 * VERIFICA cada dato (catálogo, cobertura del vendedor, texto real del cliente)
 * antes de guardarlo. Este paso nunca escribe mensajes al cliente.
 */
export type AiSaleExtraction = {
  option_id: string | null;
  city: string | null;
  place_kind: "city" | "barrio" | null;
  customer_name: string | null;
  address: string | null;
  /** Qué contiene el ÚLTIMO mensaje del cliente (análisis previo a responder). */
  last_kinds?: string[];
  phone?: string | null;
  /** Día u horario en que el cliente puede recibir («a partir del miércoles de 7 a 13 hs»). */
  delivery_note?: string | null;
};

export const MESSAGE_KINDS = ["ciudad", "nombre", "direccion", "telefono", "ubicacion", "cantidad", "producto", "pregunta", "pago", "saludo", "otro"] as const;

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const str = (v: unknown) => typeof v === "string" && v.trim() && !/^(?:null|none|-)$/i.test(v.trim()) ? v.trim() : null;

function buildPrompt(ctx: AiContext, state: SaleState): string {
  const product = ctx.products.find(p => p.id === state.productId);
  const options = (product?.product_prices ?? []).filter(o => Number(o.price) > 0)
    .map(o => `- id:${o.id} | ${o.label} | Gs. ${Math.round(Number(o.price)).toLocaleString("es-PY")}`).join("\n");
  const known = JSON.stringify({
    opcion_elegida: product?.product_prices?.find(o => o.id === state.optionId)?.label ?? null,
    ciudad: state.cityVerified ? state.city : null, nombre: state.customerName ?? null,
    direccion: state.street ?? (state.locationUrl ? "ubicación GPS recibida" : null),
  });
  return `Sos el asistente que ENTIENDE una venta por WhatsApp de una tienda de Paraguay. No le escribís al cliente: solo leés la conversación de la COMPRA ACTUAL y devolvés los datos que el CLIENTE dio, en cualquier forma de escribir (errores, abreviaturas, guaraní, mensajes cortos).
PRODUCTO: ${product?.name ?? "-"}
OPCIONES REALES DEL CATÁLOGO:
${options || "-"}
DATOS YA GUARDADOS: ${known}

Devolvé SOLO un objeto JSON con estas claves:
{"option_id":null,"city":null,"place_kind":null,"customer_name":null,"address":null,"phone":null,"delivery_note":null,"last_kinds":[]}
- option_id: el id de la opción que el cliente ELIGIÓ o aceptó («3 seria», «la de 99 mil», «el de 2», «sí» a una opción que el bot le propuso, «quiero 1» cuando existe una opción de 1 unidad). null si no eligió ninguna o si pidió una cantidad que no existe.
- city: la ciudad donde el cliente quiere RECIBIR el pedido, escrita completa y correcta (ej. «CDE» → «Ciudad del Este», «Mariano» → «Mariano Roque Alonso»). null si no la dijo. Una pregunta como «¿envían a Luque?» también cuenta como destino. La ciudad de la tienda o una ciudad que solo nombró el bot NO cuentan.
- place_kind: "barrio" si lo que dio es un barrio, zona, compañía o asentamiento y no una ciudad; "city" si es una ciudad; null si no dio lugar.
- customer_name: nombre y apellido de quien recibe, copiado TAL COMO lo escribió el cliente. null si no lo dio. Nunca uses el nombre del perfil, del titular bancario ni del comprobante.
- address: la dirección de entrega con referencia, copiada como la escribió el cliente (calle, barrio con referencia, punto conocido). null si no la dio. «No estoy», horarios, «te paso después» o una ciudad sola NO son dirección.
- delivery_note: día u horario en que el cliente puede recibir el pedido, juntando lo que dijo en varios mensajes («a partir del miércoles, de 7 a 13 hs»). null si no dijo.
- phone: otro número de teléfono que el cliente dio para la entrega, tal cual; null si no dio.
- last_kinds: ANALIZÁ SOLO EL ÚLTIMO MENSAJE DEL CLIENTE y listá qué datos contiene, usando estas etiquetas: "ciudad" (nombra la ciudad donde quiere recibir), "nombre" (su nombre y apellido), "direccion" (calle, barrio con referencia, punto de referencia de entrega), "telefono", "ubicacion" (GPS o enlace de mapa), "cantidad", "producto" (elige o nombra producto/opción), "pregunta", "pago" (forma de pago), "saludo", "otro". Un nombre de persona NUNCA es "ciudad" aunque un apellido coincida con una ciudad («Jorge Maciel» es nombre). Una frase como «ya hice mi pedido número 38» es "otro", no "direccion". Una calle o avenida («Avd Fernando de la Mora», «2998» como número de casa) es "direccion", nunca "nombre". Ejemplo: «Juan Pérez, Luque, calle Brasil casi Ruta 2» → ["nombre","ciudad","direccion"].
Usá solo mensajes del CLIENTE como fuente. Si un dato cambió, devolvé el último que dio.`;
}

function historyText(ctx: AiContext): string {
  return ctx.history.slice(-16).map(h => `${h.role === "user" ? "CLIENTE" : "BOT"}: ${h.content.slice(0, 600)}`).join("\n");
}

export async function callJson(ctx: AiContext, system: string, user: string, maxTokens = 400): Promise<string> {
  const failures: string[] = [];
  const providers: Array<[string, string | null | undefined]> = [
    ["gemini", ctx.geminiApiKey], ["gemini", ctx.geminiApiKey2], ["gemini", ctx.geminiApiKey3], ["openai", ctx.openaiApiKey]];
  const tried = new Set<string>();
  for (const [provider, rawKey] of providers) {
    const key = rawKey?.trim();
    if (!key || tried.has(key) || isKeyTemporarilyUnavailable(key)) continue;
    tried.add(key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      if (provider === "openai") {
        const model = ctx.providerModels?.openai?.trim() || "gpt-4o-mini";
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: wellFormedJson({ model, temperature: 0, max_completion_tokens: maxTokens, response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        });
        if (!res.ok) throw new Error(`openai ${res.status}`);
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
        if (data.usage) console.info("[BOT_SKY_AI_USAGE]", JSON.stringify({ stage: "sale_extraction", provider: "openai", model, input_tokens: data.usage.prompt_tokens ?? 0, output_tokens: data.usage.completion_tokens ?? 0, total_tokens: data.usage.total_tokens ?? 0 }));
        const raw = data.choices?.[0]?.message?.content ?? "";
        if (raw.trim()) return raw;
      } else {
        const model = getGeminiCandidates(ctx.model)[0];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
          body: wellFormedJson({ systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0, responseMimeType: "application/json" } }),
        });
        if (!res.ok) throw new Error(`gemini ${res.status}`);
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
        if (data.usageMetadata) console.info("[BOT_SKY_AI_USAGE]", JSON.stringify({ stage: "sale_extraction", provider: "gemini", model, input_tokens: data.usageMetadata.promptTokenCount ?? 0, output_tokens: data.usageMetadata.candidatesTokenCount ?? 0, total_tokens: data.usageMetadata.totalTokenCount ?? 0 }));
        const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
        if (raw.trim()) return raw;
      }
      throw new Error(`${provider} vacío`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(reason);
      markKeyUnavailable(key, reason);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Extracción IA sin proveedor disponible: ${failures.join(" | ")}`);
}

export async function extractSaleWithAi(ctx: AiContext, state: SaleState): Promise<AiSaleExtraction | null> {
  const raw = await callJson(ctx, buildPrompt(ctx, state), `CONVERSACIÓN (la última línea es el mensaje actual):\n${historyText(ctx)}`);
  const json = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1)) as Record<string, unknown>;
  const kind = str(parsed.place_kind);
  return {
    option_id: str(parsed.option_id),
    city: str(parsed.city),
    place_kind: kind === "barrio" ? "barrio" : kind === "city" ? "city" : null,
    customer_name: str(parsed.customer_name),
    address: str(parsed.address),
    phone: str(parsed.phone),
    delivery_note: str(parsed.delivery_note),
    last_kinds: Array.isArray(parsed.last_kinds)
      ? (parsed.last_kinds as unknown[]).map(k => String(k).toLowerCase()).filter(k => (MESSAGE_KINDS as readonly string[]).includes(k))
      : undefined,
  };
}

/**
 * Verifica y guarda lo que entendió la IA. Solo completa datos que faltan:
 * nunca pisa un dato ya verificado. Devuelve los campos aplicados.
 */
export function applyAiExtraction(ctx: AiContext, state: SaleState, ext: AiSaleExtraction, customerTexts: string[]): string[] {
  const applied: string[] = [];
  const said = ` ${norm(customerTexts.join(" "))} `;
  const wordsSaid = (value: string) => {
    const words = norm(value).split(" ").filter(w => w.length >= 2);
    return words.length > 0 && words.every(w => said.includes(` ${w} `));
  };
  const product = ctx.products.find(p => p.id === state.productId);
  // 1) Opción del catálogo: el id tiene que existir en product_prices.
  const option = ext.option_id ? product?.product_prices?.find(o => o.id === ext.option_id && Number(o.price) > 0) : null;
  if (option && !state.optionId && !state.cartLines?.length) {
    state.optionId = option.id;
    if (/\b(?:unidad(?:es)?|piezas?|caja(?:s)?|pack(?:s)?|combo(?:s)?)\b/.test(norm(option.label)) || !state.quantity) state.quantity = option.quantity || 1;
    applied.push("option");
  }
  // 2) Ciudad: la forma de pago sale SIEMPRE de la cobertura del vendedor.
  if (ext.city && !state.cityVerified) {
    const coverage = parseCoverage(ctx.training);
    // Una ciudad REAL de Paraguay nunca es «barrio», aunque la IA lo haya
    // marcado así («Concepción barrio Inmaculada», «Pedro Juan Caballero»).
    const lastText = customerTexts[customerTexts.length - 1] ?? "";
    const geo = findParaguayPlace(ext.city) ?? (ext.place_kind === "barrio" ? findParaguayPlace(lastText) : null);
    const geoSaid = geo && (wordsSaid(geo.city.replace(/\(.*\)/, "")) || findParaguayPlace(lastText)?.city === geo.city);
    if (geo && geoSaid) ext = {...ext, place_kind: "city", city: geo.city};
    const covered = ext.place_kind === "barrio" ? null : cityIn(ext.city!, coverage);
    const coveredSaid = covered && [covered.city, ...covered.aliases].some(a => norm(a).length >= 3 && said.includes(` ${norm(a)} `));
    // Geografía (no cobertura): identifica municipio y departamento para cualquier vendedor.
    const national = ext.place_kind === "barrio" ? null
      : (geo && geoSaid ? geo
        : sellerAllowsNationwideAdvance(ctx.training) ? (nationwideDestinationFromText(ext.city!) ?? nationwideDestinationFromText(`para ${ext.city}`)) : null);
    if (ext.place_kind === "barrio") {
      if (!state.pendingPlace && wordsSaid(ext.city!)) { state.pendingPlace = ext.city; applied.push("barrio"); }
    } else if (covered && coveredSaid) {
      state.city = covered.city; state.department = covered.department; state.cityVerified = true;
      state.coverageStatus = covered.active ? "covered" : "uncovered"; state.pendingPlace = null;
      applied.push("city");
    } else if (national && (wordsSaid(national.city.replace(/\(.*\)/, "")) || (geo && geoSaid && national.city === geo.city))) {
      state.city = national.city; state.department = national.department; state.cityVerified = true;
      state.coverageStatus = "uncovered"; state.pendingPlace = null;
      applied.push("city");
    }
    if (state.cityVerified) {
      const policy = deliveryPolicyForCity(state.city, state.department, ctx.training);
      if (policy?.paymentMethod) state.paymentMethod = policy.paymentMethod;
      // Fuera de la cobertura: pago anticipado solo si el entrenamiento del vendedor lo permite.
      else if (state.coverageStatus === "uncovered" && sellerAllowsNationwideAdvance(ctx.training)) state.paymentMethod = "anticipado";
      normalizeNoShipping(state, ctx.training);
    }
  }
  // 3) Nombre: tiene que estar escrito por el cliente y ser un nombre válido.
  if (ext.customer_name && !state.customerName && isValidCustomerName(ext.customer_name) && wordsSaid(ext.customer_name) &&
      !cityIn(ext.customer_name, parseCoverage(ctx.training))) {
    state.customerName = ext.customer_name.replace(/\s+/g, " ").trim();
    applied.push("name");
  }
  // 4) Dirección: solo contraentrega y escrita por el cliente.
  const cod = /contra ?entrega/i.test(String(state.paymentMethod ?? "")) || state.coverageStatus === "covered";
  if (ext.address && cod && !state.street && isValidDeliveryAddress(ext.address)) {
    const words = norm(ext.address).split(" ").filter(w => w.length >= 3);
    const hits = words.filter(w => said.includes(` ${w} `)).length;
    if (words.length && hits / words.length >= 0.8) { state.street = ext.address.trim(); applied.push("address"); }
  }
  return applied;
}


/**
 * «Primero analizar, después responder»: un dato que las reglas de código
 * cambiaron en ESTE turno (ciudad, dirección o nombre) solo se acepta si el
 * análisis de la IA lo respalda: el último mensaje trae ese tipo de dato, o la
 * IA entiende ese mismo valor para la compra. Si no, se vuelve al valor anterior.
 * Si el último mensaje cambia de ciudad y la IA entendió una ciudad real, gana la IA.
 */
export function vetoUnsupportedChanges(ctx: AiContext, stored: SaleState, next: SaleState, ext: AiSaleExtraction | null, said: string[]): string[] {
  if (!ext || !Array.isArray(ext.last_kinds)) return [];
  const kinds = new Set(ext.last_kinds);
  const reverted: string[] = [];
  const same = (a: unknown, b: unknown) => norm(a) !== "" && norm(a) === norm(b);
  const sameCity = (a: unknown, b: unknown) => {
    if (same(a, b)) return true;
    const pa = findParaguayPlace(String(a ?? "")); const pb = findParaguayPlace(String(b ?? ""));
    return Boolean(pa && pb && pa.city === pb.city);
  };
  // Ciudad
  if (!same(next.city, stored.city) && next.city && !kinds.has("ciudad") && !sameCity(ext.city, next.city)) {
    next.city = stored.city ?? null; next.department = stored.department ?? null;
    next.cityVerified = stored.cityVerified; next.coverageStatus = stored.coverageStatus;
    next.paymentMethod = stored.paymentMethod ?? null; next.pendingPlace = stored.pendingPlace ?? null;
    reverted.push("ciudad");
  }
  // Cambio de ciudad en el último mensaje: gana lo que entendió la IA (si es real).
  if (kinds.has("ciudad") && ext.city && ext.place_kind !== "barrio" && next.cityVerified && !sameCity(ext.city, next.city)) {
    const coverage = parseCoverage(ctx.training);
    const place = findParaguayPlace(ext.city);
    const listed = cityIn(ext.city, coverage) ?? (place ? cityIn(place.city, coverage) : null);
    const lastSaid = ` ${norm(said[said.length - 1] ?? "")} `;
    if ((listed || place) && norm(ext.city).split(" ").filter(w => w.length >= 3).some(w => lastSaid.includes(` ${w} `))) {
      next.city = listed?.city ?? place!.city; next.department = listed?.department ?? place!.department;
      next.cityVerified = true; next.coverageStatus = listed?.active ? "covered" : "uncovered";
      const policy = deliveryPolicyForCity(next.city, next.department, ctx.training);
      next.paymentMethod = policy?.paymentMethod ?? (sellerAllowsNationwideAdvance(ctx.training) && !listed?.active ? "anticipado" : null);
      reverted.push("ciudad→ia");
    }
  }
  // Dirección
  if (!same(next.street, stored.street) && next.street && next.street !== next.locationUrl &&
      !kinds.has("direccion") && !kinds.has("ubicacion") && !same(ext.address, next.street)) {
    next.street = stored.street; reverted.push("direccion");
  }
  // Nombre
  if (!same(next.customerName, stored.customerName) && next.customerName && !kinds.has("nombre") && !same(ext.customer_name, next.customerName)) {
    next.customerName = stored.customerName; reverted.push("nombre");
  }
  // El último mensaje trae el nombre y la IA lo entendió: gana sobre lo que adivinó una regla
  // («Avd fernandonde la Mora» guardado como nombre y después «Richard Mendez»).
  const lastSaid = ` ${norm(said[said.length - 1] ?? "")} `;
  const recentSaid = ` ${norm(said.slice(-6).join(" "))} `;
  const words = (v: string) => norm(v).split(" ").filter(w => w.length >= 2);
  if (kinds.has("nombre") && ext.customer_name && isValidCustomerName(ext.customer_name) && !same(ext.customer_name, next.customerName) &&
      words(ext.customer_name).every(w => lastSaid.includes(` ${w} `)) && !cityIn(ext.customer_name, parseCoverage(ctx.training))) {
    next.customerName = ext.customer_name.replace(/\s+/g, " ").trim(); reverted.push("nombre→ia");
  }
  // Dirección dicha en uno o varios mensajes seguidos («Avd fernandonde la Mora» + «2998»).
  if (kinds.has("direccion") && ext.address && isValidDeliveryAddress(ext.address) && !same(ext.address, next.street)) {
    const w = norm(ext.address).split(" ").filter(x => x.length >= 3 || /^\d+$/.test(x));
    if (w.length && w.filter(x => recentSaid.includes(` ${x} `)).length / w.length >= 0.75) {
      next.street = ext.address.trim(); reverted.push("direccion→ia");
    }
  }
  // Horario o día de entrega: se anota para el pedido; nunca es la dirección.
  if (ext.delivery_note && !(next.deliveryNotes ?? "").includes(ext.delivery_note)) {
    const w = norm(ext.delivery_note).split(" ").filter(x => x.length >= 3);
    if (w.length && w.filter(x => recentSaid.includes(` ${x} `) || ` ${norm(said.join(" "))} `.includes(` ${x} `)).length / w.length >= 0.6) {
      next.deliveryNotes = ext.delivery_note.slice(0, 200);
    }
  }
  return reverted;
}
