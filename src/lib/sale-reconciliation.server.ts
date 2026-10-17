import type { AiContext, AiOrder } from "@/lib/ai.server";
import type { SaleState } from "@/lib/rule-sales.server";
import { verifiedCoverage, parseCoverage } from "@/lib/rule-sales.server";

/** Mantiene exclusivamente datos del ciclo actual, comprobados por el motor. */
export function reconcileOrderWithSaleState(
  order: AiOrder | null,
  state: SaleState,
  training: AiContext["training"],
): AiOrder | null {
  if (!order) return null;
  const next: AiOrder = { ...order };
  const location = state.cityVerified && state.city && state.department
    ? verifiedCoverage(state.city, state.department, parseCoverage(training))
    : null;
  // La IA NO puede cambiar una ciudad ya verificada en el ciclo actual.
  if (location) {
    next.city = location.city;
    next.departamento = location.department;
  }
  if (state.customerName && !next.customer_name?.trim()) next.customer_name = state.customerName;
  if (state.street && !next.street?.trim()) next.street = state.street;
  if (state.locationUrl && !next.street?.trim()) next.street = state.locationUrl;
  if (state.paymentMethod && !next.payment_method?.trim()) next.payment_method = state.paymentMethod;
  if (state.optionId && !next.product_price_id) next.product_price_id = state.optionId;
  if (state.quantity && (!next.quantity || next.quantity < 1)) next.quantity = state.quantity;
  return next;
}
