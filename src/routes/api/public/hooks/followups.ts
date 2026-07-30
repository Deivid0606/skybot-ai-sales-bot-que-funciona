import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/followups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace("Bearer ", "");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || key !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { runDueFollowups } = await import("@/lib/followups.server");
        try {
          const result = await runDueFollowups();
          return Response.json({ success: true, ...result });
        } catch (e) {
          return new Response(
            JSON.stringify({
              success: false,
              error: e instanceof Error ? e.message : "error",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
