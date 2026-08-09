import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MessageSquareWarning,
  Save,
  Trash2,
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  APP_MESSAGE_LABELS,
  DEFAULT_APP_MESSAGES,
  fetchAppMessages,
  type AppMessageKey,
} from "@/lib/app-messages";

export const Route = createFileRoute(
  "/_authenticated/admin/mensajes",
)({
  head: () => ({
    meta: [
      {
        title:
          "Mensajes del sistema — BOT SKY Admin",
      },
      {
        name: "description",
        content:
          "Editá los avisos del sistema y los datos para realizar pagos.",
      },
      {
        property: "og:title",
        content:
          "Mensajes del sistema — BOT SKY Admin",
      },
      {
        property: "og:description",
        content:
          "Personalizá avisos automáticos y datos para pagos de BOT SKY.",
      },
    ],
  }),

  component: AdminMessagesPage,
});

const KEYS = Object.keys(
  APP_MESSAGE_LABELS,
) as AppMessageKey[];

const PAYMENT_BUCKET = "payment-assets";

const MAX_PAYMENT_IMAGE_BYTES =
  10 * 1024 * 1024;

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

function getPaymentImageUrl(
  path?: string | null,
) {
  if (!path) return null;

  const { data } = supabase.storage
    .from(PAYMENT_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

function getImageExtension(file: File) {
  const extension = file.name
    .split(".")
    .pop()
    ?.toLowerCase();

  if (
    extension === "jpg" ||
    extension === "jpeg"
  ) {
    return "jpg";
  }

  if (extension === "png") {
    return "png";
  }

  if (extension === "webp") {
    return "webp";
  }

  return "jpg";
}

function AdminMessagesPage() {
  const queryClient = useQueryClient();

  // =========================================================
  // MENSAJES DEL SISTEMA
  // =========================================================

  const [form, setForm] = useState<
    Record<
      string,
      {
        title: string;
        body: string;
      }
    >
  >({});

  const {
    data: messages,
    isLoading: messagesLoading,
  } = useQuery({
    queryKey: ["app-messages"],
    queryFn: fetchAppMessages,
  });

  useEffect(() => {
    if (!messages) return;

    setForm(
      Object.fromEntries(
        KEYS.map((key) => [
          key,
          {
            title:
              messages[key]?.title ??
              DEFAULT_APP_MESSAGES[key].title,

            body:
              messages[key]?.body ??
              DEFAULT_APP_MESSAGES[key].body,
          },
        ]),
      ),
    );
  }, [messages]);

  const saveMessage = useMutation({
    mutationFn: async (
      key: AppMessageKey,
    ) => {
      const value = form[key];

      if (!value) {
        throw new Error(
          "No se encontró el mensaje.",
        );
      }

      const { error } = await supabase
        .from("app_messages")
        .upsert(
          {
            key,
            title: value.title.trim(),
            body: value.body.trim(),
          },
          {
            onConflict: "key",
          },
        );

      if (error) throw error;
    },

    onSuccess: () => {
      toast.success("Mensaje actualizado");

      queryClient.invalidateQueries({
        queryKey: ["app-messages"],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // =========================================================
  // DATOS PARA PAGOS
  // =========================================================

  const [paymentTitle, setPaymentTitle] =
    useState("");

  const [
    paymentMessage,
    setPaymentMessage,
  ] = useState("");

  const [bankName, setBankName] =
    useState("");

  const [
    accountHolder,
    setAccountHolder,
  ] = useState("");

  const [
    accountNumber,
    setAccountNumber,
  ] = useState("");

  const [
    documentNumber,
    setDocumentNumber,
  ] = useState("");

  const [paymentActive, setPaymentActive] =
    useState(true);

  const [paymentImage, setPaymentImage] =
    useState<File | null>(null);

  const [
    localImagePreview,
    setLocalImagePreview,
  ] = useState<string | null>(null);

  // =========================================================
  // CARGAR CONFIGURACIÓN
  // =========================================================

  const {
    data: paymentSettings,
    isLoading: paymentLoading,
    error: paymentError,
  } = useQuery({
    queryKey: ["payment-settings-admin"],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_settings")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (error) throw error;

      return data as PaymentSettings | null;
    },
  });

  // =========================================================
  // CARGAR DATOS EN FORMULARIO
  // =========================================================

  useEffect(() => {
    if (!paymentSettings) return;

    setPaymentTitle(
      paymentSettings.title ?? "",
    );

    setPaymentMessage(
      paymentSettings.message ?? "",
    );

    setBankName(
      paymentSettings.bank_name ?? "",
    );

    setAccountHolder(
      paymentSettings.account_holder ?? "",
    );

    setAccountNumber(
      paymentSettings.account_number ?? "",
    );

    setDocumentNumber(
      paymentSettings.document_number ?? "",
    );

    setPaymentActive(
      paymentSettings.is_active ?? true,
    );
  }, [paymentSettings]);

  // =========================================================
  // URL DE LA IMAGEN GUARDADA
  // =========================================================

  const savedImageUrl = useMemo(() => {
    return getPaymentImageUrl(
      paymentSettings?.payment_image_path,
    );
  }, [
    paymentSettings?.payment_image_path,
  ]);

  // =========================================================
  // PREVIEW DE IMAGEN NUEVA
  // =========================================================

  useEffect(() => {
    if (!paymentImage) {
      setLocalImagePreview(null);
      return;
    }

    const url =
      URL.createObjectURL(paymentImage);

    setLocalImagePreview(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [paymentImage]);

  const displayedImageUrl =
    localImagePreview ?? savedImageUrl;

  // =========================================================
  // SELECCIONAR IMAGEN
  // =========================================================

  function handlePaymentImage(
    file: File | null,
  ) {
    if (!file) {
      setPaymentImage(null);
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error(
        "La imagen debe ser JPG, PNG o WEBP.",
      );

      return;
    }

    if (
      file.size >
      MAX_PAYMENT_IMAGE_BYTES
    ) {
      toast.error(
        "La imagen no puede superar los 10 MB.",
      );

      return;
    }

    setPaymentImage(file);
  }

  // =========================================================
  // GUARDAR CONFIGURACIÓN DE PAGO
  // =========================================================

  const savePaymentSettings =
    useMutation({
      mutationFn: async () => {
        if (!paymentTitle.trim()) {
          throw new Error(
            "Debes ingresar un título para los datos de pago.",
          );
        }

        if (!paymentMessage.trim()) {
          throw new Error(
            "Debes ingresar las instrucciones para realizar el pago.",
          );
        }

        let paymentImagePath =
          paymentSettings?.payment_image_path ??
          null;

        // ---------------------------------------------
        // SI HAY UNA NUEVA IMAGEN
        // ---------------------------------------------

        if (paymentImage) {
          const extension =
            getImageExtension(paymentImage);

          const newPath =
            `bank-details/payment-${Date.now()}.${extension}`;

          const {
            error: uploadError,
          } = await supabase.storage
            .from(PAYMENT_BUCKET)
            .upload(
              newPath,
              paymentImage,
              {
                cacheControl: "3600",
                upsert: false,
                contentType:
                  paymentImage.type,
              },
            );

          if (uploadError) {
            throw uploadError;
          }

          const oldPath =
            paymentSettings?.payment_image_path;

          paymentImagePath = newPath;

          // -----------------------------------------
          // BORRAR IMAGEN ANTERIOR
          // -----------------------------------------

          if (
            oldPath &&
            oldPath !== newPath
          ) {
            const { error: removeError } =
              await supabase.storage
                .from(PAYMENT_BUCKET)
                .remove([oldPath]);

            if (removeError) {
              console.warn(
                "No se pudo borrar la imagen anterior:",
                removeError,
              );
            }
          }
        }

        // ---------------------------------------------
        // GUARDAR DATOS
        // ---------------------------------------------

        const { error } = await supabase
          .from("payment_settings")
          .upsert(
            {
              id: 1,

              title:
                paymentTitle.trim(),

              message:
                paymentMessage.trim(),

              bank_name:
                bankName.trim() || null,

              account_holder:
                accountHolder.trim() ||
                null,

              account_number:
                accountNumber.trim() ||
                null,

              document_number:
                documentNumber.trim() ||
                null,

              payment_image_path:
                paymentImagePath,

              is_active:
                paymentActive,
            },
            {
              onConflict: "id",
            },
          );

        if (error) {
          throw error;
        }
      },

      onSuccess: async () => {
        toast.success(
          "Datos de pago actualizados",
        );

        setPaymentImage(null);

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: [
              "payment-settings-admin",
            ],
          }),

          queryClient.invalidateQueries({
            queryKey: [
              "payment-settings",
            ],
          }),
        ]);
      },

      onError: (error: Error) => {
        toast.error(error.message);
      },
    });

  // =========================================================
  // ELIMINAR IMAGEN
  // =========================================================

  const removePaymentImage =
    useMutation({
      mutationFn: async () => {
        const path =
          paymentSettings?.payment_image_path;

        if (path) {
          const { error } =
            await supabase.storage
              .from(PAYMENT_BUCKET)
              .remove([path]);

          if (error) {
            throw error;
          }
        }

        const { error } = await supabase
          .from("payment_settings")
          .update({
            payment_image_path: null,
          })
          .eq("id", 1);

        if (error) {
          throw error;
        }
      },

      onSuccess: async () => {
        setPaymentImage(null);
        setLocalImagePreview(null);

        toast.success(
          "Imagen de pago eliminada",
        );

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: [
              "payment-settings-admin",
            ],
          }),

          queryClient.invalidateQueries({
            queryKey: [
              "payment-settings",
            ],
          }),
        ]);
      },

      onError: (error: Error) => {
        toast.error(error.message);
      },
    });

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <PageShell>
      <PageHeader
        title="Mensajes del sistema"
        description="Editá los avisos automáticos y los datos que verán los vendedores para realizar sus pagos."
      />

      {/* ================================================= */}
      {/* MENSAJES DEL SISTEMA */}
      {/* ================================================= */}

      <div>
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold">
            Mensajes automáticos
          </h2>

          <p className="text-sm text-muted-foreground">
            Estos avisos aparecen
            automáticamente según el
            estado del vendedor.
          </p>
        </div>

        {messagesLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {KEYS.map((key) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquareWarning className="h-4 w-4 text-primary" />

                    {
                      APP_MESSAGE_LABELS[
                        key
                      ].label
                    }
                  </CardTitle>

                  <CardDescription>
                    {
                      APP_MESSAGE_LABELS[
                        key
                      ].help
                    }
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor={`title-${key}`}
                    >
                      Título
                    </Label>

                    <Input
                      id={`title-${key}`}
                      value={
                        form[key]?.title ??
                        ""
                      }
                      onChange={(event) =>
                        setForm(
                          (current) => ({
                            ...current,

                            [key]: {
                              ...current[
                                key
                              ],

                              title:
                                event.target
                                  .value,
                            },
                          }),
                        )
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor={`body-${key}`}
                    >
                      Mensaje
                    </Label>

                    <Textarea
                      id={`body-${key}`}
                      rows={4}
                      value={
                        form[key]?.body ??
                        ""
                      }
                      onChange={(event) =>
                        setForm(
                          (current) => ({
                            ...current,

                            [key]: {
                              ...current[
                                key
                              ],

                              body:
                                event.target
                                  .value,
                            },
                          }),
                        )
                      }
                    />
                  </div>

                  <Button
                    size="sm"
                    onClick={() =>
                      saveMessage.mutate(
                        key,
                      )
                    }
                    disabled={
                      saveMessage.isPending
                    }
                  >
                    {saveMessage.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}

                    Guardar
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ================================================= */}
      {/* DATOS PARA PAGOS */}
      {/* ================================================= */}

      <div className="mt-8">
        <div className="mb-4">
          <h2 className="font-display text-lg font-semibold">
            Datos para pagos y recargas
          </h2>

          <p className="text-sm text-muted-foreground">
            Esta información aparecerá
            automáticamente cuando un
            vendedor seleccione un plan.
          </p>
        </div>

        {paymentLoading ? (
          <Card>
            <CardContent className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : paymentError ? (
          <Card>
            <CardContent className="p-6">
              <p className="font-medium text-destructive">
                No se pudieron cargar los
                datos para pagos.
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                {paymentError instanceof
                Error
                  ? paymentError.message
                  : "Error desconocido"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />

                    Configuración de pago
                  </CardTitle>

                  <CardDescription className="mt-1">
                    Configurá los datos
                    bancarios, instrucciones
                    y la imagen o QR que
                    verá el vendedor.
                  </CardDescription>
                </div>

                <Button
                  type="button"
                  variant={
                    paymentActive
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    setPaymentActive(
                      (current) =>
                        !current,
                    )
                  }
                >
                  {paymentActive ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Recargas habilitadas
                    </>
                  ) : (
                    "Recargas deshabilitadas"
                  )}
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* TÍTULO Y BANCO */}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payment-title">
                    Título *
                  </Label>

                  <Input
                    id="payment-title"
                    value={paymentTitle}
                    onChange={(event) =>
                      setPaymentTitle(
                        event.target.value,
                      )
                    }
                    placeholder="Datos para realizar el pago"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bank-name">
                    Banco
                  </Label>

                  <Input
                    id="bank-name"
                    value={bankName}
                    onChange={(event) =>
                      setBankName(
                        event.target.value,
                      )
                    }
                    placeholder="Ej: Banco Continental"
                  />
                </div>
              </div>

              {/* TITULAR Y CUENTA */}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="account-holder">
                    Titular
                  </Label>

                  <Input
                    id="account-holder"
                    value={accountHolder}
                    onChange={(event) =>
                      setAccountHolder(
                        event.target.value,
                      )
                    }
                    placeholder="Nombre del titular"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="account-number">
                    Cuenta / Alias
                  </Label>

                  <Input
                    id="account-number"
                    value={accountNumber}
                    onChange={(event) =>
                      setAccountNumber(
                        event.target.value,
                      )
                    }
                    placeholder="Número de cuenta o alias"
                  />
                </div>
              </div>

              {/* DOCUMENTO */}

              <div className="space-y-1.5">
                <Label htmlFor="document-number">
                  CI / RUC
                </Label>

                <Input
                  id="document-number"
                  value={documentNumber}
                  onChange={(event) =>
                    setDocumentNumber(
                      event.target.value,
                    )
                  }
                  placeholder="CI o RUC del titular"
                />
              </div>

              {/* MENSAJE */}

              <div className="space-y-1.5">
                <Label htmlFor="payment-message">
                  Instrucciones para el
                  vendedor *
                </Label>

                <Textarea
                  id="payment-message"
                  rows={5}
                  value={paymentMessage}
                  onChange={(event) =>
                    setPaymentMessage(
                      event.target.value,
                    )
                  }
                  placeholder="Realiza la transferencia utilizando los siguientes datos y luego adjunta el comprobante de pago."
                />

                <p className="text-xs text-muted-foreground">
                  Podés utilizar varias
                  líneas. El vendedor verá
                  este texto dentro del
                  modal de recarga.
                </p>
              </div>

              {/* IMAGEN */}

              <div className="space-y-3">
                <div>
                  <Label>
                    Imagen / QR para el pago
                  </Label>

                  <p className="mt-1 text-xs text-muted-foreground">
                    JPG, PNG o WEBP. Máximo
                    10 MB.
                  </p>
                </div>

                {displayedImageUrl ? (
                  <div className="overflow-hidden rounded-xl border">
                    <div className="flex min-h-[220px] items-center justify-center bg-muted/20 p-4">
                      <img
                        src={
                          displayedImageUrl
                        }
                        alt="Datos para realizar el pago"
                        className="max-h-[400px] max-w-full rounded-lg object-contain"
                      />
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 border-t p-3">
                      <Label
                        htmlFor="change-payment-image"
                        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <Upload className="mr-2 h-4 w-4" />

                        Cambiar imagen
                      </Label>

                      <Input
                        id="change-payment-image"
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(
                          event,
                        ) =>
                          handlePaymentImage(
                            event.target
                              .files?.[0] ??
                              null,
                          )
                        }
                      />

                      {paymentSettings?.payment_image_path && (
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={
                            removePaymentImage.isPending
                          }
                          onClick={() =>
                            removePaymentImage.mutate()
                          }
                        >
                          {removePaymentImage.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}

                          Eliminar imagen
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <Label
                      htmlFor="payment-image"
                      className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center transition-colors hover:bg-muted/40"
                    >
                      <ImagePlus className="mb-3 h-8 w-8 text-muted-foreground" />

                      <span className="font-medium">
                        Seleccionar imagen
                        o QR
                      </span>

                      <span className="mt-1 text-xs text-muted-foreground">
                        JPG, PNG o WEBP
                      </span>
                    </Label>

                    <Input
                      id="payment-image"
                      type="file"
                      className="hidden"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(
                        event,
                      ) =>
                        handlePaymentImage(
                          event.target
                            .files?.[0] ??
                            null,
                        )
                      }
                    />
                  </>
                )}
              </div>

              {/* GUARDAR */}

              <div className="flex justify-end border-t pt-5">
                <Button
                  type="button"
                  disabled={
                    savePaymentSettings.isPending
                  }
                  onClick={() =>
                    savePaymentSettings.mutate()
                  }
                >
                  {savePaymentSettings.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}

                  Guardar datos de pago
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
