import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CreditCard,
  FileClock,
  Inbox,
  LayoutDashboard,
  MessageSquareCode,
  Package,
  Settings,
  ShoppingCart,
  Tags,
  Bell,
  Users,
  Wallet,
  Receipt,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

const sellerItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Inbox", url: "/inbox", icon: Inbox },
  { title: "Chat IA", url: "/chat-ia", icon: MessageSquareCode },
  { title: "Reclamos", url: "/reclamos", icon: AlertTriangle },
  { title: "Entrenamiento", url: "/entrenamiento", icon: Bot },
  { title: "Notificaciones", url: "/notificaciones", icon: Bell },
  { title: "Pedidos", url: "/pedidos", icon: ShoppingCart },
  { title: "Productos", url: "/productos", icon: Package },
  { title: "Etiquetas", url: "/etiquetas", icon: Tags },
  { title: "Planes", url: "/planes", icon: CreditCard },
  { title: "Configuraciones", url: "/configuraciones", icon: Settings },
] as const;

const adminItems = [
  { title: "Usuarios", url: "/admin/usuarios", icon: Users },
  { title: "Métricas globales", url: "/admin/metricas", icon: BarChart3 },
  { title: "Planes", url: "/admin/planes", icon: Receipt },
  { title: "Planes y pagos", url: "/admin/pagos", icon: Wallet },
  { title: "Registros", url: "/admin/registros", icon: FileClock },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin } = useAuth();
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  const isActive = (path: string) => currentPath === path;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Bot className="h-4.5 w-4.5" />
          </span>
          {!collapsed && (
            <span className="font-display text-base font-bold text-sidebar-foreground">
              BOT SKY
            </span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sellerItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
