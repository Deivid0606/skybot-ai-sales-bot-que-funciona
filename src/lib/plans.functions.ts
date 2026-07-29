import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PlanInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  price: z.number().min(0),
  conversations: z.number().int().min(1),
  duration_days: z.number().int().min(1),
  benefits: z.array(z.string().min(1)).max(10),
  is_active: z.boolean(),
});

export const savePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PlanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("No autorizado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("plans")
        .update({
          name: data.name,
          price: data.price,
          conversations: data.conversations,
          duration_days: data.duration_days,
          benefits: data.benefits,
          is_active: data.is_active,
        })
        .eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("plans")
      .insert({
        name: data.name,
        price: data.price,
        conversations: data.conversations,
        duration_days: data.duration_days,
        benefits: data.benefits,
        is_active: data.is_active,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: inserted.id };
  });

const DeletePlanInput = z.object({
  id: z.string().uuid(),
});

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeletePlanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("No autorizado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("plans").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
