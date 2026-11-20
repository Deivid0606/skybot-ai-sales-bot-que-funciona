import { useEffect, useState } from "react";
import { Check, Loader2, LogOut, Plus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addAnotherAccount,
  forgetSavedAccount,
  listSavedAccounts,
  switchToSavedAccount,
  useAuth,
  type SavedAccount,
} from "@/lib/auth";

/** Menú de cuenta: cambiar de tienda sin contraseña, agregar otra o cerrar sesión. */
export function AccountSwitcher({ onSignedOut }: { onSignedOut: () => void }) {
  const { user, profile, signOut } = useAuth();
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => setAccounts(listSavedAccounts());
  useEffect(reload, [user?.id, profile?.company]);

  const currentLabel = profile?.company || profile?.full_name || user?.email || "Mi cuenta";
  const others = accounts.filter((a) => a.userId !== user?.id);

  async function switchTo(account: SavedAccount) {
    setBusy(account.userId);
    const ok = await switchToSavedAccount(account.userId);
    if (ok) {
      // Recargar para que todas las pantallas muestren los datos de la otra tienda.
      window.location.assign("/dashboard");
      return;
    }
    setBusy(null);
    reload();
    toast.error(`La sesión de ${account.label} venció. Ingresá con la contraseña una vez y quedará guardada.`);
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && reload()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Cuenta y cambiar de tienda">
          <UserRound className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="truncate text-sm font-semibold">{currentLabel}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Cambiar a</DropdownMenuLabel>
            {others.map((account) => (
              <DropdownMenuItem
                key={account.userId}
                className="group gap-2"
                disabled={busy !== null}
                onSelect={(e) => {
                  e.preventDefault();
                  void switchTo(account);
                }}
              >
                {busy === account.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 opacity-0" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{account.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{account.email}</div>
                </div>
                <button
                  type="button"
                  aria-label={`Quitar ${account.label} de este navegador`}
                  className="rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    forgetSavedAccount(account.userId);
                    reload();
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={() => addAnotherAccount()}>
          <Plus className="h-4 w-4" /> Agregar otra cuenta
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={async () => {
            await signOut();
            onSignedOut();
          }}
        >
          <LogOut className="h-4 w-4" /> Cerrar sesión en este dispositivo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
