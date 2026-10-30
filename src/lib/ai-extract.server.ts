import { getGeminiCandidates, isKeyTemporarilyUnavailable, markKeyUnavailable, type AiContext } from "@/lib/ai.server";
import { cityIn, parseCoverage, nationwideDestinationFromText, deliveryPolicyForCity, sellerAllowsNationwideAdvance, type SaleState } from "@/lib/rule-sales.server";
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
};

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
{"option_id":null,"city":null,"place_kind":null,"customer_name":null,"address":null}
- option_id: el id de la opción que el cliente ELIGIÓ o aceptó («3 seria», «la de 99 mil», «el de 2», «sí» a una opción que el bot le propuso, «quiero 1» cuando existe una opción de 1 unidad). null si no eligió ninguna o si pidió una cantidad que no existe.
- city: la ciudad donde el cliente quiere RECIBIR el pedido, escrita completa y correcta (ej. «CDE» → «Ciudad del Este», «Mariano» → «Mariano Roque Alonso»). null si no la dijo. Una pregunta como «¿envían a Luque?» también cuenta como destino. La ciudad de la tienda o una ciudad que solo nombró el bot NO cuentan.
- place_kind: "barrio" si lo que dio es un barrio, zona, compañía o asentamiento y no una ciudad; "city" si es una ciudad; null si no dio lugar.
- customer_name: nombre y apellido de quien recibe, copiado TAL COMO lo escribió el cliente. null si no lo dio. Nunca uses el nombre del perfil, del titular bancario ni del comprobante.
- address: la dirección de entrega con referencia, copiada como la escribió el cliente (calle, barrio con referencia, punto conocido). null si no la dio. «No estoy», horarios, «te paso después» o una ciudad sola NO son dirección.
Usá solo mensajes del CLIENTE como fuente. Si un dato cambió, devolvé el último que dio.`;
}

function historyText(ctx: AiContext): string {
  return ctx.history.slice(-16).map(h => `${h.role === "user" ? "CLIENTE" : "BOT"}: ${h.content.slice(0, 600)}`).join("\n");
}

async function callJson(ctx: AiContext, system: string, user: string): Promise<string> {
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
          body: JSON.stringify({ model, temperature: 0, max_completion_tokens: 400, response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        });
        if (!res.ok) throw new Error(`openai ${res.status}`);
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const raw = data.choices?.[0]?.message?.content ?? "";
        if (raw.trim()) return raw;
      } else {
        const model = getGeminiCandidates(ctx.model)[0];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
          method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: 400, temperature: 0, responseMimeType: "application/json" } }),
        });
        if (!res.ok) throw new Error(`gemini ${res.status}`);
        const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
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
  if (!state.productId) return null;
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
    const covered = ext.place_kind === "barrio" ? null : cityIn(ext.city, coverage);
    const coveredSaid = covered && [covered.city, ...covered.aliases].some(a => norm(a).length >= 3 && said.includes(` ${norm(a)} `));
    const national = ext.place_kind === "barrio" || !sellerAllowsNationwideAdvance(ctx.training) ? null
      : (nationwideDestinationFromText(ext.city) ?? nationwideDestinationFromText(`para ${ext.city}`));
    if (ext.place_kind === "barrio") {
      if (!state.pendingPlace && wordsSaid(ext.city)) { state.pendingPlace = ext.city; applied.push("barrio"); }
    } else if (covered && coveredSaid) {
      state.city = covered.city; state.department = covered.department; state.cityVerified = true;
      state.coverageStatus = covered.active ? "covered" : "uncovered"; state.pendingPlace = null;
      applied.push("city");
    } else if (national && wordsSaid(national.city.replace(/\(.*\)/, ""))) {
      state.city = national.city; state.department = national.department; state.cityVerified = true;
      state.coverageStatus = "uncovered"; state.pendingPlace = null;
      applied.push("city");
    }
    if (state.cityVerified) {
      const policy = deliveryPolicyForCity(state.city, state.department, ctx.training);
      if (policy?.paymentMethod) state.paymentMethod = policy.paymentMethod;
      else if (state.coverageStatus === "uncovered") state.paymentMethod = "anticipado";
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
