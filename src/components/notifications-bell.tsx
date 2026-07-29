import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceId } from "@/lib/auth";

export function NotificationsBell() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const { data: count } = useQuery({
    queryKey: ["notifications-unread", workspaceId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <Button variant="ghost" size="icon" asChild aria-label="Notificaciones">
      <Link to="/notificaciones" className="relative">
        <Bell className="h-4 w-4" />
        {Boolean(count) && (
          <Badge className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]">
            {count}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
