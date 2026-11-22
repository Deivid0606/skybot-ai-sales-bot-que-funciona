/**
 * Pestaña «Mi negocio»: identidad de la tienda y horarios de entrega.
 * Se usa en el navegador (formulario con datos sugeridos) y en el servidor
 * (instrucciones para la IA). Sin dependencias del servidor.
 */
export type Tone = "amable" | "formal" | "emojis";
export type DeliveryDay = { day: number; active: boolean; from: string; to: string };
export type BusinessProfile = {
  store_name: string | null;
  assistant_name: string | null;
  tone: Tone;
  greeting: string | null;
  delivery_days: DeliveryDay[];
  cutoff_time: string | null;
  no_holiday_delivery: boolean;
  bot_always_on: boolean;
};

export const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ASSISTANT_NAMES = ["Sofi", "Vale", "Cami", "Mica", "Luli", "Abi", "Belu", "Ana", "Male", "Romi", "Caro", "Nati", "Pau", "Flor", "Lola", "Juli"];

/** Nombre de asistente sugerido, fijo para cada tienda (no cambia entre mensajes). */
export function defaultAssistantName(workspaceId: string): string {
  let h = 0;
  for (const ch of workspaceId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ASSISTANT_NAMES[h % ASSISTANT_NAMES.length];
}

export const DEFAULT_DELIVERY_DAYS: DeliveryDay[] = [
  { day: 1, active: true, from: "08:00", to: "18:00" },
  { day: 2, active: true, from: "08:00", to: "18:00" },
  { day: 3, active: true, from: "08:00", to: "18:00" },
  { day: 4, active: true, from: "08:00", to: "18:00" },
  { day: 5, active: true, from: "08:00", to: "18:00" },
  { day: 6, active: true, from: "08:00", to: "13:00" },
  { day: 0, active: false, from: "08:00", to: "12:00" },
];

export function defaultGreeting(assistant: string, store: string): string {
  return `¡Hola! Soy ${assistant} de ${store} 😊`;
}

/** «MEGA TODO STORE» → «Mega Todo Store» (las siglas cortas como «PY» quedan igual). */
export function prettyStoreName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n || n !== n.toUpperCase() || !/[A-ZÁÉÍÓÚÑ]{3}/.test(n)) return n;
  return n.split(" ").map(w => w.length <= 2 ? w : w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

/** Nombre de asistente que el vendedor ya escribió en su entrenamiento («Tu nombre es Laura»). */
export function assistantNameFromTraining(texts: string[]): string | null {
  const re = /(?:[Tt]u nombre(?: completo)? es|[Tt]e llam[aá]s|(?:[Ll]a |[Ee]l )?(?:[Aa]sistente|[Aa]sesora|[Vv]endedora) (?:se llama|llamad[ao]))\s+[*_«"']*([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]{1,14})/;
  for (const t of texts) {
    const m = String(t ?? "").match(re);
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return null;
}

/** Datos sugeridos para una tienda que todavía no completó la pestaña. */
export function suggestedProfile(workspaceId: string, storeName: string, preferredAssistant?: string | null): BusinessProfile {
  const store = prettyStoreName(storeName) || "la tienda";
  const assistant = preferredAssistant?.trim() || defaultAssistantName(workspaceId);
  return {
    store_name: store, assistant_name: assistant, tone: "amable", greeting: defaultGreeting(assistant, store),
    delivery_days: DEFAULT_DELIVERY_DAYS.map(d => ({ ...d })), cutoff_time: "12:30",
    no_holiday_delivery: true, bot_always_on: true,
  };
}

/** Feriados de fecha fija de Paraguay (MM-DD). Jueves y Viernes Santo varían y no se incluyen. */
const PY_FIXED_HOLIDAYS = new Set(["01-01", "03-01", "05-01", "05-14", "05-15", "06-12", "08-15", "09-29", "12-08", "12-25"]);

function asuncionNow(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(now).map(p => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
const toMin = (hhmm: string | null | undefined) => {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Día de entrega de un pedido confirmado en `now` (fecha local de Paraguay a medianoche UTC). */
function nextDeliverySlot(profile: BusinessProfile, now: Date): { date: Date; offset: number; rule: DeliveryDay } | null {
  const days = profile.delivery_days.filter(d => d.active);
  if (!days.length) return null;
  const t = asuncionNow(now);
  const cutoff = toMin(profile.cutoff_time);
  for (let offset = 0; offset < 14; offset++) {
    const date = new Date(Date.UTC(t.y, t.m - 1, t.d + offset));
    const weekday = date.getUTCDay();
    const rule = days.find(d => d.day === weekday);
    if (!rule) continue;
    const mmdd = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    if (profile.no_holiday_delivery && PY_FIXED_HOLIDAYS.has(mmdd)) continue;
    if (offset === 0) {
      const end = toMin(rule.to);
      if ((cutoff !== null && t.minutes > cutoff) || (end !== null && t.minutes >= end)) continue;
    }
    return { date, offset, rule };
  }
  return null;
}

/** Próximo día de entrega según días, corte y feriados (hora de Paraguay). */
export function nextDeliveryText(profile: BusinessProfile, now = new Date()): string | null {
  const slot = nextDeliverySlot(profile, now);
  if (!slot) return null;
  const { date, offset, rule } = slot;
  const weekday = date.getUTCDay();
  const when = offset === 0 ? `HOY (${DAY_NAMES[weekday]})` : offset === 1 ? `MAÑANA (${DAY_NAMES[weekday]})` : `el ${DAY_NAMES[weekday].toLowerCase()} ${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
  return `${when}, entre las ${rule.from} y las ${rule.to}`;
}

/** ¿Un pedido confirmado en `confirmedAt` se entrega HOY (fecha de Paraguay de `now`)? */
export function deliveryIsToday(profile: BusinessProfile, confirmedAt: Date, now = new Date()): boolean {
  const slot = nextDeliverySlot(profile, confirmedAt);
  if (!slot) return false;
  const t = asuncionNow(now);
  return slot.date.getTime() === Date.UTC(t.y, t.m - 1, t.d);
}

/** ¿Un pedido confirmado en este momento sale HOY? (días de entrega, hora de corte y feriados). */
export function sameDayDeliveryOpen(profile: BusinessProfile, at = new Date()): boolean {
  return deliveryIsToday(profile, at, at);
}

/**
 * El texto promete entrega/envío PARA HOY («sale hoy», «te llega hoy», «se entregará hoy»).
 * No cuenta: «si pedís hoy, te llega mañana», «hoy ya no llegamos», «hoy no hay entregas».
 */
export function promisesSameDayDelivery(text: string): boolean {
  const verbs = String.raw`(?:entreg\w*|env[ií]\w*|lleg\w*|sale|salir\w*|saldr\w*|despach\w*|programad\w*|en camino|recib\w*|te lo (?:llevamos|traemos)|lo (?:llevamos|traemos))`;
  const promise = new RegExp(String.raw`${verbs}[^,;]{0,40}\bhoy\b|\bhoy\b[^,;]{0,40}${verbs}`, "i");
  const clauses = text.split(/[.;!?\n,]+|\s(?:pero|aunque|y)\s/i);
  return clauses.some(raw => {
    // «Si pedís/confirmás hoy» habla de cuándo pide el cliente, no de cuándo llega.
    const clause = raw.replace(/\b(?:ped[ií]s|pedir|pide|pido|ped[ií]|confirm[aá]s|confirmar|confirmo|compr[aá]s|comprar|compro|hac[eé]s el pedido)\s+(?:el pedido\s+)?hoy\b/gi, " ");
    if (!/\bhoy\b/i.test(clause)) return false;
    // Negación o la próxima fecha en la misma frase: no promete hoy.
    if (/\b(?:no|ya no|nunca|tampoco|ma[nñ]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|pr[oó]xim\w*|siguiente)\b/i.test(clause)) return false;
    return promise.test(clause);
  });
}

const TONE_TEXT: Record<Tone, string> = {
  amable: "amable, cercano y breve, en español paraguayo",
  formal: "formal y respetuoso (usá «usted»), breve",
  emojis: "alegre y cercano, con emojis en cada mensaje, breve",
};

/**
 * Instrucciones para la IA. La identidad se aplica siempre (con los datos
 * sugeridos si el vendedor no guardó); los horarios solo si el vendedor guardó.
 */
export function businessProfileInstruction(profile: BusinessProfile, saved: boolean, now = new Date()): string {
  const store = profile.store_name?.trim() || "la tienda";
  const assistant = profile.assistant_name?.trim();
  const lines = [
    "IDENTIDAD DE LA TIENDA (pestaña «Mi negocio»; tiene prioridad sobre el entrenamiento):",
    `- Tienda: ${store}.`,
    assistant ? `- Te llamás ${assistant} y sos asesora de ventas de ${store}. Presentate con tu nombre solo en el primer saludo de cada conversación; nunca digas que sos un bot o una IA salvo que te lo pregunten directamente.` : "",
    `- Estilo: ${TONE_TEXT[profile.tone] ?? TONE_TEXT.amable}.`,
    profile.greeting?.trim() ? `- Saludo inicial sugerido: «${profile.greeting.trim()}».` : "",
  ];
  if (saved) {
    const days = profile.delivery_days.filter(d => d.active).sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7));
    const next = nextDeliveryText(profile, now);
    const todayOpen = sameDayDeliveryOpen(profile, now);
    lines.push(
      "HORARIO DE ENTREGAS (pestaña «Mi negocio»):",
      days.length ? `- Días de entrega: ${days.map(d => `${DAY_NAMES[d.day]} de ${d.from} a ${d.to}`).join("; ")}.` : "- No hay días de entrega cargados.",
      todayOpen
        ? (profile.cutoff_time ? `- Hora de corte: ${profile.cutoff_time}. Todavía estamos ANTES del corte: lo que se confirme ahora sale HOY.` : "")
        : `- HOY YA NO HAY ENTREGAS${profile.cutoff_time ? ` (la hora de corte de hoy, ${profile.cutoff_time}, ya pasó o hoy no se entrega)` : ""}. PROHIBIDO decir que sale, llega, se envía o se entrega hoy, y PROHIBIDO decir «si confirmás antes de las ${profile.cutoff_time ?? "…"}». Si el cliente lo quiere para hoy, decile con amabilidad que hoy ya no llegamos y ofrecé la próxima entrega.`,
      profile.no_holiday_delivery ? "- Feriados: no hay entregas." : "",
      next ? `- PRÓXIMA ENTREGA para un pedido confirmado AHORA: ${next}. Usá exactamente esto si preguntan cuándo llega; no inventes otras fechas.` : "",
      "- Si el cliente pide recibirlo MÁS ADELANTE (por ejemplo «el miércoles 25, cuando cobro»), aceptalo con gusto y confirmá esa fecha: NUNCA digas que no es una fecha válida. Lo único que no se puede es ANTES de la próxima entrega.",
      profile.bot_always_on
        ? "- Atención por WhatsApp: todos los días; seguí tomando pedidos aunque no sea horario de entrega."
        : "- Fuera del horario de entrega avisá con amabilidad que el pedido se entrega en el próximo horario, y tomá el pedido igual.",
    );
  }
  return lines.filter(Boolean).join("\n");
}

/** Normaliza lo guardado en la base (columnas sueltas) a BusinessProfile. */
export function profileFromRow(row: any, fallback: BusinessProfile): BusinessProfile {
  if (!row) return fallback;
  const days = Array.isArray(row.delivery_days) && row.delivery_days.length
    ? row.delivery_days.map((d: any) => ({ day: Number(d.day), active: d.active !== false, from: String(d.from ?? "08:00"), to: String(d.to ?? "18:00") }))
    : fallback.delivery_days;
  return {
    store_name: row.store_name?.trim() || fallback.store_name,
    assistant_name: row.assistant_name?.trim() || fallback.assistant_name,
    tone: ["amable", "formal", "emojis"].includes(row.tone) ? row.tone : fallback.tone,
    greeting: row.greeting?.trim() || fallback.greeting,
    delivery_days: days,
    cutoff_time: row.cutoff_time ?? null,
    no_holiday_delivery: row.no_holiday_delivery !== false,
    bot_always_on: row.bot_always_on !== false,
  };
}
