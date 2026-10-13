
function isAiQuotaFailure(error: unknown): boolean {
  const e = error as {status?:number;code?:string;message?:string};
  const msg = String(e?.message ?? error ?? "").toLowerCase();
  return e?.status === 429 || /(?:insufficient[_ ]quota|resource[_ ]exhausted|quota exceeded|rate[_ -]?limit|credit[s]? exhausted|sin cr[eé]ditos|saldo de ia|429)/i.test(msg);
}
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatGs } from "@/lib/format";
import { buildWorkspaceAiContext } from "@/lib/ai-context.server";
import { generateAiReply } from "@/lib/ai.server";
import { decideHybridReply } from "@/lib/hybrid-rules.server";
import { advanceRuleSale, type SaleState } from "@/lib/rule-sales.server";
import { classifyCustomerIntent, addVerifiedOrderContext, addPendingSaleContext } from "@/lib/hybrid-intent.server";
import { coordinatesFromText, validCoords } from "@/lib/hybrid-intent.server";
import { parseCoverage, verifiedCoverage } from "@/lib/rule-sales.server";
import { sendWhatsAppText } from "@/lib/whatsapp.server";
import { detectComplaint, COMPLAINT_REASON_LABELS } from "@/lib/complaints";

type MediaPart = { id?: string; mime_type?: string; caption?: string; voice?: boolean };

type IncomingMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  referral?: {
    source_id?: string;
    source_url?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    media_type?: string;
  };
  image?: MediaPart;
  audio?: MediaPart;
  voice?: MediaPart;
  video?: MediaPart;
  document?: MediaPart & { filename?: string };
  sticker?: MediaPart;
};

type WebhookPayload = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: IncomingMessage[];
      };
    }[];
  }[];
};

function textOf(message: IncomingMessage) {
  if (message.text?.body) return message.text.body;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return `[${message.type}]`;
}

function mediaOf(message: IncomingMessage) {
  const map: [string, MediaPart | undefined][] = [
    ["image", message.image ?? message.sticker],
    ["audio", message.audio ?? message.voice],
    ["video", message.video],
    ["document", message.document],
  ];
  for (const [type, part] of map) {
    if (part?.id) return { type: type as "image" | "audio" | "video" | "document", part };
  }
  return null;
}


type ReferralData = {
  adId: string | null;
  adName: string | null;
  adUrl: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
};

function referralOf(message: IncomingMessage): ReferralData {
  const referral = message.referral;

  if (!referral) {
    return {
      adId: null,
      adName: null,
      adUrl: null,
      mediaUrl: null,
      mediaType: null,
    };
  }

  const videoUrl = referral.video_url?.trim() || null;
  const imageUrl =
    referral.image_url?.trim() ||
    referral.thumbnail_url?.trim() ||
    null;

  const rawMediaType = referral.media_type?.trim().toLowerCase() || "";
  const mediaType: "image" | "video" | null =
    videoUrl || rawMediaType.startsWith("video")
      ? "video"
      : imageUrl || rawMediaType.startsWith("image")
        ? "image"
        : null;

  return {
    adId: referral.source_id?.trim() || null,
    adName: referral.headline?.trim() || null,
    adUrl: referral.source_url?.trim() || null,
    mediaUrl: videoUrl ?? imageUrl,
    mediaType,
  };
}

function normalizeIntentText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta cuando un cliente que ya cerró una venta realmente quiere iniciar
 * otra compra. Mensajes posteriores como ubicación, forma de pago o un
 * agradecimiento no deben abrir una nueva venta ni crear otro pedido.
 */
function isNewPurchaseIntent(text: string, hasReferral: boolean) {
  // Un anuncio visto otra vez no equivale a solicitar otra compra.
  // La reapertura exige una intención explícita del cliente.

  const normalized = normalizeIntentText(text);
  if (!normalized || normalized.startsWith("[location")) return false;

  const phrases = [
    "quiero comprar",
    "quiero pedir",
    "quiero llevar",
    "quiero otro",
    "quiero otra",
    "quiero uno mas",
    "quiero una mas",
    "otro pedido",
    "otra compra",
    "nuevo pedido",
    "nueva compra",
    "volver a comprar",
    "comprar nuevamente",
    "comprar de nuevo",
    "pedir nuevamente",
    "pedir de nuevo",
    "deseo comprar",
    "deseo pedir",
    "necesito otro",
    "necesito otra",
  ];

  if (phrases.some((phrase) => normalized.includes(phrase))) return true;

  // Consultas comerciales nuevas también deben abrir un ciclo, aun días después.
  // Excluir postventa antes de interpretar «pedido» o «precio» como compra.
  const postSale = /\b(?:mi pedido|mis pedidos|pedido anterior|pedido que hice|mi compra|mi entrega|mi envio|mi paquete|seguimiento|guia|reclamo|devolucion|reembolso|cuando llega|donde esta|no llego|garantia de mi|cambiar mi pedido)\b/.test(normalized);
  if (postSale) return false;
  return /\b(?:me interesa|estoy interesado|estoy interesada|precio|precios|cuanto cuesta|cuanto sale|cuanto vale|que precio tiene|a cuanto|quiero el|quiero la|quisiera el|quisiera la|tenes el|tienen el|tenes la|tienen la)\b/.test(normalized);
}

/**
 * Guarda una ubicación recibida DESPUÉS de una venta en el pedido más reciente
 * de esta conversación, sin tocar la ciudad verificada, el estado de venta
 * ni crear otra orden. Usa la columna existente orders.observations.
 * Devuelve true únicamente cuando se ha comprobado que está almacenada.
 */
export async function attachPostSaleGpsToLatestOrder(args: {
  workspaceId: string;
  conversationId: string;
  gpsUrl: string;
}): Promise<boolean> {
  const url = args.gpsUrl.trim();
  if (!/^https:\/\//i.test(url) || url.length > 700) return false;
  const {data: lastOrder,error: readError} = await supabaseAdmin.from("orders")
    .select("id,observations")
    .eq("workspace_id",args.workspaceId)
    .eq("conversation_id",args.conversationId)
    .neq("status","cancelado")
    .order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(readError) throw readError;
  if(!lastOrder) return false;
  const observations = String(lastOrder.observations ?? "");
  if (observations.includes(url)) return true;
  // No borrar notas anteriores del pedido.
  const updated = [observations,`GPS de entrega: ${url}`].filter(Boolean).join(" | ");
  const {error: updateError} = await supabaseAdmin.from("orders")
    .update({observations:updated})
    .eq("workspace_id",args.workspaceId)
    .eq("conversation_id",args.conversationId)
    .eq("id",lastOrder.id);
  if(updateError) throw updateError;
  return true;
}

/** Descarga el archivo de WhatsApp, lo guarda y deja que la IA lo interprete. */
async function ingestMedia(args: {
  workspaceId: string;
  accessToken: string;
  mediaId: string;
  type: "image" | "audio" | "video" | "document";
  allowAiInterpretation?: boolean;
}) {
  const { downloadWhatsAppMediaUrl } = await import("@/lib/whatsapp.server");
  const { transcribeAudio, describeImage, toBase64 } = await import(
    "@/lib/media-ai.server"
  );

  const emptyResult = {
    storagePath: null as string | null,
    transcript: null as string | null,
  };

  try {
    const mediaUrl = await downloadWhatsAppMediaUrl(
      args.mediaId,
      args.accessToken,
    );

    if (!mediaUrl) {
      console.error("[WhatsApp media] Meta no devolvió una URL", {
        mediaId: args.mediaId,
        type: args.type,
      });

      return emptyResult;
    }

    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
      },
    });

    if (!response.ok) {
      console.error("[WhatsApp media] Error descargando desde Meta", {
        mediaId: args.mediaId,
        type: args.type,
        status: response.status,
        statusText: response.statusText,
      });

      return emptyResult;
    }

    const rawMime =
      response.headers.get("content-type") ||
      "application/octet-stream";

    const mime = rawMime.split(";")[0].trim().toLowerCase();
    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0) {
      console.error("[WhatsApp media] Meta devolvió un archivo vacío", {
        mediaId: args.mediaId,
        type: args.type,
        mime,
      });

      return emptyResult;
    }

    const extensionByMime: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",

      "audio/ogg": "ogg",
      "audio/opus": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "audio/wav": "wav",
      "audio/x-wav": "wav",

      "video/mp4": "mp4",
      "video/3gpp": "3gp",
      "video/webm": "webm",

      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        "xlsx",
    };

    const fallbackExtension =
      mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";

    const extension = extensionByMime[mime] || fallbackExtension;
    const safeMediaId = args.mediaId.replace(/[^a-zA-Z0-9_-]/g, "");

    const storagePath =
      `${args.workspaceId}/inbound/` +
      `${Date.now()}-${safeMediaId}.${extension}`;

    const { data: uploadedFile, error: uploadError } =
      await supabaseAdmin.storage
        .from("chat-media")
        .upload(storagePath, bytes, {
          contentType: mime,
          upsert: false,
        });

    if (uploadError) {
      console.error("[WhatsApp media] Error subiendo a chat-media", {
        mediaId: args.mediaId,
        type: args.type,
        storagePath,
        mime,
        size: bytes.byteLength,
        error: uploadError.message,
      });

      return emptyResult;
    }

    if (!uploadedFile?.path) {
      console.error("[WhatsApp media] Supabase no devolvió la ruta subida", {
        mediaId: args.mediaId,
        type: args.type,
        storagePath,
      });

      return emptyResult;
    }

    let transcript: string | null = null;

    try {
      const base64 = args.allowAiInterpretation === false ? null : toBase64(bytes);

      if (base64 && args.type === "audio") {
        const result = await transcribeAudio(base64, mime);
        transcript = result?.trim() || null;

        if (!transcript) {
          console.warn("[WhatsApp media] Audio sin transcripción", {
            mediaId: args.mediaId,
            mime,
          });
        }
      } else if (base64 && args.type === "image") {
        const result = await describeImage(base64, mime);
        transcript = result?.trim() || null;

        if (!transcript) {
          console.warn("[WhatsApp media] Imagen sin interpretación", {
            mediaId: args.mediaId,
            mime,
          });
        }
      }
    } catch (error) {
      console.error("[WhatsApp media] Error procesando archivo con IA", {
        mediaId: args.mediaId,
        type: args.type,
        mime,
        error,
      });
    }

    return {
      storagePath: uploadedFile.path,
      transcript,
    };
  } catch (error) {
    console.error("[WhatsApp media] Error inesperado procesando archivo", {
      mediaId: args.mediaId,
      type: args.type,
      error,
    });

    return emptyResult;
  }
}


/**
 * Si el cliente envía una imagen o documento después de elegir pago anticipado,
 * vincula ese archivo al pedido más reciente de la misma conversación.
 *
 * Reglas:
 * - Solo imágenes/documentos.
 * - Solo pedidos con forma de pago anticipado/transferencia/depósito/giro.
 * - No pisa un comprobante ya existente.
 * - Cambia payment_status a "anticipado" únicamente cuando existe archivo real.
 * - Registra también payment_receipts para conservar historial.
 */
async function attachPaymentReceiptToLatestOrder(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  mediaPath: string;
  mediaType: "image" | "audio" | "video" | "document";
  transcript?: string | null;
}) {
  if (
    args.mediaType !== "image" &&
    args.mediaType !== "document"
  ) {
    return false;
  }

  /*
   * Una misma conversación puede contener varias compras del mismo cliente.
   * Por eso NO tomamos simplemente el último pedido: buscamos entre los pedidos
   * recientes el último que realmente sea compatible con pago anticipado,
   * todavía no tenga comprobante y no esté cancelado.
   */
  const { data: recentOrders, error: ordersError } =
    await supabaseAdmin
      .from("orders")
      .select(
        "id, order_number, payment_method, payment_status, receipt_url, total, status, created_at",
      )
      .eq("workspace_id", args.workspaceId)
      .eq("conversation_id", args.conversationId)
      .order("created_at", { ascending: false })
      .limit(20);

  if (ordersError) {
    console.error(
      "[Comprobante] Error buscando pedidos de la conversación",
      {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        error: ordersError.message,
      },
    );

    return false;
  }

  const order =
    (recentOrders ?? []).find((candidate) => {
      const paymentMethod = normalizeIntentText(
        candidate.payment_method ?? "",
      );

      const isAdvancePayment =
        paymentMethod.includes("anticipado") ||
        paymentMethod.includes("transferencia") ||
        paymentMethod.includes("transfer") ||
        paymentMethod.includes("deposito") ||
        paymentMethod.includes("giro") ||
        paymentMethod.includes("bancari");

      return (
        isAdvancePayment &&
        !candidate.receipt_url &&
        candidate.status !== "cancelado"
      );
    }) ?? null;

  if (!order) {
    console.warn(
      "[Comprobante] No se encontró un pedido compatible para asociar el comprobante",
      {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        mediaPath: args.mediaPath,
      },
    );

    return false;
  }

  /*
   * Si el pedido ya estaba validado como pagado, conservamos ese estado.
   * En los demás casos pasa a anticipado porque ya existe un comprobante real.
   */
  const nextPaymentStatus =
    order.payment_status === "pagado"
      ? "pagado"
      : "anticipado";

  const { error: updateError } = await supabaseAdmin
    .from("orders")
    .update({
      receipt_url: args.mediaPath,
      payment_status: nextPaymentStatus,
    })
    .eq("id", order.id)
    .eq("workspace_id", args.workspaceId);

  if (updateError) {
    console.error(
      "[Comprobante] No se pudo asociar el archivo al pedido",
      {
        orderId: order.id,
        orderNumber: order.order_number,
        error: updateError.message,
      },
    );

    return false;
  }

  /*
   * Evita duplicar el mismo archivo en payment_receipts si por alguna razón
   * esta función se invoca dos veces dentro del mismo flujo.
   */
  const { data: existingReceipt, error: existingReceiptError } =
    await supabaseAdmin
      .from("payment_receipts")
      .select("id")
      .eq("workspace_id", args.workspaceId)
      .eq("order_id", order.id)
      .eq("url", args.mediaPath)
      .limit(1)
      .maybeSingle();

  if (existingReceiptError) {
    console.error(
      "[Comprobante] No se pudo verificar payment_receipts",
      {
        orderId: order.id,
        error: existingReceiptError.message,
      },
    );
  } else if (!existingReceipt) {
    const noteParts = [
      "Comprobante recibido por WhatsApp",
    ];

    const cleanTranscript = args.transcript?.trim();

    if (cleanTranscript) {
      noteParts.push(
        cleanTranscript.slice(0, 1200),
      );
    }

    const { error: receiptError } = await supabaseAdmin
      .from("payment_receipts")
      .insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        order_id: order.id,
        url: args.mediaPath,
        amount: order.total,
        note: noteParts.join(" | "),
      });

    if (receiptError) {
      /*
       * El pedido ya quedó correctamente actualizado. No revertimos receipt_url
       * solo porque falle el registro histórico secundario.
       */
      console.error(
        "[Comprobante] Pedido actualizado, pero falló payment_receipts",
        {
          orderId: order.id,
          orderNumber: order.order_number,
          error: receiptError.message,
        },
      );
    }
  }

  console.info(
    "[Comprobante] Comprobante asociado correctamente",
    {
      orderId: order.id,
      orderNumber: order.order_number,
      conversationId: args.conversationId,
      receiptUrl: args.mediaPath,
    },
  );

  return true;
}


/**
 * Recupera un comprobante que el cliente pudo haber enviado ANTES de que
 * el pedido terminara de crearse.
 *
 * Esto cubre el caso:
 * 1. Cliente elige transferencia/pago anticipado.
 * 2. Envía el comprobante.
 * 3. Todavía faltaba algún dato del pedido.
 * 4. En un mensaje posterior se completa la venta y recién ahí se crea orders.
 *
 * Reglas de seguridad:
 * - Solo trabaja con pedidos de pago anticipado/transferencia/depósito/giro.
 * - No toca pedidos que ya tengan receipt_url.
 * - Solo considera mensajes inbound con imagen/documento.
 * - Excluye archivos que ya estén asociados como receipt_url a cualquier pedido
 *   de esta misma conversación.
 * - Prefiere mensajes cuyo texto/transcripción parezca realmente un comprobante.
 * - Como fallback, usa el archivo inbound no utilizado más reciente únicamente
 *   si fue enviado dentro de los 30 minutos anteriores a la creación del pedido.
 */
export async function recoverRecentPaymentReceiptForOrder(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  orderId: string;
}) {
  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, payment_method, payment_status, receipt_url, total, status, created_at",
    )
    .eq("workspace_id", args.workspaceId)
    .eq("conversation_id", args.conversationId)
    .eq("id", args.orderId)
    .maybeSingle();

  if (orderError) {
    console.error(
      "[Comprobante recuperación] Error buscando el pedido recién creado",
      {
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        orderId: args.orderId,
        error: orderError.message,
      },
    );
    return false;
  }

  if (!order || order.receipt_url || order.status === "cancelado") {
    return false;
  }

  const paymentMethod = normalizeIntentText(order.payment_method ?? "");

  const isAdvancePayment =
    paymentMethod.includes("anticipado") ||
    paymentMethod.includes("transferencia") ||
    paymentMethod.includes("transfer") ||
    paymentMethod.includes("deposito") ||
    paymentMethod.includes("giro") ||
    paymentMethod.includes("bancari");

  if (!isAdvancePayment) {
    return false;
  }

  const orderCreatedAt = new Date(order.created_at);

  if (Number.isNaN(orderCreatedAt.getTime())) {
    console.warn(
      "[Comprobante recuperación] created_at inválido en pedido",
      {
        orderId: order.id,
        orderNumber: order.order_number,
        createdAt: order.created_at,
      },
    );
    return false;
  }

  /*
   * Buscamos hasta 3 horas hacia atrás. Es una ventana suficientemente amplia
   * para conversaciones donde el cliente tarda en terminar de pasar sus datos,
   * pero evita rescatar imágenes antiguas de compras anteriores.
   */
  const lookbackStart = new Date(
    orderCreatedAt.getTime() - 3 * 60 * 60 * 1000,
  ).toISOString();

  const { data: candidateMessages, error: messagesError } =
    await supabaseAdmin
      .from("messages")
      .select(
        "id, media_url, media_type, transcript, body, created_at, direction, sender",
      )
      .eq("workspace_id", args.workspaceId)
      .eq("conversation_id", args.conversationId)
      .eq("direction", "inbound")
      .not("media_url", "is", null)
      .in("media_type", ["image", "document"])
      .gte("created_at", lookbackStart)
      .lte("created_at", order.created_at)
      .order("created_at", { ascending: false })
      .limit(30);

  if (messagesError) {
    console.error(
      "[Comprobante recuperación] Error buscando multimedia reciente del chat",
      {
        orderId: order.id,
        orderNumber: order.order_number,
        error: messagesError.message,
      },
    );
    return false;
  }

  if (!candidateMessages?.length) {
    return false;
  }

  /*
   * No reutilizamos un archivo que ya esté enlazado a otro pedido
   * de la misma conversación.
   */
  const { data: ordersWithReceipt, error: usedReceiptsError } =
    await supabaseAdmin
      .from("orders")
      .select("id, receipt_url")
      .eq("workspace_id", args.workspaceId)
      .eq("conversation_id", args.conversationId)
      .not("receipt_url", "is", null);

  if (usedReceiptsError) {
    console.error(
      "[Comprobante recuperación] No se pudieron verificar comprobantes ya usados",
      {
        orderId: order.id,
        error: usedReceiptsError.message,
      },
    );
    return false;
  }

  const usedReceiptUrls = new Set(
    (ordersWithReceipt ?? [])
      .filter((candidate) => candidate.id !== order.id)
      .map((candidate) => candidate.receipt_url)
      .filter((value): value is string => Boolean(value)),
  );

  const availableMessages = candidateMessages.filter(
    (candidate) =>
      Boolean(candidate.media_url) &&
      !usedReceiptUrls.has(candidate.media_url as string),
  );

  if (!availableMessages.length) {
    return false;
  }

  function looksLikePaymentReceipt(candidate: {
    body?: string | null;
    transcript?: string | null;
  }) {
    const normalized = normalizeIntentText(
      `${candidate.body ?? ""} ${candidate.transcript ?? ""}`,
    );

    const paymentSignals = [
      "comprobante",
      "transferencia",
      "transferido",
      "transferi",
      "pago realizado",
      "pague",
      "pagado",
      "pago",
      "deposito",
      "depositado",
      "giro",
      "banco",
      "bancaria",
      "operacion",
      "transaccion",
      "recibo",
      "importe",
      "monto",
      "gs",
      "pyg",
      "guaran",
    ];

    return paymentSignals.some((signal) =>
      normalized.includes(signal),
    );
  }

  /*
   * Primero preferimos una imagen/documento que la interpretación de IA,
   * el caption o el texto del mensaje identifique como pago/comprobante.
   */
  let selectedMessage =
    availableMessages.find((candidate) =>
      looksLikePaymentReceipt(candidate),
    ) ?? null;

  /*
   * Fallback:
   * si la IA no pudo interpretar la imagen, permitimos tomar el archivo inbound
   * más reciente no utilizado, pero SOLO si llegó como máximo 30 minutos antes
   * de la creación del pedido.
   */
  if (!selectedMessage) {
    const fallback = availableMessages[0] ?? null;

    if (fallback?.created_at) {
      const mediaCreatedAt = new Date(fallback.created_at);
      const ageMs =
        orderCreatedAt.getTime() - mediaCreatedAt.getTime();

      if (
        Number.isFinite(ageMs) &&
        ageMs >= 0 &&
        ageMs <= 30 * 60 * 1000
      ) {
        selectedMessage = fallback;
      }
    }
  }

  if (!selectedMessage?.media_url) {
    console.info(
      "[Comprobante recuperación] No se encontró un archivo reciente suficientemente confiable",
      {
        orderId: order.id,
        orderNumber: order.order_number,
        conversationId: args.conversationId,
      },
    );
    return false;
  }

  const mediaType =
    selectedMessage.media_type === "document"
      ? "document"
      : "image";

  console.info(
    "[Comprobante recuperación] Recuperando comprobante enviado antes de crear el pedido",
    {
      orderId: order.id,
      orderNumber: order.order_number,
      conversationId: args.conversationId,
      messageId: selectedMessage.id,
      mediaUrl: selectedMessage.media_url,
      mediaType,
    },
  );

  /*
   * Reutilizamos la misma función central. Como el pedido recién creado es
   * el más reciente compatible y aún no tiene receipt_url, quedará asociado
   * al pedido correcto y también se registrará payment_receipts.
   */
  return attachPaymentReceiptToLatestOrder({
    workspaceId: args.workspaceId,
    ownerId: args.ownerId,
    conversationId: args.conversationId,
    mediaPath: selectedMessage.media_url,
    mediaType,
    transcript: selectedMessage.transcript ?? null,
  });
}

export async function handleWhatsAppWebhook(payload: WebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const messages = value?.messages ?? [];
      if (!phoneNumberId || messages.length === 0) continue;

      const { data: conn } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("workspace_id, user_id, phone_number_id, access_token")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!conn) continue;

      for (const message of messages) {
        await processMessage(conn, value?.contacts?.[0]?.profile?.name ?? null, message);
      }
    }
  }
}

/**
 * Alias de compatibilidad para rutas antiguas o imports con otros nombres.
 * Todos ejecutan exactamente el mismo webhook principal.
 */
export const processWhatsAppWebhook = handleWhatsAppWebhook;
export const processWebhook = handleWhatsAppWebhook;
export const handleWebhook = handleWhatsAppWebhook;
export const whatsappWebhookHandler = handleWhatsAppWebhook;

export default handleWhatsAppWebhook;

type Conn = {
  workspace_id: string;
  user_id: string;
  phone_number_id: string | null;
  access_token: string | null;
};

async function processMessage(conn: Conn, profileName: string | null, message: IncomingMessage) {
  const workspaceId = conn.workspace_id;
  const ownerId = conn.user_id;
  const phone = String(message.from ?? "").replace(/\D/g, "");

  if (!phone) {
    console.warn("[WhatsApp webhook] Mensaje sin teléfono válido", {
      workspaceId,
      wamid: message.id,
    });
    return;
  }

  const media = mediaOf(message);
  const referral = referralOf(message);

  const latitude =
    message.type === "location" && typeof message.location?.latitude === "number"
      ? message.location.latitude
      : null;

  const longitude =
    message.type === "location" && typeof message.location?.longitude === "number"
      ? message.location.longitude
      : null;

  const locationName =
    message.type === "location"
      ? message.location?.name?.trim() || null
      : null;

  const locationAddress =
    message.type === "location"
      ? message.location?.address?.trim() || null
      : null;

  const isLocation = latitude !== null && longitude !== null && validCoords(latitude,longitude);

  const googleMapsUrl = isLocation
    ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
    : null;

  let body = isLocation
    ? [
        "📍 Ubicación compartida",
        locationName,
        locationAddress,
        googleMapsUrl,
      ]
        .filter(Boolean)
        .join("\n")
    : media?.part.caption?.trim() || textOf(message);

  let mediaPath: string | null = null;
  let transcript: string | null = null;

  /*
   * Meta puede reenviar el mismo webhook. Si el wamid ya existe,
   * no volvemos a procesar ni responder el mensaje.
   */
  const { data: existingMessage, error: existingMessageError } =
    await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("wamid", message.id)
      .maybeSingle();

  if (existingMessageError) throw existingMessageError;
  if (existingMessage) return;

  /*
   * Un contacto es único por workspace + teléfono normalizado.
   * Requiere el índice único indicado en la migración SQL.
   */
  const normalizedProfileName = profileName?.trim() || null;

  const { data: contact, error: contactError } = await supabaseAdmin
    .from("contacts")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        phone,
        ...(normalizedProfileName ? { name: normalizedProfileName } : {}),
      },
      {
        onConflict: "workspace_id,phone",
        ignoreDuplicates: false,
      },
    )
    .select("id, name")
    .single();

  if (contactError) throw contactError;

  /*
   * Siempre reutilizamos una sola conversación por contacto.
   * Nunca se crea otro chat por venir desde un anuncio ni por tener
   * una venta anterior marcada como cerrada.
   */
  let { data: conversation, error: conversationLookupError } =
    await supabaseAdmin
      .from("conversations")
      .select("id, ai_paused, product_id, is_closed, sale_closed, ad_id")
      .eq("workspace_id", workspaceId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  if (conversationLookupError) throw conversationLookupError;

  let isNewConversation = false;

  if (!conversation) {
    const { data: created, error: createConversationError } =
      await supabaseAdmin
        .from("conversations")
        .insert({
          workspace_id: workspaceId,
          user_id: ownerId,
          contact_id: contact.id,
          status: "abierta",
          sale_closed: false,
          is_closed: false,
          product_id: null,
          ad_id: referral.adId,
          ad_name: referral.adName,
          ad_url: referral.adUrl,
          ad_media_url: referral.mediaUrl,
          ad_media_type: referral.mediaType,
        })
        .select("id, ai_paused, product_id, is_closed, sale_closed, ad_id")
        .single();

    if (createConversationError) {
      /*
       * Si dos webhooks llegaron juntos, el índice único puede hacer
       * que uno de los inserts falle con 23505. En ese caso recuperamos
       * la conversación que creó el otro proceso.
       */
      if (createConversationError.code !== "23505") {
        throw createConversationError;
      }

      const { data: concurrentConversation, error: concurrentLookupError } =
        await supabaseAdmin
          .from("conversations")
          .select("id, ai_paused, product_id, is_closed, sale_closed, ad_id")
          .eq("workspace_id", workspaceId)
          .eq("contact_id", contact.id)
          .single();

      if (concurrentLookupError) throw concurrentLookupError;
      conversation = concurrentConversation;
    } else {
      conversation = created;
      isNewConversation = true;
    }
  } else {
    /*
     * Una conversación vendida solamente vuelve a habilitar una venta cuando
     * el cliente expresa una intención clara de comprar otra vez o entra desde
     * un anuncio nuevo. Ubicación, forma de pago y mensajes de seguimiento
     * conservan sale_closed=true para impedir órdenes duplicadas.
     */
    const startsNewPurchase =
      conversation.sale_closed &&
      isNewPurchaseIntent(body, Boolean(referral.adId));
    // «Quiero otro igual» conserva el producto; una consulta por otro producto no.
    const sameProductRepeat = /\b(?:quiero|dame|mandame|necesito|llevo)\s+(?:otro|otra|uno mas|una mas)(?:\s+(?:igual|del mismo|de lo mismo))?\b|\b(?:otro|otra)\s+(?:igual|del mismo)\b/i.test(normalizeIntentText(body));
    if (startsNewPurchase) {
      // Los campos del checkout anterior NUNCA deben contaminar la nueva compra.
      // El historial y los registros reales en orders se conservan intactos.
      const { error: clearStateError } = await supabaseAdmin.from("bot_sale_states")
        .delete().eq("workspace_id",workspaceId).eq("conversation_id",conversation.id);
      if (clearStateError) throw clearStateError;
    }

    const { data: reopened, error: reopenError } = await supabaseAdmin
      .from("conversations")
      .update({
        status: startsNewPurchase
          ? "abierta"
          : conversation.sale_closed
            ? "vendida"
            : "abierta",
        is_closed: false,
        ...(startsNewPurchase
          ? {
              sale_closed: false,
              product_id: sameProductRepeat ? conversation.product_id : null,
            }
          : {}),
        ...(referral.adId ? { ad_id: referral.adId } : {}),
        ...(referral.adName ? { ad_name: referral.adName } : {}),
        ...(referral.adUrl ? { ad_url: referral.adUrl } : {}),
        ...(referral.mediaUrl ? { ad_media_url: referral.mediaUrl } : {}),
        ...(referral.mediaType ? { ad_media_type: referral.mediaType } : {}),
      })
      .eq("id", conversation.id)
      .eq("workspace_id", workspaceId)
      .select("id, ai_paused, product_id, is_closed, sale_closed, ad_id")
      .single();

    if (reopenError) throw reopenError;
    conversation = reopened;
  }

  if (!conversation) {
    throw new Error("No se pudo crear ni recuperar la conversación");
  }

  /*
   * Snapshot de atribución: cada mensaje conserva el anuncio vigente en ESTE
   * momento. Si Meta trae referral, ese anuncio gana; si no, se hereda el
   * anuncio actual de la conversación. Así un referral futuro no reescribe
   * históricamente los mensajes anteriores.
   */
  const attributedAdId = referral.adId ?? conversation.ad_id ?? null;

  if (media) {
    if (!conn.access_token) {
      console.error("[WhatsApp media] La conexión no tiene access_token", {
        workspaceId,
        mediaId: media.part.id,
        type: media.type,
      });
    } else {
      const {data: mediaMode} = await supabaseAdmin.from("ai_settings")
        .select("hybrid_mode").eq("workspace_id",workspaceId).maybeSingle();
      const ingested = await ingestMedia({
        workspaceId,
        accessToken: conn.access_token,
        mediaId: media.part.id!,
        type: media.type,
        allowAiInterpretation: mediaMode?.hybrid_mode !== "rules_only",
      });

      mediaPath = ingested.storagePath;
      transcript = ingested.transcript;

      if (transcript) {
        body =
          media.type === "audio"
            ? transcript
            : `${body && body !== `[${message.type}]` ? body + "\n" : ""}[imagen] ${transcript}`;
      }
    }
  }

  const { data: savedMessage } = await supabaseAdmin
    .from("messages")
    .insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      ad_id: attributedAdId,
      direction: "inbound",
      sender: "customer",
      body,
      transcript,
      media_url: mediaPath,
      media_type: media?.type ?? null,
      latitude,
      longitude,
      location_name: locationName,
      location_address: locationAddress,
      wamid: message.id,
      status: "received",
    })
    .select("id")
    .single();

  /*
   * Si ya existe un pedido anticipado para esta conversación, el archivo
   * recibido se convierte inmediatamente en su comprobante.
   */
  if (mediaPath && media) {
    await attachPaymentReceiptToLatestOrder({
      workspaceId,
      ownerId,
      conversationId: conversation.id,
      mediaPath,
      mediaType: media.type,
      transcript,
    });
  }

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message: body,
      last_message_at: new Date().toISOString(),
      unread_count: 1,
    })
    .eq("id", conversation.id);

  const complaint = detectComplaint(body);
  if (complaint) {
    await supabaseAdmin.from("complaints").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      contact_id: contact.id,
      message_id: savedMessage?.id ?? null,
      phone,
      contact_name: contact.name,
      body,
      reason: complaint.reason,
      severity: complaint.severity,
      status: "nuevo",
    });

    await supabaseAdmin.from("notifications").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      type: "reclamo",
      title: `Reclamo detectado · ${phone}`,
      body: `${COMPLAINT_REASON_LABELS[complaint.reason] ?? "Reclamo"}: ${body.slice(0, 160)}`,
      link: "/reclamos",
      audience: "user",
    });
  }

  // Balance: one conversation credit per new conversation
  const { data: balance } = await supabaseAdmin
    .from("conversation_balances")
    .select("id, available, consumed")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (isNewConversation) {
    if (!balance || balance.available <= 0) {
      await supabaseAdmin.from("notifications").insert({
        workspace_id: workspaceId,
        user_id: ownerId,
        type: "saldo",
        title: "Sin conversaciones disponibles",
        body: "Tu bot no respondió porque tu saldo se agotó. Recarga un plan para continuar.",
        link: "/planes",
        audience: "user",
      });
      return;
    }
    await supabaseAdmin
      .from("conversation_balances")
      .update({ available: balance.available - 1, consumed: balance.consumed + 1 })
      .eq("id", balance.id);
    await supabaseAdmin.from("conversation_usage").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      amount: 1,
      reason: "nueva_conversacion",
      wamid: message.id,
    });
  } else if (!balance || balance.available <= 0) {
    return;
  }

  const { data: aiSettings } = await supabaseAdmin
    .from("ai_settings")
    .select("ai_enabled, reply_delay_seconds, hybrid_mode, hybrid_fallback_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!aiSettings?.ai_enabled || conversation.ai_paused || conversation.is_closed) return;

  // POSTVENTA: nunca reiniciar checkout ni volver a preguntar la ciudad por un GPS.
  // El mensaje ya fue insertado en messages (incluidas coordenadas nativas).
  // Asociar su enlace al pedido realmente registrado, sin tocar PEDIDOS/UI.
  if (conversation.sale_closed) {
    const coordsAfterSale = isLocation && googleMapsUrl ? googleMapsUrl : coordinatesFromText(body);
    const postSaleUrl = typeof coordsAfterSale === "string" ? coordsAfterSale
      : coordsAfterSale ? `https://www.google.com/maps/search/?api=1&query=${coordsAfterSale.latitude},${coordsAfterSale.longitude}`
      : body.match(/https?:\/\/[^\s]+/i)?.[0] ?? null;
    const postSaleGps = Boolean(isLocation || coordsAfterSale ||
      (postSaleUrl && /(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.[^\s/]+\/maps|maps\.google\.)/i.test(postSaleUrl)));
    if (postSaleGps && postSaleUrl) {
      let attached = false;
      try {
        attached = await attachPostSaleGpsToLatestOrder({
          workspaceId,conversationId:conversation.id,gpsUrl:postSaleUrl,
        });
      } catch(error) {
        console.error("[BOT SKY postventa] No se pudo asociar el GPS al pedido",error);
      }
      const reply = attached
        ? "📍 ¡Perfecto! 😊 Guardé tu ubicación en tu pedido ya registrado. No necesitás volver a confirmar la ciudad. ¡Gracias! 🚚💚"
        : "📍 ¡Recibí tu ubicación! 😊 Tu pedido ya está registrado, pero no pude asociar el GPS al pedido. Un asesor puede verificarlo. 💚";
      const wamid=await sendWhatsAppText(conn,phone,reply);
      await supabaseAdmin.from("messages").insert({
        workspace_id:workspaceId,user_id:ownerId,conversation_id:conversation.id,
        ad_id:attributedAdId,direction:"outbound",sender:"ai",body:reply,
        wamid,status:"sent"
      });
      await supabaseAdmin.from("conversations").update({
        last_message:reply,last_message_at:new Date().toISOString(),unread_count:0,
      }).eq("workspace_id",workspaceId).eq("id",conversation.id);
      return;
    }
  }

  // POSTVENTA GENERAL: una venta cerrada no vuelve al catálogo por un saludo,
  // reclamo, consulta logística o mensaje ambiguo. Solo una intención inequívoca
  // de COMPRA NUEVA puede reabrir la venta (decidido antes, al cargar conversación).
  if (conversation.sale_closed) {
    const { data: recentHistory } = await supabaseAdmin.from("messages")
      .select("sender,body").eq("workspace_id",workspaceId)
      .eq("conversation_id",conversation.id)
      .order("created_at",{ascending:false}).limit(24);
    const history=(recentHistory??[]).reverse().filter(m=>Boolean(m.body)).map(m=>({
      role:m.sender==="customer"?("user" as const):("assistant" as const),content:String(m.body),
    }));
    const ctx=await buildWorkspaceAiContext(supabaseAdmin,workspaceId,history,conversation.product_id,phone);
    const verified=await addVerifiedOrderContext(supabaseAdmin,ctx,workspaceId,phone);
    const safeCtx={...verified,systemInstruction:verified.systemInstruction+`\nPRIORIDAD ABSOLUTA: El cliente YA COMPRÓ (sale_closed=true). Esto es POSTVENTA. Contestá su último mensaje y su reclamo primero. PROHIBIDO reiniciar venta, ofrecer promociones, solicitar cantidad, ciudad, GPS, nombre o domicilio que ya proporcionó, o generar otro pedido. Si pide entrega hoy, solo confirmala si hay fecha exacta en datos verificados. Nunca afirmes haber avisado a logística, priorizado, coordinado o registrado cambios sin una herramienta que lo haga. Si envía un saludo o agradecimiento, responde muy brevemente. Evitá repeticiones.`};
    let reply:string;
    try { reply=(await generateAiReply(safeCtx)).reply?.trim() || ""; }
    catch (error) { console.error("[BOT SKY postventa] IA no disponible",error); reply="Entiendo tu consulta sobre tu pedido. 🙏 Un asesor debe verificar con logística el estado real de entrega. No quiero prometerte una fecha sin confirmarla."; }
    if(!reply) reply="Gracias por escribirnos. 😊 Para darte información correcta sobre tu pedido, un asesor debe verificar el estado actual.";
    const wamid=await sendWhatsAppText(conn,phone,reply);
    await supabaseAdmin.from("messages").insert({workspace_id:workspaceId,user_id:ownerId,conversation_id:conversation.id,ad_id:attributedAdId,direction:"outbound",sender:"ai",body:reply,wamid,status:"sent"});
    await supabaseAdmin.from("conversations").update({last_message:reply,last_message_at:new Date().toISOString(),unread_count:0}).eq("workspace_id",workspaceId).eq("id",conversation.id);
    return;
  }

  // Palabra clave → envía la plantilla del producto (multimedia + copy).
  // Si el catálogo fue enviado AHORA, terminamos este turno para evitar que
  // generateAiReply() vuelva a mandar el mismo copy en el mismo webhook.
  const catalogResult = await sendCatalogByKeyword({
    workspaceId,
    ownerId,
    conversationId: conversation.id,
    adId: attributedAdId,
    conn,
    phone,
    text: body,
    cityFirst: aiSettings.hybrid_mode === "hybrid" || !aiSettings.hybrid_mode,
  });

  if (catalogResult) {
    conversation.product_id = catalogResult.productId;
    // El copy del catálogo es la ÚNICA respuesta comercial en este turno.
    // No mandar oferta corta duplicada ni preguntar ciudad antes de elegir variante.
    if (catalogResult.sent) {
      if (aiSettings.hybrid_mode === "hybrid" || !aiSettings.hybrid_mode) {
        // La presentación comercial ya salió: persistir qué esperamos sin consumir IA.
        // Nunca borrar otra venta activa con datos ya capturados.
        const { data: existingState, error: stateError } = await supabaseAdmin
          .from("bot_sale_states").select("state")
          .eq("workspace_id", workspaceId).eq("conversation_id", conversation.id).maybeSingle();
        if (stateError) throw stateError;
        const current = (existingState?.state ?? {}) as SaleState;
        if (!current.cityVerified && (!current.productId || current.productId === catalogResult.productId)) {
          await supabaseAdmin.from("bot_sale_states").upsert({
            workspace_id: workspaceId, conversation_id: conversation.id,
            state: { ...current, productId: catalogResult.productId, awaiting: "city" },
            updated_at: new Date().toISOString(),
          }, { onConflict: "workspace_id,conversation_id" }).then(({ error }) => {
            if (error) throw error;
          });
        }
      }
      return;
    }
  }

  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("sender, body")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(24);

  const chatHistory = (history ?? [])
    .reverse()
    .filter((m) => Boolean(m.body))
    .map((m) => ({
      role: m.sender === "customer" ? ("user" as const) : ("assistant" as const),
      content: m.body as string,
    }));

  try {
    const ctx = await buildWorkspaceAiContext(
      supabaseAdmin,
      workspaceId,
      chatHistory,
      conversation.product_id,
      phone,
    );
    const hybridMode = (aiSettings?.hybrid_mode === "rules_only" || aiSettings?.hybrid_mode === "ai_first")
      ? aiSettings.hybrid_mode : "hybrid";
    // Persistencia por conversación. El estado no depende de la memoria de Vercel.
    const { data: saleRow, error: saleReadError } = await supabaseAdmin
      .from("bot_sale_states").select("state")
      .eq("workspace_id", workspaceId).eq("conversation_id", conversation.id).maybeSingle();
    if (saleReadError) throw saleReadError;
    const previousSale = (saleRow?.state ?? {}) as SaleState;
    // GPS se conserva incluso si la IA responde a continuación. Datos geográficos
    // del mensaje NO son una ciudad confirmada hasta verificar la geocodificación.
    const explicitCoordinates = isLocation && latitude !== null && longitude !== null
      ? { latitude, longitude } : coordinatesFromText(body);
    const isGpsMessage = Boolean(explicitCoordinates || googleMapsUrl || /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[^\s/]+\/maps)/i.test(body));
    const gpsUrl = googleMapsUrl || (explicitCoordinates
      ? `https://www.google.com/maps/search/?api=1&query=${explicitCoordinates.latitude},${explicitCoordinates.longitude}`
      : null);
    if (gpsUrl) previousSale.locationUrl = gpsUrl;
    // No deducimos la ciudad a partir de coordenadas: el cliente la confirma.
    // Si una ciudad ya estaba confirmada en ESTA conversación, se conserva.
    if (isGpsMessage && !previousSale.cityVerified) {
      previousSale.city = null;
      previousSale.department = null;
      previousSale.coverageStatus = "unknown";
      previousSale.awaiting = "city";
    }
    if (isGpsMessage) {
      const { error: gpsSaveError } = await supabaseAdmin.from("bot_sale_states").upsert({
        workspace_id:workspaceId,conversation_id:conversation.id,state:previousSale,
        updated_at:new Date().toISOString()
      },{onConflict:"workspace_id,conversation_id"});
      if(gpsSaveError) throw gpsSaveError;
    }
    const intent = isGpsMessage ? "checkout" : classifyCustomerIntent(body);
    // No permitir que texto libre en el nombre/dirección de la ubicación se
    // confunda con ciudades o información del checkout.
    const locationReminder = !isGpsMessage && /\b(?:ya (?:te|le|les) (?:pase|envie|mande)|ya (?:comparti|envie)|ahi ya (?:te|le) pase)\b/i.test(body.normalize("NFD").replace(/[\u0300-\u036f]/g,"")) && /\b(?:ubicacion|gps|maps|localizacion)\b/i.test(body.normalize("NFD").replace(/[\u0300-\u036f]/g,""));
    // Si el GPS está guardado, reconocer el dato real en vez de pedirlo otra vez.
    // El resto de mensajes complejos sigue yendo a la IA.
    const savedSaleReadyForFinalization = Boolean(locationReminder && previousSale.locationUrl && previousSale.cityVerified && previousSale.customerName && previousSale.productId && previousSale.quantity);
    const saleInput = isGpsMessage ? `📍 Ubicación compartida${gpsUrl?`\n${gpsUrl}`:""}` : savedSaleReadyForFinalization ? "Confirmo mis datos para registrar el pedido" : body;
    const bypassSale = intent !== "checkout" && !savedSaleReadyForFinalization;
    const answerContextBase = intent === "order_status" && hybridMode !== "rules_only"
      ? await addVerifiedOrderContext(supabaseAdmin, ctx, workspaceId, phone)
      : ctx;
    const answerContext = isGpsMessage ? {...answerContextBase, systemInstruction:answerContextBase.systemInstruction +
          `\nUBICACIÓN RECIBIDA: GPS guardado: ${Boolean(previousSale.locationUrl)}. `+
          `Ciudad verificada: ${previousSale.cityVerified ? previousSale.city : "NO VERIFICADA"}. `+
          `Estado de cobertura: ${previousSale.coverageStatus??"unknown"}. `+
          `No inventes ciudad, departamento ni cobertura. Si está NO VERIFICADA, pedí ciudad. `+
          `Nunca pidas pago anticipado por una ubicación desconocida. `+
          `La IA no puede registrar un pedido ni modificar precios a partir de la ubicación.`}
      : bypassSale && hybridMode !== "rules_only" ? addPendingSaleContext(answerContextBase, previousSale) : answerContextBase;
    const ruleStep = hybridMode !== "ai_first" && !bypassSale
      ? advanceRuleSale(ctx, saleInput, previousSale, media && (media.type === "image" || media.type === "document") ? mediaPath : null, gpsUrl)
      : null;
    let saveStep = ruleStep;
    // En híbrido: reglas administran producto/ciudad/importe y siempre registran el
    // pedido si está completo. Tras la ciudad, la IA puede continuar la charla;
    // no se la invoca para una respuesta determinista inicial ni para el registro.
    const ruleMustAnswer = hybridMode !== "hybrid" || !previousSale.cityVerified ||
      !ruleStep?.state.cityVerified || ruleStep?.complete ||
      ruleStep?.state.awaiting === "variant" || ruleStep?.state.awaiting === "quantity" ||
      ruleStep?.state.awaiting === "receipt" ||
      (previousSale.awaiting === "city" && Boolean(ruleStep?.state.cityVerified));
    let safeDecision = ruleStep && !ruleStep.needsAi && ruleMustAnswer
      ? {reply:ruleStep.reply, productId:ruleStep.productId, reason:"venta_reglas"}
      : (intent === "order_status" || intent === "complex" || intent === "price") && hybridMode !== "rules_only"
        ? null
        : decideHybridReply({ctx, text: body, mode: hybridMode});
    let result: Awaited<ReturnType<typeof generateAiReply>>;
    let responseOrigin = "ai";
    // En modo híbrido la IA redacta la respuesta al GPS con hechos verificados.
    // La respuesta determinista queda como respaldo y nunca se autoriza un pedido por este evento.
    if (isGpsMessage && hybridMode !== "rules_only" && ruleStep && !ruleStep.needsAi) {
      safeDecision = null;
    }
    if (locationReminder && bypassSale && previousSale.locationUrl && hybridMode !== "ai_first") {
      const missing = !previousSale.cityVerified ? "Solo falta confirmar tu ciudad para verificar la cobertura." : !previousSale.customerName ? "Solo me falta tu nombre y apellido para completar el pedido." : "Ya tengo la ubicación guardada para tu compra. Voy a revisar que el pedido tenga todos sus datos.";
      safeDecision = {reply:`Tenés razón, disculpame. 🙏📍 *Tu ubicación ya está guardada*, no hace falta que la vuelvas a enviar. ${missing}`,productId:previousSale.productId??conversation.product_id,reason:"gps_ya_guardado"};
    }
    if (isGpsMessage) {
      const msg = previousSale.cityVerified && previousSale.city
        ? `📍 ¡Recibí y guardé tu ubicación! 😊 Ya tengo tu ciudad confirmada: *${previousSale.city}*. Seguimos con tu pedido. 💚`
        : "📍 ¡Recibí y guardé tu ubicación! 😊🚚 Para confirmar nuestra cobertura, ¿me indicás *en qué ciudad* estás?";
      safeDecision = {reply:msg,productId:previousSale.productId??conversation.product_id,reason:"ubicacion_ciudad_confirmacion"};
      saveStep = null;
    }
    if (safeDecision) {
      result = {reply: safeDecision.reply, product_id: safeDecision.productId, sale_closed: false, order: null};
      responseOrigin = `code:${safeDecision.reason}`;
    } else if (hybridMode === "rules_only") {
      const fallback = decideHybridReply({ctx, text: body, mode: hybridMode, fallback: true});
      result = {reply: fallback?.reply ?? "Un asesor necesita revisar tu consulta. 😊", product_id: fallback?.productId ?? conversation.product_id, sale_closed:false, order:null};
      responseOrigin = "code:rules_only";
    } else {
      try {
        result = await generateAiReply(answerContext);
      } catch (aiError) {
        if (aiSettings?.hybrid_fallback_enabled === false && !isAiQuotaFailure(aiError)) throw aiError;
        saveStep = bypassSale ? null : advanceRuleSale(ctx, saleInput, previousSale, media && (media.type === "image" || media.type === "document") ? mediaPath : null, gpsUrl);
        const fallback = saveStep && !saveStep.needsAi
          ? {reply:saveStep.reply, productId:saveStep.productId, reason:"venta_reglas_respaldo"}
          : decideHybridReply({ctx, text:body, mode:hybridMode, fallback:true});
        if (!fallback) throw aiError;
        result = {reply:fallback.reply, product_id:fallback.productId, sale_closed:false, order:null};
        responseOrigin = `code:${fallback.reason}`;
        console.warn("[BOT SKY híbrido] APIs agotadas; respondió el respaldo determinista", {
          workspaceId, conversationId:conversation.id,
          reason:aiError instanceof Error ? aiError.message.slice(0, 160) : "error"
        });
      }
    }
    // Consultar precio/garantía/seguimiento no debe completar ni crear pedidos.
    if (isGpsMessage && ruleStep && !ruleStep.needsAi && /(?:sin cobertura|no tenemos cobertura|pago anticipado|datos bancarios)/i.test(result.reply) && previousSale.coverageStatus !== "uncovered") {
      result = {...result,reply:ruleStep.reply};
    }
    if (bypassSale || isGpsMessage) result = {...result, sale_closed:false, order:null};
    if (saveStep && !saveStep.needsAi) {
      const {error: saveStateError} = await supabaseAdmin.from("bot_sale_states")
        .upsert({workspace_id:workspaceId,conversation_id:conversation.id,
          state:saveStep.state,updated_at:new Date().toISOString()},
          {onConflict:"workspace_id,conversation_id"});
      if(saveStateError) throw saveStateError;
      if(saveStep.complete && !isGpsMessage && !conversation.sale_closed) {
        const st=saveStep.state;
        result = {reply:saveStep.reply,product_id:saveStep.productId,sale_closed:true,
          order:{customer_name:st.customerName!,city:st.city!,departamento:st.department!,
            street:st.street??undefined,quantity:st.quantity!,
            product_price_id:st.optionId??undefined,payment_method:st.paymentMethod!,phone}};
        responseOrigin="code:venta_completa";
      }
    }
    console.info("[BOT SKY híbrido] respuesta", {workspaceId, conversationId:conversation.id, origin:responseOrigin});

    const detectedProduct =
      result.product_id && ctx.products.some((p) => p.id === result.product_id)
        ? result.product_id
        : conversation.product_id;

    // Segunda barrera anti-repetición:
    // si la IA intenta volver a mandar prácticamente el mismo copy largo del
    // catálogo, lo reemplazamos por una oferta breve con los precios reales.
    const safeReply = bypassSale && hybridMode !== "rules_only" ? result.reply : buildSafeAiReply({
      reply: result.reply,
      history: chatHistory,
      products: ctx.products,
      productId: detectedProduct,
      lastCustomerMessage: body,
    });

    const optionConfirmed = Boolean(saveStep?.state.cartLines?.length) || isUnambiguousPriceSelection(result.order, detectedProduct, ctx.products, chatHistory);
    const productForReply = ctx.products.find((p) => p.id === detectedProduct);
    const mustClarify = Boolean(result.order && !optionConfirmed && (productForReply?.product_prices?.length ?? 0) > 1);
    const finalReply = mustClarify
      ? buildVariantSelectionQuestion(productForReply!)
      : safeReply;
    // No prometer que el pedido quedó registrado ANTES del INSERT.
    // No permitir confirmaciones comerciales falsas, incluso si la IA no entrega
    // result.order o sale_closed. Sólo el bloque posterior al INSERT confirmado
    // puede anunciar "PEDIDO REGISTRADO" con número real.
    const safeBeforeInsert = finalReply
      .replace(/(?:✅\s*)?PEDIDO\s+(?:CONFIRMADO|REGISTRADO)/gi, "Pedido pendiente de verificación")
      .replace(/\b(?:ya\s+)?(?:registre|registramos|tome|tomamos|agende|agendamos)\s+(?:tu|su|el)\s+pedido\b/gi,
        "Estoy verificando los datos de tu pedido")
      .replace(/\b(?:tu|su)\s+pedido\s+(?:ya\s+)?(?:quedo|esta)\s+(?:confirmado|registrado|agendado)\b/gi,
        "Tu pedido está pendiente de verificación");
    const wamid = await sendWhatsAppText(conn, phone, safeBeforeInsert);

    await supabaseAdmin.from("messages").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      conversation_id: conversation.id,
      ad_id: attributedAdId,
      direction: "outbound",
      sender: "ai",
      response_origin: responseOrigin.startsWith("code:") ? "code" : "ai",
      body: safeBeforeInsert,
      wamid,
      status: "sent",
    } as any);

    await supabaseAdmin
      .from("conversations")
      .update({
        last_message: safeBeforeInsert,
        last_message_at: new Date().toISOString(),
        product_id: detectedProduct,
        unread_count: 0,
      })
      .eq("id", conversation.id);

    // Pago anticipado: no registrar si todavía no hay archivo de comprobante.
    // La recepción del archivo NO equivale a dinero acreditado.
    const isAdvance = /anticip|transfer|deposit|giro/i.test(result.order?.payment_method ?? "");
    let hasReceiptForOrder = Boolean(mediaPath && media && (media.type === "image" || media.type === "document"));
    if (isAdvance && !hasReceiptForOrder) {
      const {data: recentProofs} = await supabaseAdmin.from("messages")
        .select("id").eq("workspace_id",workspaceId).eq("conversation_id",conversation.id)
        .eq("direction","inbound").in("media_type",["image","document"])
        .not("media_url","is",null)
        .gte("created_at",new Date(Date.now()-3*60*60*1000).toISOString())
        .limit(1);
      hasReceiptForOrder=Boolean(recentProofs?.length);
    }
    const orderReady = isOrderReady(result.order, detectedProduct) &&
      (Boolean(saveStep?.state.cartLines?.length) || isUnambiguousPriceSelection(result.order, detectedProduct, ctx.products, chatHistory)) &&
      (!isAdvance || hasReceiptForOrder);

    /*
     * No dependemos solamente de sale_closed.
     * Si Gemini entregó todos los datos obligatorios, el backend crea el
     * pedido aunque el modelo haya olvidado marcar sale_closed=true.
     */
    /*
     * Si la conversación ya tiene una venta cerrada, la IA puede seguir
     * devolviendo el pedido anterior por el historial. En ese caso no se crea
     * otra orden. Una compra nueva primero reinicia sale_closed=false mediante
     * isNewPurchaseIntent() y recién entonces puede registrar otro pedido.
     */
    const verifiedOrderCoverage = result.order ? verifiedCoverage(
      String(result.order.city??""),String(result.order.departamento??""),parseCoverage(ctx.training)) : null;
    if (!conversation.sale_closed && result.order && orderReady && !isGpsMessage && (verifiedOrderCoverage?.active || (isAdvance && /ANTICIPADO|TRANSFERENCIA/i.test(verifiedOrderCoverage?.method ?? ""))) && (!previousSale.city || (previousSale.cityVerified && previousSale.coverageStatus === "covered"))) {
      const completedOrder = {
        ...result.order,
        phone,
      };

      const createdOrder = await createOrderFromAi({
        workspaceId,
        ownerId,
        conversationId: conversation.id,
        contactId: contact.id,
        phone,
        adId: attributedAdId,
        productId: detectedProduct,
        sourceMessageId: message.id,
        order: completedOrder,
        products: ctx.products,
        cartLines: saveStep?.state.cartLines,
      });

      /*
       * CASO 1:
       * Si el mismo mensaje que terminó de confirmar el pedido contenía el
       * comprobante, en el primer intento todavía no existía la orden.
       * Reintentamos ahora que createOrderFromAi() ya la creó.
       */
      if (mediaPath && media) {
        await attachPaymentReceiptToLatestOrder({
          workspaceId,
          ownerId,
          conversationId: conversation.id,
          mediaPath,
          mediaType: media.type,
          transcript,
        });
      }

      /*
       * CASO 2:
       * El cliente pudo haber enviado el comprobante ANTES de completar todos
       * los datos necesarios para crear el pedido. En ese caso el archivo ya
       * existe en messages.media_url, pero todavía no existía orders.
       *
       * Esta recuperación busca ese comprobante reciente y lo enlaza al pedido.
       * Si el CASO 1 ya lo enlazó, esta función detecta receipt_url y no hace nada.
       */
      await recoverRecentPaymentReceiptForOrder({
        workspaceId,
        ownerId,
        conversationId: conversation.id,
        orderId: createdOrder.id,
      });
      await supabaseAdmin.from("bot_sale_states").delete()
        .eq("workspace_id", workspaceId).eq("conversation_id", conversation.id);
      // Confirmar SOLO después de que Supabase haya insertado el pedido.
      // No afirmar que una transferencia quedó acreditada sin validarla.
      const confirmedMessage = `✅ PEDIDO REGISTRADO\n📦 N.º ${createdOrder.order_number}\n💰 Total: ${formatGs(createdOrder.total)}\n¡Gracias por tu compra!`;
      try {
        const confirmationWamid = await sendWhatsAppText(conn, phone, confirmedMessage);
        await supabaseAdmin.from("messages").insert({
          workspace_id: workspaceId, user_id: ownerId,
          conversation_id: conversation.id, ad_id: attributedAdId,
          direction: "outbound", sender: "ai", body: confirmedMessage,
          wamid: confirmationWamid, status: "sent",
        });
        await supabaseAdmin.from("conversations").update({
          last_message: confirmedMessage,
          last_message_at: new Date().toISOString(),
        }).eq("id", conversation.id).eq("workspace_id", workspaceId);
      } catch (confirmationError) {
        console.error("[Pedidos] Pedido creado, pero falló el aviso de registro", {
          orderId: createdOrder.id,
          error: confirmationError instanceof Error ? confirmationError.message : String(confirmationError),
        });
      }
    } else if (result.sale_closed && !result.order) {
      await logOrderIssue({
        workspaceId,
        ownerId,
        message:
          `La IA marcó sale_closed=true pero devolvió order=null. ` +
          `Conversación: ${conversation.id}. Producto: ${detectedProduct ?? "sin producto"}.`,
      });
    } else if (result.sale_closed && result.order && !orderReady) {
      await logOrderIssue({
        workspaceId,
        ownerId,
        message:
          `La IA marcó la venta como cerrada, pero faltan datos obligatorios. ` +
          `Conversación: ${conversation.id}. ` +
          `Producto: ${detectedProduct ?? "sin producto"}. ` +
          `Pedido recibido: ${JSON.stringify(result.order)}`,
      });
    }
  } catch (e) {
    const messageText = e instanceof Error ? e.message : "error";
    // Cola duradera de fallos. No vuelve a enviar mensajes automáticamente:
    // el reprocesador debe ser idempotente y verificar orders antes de enviar.
    try {
      const { error: queueError } = await supabaseAdmin.from("ai_failed_messages").upsert({
        workspace_id: workspaceId,
        user_id: ownerId,
        conversation_id: conversation.id,
        wamid: message.id,
        error_message: messageText.slice(0, 1500),
        status: "pending",
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,wamid" });
      if (queueError) console.error("[AI] No se pudo guardar el mensaje pendiente", queueError);
    } catch (queueUnexpectedError) {
      console.error("[AI] Error inesperado registrando pendiente", queueUnexpectedError);
    }
    await supabaseAdmin.from("integration_logs").insert({
      workspace_id: workspaceId,
      user_id: ownerId,
      integration: "ai",
      level: "error",
      message: messageText,
    });
  }
}

function cleanOrderText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type PriceOption = { id: string; label: string; quantity: number; price: number; sort_order: number };

function matchSelectedOption(
  order: Awaited<ReturnType<typeof generateAiReply>>["order"],
  options: PriceOption[],
  history: { role: "user" | "assistant"; content: string }[] = [],
): PriceOption | null {
  if (!order || options.length === 0) return null;
  if (options.length === 1) return options[0];
  // Si el cliente dijo explícitamente una presentación, esa elección manda.
  // No interpretar un número sin unidad ("5") como cinco litros.
  const customerTurns = history.filter((h) => h.role === "user").slice(-12).reverse();
  for (const turn of customerTurns) {
    const message = normalizeIntentText(turn.content);
    if (/\bno (?:quiero|me interesa|deseo|llevo)\b/.test(message)) continue;
    const hits = options.filter((o) => {
      const label = normalizeIntentText(o.label);
      const token = label.match(/\b\d+(?:[.,]\d+)?\s*(?:litros?|lts?|ml|kg|gramos?|gr|cm|mm)\b/)
        ?? label.match(/\b(?:azul|rojo|negro|blanco|verde|rosa|pequeno|mediano|grande)\b/);
      return Boolean(token && message.includes(token[0]));
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  const directId = cleanOrderText(order.product_price_id);
  if (directId) return options.find((o) => o.id === directId) ?? null;
  const requestedLabel = normalizeIntentText(cleanOrderText(order.price_option_label));
  if (requestedLabel) {
    const matched = options.filter((o) => normalizeIntentText(o.label) === requestedLabel);
    if (matched.length === 1) return matched[0];
  }
  return null;
}

export function isUnambiguousPriceSelection(
  order: Awaited<ReturnType<typeof generateAiReply>>["order"],
  productId: string | null,
  products: AiContextProducts,
  history: { role: "user" | "assistant"; content: string }[] = [],
): boolean {
  if (!order || !productId) return false;
  const product = products.find((p) => p.id === productId);
  if (!product) return false;
  const options = product.product_prices ?? [];
  return options.length === 0 || matchSelectedOption(order, options, history) !== null;
}

function buildVariantSelectionQuestion(product: AiContextProducts[number]): string {
  const options = [...(product.product_prices ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return `😊 Tenemos estas opciones de *${product.name}*:\n\n${options.map((o) => `• *${o.label}* — ${formatGs(o.price)}`).join("\n")}\n\n¿Cuál preferís?`;
}

export function isOrderReady(
  order: Awaited<ReturnType<typeof generateAiReply>>["order"],
  productId: string | null,
): order is NonNullable<Awaited<ReturnType<typeof generateAiReply>>["order"]> {
  if (!order || !productId) return false;

  const customerName = cleanOrderText(order.customer_name);
  const city = cleanOrderText(order.city);
  const paymentMethod = cleanOrderText(order.payment_method);
  const quantity = Number(order.quantity);

  /*
   * La dirección es opcional para contraentrega y transportadora.
   * El pedido puede crearse con producto, nombre, ciudad, forma de pago y
   * cantidad válidos. Si existe una dirección, igualmente se guarda.
   */
  return Boolean(
    customerName &&
      city &&
      paymentMethod &&
      Number.isFinite(quantity) &&
      quantity > 0,
  );
}

async function logOrderIssue(args: {
  workspaceId: string;
  ownerId: string;
  message: string;
}) {
  console.error("[Pedidos]", args.message);

  const { error } = await supabaseAdmin.from("integration_logs").insert({
    workspace_id: args.workspaceId,
    user_id: args.ownerId,
    integration: "orders",
    level: "error",
    message: args.message.slice(0, 2000),
  });

  if (error) {
    console.error("[Pedidos] No se pudo guardar integration_logs", {
      error: error.message,
    });
  }
}

export async function createOrderFromAi(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  contactId: string;
  phone: string;
  adId: string | null;
  productId: string | null;
  sourceMessageId: string;
  order: NonNullable<Awaited<ReturnType<typeof generateAiReply>>["order"]>;
  cartLines?: Array<{ optionId: string; quantity: number }>;
  products: {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    promo_price: number | null;
    product_prices?: {
      id: string;
      label: string;
      quantity: number;
      price: number;
      sort_order: number;
    }[];
  }[];
}) {
  /*
   * Cada compra se identifica por el mensaje de WhatsApp que terminó de
   * confirmar el pedido. El número generado es determinista: si Meta reenvía
   * exactamente el mismo webhook, recuperamos el mismo pedido; si el cliente
   * realiza otra compra en otro mensaje, se crea una orden nueva aunque se
   * reutilicen el contacto y la conversación.
   */
  const sourceMessageId = cleanOrderText(args.sourceMessageId);

  if (!sourceMessageId) {
    const error = new Error(
      "No se puede crear el pedido porque falta el ID del mensaje de origen",
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message: `${error.message}. Conversación: ${args.conversationId}.`,
    });

    throw error;
  }

  const orderKeyBytes = new TextEncoder().encode(
    `${args.workspaceId}:${sourceMessageId}`,
  );
  const orderKeyHash = await crypto.subtle.digest("SHA-256", orderKeyBytes);
  const orderKey = Array.from(new Uint8Array(orderKeyHash))
    .slice(0, 10)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const orderNumber = `BS-${orderKey}`;

  const { data: existingOrder, error: existingOrderError } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, ad_id, total")
    .eq("workspace_id", args.workspaceId)
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (existingOrderError) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `No se pudo comprobar si el mensaje ya había creado un pedido. ` +
        `${existingOrderError.message} | ` +
        `${existingOrderError.details ?? ""} | ` +
        `${existingOrderError.hint ?? ""} | ` +
        `${existingOrderError.code ?? ""}`,
    });

    throw existingOrderError;
  }

  if (existingOrder) {
    /*
     * Reintento del mismo webhook: repara conversation_id, pero NUNCA pisa un
     * ad_id ya guardado. El anuncio del pedido es un snapshot histórico.
     */
    const { error: repairExistingOrderError } = await supabaseAdmin
      .from("orders")
      .update({
        conversation_id: args.conversationId,
        ad_id: existingOrder.ad_id ?? args.adId,
      })
      .eq("id", existingOrder.id)
      .eq("workspace_id", args.workspaceId);

    if (repairExistingOrderError) {
      console.error("[Pedidos] No se pudo reparar la atribución del pedido existente", {
        orderId: existingOrder.id,
        conversationId: args.conversationId,
        error: repairExistingOrderError.message,
      });
    }

    console.info("[Pedidos] Mensaje de venta ya procesado", {
      conversationId: args.conversationId,
      sourceMessageId,
      orderId: existingOrder.id,
      orderNumber: existingOrder.order_number,
      adId: existingOrder.ad_id ?? args.adId,
    });

    return existingOrder;
  }

  const product =
    args.products.find((candidate) => candidate.id === args.productId) ?? null;

  if (!product || !args.productId) {
    const error = new Error(
      "No se puede crear el pedido porque no hay un producto válido detectado",
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `${error.message}. Conversación: ${args.conversationId}. ` +
        `productId recibido: ${args.productId ?? "null"}.`,
    });

    throw error;
  }

  /*
   * Los precios reales se guardan en product_prices.
   * Cada opción contiene:
   * - quantity: cantidad incluida en la presentación.
   * - price: precio TOTAL de esa presentación.
   *
   * Ejemplo:
   * 2 unidades -> 250000
   *
   * En orders guardamos:
   * - quantity = 2
   * - price = 125000 (precio unitario calculado)
   * - total = 250000
   */
  const parsedRequestedQuantity = Number(args.order.quantity);
  const requestedQuantity =
    Number.isFinite(parsedRequestedQuantity) &&
    parsedRequestedQuantity > 0
      ? Math.floor(parsedRequestedQuantity)
      : 1;

  const { data: recentCustomerMessages } = await supabaseAdmin
    .from("messages")
    .select("body")
    .eq("workspace_id", args.workspaceId)
    .eq("conversation_id", args.conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(24);
  const selectionHistory = (recentCustomerMessages ?? []).reverse().map((row) => ({
    role: "user" as const,
    content: String(row.body ?? ""),
  }));

  const priceOptions = [...(product.product_prices ?? [])]
    .map((option) => ({
      id: option.id,
      label: cleanOrderText(option.label),
      quantity: Math.max(1, Math.floor(Number(option.quantity) || 1)),
      price: Number(option.price),
      sort_order: Number(option.sort_order) || 0,
    }))
    .filter(
      (option) =>
        option.label &&
        Number.isFinite(option.quantity) &&
        option.quantity > 0 &&
        Number.isFinite(option.price) &&
        option.price > 0,
    )
    .sort((a, b) => a.sort_order - b.sort_order);

  // El carrito se valida contra las opciones REALES del producto, nunca contra texto de IA.
  const cartLines = args.cartLines?.length ? args.cartLines : null;
  const cartResolved = cartLines?.map(line=>{
    const option=priceOptions.find(o=>o.id===line.optionId);
    if(!option||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>25||option.quantity!==1){
      throw new Error('Carrito de variantes inválido: un asesor debe revisar el pedido');
    }
    return {...line,label:option.label,price:option.price};
  }) ?? null;
  if(cartResolved && (cartResolved.length<2||new Set(cartResolved.map(x=>x.optionId)).size!==cartResolved.length)){
    throw new Error('Carrito multivariante incompleto o con artículos repetidos');
  }
  const selectedPrice = matchSelectedOption(args.order, priceOptions, selectionHistory);
  if (priceOptions.length > 0 && !selectedPrice && !cartResolved) {
    throw new Error(`No se puede cerrar pedido: falta seleccionar una variante válida de ${product.name}`);
  }

  /*
   * Compatibilidad con productos antiguos:
   * si todavía no tienen product_prices, se usan las columnas heredadas.
   */
  const legacyRegularPrice = Number(product.price);
  const legacyPromoPrice =
    product.promo_price === null || product.promo_price === undefined
      ? null
      : Number(product.promo_price);

  const legacyUnitPrice =
    legacyPromoPrice !== null &&
    Number.isFinite(legacyPromoPrice) &&
    legacyPromoPrice > 0
      ? legacyPromoPrice
      : legacyRegularPrice;

  let quantity: number;
  let unitPrice: number;
  let total: number;
  let selectedPriceLabel: string | null = null;

  if (cartResolved) {
    quantity=cartResolved.reduce((sum,c)=>sum+c.quantity,0);
    total=cartResolved.reduce((sum,c)=>sum+c.quantity*c.price,0);
    unitPrice=total/quantity;
    selectedPriceLabel='Múltiples presentaciones';
  } else if (selectedPrice) {
    // Una opción de 1 unidad (p. ej. 5 litros) se multiplica por la
    // cantidad explícitamente solicitada. Una promoción de paquete se
    // mantiene con su cantidad/precio propios; nunca inventar prorrateos.
    if (selectedPrice.quantity === 1) {
      quantity = requestedQuantity;
      unitPrice = selectedPrice.price;
      total = selectedPrice.price * requestedQuantity;
    } else {
      if (requestedQuantity !== selectedPrice.quantity) {
        throw new Error(`Cantidad ${requestedQuantity} incompatible con la promoción ${selectedPrice.label} (${selectedPrice.quantity} unidades)`);
      }
      quantity = selectedPrice.quantity;
      total = selectedPrice.price;
      unitPrice = total / quantity;
    }
    selectedPriceLabel = selectedPrice.label;
  } else if (
    Number.isFinite(legacyUnitPrice) &&
    legacyUnitPrice > 0
  ) {
    quantity = requestedQuantity;
    unitPrice = legacyUnitPrice;
    total = unitPrice * quantity;
  } else {
    const error = new Error(
      `El producto "${product.name}" no tiene opciones de precio válidas`,
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `${error.message}. Conversación: ${args.conversationId}. ` +
        `Producto: ${product.id}. ` +
        `product_prices=${JSON.stringify(product.product_prices ?? [])}. ` +
        `price=${String(product.price)}. ` +
        `promo_price=${String(product.promo_price)}.`,
    });

    throw error;
  }

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    const error = new Error(
      `El producto "${product.name}" produjo un cálculo de precio inválido`,
    );

    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `${error.message}. Conversación: ${args.conversationId}. ` +
        `Producto: ${product.id}. ` +
        `Cantidad: ${quantity}. Precio unitario: ${unitPrice}. Total: ${total}.`,
    });

    throw error;
  }

  const customerName = cleanOrderText(args.order.customer_name) || "Cliente";

  const city = cleanOrderText(args.order.city);
  const departamento = cleanOrderText(args.order.departamento) || null;
  const district = cleanOrderText(args.order.district) || null;
  const street = cleanOrderText(args.order.street);
  const baseObservations =
    cleanOrderText(args.order.observations) || null;

  const observations = [
    baseObservations,
    cartResolved
      ? `MULTIVARIANTE (MISMO PRODUCTO): ${cartResolved.map(c=>`${c.quantity} x ${c.label} (${c.price.toLocaleString('es-PY')} Gs. c/u)`).join(' + ')}. TOTAL: ${total.toLocaleString('es-PY')} Gs.`
      : selectedPriceLabel ? `Variante seleccionada: ${selectedPriceLabel}` : null,
  ]
    .filter(Boolean)
    .join(" | ") || null;

  const paymentMethod = cleanOrderText(args.order.payment_method);

  /*
   * Snapshot del SKU vigente del producto al momento de crear el pedido.
   * Si el SKU cambia después en products, el pedido histórico conserva
   * el SKU con el que se realizó la venta.
   */
  // El pedido mixto NO representa un SKU único: bloquear exportación automática
  // para evitar que la plataforma de destino cargue la presentación equivocada.
  const productSku = cartResolved ? null : (cleanOrderText(product.sku) || null);

  /*
   * El ad_id llega como snapshot desde el mensaje que está cerrando la venta.
   * No volvemos a leer conversations.ad_id aquí porque otro referral concurrente
   * podría cambiarlo y atribuir la venta al anuncio equivocado.
   */

  const orderPayload = {
    workspace_id: args.workspaceId,
    user_id: args.ownerId,
    conversation_id: args.conversationId,
    ad_id: args.adId,
    contact_id: args.contactId,
    order_number: orderNumber,
    customer_name: customerName,
    phone: args.phone,
    city,
    departamento,
    district,
    street,
    observations,
    payment_method: paymentMethod,
    product_id: args.productId,
    product_title: product.name,
    sku: productSku,
    quantity,
    price: unitPrice,
    total,
    status: "nuevo" as const,
    payment_status: "pendiente" as const,
  };

  const { data: created, error } = await supabaseAdmin
    .from("orders")
    .insert(orderPayload)
    .select("id, order_number, customer_name, phone, total")
    .single();

  if (error) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `No se pudo crear el pedido. ` +
        `Mensaje: ${error.message}. ` +
        `Detalles: ${error.details ?? "-"}. ` +
        `Sugerencia: ${error.hint ?? "-"}. ` +
        `Código: ${error.code ?? "-"}. ` +
        `Payload: ${JSON.stringify(orderPayload)}`,
    });

    throw error;
  }

  const { error: conversationError } = await supabaseAdmin
    .from("conversations")
    .update({
      sale_closed: true,
      status: "vendida",
      product_id: args.productId,
    })
    .eq("id", args.conversationId);

  if (conversationError) {
    await logOrderIssue({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      message:
        `El pedido ${created.order_number} fue creado, pero no se pudo ` +
        `marcar la conversación como vendida. ${conversationError.message}`,
    });
  }

  const { error: notificationError } = await supabaseAdmin
    .from("notifications")
    .insert({
      workspace_id: args.workspaceId,
      user_id: args.ownerId,
      type: "venta",
      title: `Nueva venta ${created.order_number}`,
      body: `${created.customer_name} · ${formatGs(created.total)}`,
      link: "/pedidos",
      audience: "user",
    });

  if (notificationError) {
    console.error("[Pedidos] Error creando notificación", {
      orderNumber: created.order_number,
      error: notificationError.message,
    });
  }

  /*
   * Actualiza los datos básicos del contacto para que también aparezcan
   * correctamente en Inbox y Contactos.
   */
  const contactUpdate: {
    name?: string;
    city?: string;
  } = {};

  if (customerName && customerName !== "Cliente") {
    contactUpdate.name = customerName;
  }

  if (city) {
    contactUpdate.city = city;
  }

  if (Object.keys(contactUpdate).length > 0) {
    const { error: contactError } = await supabaseAdmin
      .from("contacts")
      .update(contactUpdate)
      .eq("id", args.contactId)
      .eq("workspace_id", args.workspaceId);

    if (contactError) {
      console.error("[Pedidos] Error actualizando contacto", {
        contactId: args.contactId,
        error: contactError.message,
      });
    }
  }

  const { data: settings } = await supabaseAdmin
    .from("user_settings")
    .select("apps_script_url")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();

  if (settings?.apps_script_url) {
    try {
      const response = await fetch(settings.apps_script_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_number: created.order_number,
          customer_name: customerName,
          phone: args.phone,
          city,
          departamento,
          district,
          street,
          product_id: args.productId,
          product: product.name,
          sku: productSku,
          price_option: selectedPriceLabel,
          quantity,
          unit_price: unitPrice,
          total,
          payment_method: paymentMethod,
          observations,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Apps Script respondió ${response.status}: ` +
            `${(await response.text()).slice(0, 500)}`,
        );
      }

      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        integration: "apps_script",
        level: "info",
        message: `Pedido ${created.order_number} enviado a Google Sheets`,
      });
    } catch (error) {
      await supabaseAdmin.from("integration_logs").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        integration: "apps_script",
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "Error enviando a Apps Script",
      });
    }
  }

  console.info("[Pedidos] Pedido creado correctamente", {
    id: created.id,
    orderNumber: created.order_number,
    conversationId: args.conversationId,
    adId: args.adId,
    workspaceId: args.workspaceId,
  });

  return created;
}

type CatalogKeywordResult = {
  productId: string;
  /** true = el catálogo/copy fue enviado en ESTE turno. */
  sent: boolean;
};

function normalizeForDuplicateCheck(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string) {
  const aTokens = new Set(normalizeForDuplicateCheck(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeForDuplicateCheck(b).split(" ").filter(Boolean));

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  return intersection / Math.min(aTokens.size, bTokens.size);
}

function looksLikeRepeatedCatalogCopy(
  reply: string,
  history: { role: "user" | "assistant"; content: string }[],
) {
  const normalizedReply = normalizeForDuplicateCheck(reply);

  // Las respuestas breves no se consideran repetición de un copy comercial.
  if (normalizedReply.length < 180) return false;

  const previousLongAssistantMessages = history
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .filter((content) => normalizeForDuplicateCheck(content).length >= 180)
    .slice(-6);

  return previousLongAssistantMessages.some((previous) => {
    const normalizedPrevious = normalizeForDuplicateCheck(previous);

    if (normalizedReply === normalizedPrevious) return true;
    if (normalizedReply.includes(normalizedPrevious)) return true;
    if (normalizedPrevious.includes(normalizedReply)) return true;

    return tokenSimilarity(reply, previous) >= 0.72;
  });
}

function isGreetingOrInitialInquiry(value: string) {
  const normalized = normalizeIntentText(value);

  const patterns = [
    "hola",
    "buen dia",
    "buenas",
    "buenas tardes",
    "buenas noches",
    "informacion",
    "info",
    "precio",
    "cuanto cuesta",
    "cuanto sale",
    "disponible",
    "quiero informacion",
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

type AiContextProducts = Awaited<
  ReturnType<typeof buildWorkspaceAiContext>
>["products"];

function buildShortProductOffer(args: {
  products: AiContextProducts;
  productId: string | null;
  lastCustomerMessage: string;
}) {
  const product =
    args.products.find((candidate) => candidate.id === args.productId) ?? null;

  if (!product) {
    return "¡Claro! 😊 ¿Para qué ciudad sería el envío? 📍";
  }

  const options = [...(product.product_prices ?? [])]
    .map((option) => ({
      label: String(option.label ?? "").trim(),
      quantity: Math.max(1, Math.floor(Number(option.quantity) || 1)),
      price: Number(option.price),
      sortOrder: Number(option.sort_order) || 0,
    }))
    .filter(
      (option) =>
        Number.isFinite(option.quantity) &&
        option.quantity > 0 &&
        Number.isFinite(option.price) &&
        option.price > 0,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 5);

  let priceText = "";

  if (options.length === 1) {
    priceText = `a solo ${formatGs(options[0].price)}`;
  } else if (options.length > 1) {
    priceText = `! 🔥\n\n${options
      .map(
        (option) =>
          `${option.label || `${option.quantity} unidades`} — ${formatGs(option.price)}`,
      )
      .join("\n")}`;
  } else {
    const promoPrice = Number(product.promo_price);
    const regularPrice = Number(product.price);
    const effectivePrice =
      Number.isFinite(promoPrice) && promoPrice > 0 ? promoPrice : regularPrice;

    if (Number.isFinite(effectivePrice) && effectivePrice > 0) {
      priceText = `a solo ${formatGs(effectivePrice)}`;
    }
  }

  const question = options.length > 1
    ? "¿Cuál de estas opciones preferís? 😊"
    : isGreetingOrInitialInquiry(args.lastCustomerMessage)
      ? "¿Para qué ciudad sería el envío? 📍"
      : "¿Querés que avancemos con tu pedido? 📦";

  if (options.length > 1) {
    return `¡El ${product.name} está en súper oferta${priceText}\n\n${question}`;
  }

  if (priceText) {
    return `¡El ${product.name} está en súper oferta ${priceText}! 🔥\n\n${question}`;
  }

  return `¡El ${product.name} está en súper oferta! 🔥\n\n${question}`;
}

function buildSafeAiReply(args: {
  reply: string;
  history: { role: "user" | "assistant"; content: string }[];
  products: AiContextProducts;
  productId: string | null;
  lastCustomerMessage: string;
}) {
  const cleanReply = args.reply.trim();

  if (!cleanReply) {
    return buildShortProductOffer({
      products: args.products,
      productId: args.productId,
      lastCustomerMessage: args.lastCustomerMessage,
    });
  }

  if (!looksLikeRepeatedCatalogCopy(cleanReply, args.history)) {
    return cleanReply;
  }

  console.info("[IA] Copy repetido bloqueado; se envía respuesta comercial breve", {
    productId: args.productId,
  });

  return buildShortProductOffer({
    products: args.products,
    productId: args.productId,
    lastCustomerMessage: args.lastCustomerMessage,
  });
}

/**
 * Detecta palabras clave del catálogo en el mensaje del cliente y envía
 * la plantilla del producto (multimedia + copy) una sola vez por conversación.
 * Devuelve el producto detectado e indica si se envió en este turno.
 */
async function sendCatalogByKeyword(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  adId: string | null;
  conn: Conn;
  phone: string;
  text: string;
  cityFirst?: boolean;
}): Promise<CatalogKeywordResult | null> {
  const raw = (args.text ?? "").toLowerCase().trim();
  if (!raw) return null;

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const haystack = normalize(raw);

  const { data: keywords, error: keywordsError } = await supabaseAdmin
    .from("product_keywords")
    .select(
      "keyword, product_id, products!inner(id, name, price, promo_price, sales_copy, description, is_active)",
    )
    .eq("workspace_id", args.workspaceId);

  if (keywordsError) {
    console.error("[Catálogo] Error leyendo palabras clave", {
      workspaceId: args.workspaceId,
      error: keywordsError.message,
    });
    return null;
  }

  if (!keywords?.length) return null;

  type Row = (typeof keywords)[number] & {
    products: {
      id: string;
      name: string;
      sales_copy: string | null;
      description: string | null;
      is_active: boolean;
    } | null;
  };

  let match: Row | null = null;

  for (const row of keywords as Row[]) {
    if (!row.products || row.products.is_active === false) {
      continue;
    }

    const keyword = normalize(row.keyword ?? "");
    if (!keyword) continue;

    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const expression = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`,
      "u",
    );

    if (
      expression.test(haystack) &&
      (!match || keyword.length > normalize(match.keyword ?? "").length)
    ) {
      match = row;
    }
  }

  if (!match?.products) return null;

  const productId = match.products.id;

  const { data: alreadySent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("conversation_id", args.conversationId)
    .eq("direction", "outbound")
    .eq("catalog_product_id", productId)
    .limit(1)
    .maybeSingle();

  if (alreadySent) {
    return { productId, sent: false };
  }

  const baseCopy =
    match.products.sales_copy?.trim() ||
    `${match.products.name}
${match.products.description ?? ""}`.trim();
  const { data: rawOptions } = await supabaseAdmin.from("product_prices")
    .select("label, quantity, price, sort_order")
    .eq("workspace_id", args.workspaceId)
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  const options = (rawOptions ?? []).filter((o) => o.label && Number(o.price) > 0);
  const normalizedCopy = normalizeIntentText(baseCopy);
  const missingNames = options.filter((o) => {
    const normalizedLabel = normalizeIntentText(o.label);
    const measure = normalizedLabel.match(/\b\d+(?:[.,]\d+)?\s*(?:litros?|lts?|ml|kg|gramos?|gr|cm|mm)\b/);
    return !normalizedCopy.includes(normalizedLabel) && !(measure && normalizedCopy.includes(measure[0]));
  });
  // Nunca presentar opciones solo como "1 unidad" si las etiquetas son capacidades.
  const variantLines = options.length > 1 && missingNames.length > 0
    ? `\n\n💥 *Opciones disponibles:*\n${options.map((o) => `• *${o.label}* — ${formatGs(Number(o.price))}`).join("\n")}${args.cityFirst ? "" : "\n¿Cuál preferís?"}`
    : "";
  const copy = baseCopy + variantLines + (args.cityFirst ? "\n\n📍 ¿De qué ciudad sos? Así verifico tu modalidad de entrega. 🚚" : "");

  const { sendWhatsAppMedia } = await import("@/lib/whatsapp.server");

  const { data: mediaRows, error: mediaError } = await supabaseAdmin
    .from("product_media")
    .select("url, storage_path, media_type, position")
    .eq("product_id", productId)
    .order("position", { ascending: true });

  if (mediaError) {
    console.error("[Catálogo] Error leyendo multimedia", {
      productId,
      error: mediaError.message,
    });
  }

  let copySentAsCaption = false;
  let copySent = false;
  let sentMediaCount = 0;

  for (const media of (mediaRows ?? []).slice(0, 8)) {
    let link =
      typeof media.url === "string" && media.url.trim()
        ? media.url.trim()
        : null;

    if (media.storage_path) {
      const { data: signed, error: signedError } = await supabaseAdmin.storage
        .from("product-media")
        .createSignedUrl(media.storage_path, 60 * 60 * 24 * 7);

      if (signedError) {
        console.error("[Catálogo] Error creando URL firmada", {
          productId,
          storagePath: media.storage_path,
          error: signedError.message,
        });
      }

      if (signed?.signedUrl) {
        link = signed.signedUrl;
      }
    }

    if (!link) continue;

    const rawType = String(media.media_type ?? "").toLowerCase();

    const type: "image" | "video" | "audio" | "document" = rawType.startsWith(
      "image",
    )
      ? "image"
      : rawType.startsWith("video")
        ? "video"
        : rawType.startsWith("audio")
          ? "audio"
          : "document";

    const caption =
      !copySentAsCaption && copy.length <= 1024 && (type === "image" || type === "video")
        ? copy
        : undefined;

    try {
      const wamid = await sendWhatsAppMedia(
        args.conn,
        args.phone,
        link,
        type,
        caption,
      );

      sentMediaCount += 1;

      if (caption) {
        copySentAsCaption = true;
        copySent = true;
      }

      const { error: insertError } = await supabaseAdmin
        .from("messages")
        .insert({
          workspace_id: args.workspaceId,
          user_id: args.ownerId,
          conversation_id: args.conversationId,
          ad_id: args.adId,
          direction: "outbound",
          sender: "ai",
          response_origin: "code",
          body: caption || `[${type}] ${match.products.name}`,
          media_url: link,
          media_type: type,
          status: "sent",
          wamid,
          catalog_product_id: caption ? productId : null,
        });

      if (insertError) {
        console.error("[Catálogo] Error guardando multimedia", {
          productId,
          error: insertError.message,
        });
      }
    } catch (error) {
      console.error("[Catálogo] Meta rechazó el archivo", {
        productId,
        type,
        link,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!copySentAsCaption) {
    try {
      const wamid = await sendWhatsAppText(args.conn, args.phone, copy);
      copySent = true;

      const { error: copyError } = await supabaseAdmin.from("messages").insert({
        workspace_id: args.workspaceId,
        user_id: args.ownerId,
        conversation_id: args.conversationId,
        ad_id: args.adId,
        direction: "outbound",
        sender: "ai",
        response_origin: "code",
        body: copy,
        catalog_product_id: productId,
        status: "sent",
        wamid,
      });

      if (copyError) {
        console.error("[Catálogo] Error guardando copy", {
          productId,
          error: copyError.message,
        });
      }
    } catch (error) {
      console.error("[Catálogo] Error enviando copy", {
        productId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (sentMediaCount === 0) {
        return null;
      }
    }
  }

  await supabaseAdmin
    .from("conversations")
    .update({
      product_id: productId,
      last_message: copy,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);

  return { productId, sent: copySent || sentMediaCount > 0 };
}
