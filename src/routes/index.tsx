import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bot,
  BarChart3,
  MessagesSquare,
  ShoppingBag,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BOT SKY — Vende por WhatsApp con inteligencia artificial" },
      {
        name: "description",
        content:
          "BOT SKY conecta tu WhatsApp Business, entrena tu propia IA de ventas, atiende conversaciones en tiempo real y crea pedidos automáticamente.",
      },
      { property: "og:title", content: "BOT SKY — Ventas automáticas por WhatsApp con IA" },
      {
        property: "og:description",
        content:
          "Automatiza tus ventas por WhatsApp: catálogo, entrenamiento de IA, inbox en tiempo real, pedidos y métricas por anuncio.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: MessagesSquare,
    title: "Inbox en tiempo real",
    text: "Todas tus conversaciones de WhatsApp en un solo lugar, con etiquetas, filtros y control de IA por chat.",
  },
  {
    icon: Bot,
    title: "IA entrenada por ti",
    text: "Reglas, horarios, cobertura, objeciones y técnicas de cierre. La IA responde solo con tu información.",
  },
  {
    icon: ShoppingBag,
    title: "Pedidos automáticos",
    text: "Cuando la IA detecta la compra, valida los datos, confirma con el cliente y crea el pedido.",
  },
  {
    icon: BarChart3,
    title: "Métricas por anuncio",
    text: "Sabe qué anuncio genera mensajes, ventas y facturación real, con filtros por rango de fechas.",
  },
  {
    icon: Zap,
    title: "Seguimientos escalonados",
    text: "Recupera clientes que no respondieron con mensajes automáticos configurables por producto.",
  },
  {
    icon: ShieldCheck,
    title: "Multiusuario y seguro",
    text: "Aislamiento total por vendedor, aprobación de cuentas y control de consumo por plan.",
  },
];

function Landing() {
  const { session } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bot className="h-5 w-5" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">BOT SKY</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {session ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Ir al panel</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/auth">Iniciar sesión</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/auth" search={{ mode: "signup" }}>
                    Crear cuenta
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="gradient-hero">
          <div className="mx-auto max-w-6xl px-4 py-24 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              WhatsApp Business Cloud API + IA
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
              Automatiza tus ventas por <span className="text-gradient">WhatsApp</span> con
              inteligencia artificial
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Conecta tu número, carga tu catálogo, entrena tu asistente y deja que BOT SKY atienda,
              responda y cierre pedidos por ti las 24 horas.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  Empezar ahora
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/auth">Ya tengo cuenta</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="border-border/70">
                <CardContent className="p-6">
                  <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-base font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
        BOT SKY · Plataforma de ventas automatizadas por WhatsApp
      </footer>
    </div>
  );
}
