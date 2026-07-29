import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ReviewInput = z.object({
  purchaseId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export const reviewPlanPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("No autorizado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: purchase, error } = await supabaseAdmin
      .from("plan_purchases")
      .select("*")
      .eq("id", data.purchaseId)
      .single();
    if (error || !purchase) throw new Error("Solicitud no encontrada");
    if (purchase.status !== "pendiente") throw new Error("La solicitud ya fue procesada");

    await supabaseAdmin
      .from("plan_purchases")
      .update({
        status: data.approve ? "aprobado" : "rechazado",
        approved_at: data.approve ? new Date().toISOString() : null,
        admin_note: data.note ?? null,
      })
      .eq("id", purchase.id);

    if (data.approve) {
      const { data: balance } = await supabaseAdmin
        .from("conversation_balances")
        .select("id, available, purchased")
        .eq("workspace_id", purchase.workspace_id)
        .maybeSingle();

      if (balance) {
        await supabaseAdmin
          .from("conversation_balances")
          .update({
            available: balance.available + purchase.conversations,
            purchased: balance.purchased + purchase.conversations,
          })
          .eq("id", balance.id);
      } else {
        await supabaseAdmin.from("conversation_balances").insert({
          workspace_id: purchase.workspace_id,
          user_id: purchase.user_id,
          available: purchase.conversations,
          purchased: purchase.conversations,
        });
      }
    }

    await supabaseAdmin.from("notifications").insert({
      workspace_id: purchase.workspace_id,
      user_id: purchase.user_id,
      type: "recarga",
      title: data.approve ? "Recarga aprobada" : "Recarga rechazada",
      body: data.approve
        ? `Se acreditaron ${purchase.conversations} conversaciones a tu cuenta.`
        : (data.note ?? "Tu solicitud fue rechazada."),
      link: "/planes",
      audience: "user",
    });

    return { ok: true };
  });

const StatusInput = z.object({
  profileId: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected", "blocked", "active", "suspended"]),
  message: z.string().trim().max(300).optional(),
});

export const updateUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("No autorizado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status: data.status, status_message: data.message ?? null })
      .eq("id", data.profileId);
    if (error) throw error;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("workspace_id")
      .eq("id", data.profileId)
      .single();

    await supabaseAdmin.from("notifications").insert({
      workspace_id: profile?.workspace_id ?? null,
      user_id: data.profileId,
      type: "cuenta",
      title: `Estado de cuenta: ${data.status}`,
      body: data.message ?? null,
      audience: "user",
    });

    return { ok: true };
  });
