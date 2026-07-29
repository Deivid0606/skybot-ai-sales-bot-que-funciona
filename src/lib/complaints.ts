const RULES: { reason: string; severity: "alta" | "media"; words: string[] }[] = [
  {
    reason: "no_llego",
    severity: "alta",
    words: [
      "no llego",
      "no llegó",
      "no me llego",
      "no me llegó",
      "nunca llego",
      "nunca llegó",
      "no recibi",
      "no recibí",
      "sigo esperando",
      "no entregaron",
    ],
  },
  {
    reason: "producto_danado",
    severity: "alta",
    words: [
      "roto",
      "rota",
      "dañado",
      "danado",
      "defectuoso",
      "no funciona",
      "no anda",
      "vino mal",
      "llego mal",
      "llegó mal",
      "producto fallado",
      "fallado",
    ],
  },
  {
    reason: "estafa",
    severity: "alta",
    words: ["estafa", "estafaron", "ladrones", "denuncia", "denunciar", "abogado", "fraude"],
  },
  {
    reason: "reembolso",
    severity: "alta",
    words: [
      "devolucion",
      "devolución",
      "devuelvan",
      "reembolso",
      "quiero mi plata",
      "quiero mi dinero",
      "cancelar el pedido",
      "anular el pedido",
      "garantia",
      "garantía",
    ],
  },
  {
    reason: "demora",
    severity: "media",
    words: [
      "demora",
      "demorando",
      "tarda mucho",
      "tarde mucho",
      "hace dias",
      "hace días",
      "todavia espero",
      "todavía espero",
      "cuanto falta",
      "cuánto falta",
    ],
  },
  {
    reason: "mala_atencion",
    severity: "media",
    words: [
      "pesimo",
      "pésimo",
      "pesima",
      "pésima",
      "mal servicio",
      "mala atencion",
      "mala atención",
      "nadie responde",
      "no me responden",
      "no contestan",
      "reclamo",
      "reclamar",
      "queja",
      "me quejo",
      "estoy molesto",
      "estoy molesta",
      "indignado",
      "indignada",
      "enojado",
      "enojada",
      "una verguenza",
      "una vergüenza",
      "horrible",
    ],
  },
];

export const COMPLAINT_REASON_LABELS: Record<string, string> = {
  no_llego: "Pedido no recibido",
  producto_danado: "Producto dañado o fallado",
  estafa: "Acusación de estafa",
  reembolso: "Pide devolución / reembolso",
  demora: "Demora en la entrega",
  mala_atencion: "Mala atención / queja",
  general: "Reclamo general",
};

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectComplaint(
  body: string,
): { reason: string; severity: "alta" | "media"; matched: string } | null {
  const text = normalize(body);
  if (!text) return null;
  for (const rule of RULES) {
    const hit = rule.words.find((w) => text.includes(w));
    if (hit) return { reason: rule.reason, severity: rule.severity, matched: hit };
  }
  return null;
}
