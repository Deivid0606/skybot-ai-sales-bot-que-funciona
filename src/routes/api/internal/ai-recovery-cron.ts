import { createFileRoute } from "@tanstack/react-router";

/**
 * Private periodic recovery worker. Requires BOTSKY_CRON_SECRET and is invoked
 * by Supabase pg_cron. Never exposes customer details or API credentials.
 */
export const Route = createFileRoute("/api/internal/ai-recovery-cron")({
  server: {
    handlers: {
      POST: async ({request}) => {
        const expected=process.env.BOTSKY_CRON_SECRET;
        if(!expected) return Response.json({error:"Falta configuración de cron"},{status:503});
        if(request.headers.get("authorization")!==`Bearer ${expected}`)
          return Response.json({error:"No autorizado"},{status:401});
        try{
          const {processAiRecoveryBatch}=await import("@/lib/ai-recovery.server");
          return Response.json(await processAiRecoveryBatch());
        }catch(error){
          console.error("[BOT_SKY_AI_RECOVERY_CRON]",error);
          return Response.json({error:"No se pudo procesar la recuperación"},{status:500});
        }
      },
    },
  },
});
