import type { AiContext } from "@/lib/ai.server";
/** Los ajustes antiguos permanecen para compatibilidad con la base de datos. */
type Mode = "hybrid" | "ai_first" | "rules_only";
export type HybridSettings = { hybrid_mode?: Mode | null; hybrid_fallback_enabled?: boolean | null };
export type HybridDecision = { reply: string; productId: string | null; reason: string } | null;
/** Nunca redactar respuestas comerciales desde código. Catálogo = copy + imagen;
 * el resto de conversaciones se resuelven exclusivamente con IA + entrenamiento.
 * Un fallo del proveedor se registra como pendiente, no se finge atención.
 */
export function decideHybridReply(_args:{ctx:AiContext;text:string;mode:Mode;fallback?:boolean}): HybridDecision {
  return null;
}
