import { useMemo, useState } from "react";
import { formatDate, formatGs } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FileCheck2,
  ImageIcon,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  PageHeader,
  PageShell,
} from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useAuth } from "@/lib/auth";
import {
  MAX_FILE_BYTES,
  uploadWorkspaceFile,
} from "@/lib/storage";
import {
  fetchAppMessages,
  resolveMessage,
} from "@/lib/app-messages";

export const Route = createFileRoute(
  "/_authenticated/planes",
)({
  head: () => ({
    meta: [
      {
        title: "Planes y recargas — BOT SKY",
      },
      {
        name: "description",
        content:
          "Compra conversaciones y consulta tu saldo disponible.",
      },
      {
        property: "og:title",
        content:
          "Planes y recargas — BOT SKY",
      },
      {
        property: "og:description",
        content:
          "Planes de conversaciones para tu bot de ventas.",
      },
    ],
  }),

  component: PlansPage,
});

const PAYMENT_BUCKET = "payment-assets";

type SelectedPlan = {
  id: string;
  name: string;
  price: number;
  conversations: number;
};

type PaymentSettings = {
  id: number;
  title: string;
  message: string;
  bank_name: string | null;
  account_holder: string | null;
  account_number: string | null;
  document_number: string | null;
  payment_image_path: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function PlansPage() {
  const { profile, user } = useAuth();

  const workspaceId =
    profile?.workspace_id ?? null;

  const queryClient =
    useQueryClient();

  const [selected, setSelected] =
    useState<SelectedPlan | null>(null);

  const [file, setFile] =
    useState<File | null>(null);

  const [uploading, setUploading] =
    useState(false);

  // =========================================================
  // PLANES
  // =========================================================

  const {
    data: plans,
    isLoading: plansLoading,
  } = useQuery({
    queryKey: ["plans"],

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("plans")
          .select("*")
          .eq("is_active", true)
          .order("price");

      if (error) throw error;

      return data;
    },
  });

  // =========================================================
  // SALDO
  // =========================================================

  const {
    data: balance,
    isLoading: balanceLoading,
  } = useQuery({
    queryKey: [
      "balance",
      workspaceId,
    ],

    enabled:
      Boolean(workspaceId),

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from(
            "conversation_balances",
          )
          .select("*")
          .eq(
            "workspace_id",
            workspaceId!,
          )
          .maybeSingle();

      if (error) throw error;

      return data;
    },
  });

  // =========================================================
  // SOLICITUDES
  // =========================================================

  const {
    data: purchases,
    isLoading: purchasesLoading,
  } = useQuery({
    queryKey: [
      "purchases",
      workspaceId,
    ],

    enabled:
      Boolean(workspaceId),

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from("plan_purchases")
          .select("*")
          .eq(
            "workspace_id",
            workspaceId!,
          )
          .order("created_at", {
            ascending: false,
          });

      if (error) throw error;

      return data;
    },
  });

  // =========================================================
  // DATOS PARA PAGOS
  // =========================================================

  const {
    data: paymentSettings,
    isLoading:
      paymentSettingsLoading,
    error:
      paymentSettingsError,
  } = useQuery({
    queryKey: [
      "payment-settings",
    ],

    queryFn: async () => {
      const { data, error } =
        await supabase
          .from(
            "payment_settings",
          )
          .select("*")
          .eq("id", 1)
          .maybeSingle();

      if (error) throw error;

      return (
        data as PaymentSettings | null
      );
    },
  });

  // =========================================================
  // URL QR / IMAGEN
  // =========================================================

  const paymentImageUrl =
    useMemo(() => {
      const path =
        paymentSettings?.payment_image_path;

      if (!path) return null;

      const { data } =
        supabase.storage
          .from(PAYMENT_BUCKET)
          .getPublicUrl(path);

      return data.publicUrl;
    }, [
      paymentSettings?.payment_image_path,
    ]);

  // =========================================================
  // MENSAJES APP
  // =========================================================

  const { data: appMessages } =
    useQuery({
      queryKey: [
        "app-messages",
      ],

      queryFn:
        fetchAppMessages,
    });

  const noBalance =
    (balance?.available ?? 0) <=
    0;

  const noBalanceMsg =
    resolveMessage(
      appMessages,
      "no_balance",
    );

  // =========================================================
  // CERRAR MODAL
  // =========================================================

  function closeDialog() {
    if (
      request.isPending ||
      uploading
    ) {
      return;
    }

    setSelected(null);
    setFile(null);
  }

  // =========================================================
  // SELECCIONAR COMPROBANTE
  // =========================================================

  function handleReceiptFile(
    nextFile: File | null,
  ) {
    if (!nextFile) {
      setFile(null);
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    if (
      !allowedTypes.includes(
        nextFile.type,
      )
    ) {
      toast.error(
        "El comprobante debe ser JPG, PNG, WEBP o PDF.",
      );

      setFile(null);

      return;
    }

    if (
      nextFile.size >
      MAX_FILE_BYTES
    ) {
      toast.error(
        "El comprobante supera el tamaño máximo permitido.",
      );

      setFile(null);

      return;
    }

    setFile(nextFile);
  }

  // =========================================================
  // COPIAR DATOS
  // =========================================================

  async function copyValue(
    label: string,
    value: string,
  ) {
    try {
      await navigator.clipboard.writeText(
        value,
      );

      toast.success(
        `${label} copiado`,
      );
    } catch {
      toast.error(
        "No se pudo copiar el dato.",
      );
    }
  }

  // =========================================================
  // ENVIAR SOLICITUD
  // =========================================================

  const request = useMutation({
    mutationFn: async () => {
      if (
        !workspaceId ||
        !user ||
        !selected
      ) {
        throw new Error(
          "Sesión no válida",
        );
      }

      if (!paymentSettings) {
        throw new Error(
          "Los datos para realizar el pago todavía no fueron configurados.",
        );
      }

      if (
        !paymentSettings.is_active
      ) {
        throw new Error(
          "Las solicitudes de recarga están temporalmente deshabilitadas.",
        );
      }

      // COMPROBANTE OBLIGATORIO
      if (!file) {
        throw new Error(
          "Debes adjuntar el comprobante de pago.",
        );
      }

      if (
        file.size >
        MAX_FILE_BYTES
      ) {
        throw new Error(
          "El comprobante supera 25MB",
        );
      }

      setUploading(true);

      // SUBIR COMPROBANTE
      const receiptPath =
        await uploadWorkspaceFile(
          "receipts",
          workspaceId,
          file,
          "planes",
        );

      // GUARDAR SOLICITUD
      const { error } =
        await supabase
          .from("plan_purchases")
          .insert({
            workspace_id:
              workspaceId,

            user_id: user.id,

            plan_id:
              selected.id,

            plan_name:
              selected.name,

            amount:
              selected.price,

            conversations:
              selected.conversations,

            receipt_url:
              receiptPath,

            status:
              "pendiente",
          });

      if (error) throw error;
    },

    onSuccess: async () => {
      toast.success(
        "Solicitud enviada. Un administrador revisará tu comprobante.",
      );

      setSelected(null);
      setFile(null);

      await queryClient.invalidateQueries(
        {
          queryKey: [
            "purchases",
            workspaceId,
          ],
        },
      );
    },

    onError: (
      error: Error,
    ) => {
      toast.error(
        error.message,
      );
    },

    onSettled: () => {
      setUploading(false);
    },
  });

  // =========================================================
  // BOTÓN ENVIAR
  // =========================================================

  const canSubmit =
    Boolean(file) &&
    Boolean(paymentSettings) &&
    paymentSettings?.is_active ===
      true &&
    !request.isPending &&
    !uploading;

  return (
    <PageShell>
      <PageHeader
        title="Planes y recargas"
        description="Tu saldo se descuenta por conversación nueva atendida por la IA."
      />

      {/* =================================================== */}
      {/* SIN SALDO */}
      {/* =================================================== */}

      {noBalance &&
        !balanceLoading && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />

            <div>
              <p className="font-medium">
                {
                  noBalanceMsg.title
                }
              </p>

              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {
                  noBalanceMsg.body
                }
              </p>
            </div>
          </div>
        )}

      {/* =================================================== */}
      {/* BALANCE */}
      {/* =================================================== */}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label:
              "Disponibles",

            value:
              balance?.available ??
              0,
          },
          {
            label:
              "Compradas",

            value:
              balance?.purchased ??
              0,
          },
          {
            label:
              "Consumidas",

            value:
              balance?.consumed ??
              0,
          },
        ].map((stat) => (
          <Card
            key={
              stat.label
            }
          >
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">
                {
                  stat.label
                }
              </p>

              <p className="font-display text-2xl font-bold">
                {balanceLoading
                  ? "..."
                  : stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* =================================================== */}
      {/* PLANES */}
      {/* =================================================== */}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plansLoading &&
          Array.from({
            length: 3,
          }).map(
            (_, index) => (
              <Card
                key={
                  index
                }
              >
                <CardContent className="h-[230px] animate-pulse p-6" />
              </Card>
            ),
          )}

        {plans?.map(
          (plan) => (
            <Card
              key={
                plan.id
              }
              className="flex flex-col"
            >
              <CardContent className="flex flex-1 flex-col gap-3 p-6">
                <h3 className="font-display text-lg font-bold">
                  {
                    plan.name
                  }
                </h3>

                <p className="font-display text-3xl font-bold text-primary">
                  {formatGs(
                    plan.price,
                  )}
                </p>

                <p className="text-sm text-muted-foreground">
                  {
                    plan.conversations
                  }{" "}
                  conversaciones
                  {" · "}
                  sin
                  vencimiento
                </p>

                <ul className="space-y-1.5 text-sm">
                  {(
                    plan.benefits ??
                    []
                  ).map(
                    (
                      benefit,
                    ) => (
                      <li
                        key={
                          benefit
                        }
                        className="flex items-start gap-2"
                      >
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                        <span>
                          {
                            benefit
                          }
                        </span>
                      </li>
                    ),
                  )}
                </ul>

                <Button
                  className="mt-auto"
                  disabled={
                    paymentSettingsLoading ||
                    !paymentSettings ||
                    paymentSettings.is_active ===
                      false
                  }
                  onClick={() => {
                    setFile(
                      null,
                    );

                    setSelected(
                      {
                        id: plan.id,

                        name:
                          plan.name,

                        price:
                          Number(
                            plan.price,
                          ),

                        conversations:
                          plan.conversations,
                      },
                    );
                  }}
                >
                  Solicitar
                  recarga
                </Button>

                {paymentSettings?.is_active ===
                  false && (
                  <p className="text-center text-xs text-muted-foreground">
                    Recargas
                    temporalmente
                    deshabilitadas.
                  </p>
                )}
              </CardContent>
            </Card>
          ),
        )}
      </div>

      {/* =================================================== */}
      {/* ERROR DATOS DE PAGO */}
      {/* =================================================== */}

      {paymentSettingsError && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />

          <div>
            <p className="font-medium">
              No se pudieron
              cargar los datos
              para realizar el
              pago.
            </p>

            <p className="text-sm text-muted-foreground">
              Intenta
              nuevamente más
              tarde.
            </p>
          </div>
        </div>
      )}

      {/* =================================================== */}
      {/* MIS SOLICITUDES */}
      {/* =================================================== */}

      <Card>
        <CardContent className="p-5">
          <h2 className="font-display text-base font-semibold">
            Mis solicitudes
          </h2>

          <div className="mt-3 space-y-2">
            {purchasesLoading && (
              <p className="text-sm text-muted-foreground">
                Cargando
                solicitudes...
              </p>
            )}

            {!purchasesLoading &&
              !purchases?.length && (
                <p className="text-sm text-muted-foreground">
                  Aún no has
                  solicitado
                  recargas.
                </p>
              )}

            {purchases?.map(
              (purchase) => (
                <div
                  key={
                    purchase.id
                  }
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <span className="font-medium">
                    {
                      purchase.plan_name
                    }
                  </span>

                  <span className="text-muted-foreground">
                    {formatGs(
                      purchase.amount,
                    )}
                    {" · "}
                    {
                      purchase.conversations
                    }{" "}
                    conv.
                  </span>

                  <span className="text-xs text-muted-foreground">
                    {formatDate(
                      purchase.created_at,
                    )}
                  </span>

                  <Badge
                    className="ml-auto"
                    variant={
                      purchase.status ===
                      "aprobado"
                        ? "default"
                        : purchase.status ===
                            "rechazado"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {
                      purchase.status
                    }
                  </Badge>
                </div>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      {/* =================================================== */}
      {/* MODAL */}
      {/* =================================================== */}

      <Dialog
        open={Boolean(
          selected,
        )}
        onOpenChange={(
          open,
        ) => {
          if (!open) {
            closeDialog();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              Solicitar{" "}
              {
                selected?.name
              }
            </DialogTitle>

            <DialogDescription>
              Realiza el pago
              utilizando los
              datos indicados y
              adjunta tu
              comprobante para
              continuar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* ============================================= */}
            {/* PLAN SELECCIONADO */}
            {/* ============================================= */}

            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Plan
                seleccionado
              </p>

              <div className="mt-2 flex items-center justify-between gap-4">
                <div>
                  <p className="font-display text-lg font-bold">
                    {
                      selected?.name
                    }
                  </p>

                  <p className="text-sm text-muted-foreground">
                    {
                      selected?.conversations
                    }{" "}
                    conversaciones
                  </p>
                </div>

                <p className="whitespace-nowrap font-display text-2xl font-bold text-primary">
                  {formatGs(
                    selected?.price ??
                      0,
                  )}
                </p>
              </div>
            </div>

            {/* ============================================= */}
            {/* DATOS DE PAGO */}
            {/* ============================================= */}

            {paymentSettingsLoading ? (
              <div className="flex items-center justify-center rounded-xl border p-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : paymentSettings ? (
              <div className="overflow-hidden rounded-xl border">
                {/* CABECERA */}

                <div className="border-b bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary/10 p-2">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>

                    <div>
                      <p className="font-semibold">
                        {
                          paymentSettings.title
                        }
                      </p>

                      {paymentSettings.message && (
                        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                          {
                            paymentSettings.message
                          }
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* DATOS BANCARIOS */}

                <div className="space-y-2 p-4">
                  {paymentSettings.bank_name && (
                    <PaymentRow
                      label="Banco"
                      value={
                        paymentSettings.bank_name
                      }
                      onCopy={() =>
                        copyValue(
                          "Banco",
                          paymentSettings.bank_name!,
                        )
                      }
                    />
                  )}

                  {paymentSettings.account_holder && (
                    <PaymentRow
                      label="Titular"
                      value={
                        paymentSettings.account_holder
                      }
                      onCopy={() =>
                        copyValue(
                          "Titular",
                          paymentSettings.account_holder!,
                        )
                      }
                    />
                  )}

                  {paymentSettings.account_number && (
                    <PaymentRow
                      label="Cuenta / Alias"
                      value={
                        paymentSettings.account_number
                      }
                      onCopy={() =>
                        copyValue(
                          "Cuenta",
                          paymentSettings.account_number!,
                        )
                      }
                    />
                  )}

                  {paymentSettings.document_number && (
                    <PaymentRow
                      label="CI / RUC"
                      value={
                        paymentSettings.document_number
                      }
                      onCopy={() =>
                        copyValue(
                          "CI / RUC",
                          paymentSettings.document_number!,
                        )
                      }
                    />
                  )}
                </div>

                {/* QR */}

                {paymentImageUrl && (
                  <div className="border-t bg-muted/20 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-primary" />

                      <p className="text-sm font-medium">
                        Imagen /
                        QR para
                        realizar
                        el pago
                      </p>
                    </div>

                    <div className="flex justify-center overflow-hidden rounded-lg border bg-background p-3">
                      <img
                        src={
                          paymentImageUrl
                        }
                        alt="Datos para realizar el pago"
                        className="max-h-[350px] max-w-full rounded-md object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />

                <div>
                  <p className="font-medium">
                    Datos de pago
                    no configurados
                  </p>

                  <p className="text-sm text-muted-foreground">
                    Comunícate con
                    un
                    administrador.
                  </p>
                </div>
              </div>
            )}

            {/* ============================================= */}
            {/* COMPROBANTE */}
            {/* ============================================= */}

            <div className="space-y-2">
              <Label htmlFor="payment-receipt">
                Comprobante de
                pago *
              </Label>

              <Input
                id="payment-receipt"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(
                  event,
                ) => {
                  handleReceiptFile(
                    event.target
                      .files?.[0] ??
                      null,
                  );
                }}
              />

              <p className="text-xs text-muted-foreground">
                El comprobante
                es obligatorio.
                Podés enviar JPG,
                PNG, WEBP o PDF.
              </p>

              {/* ARCHIVO CARGADO */}

              {file && (
                <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {
                        file.name
                      }
                    </p>

                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(
                        file.size,
                      )}
                    </p>
                  </div>

                  <FileCheck2 className="ml-auto h-5 w-5 shrink-0 text-primary" />
                </div>
              )}

              {/* NO HAY ARCHIVO */}

              {!file && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0" />

                  Debes adjuntar
                  el comprobante
                  antes de
                  enviar la
                  solicitud.
                </div>
              )}
            </div>
          </div>

          {/* =============================================== */}
          {/* BOTONES */}
          {/* =============================================== */}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              disabled={
                request.isPending ||
                uploading
              }
              onClick={
                closeDialog
              }
            >
              Cancelar
            </Button>

            <Button
              type="button"
              disabled={
                !canSubmit
              }
              onClick={() =>
                request.mutate()
              }
            >
              {request.isPending ||
              uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}

              {request.isPending ||
              uploading
                ? "Enviando..."
                : "Enviar solicitud"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

// ===========================================================
// FILA DATO BANCARIO
// ===========================================================

function PaymentRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {label}
        </p>

        <p className="break-words text-sm font-medium">
          {value}
        </p>
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        onClick={onCopy}
        title={`Copiar ${label}`}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ===========================================================
// FORMAT FILE SIZE
// ===========================================================

function formatFileSize(
  bytes: number,
) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (
    bytes <
    1024 * 1024
  ) {
    return `${(
      bytes / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    1024 /
    1024
  ).toFixed(1)} MB`;
}
