import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceId } from "@/lib/auth";

export function BalanceBadge() {
  const workspaceId = useWorkspaceId();

  const { data } = useQuery({
    queryKey: ["balance", workspaceId],
    enabled: Boolean(workspaceId),
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversation_balances")
        .select("available, purchased, consumed")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const available = data?.available ?? 0;

  return (
    <Link to="/planes" className="hidden sm:block">
      <Badge
        variant={available > 50 ? "secondary" : "destructive"}
        className="gap-1 font-normal"
        title="Conversaciones disponibles"
      >
        <Wallet className="h-3 w-3" />
        {available} conv.
      </Badge>
    </Link>
  );
}
