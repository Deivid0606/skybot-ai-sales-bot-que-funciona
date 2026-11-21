/**
 * Muletillas de bot («¡Estoy aquí para ayudarte!», «No dudes en consultarme»,
 * «¡Que tengas un excelente día!»). Un vendedor de verdad no cierra así cada mensaje.
 * Se quitan esas frases enteras; si el mensaje quedaría vacío, se deja como estaba.
 */
const FILLER_SENTENCE = new RegExp([
  String.raw`estoy (?:aqu[ií]|ac[aá]|para)\s+(?:para\s+)?(?:ayudarte|ayudar|lo que necesites|servirte)`,
  String.raw`estamos (?:aqu[ií]|ac[aá]|para)\s+(?:para\s+)?(?:ayudarte|ayudar|lo que necesites)`,
  String.raw`no dudes en`,
  String.raw`si ten[eé]s (?:alguna\s+)?(?:otra\s+)?(?:consulta|pregunta|duda)`,
  String.raw`si necesit[aá]s (?:algo m[aá]s|m[aá]s informaci[oó]n|ayuda)`,
  String.raw`(?:en )?qu[eé] m[aá]s (?:te )?puedo ayudar`,
  String.raw`que tengas un (?:excelente|lindo|buen|hermoso) d[ií]a`,
  String.raw`quedo (?:atent[oa]|a (?:tu|su) disposici[oó]n)`,
  String.raw`(?:estoy|quedo) a (?:tu|su) (?:entera )?disposici[oó]n`,
].join("|"), "i");

export function stripBotFillers(text: string): string {
  const original = text.trim();
  if (!original) return text;
  const lines = original.split("\n").map(line => {
    const parts = line.split(/(?<=[.!?…])\s+/);
    const kept = parts.filter(part => !(FILLER_SENTENCE.test(part) && !/¿/.test(part.replace(/¿[^?]*(?:qu[eé] m[aá]s|ayudar)[^?]*\?/gi, ""))));
    return kept.join(" ");
  });
  const cleaned = lines.join("\n")
    // Restos sueltos: emojis o signos solos al final.
    .replace(/(?:\s*[\p{Extended_Pictographic}\u{FE0F}!¡.])+\s*$/u, m => (/[\p{Extended_Pictographic}]/u.test(m) ? ` ${m.trim().replace(/^[!¡.\s]+/, "")}` : m))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  // Que quede algo con sentido (al menos 2 palabras); si no, mejor el original.
  return (cleaned.match(/\p{L}{2,}/gu) ?? []).length >= 2 ? cleaned : original;
}
