import { useEffect, useState } from "react";
import { Monitor, Smartphone, Tablet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ViewMode = "celular" | "tableta" | "escritorio";

const STORAGE_KEY = "botsky-view-mode";
// Ancho con el que se dibuja la app en cada modo.
const WIDTHS: Record<ViewMode, number | null> = { celular: null, tableta: 820, escritorio: 1280 };
// Tamaño del marco de vista previa en computadoras.
const FRAMES: Record<Exclude<ViewMode, "escritorio">, { width: number; height: number }> = {
  celular: { width: 390, height: 844 },
  tableta: { width: 820, height: 1180 },
};
const ICONS: Record<ViewMode, typeof Monitor> = { celular: Smartphone, tableta: Tablet, escritorio: Monitor };
const LABELS: Record<ViewMode, string> = { celular: "Celular", tableta: "Tableta", escritorio: "Escritorio" };

const isTouchDevice = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const insidePreview = () => {
  try { return window.self !== window.top; } catch { return true; }
};

/** En celulares y tabletas el navegador respeta el ancho del viewport: se redibuja la app. */
function applyViewport(mode: ViewMode) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const width = WIDTHS[mode];
  meta.content = width ? `width=${width}` : "width=device-width, initial-scale=1";
}

function readStoredMode(): ViewMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "celular" || value === "tableta" || value === "escritorio" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Botón «Modo celular / tableta / escritorio».
 * - En celular o tableta: cambia cómo se dibuja la app (y lo recuerda).
 * - En computadora: celular y tableta abren una vista previa con ese tamaño.
 */
export function ViewModeToggle() {
  const [touch, setTouch] = useState(false);
  const [mode, setMode] = useState<ViewMode>("escritorio");
  const [preview, setPreview] = useState<Exclude<ViewMode, "escritorio"> | null>(null);

  useEffect(() => {
    const isTouch = isTouchDevice();
    setTouch(isTouch);
    if (isTouch) {
      const stored = readStoredMode();
      const initial = stored ?? (window.innerWidth < 768 ? "celular" : "tableta");
      setMode(initial);
      if (stored) applyViewport(stored);
      // Si al navegar se vuelve a escribir el viewport original, se reaplica el modo elegido.
      const meta = document.querySelector('meta[name="viewport"]');
      if (!meta) return;
      const observer = new MutationObserver(() => {
        const chosen = readStoredMode();
        const width = chosen ? WIDTHS[chosen] : null;
        if (width && !meta.getAttribute("content")?.includes(`width=${width}`)) applyViewport(chosen!);
      });
      observer.observe(meta, { attributes: true, attributeFilter: ["content"] });
      return () => observer.disconnect();
    }
  }, []);

  // Dentro de la vista previa no se muestra el botón (evita vistas anidadas).
  if (typeof window !== "undefined" && insidePreview()) return null;

  function choose(next: ViewMode) {
    if (touch) {
      setMode(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* sin almacenamiento */ }
      applyViewport(next);
      return;
    }
    setPreview(next === "escritorio" ? null : next);
  }

  const current: ViewMode = touch ? mode : preview ?? "escritorio";
  const Icon = ICONS[current];
  const frame = preview ? FRAMES[preview] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Modo de vista: ${LABELS[current]}`} title="Modo celular, tableta o escritorio">
            <Icon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{touch ? "Ver la app como" : "Vista previa"}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={current} onValueChange={(value) => choose(value as ViewMode)}>
            {(["celular", "tableta", "escritorio"] as const).map((option) => {
              const OptionIcon = ICONS[option];
              return (
                <DropdownMenuRadioItem key={option} value={option} className="gap-2">
                  <OptionIcon className="h-4 w-4" /> {LABELS[option]}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {frame && preview && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center gap-3 overflow-auto bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Vista previa en ${LABELS[preview]}`}>
          <div className="flex w-full max-w-[880px] items-center justify-between gap-2 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {preview === "celular" ? <Smartphone className="h-4 w-4" /> : <Tablet className="h-4 w-4" />}
              Vista {LABELS[preview].toLowerCase()} · {frame.width}px
            </div>
            <div className="flex items-center gap-1">
              {(["celular", "tableta"] as const).map((option) => (
                <Button key={option} size="sm" variant={option === preview ? "secondary" : "ghost"} className="text-white" onClick={() => setPreview(option)}>
                  {LABELS[option]}
                </Button>
              ))}
              <Button size="icon" variant="ghost" className="text-white" aria-label="Cerrar vista previa" onClick={() => setPreview(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <iframe
            title={`BOT SKY en ${LABELS[preview]}`}
            src={window.location.href}
            className="shrink-0 rounded-[28px] border-8 border-neutral-800 bg-background shadow-2xl"
            style={{ width: frame.width + 16, height: Math.min(frame.height, window.innerHeight - 90) }}
          />
        </div>
      )}
    </>
  );
}
