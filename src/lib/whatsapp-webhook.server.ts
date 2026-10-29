function isAiQuotaFailure(error: unknown): boolean {
  const e = error as {status?:number;code?:string;message?:string};
  const msg = String(e?.message ?? error ?? "").toLowerCase();
  return e?.status === 429 || /(?:insufficient[_ ]quota|resource[_ ]exhausted|quota exceeded|rate[_ -]?limit|credit[s]? exhausted|sin cr[eé]ditos|saldo de ia|429)/i.test(msg);
}
import { handlePostSaleRecipientCi, shouldAskPostSaleCi } from "./recipient-ci.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formatGs } from "@/lib/format";
import { parseReceiptFields } from "@/lib/media-ai.server";
import { reconcileOrderWithSaleState, recoverSaleStateFromHistory, isValidCustomerName, isValidDeliveryAddress } from "@/lib/sale-reconciliation.server";
import { buildRegisteredOrderConfirmation } from "@/lib/order-confirmation.server";
import { buildWorkspaceAiContext } from "@/lib/ai-context.server";
import { generateAiReply, applyDynamicSellerTrainingReply, type AiContext } from "@/lib/ai.server";
import { advanceRuleSale, sellerUsesFirstOffer, isEncomiendaAdvanceOrder, sellerRequiresEncomiendaCi, isValidRecipientCi, type SaleState } from "@/lib/rule-sales.server";
import { classifyCustomerIntent, addVerifiedOrderContext, addPendingSaleContext } from "@/lib/hybrid-intent.server";
import { coordinatesFromText, validCoords } from "@/lib/hybrid-intent.server";
import { parseCoverage, verifiedCoverage, sellerAllowsNationwideAdvance, deliveryPolicyForCity, hasTemplatePlaceholder, stripBankDetailsForCod, enforceVerifiedPaymentReply, isNonCityPhrase, sellerBankText } from "@/lib/rule-sales.server";
import { resolveDepartamento } from "@/lib/orders";
import { sendWhatsAppText } from "@/lib/whatsapp.server";
import { detectComplaint, COMPLAINT_REASON_LABELS } from "@/lib/complaints";

type CheckoutPrompt = "city" | "name" | "address";

const looksLikeCheckoutQuestion = (reply: string, stage: CheckoutPrompt): boolean => {
  // La pregunta debe existir en la respuesta, no basta con listar «Nombre: ...».
  const questions = reply.match(/¿[^?\n]{1,220}\?|[^\n¿?]{1,220}\?/g) ?? [];
  const target = stage === "city"
    ? /\b(?:ciudad|localidad|d[oó]nde\s+(?:lo|te)\s+(?:enviamos|entregamos|recib[ií]s)|d[oó]nde\s+quer[eé]s\s+recibir)\b/i
    : stage === "name"
      ? /\b(?:nombre|apellido|c[oó]mo\s+te\s+llam[aá]s|qui[eé]n\s+(?:lo\s+)?recibe)\b/i
      : /\b(?:direcci[oó]n|domicilio|calle|referencia|ubicaci[oó]n|google\s+maps)\b/i;
  return questions.some(question => target.test(question));
};

function requiredCheckoutPrompt(
  state: SaleState | null | undefined,
  customerNameValid: boolean,
): { stage: CheckoutPrompt; question: string } | null {
  if (!state?.productId) return null;
  // No pedir ciudad si todavía falta seleccionar presentación/cantidad.
  if (state.awaiting === "city" && !state.cityVerified &&
      (state.optionId || state.cartLines?.length || (state.quantity ?? 0) > 0)) {
    return {
      stage: "city",
      question: "📍 Para continuar con tu pedido, ¿en qué ciudad querés recibirlo?",
    };
  }
  // El nombre es obligatorio tanto en contraentrega como en encomienda.
  // Para encomienda el extractor deja awaiting='receipt' hasta que el
  // comprobante documentalmente compatible esté disponible.
  if ((state.awaiting === "name" || state.awaiting === "address" || state.awaiting === null) &&
      state.cityVerified && state.city && state.department && (state.quantity ?? 0) > 0 &&
      !customerNameValid) {
    return {
      stage: "name",
      question: "😊 Para preparar tu pedido, ¿me pasás tu nombre y apellido?",
    };
  }
  if (state.awaiting === "address" && state.cityVerified && customerNameValid &&
      state.paymentMethod === "contraentrega" && !isValidDeliveryAddress(state.street) && !isValidDeliveryAddress(state.locationUrl)) {
    return {
      stage: "address",
      question: "📍 Para completar la entrega, ¿me pasás tu dirección con una referencia o tu ubicación de Google Maps?",
    };
  }
  return null;
}

function ensureCheckoutProgressReply(args: {
  reply: string;
  state: SaleState | null | undefined;
  customerNameValid: boolean;
  checkoutActive: boolean;
}): string {
  const reply = args.reply.trim();
  if (!args.checkoutActive || !reply) return reply;
  const pending = requiredCheckoutPrompt(args.state, args.customerNameValid);
  if (!pending || looksLikeCheckoutQuestion(reply, pending.stage)) return reply;

  // Una pregunta vaga después de un resumen («¿Seguimos?», «¿Así está bien?»)
  // hace que el cliente crea que la compra terminó. Reemplazar únicamente esa
  // pregunta final por la solicitud del dato faltante, sin borrar el resumen.
  const withoutGenericEnding = reply.replace(
    /\s*¿\s*(?:seguimos|te\s+parece|as[ií]\s+est[aá]\s+bien|est[aá]\s+(?:todo\s+)?bien|est[aá]\s+correcto|quer[eé]s\s+(?:confirmar|que\s+lo\s+prepare)|confirm[aá]s\s+(?:el|tu)\s+pedido)\s*\?[\s😊🙂👍]*$/iu,
    "",
  ).trim();

  return `${withoutGenericEnding}\n\n${pending.question}`;
}

/**
 * Un comprobante puede mostrar un monto mayor al de la compra aunque la
 * validación documental de destinatario todavía esté pendiente. La IA jamás
 * puede describir esa diferencia como dinero faltante.
 * Esta función NO valida ni acredita la transferencia.
 */
export function correctReceiptAmountReply(args: {
  reply: string;
  expectedTotal: number | null;
  parsedAmount: number | null;
  documentAccepted: boolean;
  customerNameValid: boolean;
}): string {
  const {reply,expectedTotal,parsedAmount,documentAccepted,customerNameValid}=args;
  if (expectedTotal===null || !Number.isSafeInteger(expectedTotal) || expectedTotal<=0 ||
      parsedAmount===null || !Number.isSafeInteger(parsedAmount) || parsedAmount<expectedTotal) return reply;
  // Solo intervenir cuando la IA comete un error aritmético o exige un pago adicional.
  if (!/(?:\b(?:te\s+)?falt(?:a|an|aria|arian)\b|\b(?:complemento|diferencia\s+por\s+transferir|pago\s+adicional|otro\s+comprobante|comprobante\s+del\s+complemento)\b)/i.test(
    reply.normalize("NFD").replace(/[\u0300-\u036f]/g,""))) return reply;
  const gs=(value:number)=>`Gs. ${value.toLocaleString("es-PY")}`;
  const intro = parsedAmount === expectedTotal
    ? `El importe leído en tu comprobante es ${gs(parsedAmount)}, igual al total de ${gs(expectedTotal)}.`
    : `El importe leído en tu comprobante es ${gs(parsedAmount)}, ${gs(parsedAmount-expectedTotal)} más que el total de ${gs(expectedTotal)}.`;
  const status = documentAccepted
    ? "El comprobante coincide documentalmente con los datos configurados, pendiente de acreditación bancaria."
    : "El importe alcanza, pero todavía debemos comprobar que el comprobante corresponda a la cuenta destinataria correcta.";
  return `😊 ${intro} No te falta dinero. ${status}` +
    (!customerNameValid ? "\n\n¿Me pasás el nombre y apellido de quien recibirá el pedido?" : "");
}

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
        const result = await transcribeAudio(base64, mime, args.workspaceId);
        transcript = result?.trim() || null;

        if (!transcript) {
          console.warn("[WhatsApp media] Audio sin transcripción", {
            mediaId: args.mediaId,
            mime,
          });
        }
      } else if (base64 && args.type === "image") {
        const result = await describeImage(base64, mime, args.workspaceId);
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
        // No escribir order.total como monto transferido: son conceptos distintos.
        // La lectura del importe exige extracción estructurada y comprobación
        // documental. Hasta entonces el monto recibido permanece sin verificar.
        amount: null,
        note: [...noteParts, "MONTO NO EXTRAÍDO: no confundir total de orden con monto del comprobante"].join(" | "),
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
 * Adjunta el comprobante documentalmente compatible del ciclo ACTUAL al pedido
 * recién insertado. No depende de una ventana de 3 horas, no busca imágenes
 * arbitrarias y jamás usa un archivo vinculado a otro pedido.
 * El estado `anticipado` indica comprobante recibido, NO pago acreditado.
 */
async function linkVerifiedReceiptToOrder(args: {
  workspaceId: string;
  ownerId: string;
  conversationId: string;
  orderId: string;
  verifiedReceiptPath: string;
}): Promise<boolean> {
  const {data: inbound, error: inboundError} = await supabaseAdmin.from("messages")
    .select("id,media_url")
    .eq("workspace_id", args.workspaceId)
    .eq("conversation_id", args.conversationId)
    .eq("direction", "inbound")
    .eq("media_url", args.verifiedReceiptPath)
    .limit(1).maybeSingle();
  if (inboundError || !inbound) return false;
  const {data: alreadyUsed, error: usedError} = await supabaseAdmin.from("orders")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("receipt_url", args.verifiedReceiptPath)
    .neq("id", args.orderId)
    .limit(1).maybeSingle();
  if (usedError || alreadyUsed) return false;
  const {data: order, error: orderError} = await supabaseAdmin.from("orders")
    .select("id,payment_method,payment_status,receipt_url")
    .eq("workspace_id", args.workspaceId)
    .eq("conversation_id", args.conversationId)
    .eq("id", args.orderId)
    .maybeSingle();
  if (orderError || !order || !/anticip|transfer|deposit|giro/i.test(order.payment_method ?? "") ||
      (order.receipt_url && order.receipt_url !== args.verifiedReceiptPath)) return false;
  if (!order.receipt_url) {
    const {error: updateError} = await supabaseAdmin.from("orders").update({
      receipt_url: args.verifiedReceiptPath,
      payment_status: order.payment_status === "pagado" ? "pagado" : "anticipado",
    }).eq("workspace_id",args.workspaceId).eq("id",args.orderId);
    if (updateError) return false;
  }
  const {data: existing, error: receiptLookupError} = await supabaseAdmin.from("payment_receipts")
    .select("id")
    .eq("workspace_id",args.workspaceId).eq("order_id",args.orderId)
    .eq("url",args.verifiedReceiptPath).limit(1).maybeSingle();
  if (receiptLookupError) {
    console.error("[BOT_SKY_RECEIPT_HISTORY_LOOKUP_ERROR]", receiptLookupError.message);
  } else if (!existing) {
    const {error: historyError} = await supabaseAdmin.from("payment_receipts").insert({
      workspace_id: args.workspaceId, user_id: args.ownerId,
      order_id: args.orderId, url: args.verifiedReceiptPath, amount: null,
      note: "Comprobante compatible documentado en el checkout; pendiente de acreditación bancaria",
    });
    if (historyError) console.error("[BOT_SKY_RECEIPT_HISTORY_INSERT_ERROR]", historyError.message);
  }
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

      const { data: conn, error: connectionError } = await supabaseAdmin
        .from("whatsapp_connections")
        .select("workspace_id, user_id, phone_number_id, access_token")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (connectionError) {
        console.error("[BOT_SKY_WEBHOOK_CONNECTION_QUERY_FAILED]", {
          phoneNumberId, error: connectionError.message,
        });
        throw connectionError; // 503: Meta podrá reintentar, en vez de perder el evento.
      }
      if (!conn) {
        console.error("[BOT_SKY_WEBHOOK_CONNECTION_MISSING] WhatsApp sin conexión activa", {
          phoneNumberId, messages: messages.length,
        });
        continue;
      }

      // Aislar cada mensaje: un error de un contacto no debe impedir el
      // procesamiento de otros mensajes del mismo evento de Meta.
      for (const message of messages) {
        try {
          await processMessage(conn, value?.contacts?.[0]?.profile?.name ?? null, message);
        } catch (error) {
          // Algunos fallos (contacto, conversación, permisos y deduplicación)
          // ocurren ANTES del try/catch de processMessage. Antes se perdían:
          // la ruta HTTP devolvía 200 y no quedaba respuesta al cliente.
          console.error("[BOT_SKY_WEBHOOK_EARLY_FAILURE]", {
            workspaceId: conn.workspace_id,
            wamid: message.id,
            error: error instanceof Error ? error.message : String(error),
          });
          await recoverFailedInboundMessage(conn, message, error);
        }
      }
    }
  }
}

/**
 * Rescate de errores que suceden antes de la lógica de IA. No inventa precios,
 * pagos, cobertura ni confirma pedidos; informa y deja trazabilidad al vendedor.
 * La comprobación de salida reciente evita enviar otra respuesta si el envío
 * llegó a WhatsApp pero falló el guardado posterior.
 */
async function recoverFailedInboundMessage(
  conn: Conn,
  message: IncomingMessage,
  originalError: unknown,
): Promise<void> {
  const phone = String(message.from ?? "").replace(/\D/g, "");
  if (!phone) return;
  try {
    const { data: inbound } = await supabaseAdmin.from("messages")
      .select("conversation_id,created_at")
      .eq("workspace_id", conn.workspace_id)
      .eq("wamid", message.id)
      .maybeSingle();
    let conversationId: string | null = inbound?.conversation_id ?? null;
    if (!conversationId) {
      const { data: contact } = await supabaseAdmin.from("contacts")
        .select("id").eq("workspace_id", conn.workspace_id)
        .eq("phone", phone).maybeSingle();
      if (contact) {
        const { data: conversation } = await supabaseAdmin.from("conversations")
          .select("id").eq("workspace_id", conn.workspace_id)
          .eq("contact_id", contact.id).order("created_at", { ascending: true })
          .limit(1).maybeSingle();
        conversationId = conversation?.id ?? null;
      }
    }
    if (conversationId) {
      const { error: queueError } = await supabaseAdmin.from("ai_failed_messages").upsert({
        workspace_id: conn.workspace_id,
        user_id: conn.user_id,
        conversation_id: conversationId,
        wamid: message.id,
        error_message: `Webhook antes de IA: ${String(originalError instanceof Error ? originalError.message : originalError).slice(0,1300)}`,
        status: "pending",
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,wamid" });
      if (queueError) console.error("[BOT_SKY_EARLY_FAILURE_QUEUE_ERROR]", queueError.message);
      await sendSilenceFallback({
        conn, workspaceId: conn.workspace_id, ownerId: conn.user_id,
        conversationId, adId: null, phone, wamid: message.id,
        reason: "No se pudo completar el procesamiento del mensaje; revisar los logs del webhook.",
        reply: "Hubo un inconveniente técnico al procesar el último mensaje. Respondé el último mensaje del cliente con el entrenamiento; si no podés, decí que un asesor lo revisa.",
        queue: false,
      });
    } else {
      // Sin conversación no hay contexto para que la IA responda: no enviar
      // texto fijo; queda registrado en los logs para revisión del vendedor.
      console.error("[BOT_SKY_EARLY_FAILURE_NO_CONVERSATION]", { workspaceId: conn.workspace_id, wamid: message.id });
    }
  } catch (recoveryError) {
    console.error("[BOT_SKY_WEBHOOK_RECOVERY_FAILED]", {
      workspaceId: conn.workspace_id,
      wamid: message.id,
      error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
    });
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
      // El audio se debe transcribir siempre: la configuración del modo de
      // conversación no puede impedir que la IA escuche al comprador.
      const ingested = await ingestMedia({
        workspaceId,
        accessToken: conn.access_token,
        mediaId: media.part.id!,
        type: media.type,
        allowAiInterpretation: true,
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
      console.warn("[BOT_SKY_REPLY_SKIPPED_BALANCE]", {
        workspaceId, conversationId: conversation.id,
        hasBalance: Boolean(balance), available: balance?.available ?? null,
      });
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
    console.warn("[BOT_SKY_REPLY_SKIPPED_BALANCE]", {
      workspaceId, conversationId: conversation.id,
      hasBalance: Boolean(balance), available: balance?.available ?? null,
    });
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentSaldo } = await supabaseAdmin.from("notifications").select("id")
      .eq("workspace_id", workspaceId).eq("type", "saldo").gte("created_at", since).limit(1);
    if (!recentSaldo?.length) {
      await supabaseAdmin.from("notifications").insert({
        workspace_id: workspaceId, user_id: ownerId, type: "saldo",
        title: "Sin conversaciones disponibles",
        body: `Tu bot no respondió a ${phone} porque se agotaron las conversaciones de tu plan BOT SKY (no es el saldo de la API de IA). Recarga un plan para continuar.`,
        link: "/planes", audience: "user",
      });
    }
    return;
  }

  const { data: aiSettings } = await supabaseAdmin
    .from("ai_settings")
    .select("ai_enabled, reply_delay_seconds, hybrid_mode, hybrid_fallback_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!aiSettings?.ai_enabled || conversation.ai_paused || conversation.is_closed) {
    console.warn("[BOT_SKY_REPLY_SKIPPED_SETTINGS]", {
      workspaceId, conversationId: conversation.id,
      missingAiSettings: !aiSettings,
      aiEnabled: aiSettings?.ai_enabled ?? null,
      aiPaused: Boolean(conversation.ai_paused),
      isClosed: Boolean(conversation.is_closed),
    });
    return;
  }

  if (conversation.sale_closed) {
    let ciResult: Awaited<ReturnType<typeof handlePostSaleRecipientCi>> = null;
    try {
      ciResult = await handlePostSaleRecipientCi({client:supabaseAdmin,workspaceId,
        conversationId:conversation.id,training:(await buildWorkspaceAiContext(supabaseAdmin,workspaceId,[],conversation.product_id,phone)).training,
        customerText:message.type === "text" ? body : ""});
    } catch (error) {
      console.error("[Postventa] No se pudo actualizar la cédula",error);
      ciResult = {reply:"El pedido sigue confirmado, pero no se pudo guardar la cédula todavía; un asesor la revisará.",orderId:null};
    }
    if (ciResult) {
      // El resultado técnico de la cédula lo comunica la IA con el estilo del vendedor.
      const ciCtx = await buildWorkspaceAiContext(supabaseAdmin,workspaceId,[{role:"user",content:body}],conversation.product_id,phone);
      const ciText = await aiCompose(ciCtx, ciResult.reply);
      if (!ciText) {
        await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
          reason:"La IA no pudo responder sobre la cédula", reply:ciResult.reply, queue:false});
        return;
      }
      ciResult = {...ciResult, reply: ciText};
      const wamid=await sendWhatsAppText(conn,phone,ciResult.reply);
      await supabaseAdmin.from("messages").insert({workspace_id:workspaceId,user_id:ownerId,
        conversation_id:conversation.id,ad_id:attributedAdId,direction:"outbound",sender:"ai",
        body:ciResult.reply,response_origin:"code",wamid,status:"sent"});
      await supabaseAdmin.from("conversations").update({last_message:ciResult.reply,
        last_message_at:new Date().toISOString(),unread_count:0}).eq("workspace_id",workspaceId).eq("id",conversation.id);
      return;
    }
  }

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
      // GPS guardado: la IA contesta usando el resultado real, sin respuesta fija por código.
      const {data:gpsHistory}=await supabaseAdmin.from("messages")
        .select("sender,body").eq("workspace_id",workspaceId)
        .eq("conversation_id",conversation.id)
        .order("created_at",{ascending:false}).limit(24);
      const gpsChatHistory=(gpsHistory??[]).reverse().filter(m=>Boolean(m.body))
        .map(m=>({role:m.sender==="customer"?("user" as const):("assistant" as const),content:String(m.body)}));
      const gpsCtx=await buildWorkspaceAiContext(supabaseAdmin,workspaceId,gpsChatHistory,conversation.product_id,phone);
      const gpsVerified=await addVerifiedOrderContext(supabaseAdmin,gpsCtx,workspaceId,phone);
      try {
        const gpsReply=(await generateAiReply({...gpsVerified,systemInstruction:gpsVerified.systemInstruction+
          `\nHECHO VERIFICADO DEL ÚLTIMO MENSAJE: ubicación GPS ${attached?"ASOCIADA AL PEDIDO EN SUPABASE":"RECIBIDA, PERO NO SE PUDO ASOCIAR AL PEDIDO"}. Respondé natural y brevemente; no afirmes haber guardado la ubicación si no se pudo.`})).reply;
        const gpsWamid=await sendWhatsAppText(conn,phone,gpsReply);
        await supabaseAdmin.from("messages").insert({workspace_id:workspaceId,user_id:ownerId,
          conversation_id:conversation.id,ad_id:attributedAdId,direction:"outbound",sender:"ai",
          response_origin:"ai",body:gpsReply,wamid:gpsWamid,status:"sent"} as any);
        await supabaseAdmin.from("conversations").update({last_message:gpsReply,
          last_message_at:new Date().toISOString(),unread_count:0})
          .eq("workspace_id",workspaceId).eq("id",conversation.id);
      } catch(error){console.error("[BOT SKY postventa] Respuesta IA pendiente",error);}
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
    try { reply=(await generateAiReplyWithRetry(safeCtx)).reply?.trim() || ""; }
    catch (error) {
      console.error("[BOT SKY postventa] IA no disponible; pendiente",error);
      await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
        reason:`IA sin respuesta en postventa: ${error instanceof Error ? error.message : String(error)}`});
      return;
    }
    if(!reply) {
      await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
        reason:"La IA devolvió una respuesta vacía en postventa", reply:"El cliente ya compró. Respondé su último mensaje sobre el pedido sin inventar estados de entrega."});
      return;
    }
    const wamid=await sendWhatsAppText(conn,phone,reply);
    await supabaseAdmin.from("messages").insert({workspace_id:workspaceId,user_id:ownerId,conversation_id:conversation.id,ad_id:attributedAdId,direction:"outbound",sender:"ai",body:reply,wamid,status:"sent"});
    await supabaseAdmin.from("conversations").update({last_message:reply,last_message_at:new Date().toISOString(),unread_count:0}).eq("workspace_id",workspaceId).eq("id",conversation.id);
    return;
  }

  // Primera consulta de un producto identificado: enviar UNA VEZ el copy y las
  // imágenes que el VENDEDOR guardó en su catálogo. No redactar guiones aquí.
  // Después de la presentación, todas las respuestas conversacionales usan IA.
  const catalogResult = await sendCatalogByKeyword({
    workspaceId, ownerId, conversationId: conversation.id,
    adId: attributedAdId, conn, phone, text: body,
  });
  if (catalogResult?.productId && catalogResult.productId !== conversation.product_id) {
    conversation.product_id = catalogResult.productId;
    const { error: productUpdateError } = await supabaseAdmin.from("conversations")
      .update({ product_id: catalogResult.productId })
      .eq("workspace_id", workspaceId).eq("id", conversation.id);
    if (productUpdateError) throw productUpdateError;
  }
  // El copy y la foto ya constituyen la presentación del producto en este turno.
  // No enviar además una respuesta IA duplicada; IA asume los turnos siguientes.
  if (catalogResult?.sent) return;

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
      conversation.id,
    );
    // IA + entrenamiento redactan siempre; el backend solo verifica y persiste.
    // Persistencia por conversación. El estado no depende de la memoria de Vercel.
    const { data: saleRow, error: saleReadError } = await supabaseAdmin
      .from("bot_sale_states").select("state")
      .eq("workspace_id", workspaceId).eq("conversation_id", conversation.id).maybeSingle();
    if (saleReadError) throw saleReadError;
    const previousSale = recoverSaleStateFromHistory(ctx, (saleRow?.state ?? {}) as SaleState, chatHistory);
    // Reintento persistente con límite y espera: un error de Gemini no inutiliza
    // el archivo permanentemente. Los reintentos pertenecen al workspace/chat.
    if (!previousSale.receiptDocuments?.length && !previousSale.receiptPath &&
        previousSale.productId) {
      // Se lee cualquier imagen reciente aunque el método de pago todavía no
      // esté guardado: en encomienda el "anticipado" se fija recién al validar.
      const {data: recentUnparsed, error: pendingReadError} = await supabaseAdmin.from("messages")
        .select("id,media_url,media_type,transcript,created_at")
        .eq("workspace_id",workspaceId).eq("conversation_id",conversation.id)
        .eq("direction","inbound").eq("media_type","image")
        .order("created_at",{ascending:false}).limit(8);
      if (pendingReadError) console.warn("[RECEIPT_MEDIA_READ]", pendingReadError.message);
      const retryState = previousSale as SaleState & {receiptRetry?: Record<string,{count:number;lastAt:number}>};
      const ledger = retryState.receiptRetry ?? {};
      const pending = (recentUnparsed ?? []).find(row => {
        if (!row.media_url || row.transcript) return false;
        const age = Date.now() - new Date(row.created_at).getTime();
        const retry = ledger[row.media_url];
        return age >= 0 && age < 3*60*60*1000 && (!retry ||
          (retry.count < 3 && Date.now()-retry.lastAt > (retry.count === 1 ? 4_000 : 30_000)));
      });
      if (pending?.media_url) {
        const path = pending.media_url;
        try {
          const {data: blob, error: downloadError} = await supabaseAdmin.storage
            .from("chat-media").download(path);
          if (downloadError || !blob) throw downloadError ?? new Error("Archivo no accesible");
          const {describeImage,toBase64} = await import("@/lib/media-ai.server");
          const base64 = toBase64(await blob.arrayBuffer());
          // Reintento inmediato: el cliente suele mandar solo la foto y no
          // escribe más, así que no se puede esperar a su próximo mensaje.
          let description = "";
          let fields: ReturnType<typeof parseReceiptFields> = null;
          for (let attempt = 0; attempt < 3 && !fields; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2500));
            try {
              description = await describeImage(base64,blob.type || "image/jpeg",workspaceId);
              fields = parseReceiptFields(description);
            } catch (readError) {
              if (attempt === 2) throw readError;
            }
          }
          if (!fields) throw new Error("Gemini respondió, pero no identificó un comprobante estructurado: " + description.slice(0, 180));
          console.info("[BOT_SKY_RECEIPT_PARSED]", JSON.stringify({conversationId:conversation.id,
            path,hasAmount:fields.amountGs!==null,hasDestination:Boolean(fields.destinationAccount),
            hasBeneficiary:Boolean(fields.beneficiary)}));
          const {error: transcriptError} = await supabaseAdmin.from("messages")
            .update({transcript:description}).eq("id",pending.id)
            .eq("conversation_id",conversation.id).eq("workspace_id",workspaceId);
          if (transcriptError) throw transcriptError;
          // Se utiliza el transcript persistido en el paso de conciliación siguiente.
          delete ledger[path];
        } catch (error) {
          const last = ledger[path]?.count ?? 0;
          ledger[path] = {count:last+1,lastAt:Date.now()};
          console.warn("[BOT_SKY_RECEIPT_RETRY]",JSON.stringify({
            workspaceId,conversationId:conversation.id,path,attempts:ledger[path].count,
            error:error instanceof Error?error.message:String(error)}));
        }
        retryState.receiptRetry = ledger;
      }
    }
    // La imagen puede estar almacenada sin transcript (Gemini falló). No se transforma
    // en pago válido por el simple hecho de existir, ni se reutiliza el precio del carrito.
    if (!previousSale.receiptPath && !previousSale.receiptDocuments?.length) {
      const {data: recentMedia, error: mediaReadError} = await supabaseAdmin.from("messages")
        .select("media_url,media_type,transcript,created_at")
        .eq("workspace_id",workspaceId).eq("conversation_id",conversation.id)
        .eq("direction","inbound").in("media_type",["image","document"])
        .order("created_at",{ascending:false}).limit(8);
      if (mediaReadError) console.warn("[BOT_SKY_RECEIPT_RECOVERY]",mediaReadError.message);
      // Conservar solamente la referencia si se reconoce un documento, nunca
      // asignarle monto sin comprobar cuenta/importe en la lectura estructurada.
      if ((recentMedia??[]).some(row=>Boolean(row.media_url) && parseReceiptFields(row.transcript))) {
        console.info("[BOT_SKY_RECEIPT_RECOVERY] Comprobante histórico disponible para revisión",conversation.id);
      }
    }
    // Evaluar tanto el adjunto del mensaje actual como un comprobante anterior
    // que quedó en messages mientras el comprador facilitaba otros datos.
    const {data: receiptHistory} = await supabaseAdmin.from("messages")
      .select("media_url,transcript,created_at")
      .eq("workspace_id",workspaceId).eq("conversation_id",conversation.id)
      .eq("direction","inbound").in("media_type",["image","document"])
      .order("created_at",{ascending:false}).limit(10);
    const receiptSources = [
      ...(mediaPath && media && (media.type === "image" || media.type === "document")
        ? [{media_url:mediaPath,transcript,created_at:new Date().toISOString()}] : []),
      ...(receiptHistory ?? []),
    ];
    // Un comprobante pertenece a una operación concreta. No reutilizar imágenes
    // ya asociadas a otra orden, incluso cuando sigan visibles en el historial.
    const candidatePaths = [...new Set(receiptSources.map(r => r.media_url).filter((x):x is string => Boolean(x)))];
    const usedReceiptPaths = new Set<string>();
    if (candidatePaths.length) {
      const [ordersUsing, receiptsUsing] = await Promise.all([
        supabaseAdmin.from("orders").select("receipt_url")
          .eq("workspace_id",workspaceId).in("receipt_url",candidatePaths),
        supabaseAdmin.from("payment_receipts").select("url")
          .eq("workspace_id",workspaceId).in("url",candidatePaths),
      ]);
      if (ordersUsing.error || receiptsUsing.error) {
        // Si no podemos verificar reutilización, no sumar el comprobante.
        console.warn("[BOT_SKY_RECEIPT_REUSE_CHECK] No se pudo consultar duplicados",{
          workspaceId,conversationId:conversation.id,
          ordersError:ordersUsing.error?.message,receiptsError:receiptsUsing.error?.message});
        receiptSources.length = 0;
        previousSale.receiptReview = "datos_no_legibles";
      } else {
        for (const row of ordersUsing.data ?? []) if (row.receipt_url) usedReceiptPaths.add(row.receipt_url);
        for (const row of receiptsUsing.data ?? []) if (row.url) usedReceiptPaths.add(row.url);
      }
    }
    if (previousSale.productId && !conversation.sale_closed) {
      const digits = (value: string) => value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      // Solo datos del vendedor actual: localizar el bloque bancario AUTORIZADO,
      // nunca el de ejemplos, textos históricos o entidades de otros workspaces.
      // Cada vendedor redacta distinto: sellerBankText tolera otros títulos.
      const authorizedBankBlock = sellerBankText(ctx.training);
      // Acepta: "Número de cuenta:", "N.º de cuenta:",
      // "N° de cuenta para transferencias desde otros bancos:", etc.
      // Las cuentas bancarias y los ALIAS explícitamente autorizados son
      // identificadores distintos del mismo destinatario. Nunca se debe usar
      // una cédula suelta, teléfono ni dato de otra tienda como alias válido.
      // Limpia emojis, viñetas y negritas (**Titular:**) para que las líneas
      // del entrenamiento se reconozcan aunque tengan formato de WhatsApp.
      const bankLines = authorizedBankBlock.split(/\r?\n/).map(line => line
        .replace(/[*_~`]/g, "")
        .replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+/u, "")
        .trim());
      const authorizedAccounts = [...new Set(bankLines.flatMap(line => {
        const match = line.trim().replace(/^[-*]\s*/, "").match(
          /(?:^|\b)(?:(?:n[úu]mero|n[.º°o\s]*|nro\.?)\s*(?:de\s+)?)?(?:cuenta|cta\.?)(?:\s|\b)[^:\d]{0,60}[:\s#]\s*([\d\s.-]{6,30})\s*$/i
        );
        const account = match?.[1]?.replace(/\D/g, "") ?? "";
        return account.length >= 6 ? [account] : [];
      }))];
      // Solo aceptar alias mencionados explícitamente en el bloque de datos
      // bancarios AUTORIZADOS del workspace. "CI del titular" por sí sola NO
      // habilita la cédula como identificador de transferencia.
      const normalizeDestination = (value: string) => {
        const result = value.toUpperCase().normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "").replace(/[\s._-]/g, "");
        if (!/^[A-Z0-9]{4,80}$/.test(result)) return "";
        // "CI 4804126", "C.I. 4804126" o "Alias ci 4804126" = mismo alias numérico.
        const ciDigits = result.match(/^(?:ALIAS)?(?:CI|CEDULA|RUC)(\d{5,12})$/)?.[1];
        if (ciDigits) return ciDigits.replace(/^0+(?=\d)/, "");
        return /^\d+$/.test(result) ? result.replace(/^0+(?=\d)/, "") : result;
      };
      const authorizedAliases = [...new Set(bankLines.flatMap(line => {
        const match = line.trim().replace(/^[-*]\s*/, "").match(
          /^(?:alias\b|clave\s+(?:de\s+)?transferencia\b)[^:]*:\s*(.+)$/i
        );
        const alias = (match?.[1]?.trim() ?? "").replace(/\s+/g, "");
        // Para evitar tomar explicaciones por alias, requerir un identificador
        // único y concreto, no una frase descriptiva.
        const normalized = /^[A-Z0-9._-]{4,80}$/i.test(alias)
          ? normalizeDestination(alias) : "";
        return normalized ? [normalized] : [];
      }))];
      const authorizedHolder = bankLines.map(line =>
        line.trim().replace(/^[-*]\s*/, "").match(/^Titular\s*:\s*(.+)$/i)?.[1]?.trim() ?? ""
      ).find(Boolean) ?? null;
      if (!authorizedAccounts.length && !authorizedAliases.length)
        console.warn("[BOT_SKY_RECEIPT_CONFIGURATION] No se encontró cuenta ni alias bancario autorizado en este vendedor",{workspaceId,conversationId:conversation.id});
      const normalizeHolder = (value: string) => value.toUpperCase().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
      const compatibleHolder = (received: string | null) => {
        // La abreviación de un titular (p.ej., nombre + apellido) es habitual
        // en recibos; si es ambigua debe revisarse, no afirmarse acreditación.
        if (!authorizedHolder || !received) return true;
        const expected = normalizeHolder(authorizedHolder);
        const actual = normalizeHolder(received);
        if (actual.length < 2) return false;
        return actual.every(token => expected.includes(token)) &&
          actual.some(token => token === expected[0]) && actual.some(token => token === expected[expected.length - 1] || token === expected[expected.length - 2]);
      };
      for (const source of receiptSources) {
        const candidate = parseReceiptFields(source.transcript);
        if (!source.media_url || !candidate) continue;
        // Nunca usar un recibo ya consumido ni documentos antiguos de otro ciclo.
        if (usedReceiptPaths.has(source.media_url)) continue;
        const ageMs = Date.now() - new Date(source.created_at).getTime();
        if (!Number.isFinite(ageMs) || ageMs < -60000 || ageMs > 3*60*60*1000) continue;
        if (previousSale.receiptDocuments?.some(r => r.path === source.media_url)) continue;
        const receivedDestinations = [candidate.destinationAccount, candidate.destinationAlias]
          .filter((value): value is string => Boolean(value && value.trim()));
        // Hay bancos que muestran el ALIAS donde otros muestran la cuenta.
        // Admitir ambos campos y sus formatos, siempre cotejándolos con los
        // identificadores autorizados de ESTE vendedor únicamente.
        const destinationChecks = receivedDestinations.map(value => {
          const normalized = normalizeDestination(value);
          const accountMatch = authorizedAccounts.some(account =>
            normalizeDestination(String(account)) === normalized && normalized !== "");
          const aliasMatch = authorizedAliases.includes(normalized) && normalized !== "";
          return { accountMatch, aliasMatch };
        });
        // No ignorar un identificador explícito que contradiga a otro visible.
        const accountOk = destinationChecks.length > 0 && destinationChecks.every(
          check => check.accountMatch || check.aliasMatch);
        const wrongAccount = destinationChecks.length > 0 && !accountOk;
        const holderOk = compatibleHolder(candidate.beneficiary);
        const wrongHolder = Boolean(authorizedHolder && candidate.beneficiary && !holderOk);
        // Si la coincidencia depende de alias, el nombre del beneficiario debe
        // aparecer y coincidir: de otro modo, enviar a revisión documental.
        const needsHolderForAlias = destinationChecks.some(c => c.aliasMatch && !c.accountMatch);
        const missingAliasHolder = Boolean(needsHolderForAlias && authorizedHolder &&
          (!candidate.beneficiary || !holderOk));
        const amountOk = candidate.amountGs !== null && Number.isSafeInteger(candidate.amountGs);
        if (!accountOk || !amountOk || wrongHolder || missingAliasHolder) {
          console.warn("[BOT_SKY_RECEIPT_REJECTED]",JSON.stringify({conversationId:conversation.id,
            path:source.media_url,hasConfiguredAccount:authorizedAccounts.length > 0,
            hasConfiguredAlias:authorizedAliases.length > 0,
            hasDestination:Boolean(receivedDestinations.length),amountOk,wrongAccount,wrongHolder,missingAliasHolder}));
          // El último comprobante incompleto bloquea el registro; jamás se inventa monto.
          // No se debe sobreescribir un comprobante válido anterior con otro ilegible.
          if (!previousSale.receiptDocuments?.length)
            previousSale.receiptReview = wrongAccount || wrongHolder ? "cuenta_destino_distinta" : "datos_no_legibles";
          continue;
        }
        previousSale.receiptDocuments = previousSale.receiptDocuments ?? [];
        const op = candidate.operation?.trim() ?? null;
        const duplicate = previousSale.receiptDocuments.some(r =>
          r.path === source.media_url || (op && r.operation === op));
        if (!duplicate) previousSale.receiptDocuments.push({
          path:source.media_url,amountGs:candidate.amountGs!,operation:op});
        previousSale.receiptPath = previousSale.receiptDocuments[0]?.path ?? source.media_url;
        previousSale.receiptReview = null;
        // El comprobante no acredita dinero. Para un destino fuera de
        // contraentrega y con política nacional, el método sí es anticipado.
        if (previousSale.cityVerified && previousSale.city && previousSale.department &&
            sellerAllowsNationwideAdvance(ctx.training) &&
            !verifiedCoverage(previousSale.city,previousSale.department,parseCoverage(ctx.training))?.active) {
          previousSale.paymentMethod = "anticipado";
        }
      }
    }

    // Persistir recuperación antes de que la IA vuelva a intervenir.
    if (!conversation.sale_closed) {
      const { error: recoveryError } = await supabaseAdmin.from("bot_sale_states").upsert({
        workspace_id: workspaceId, conversation_id: conversation.id,
        state: previousSale, updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,conversation_id" });
      if (recoveryError) throw recoveryError;
    }
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
    // Una compra pendiente con comprobante debe seguir en el flujo de checkout
    // incluso si el comprador escribe «y de paso» o pregunta por la demora.
    // Nunca confundirla con una compra ya cerrada ni confirmar sin INSERT.
    const hasPendingDocumentedCheckout = Boolean(!conversation.sale_closed &&
      previousSale.productId && previousSale.cityVerified &&
      ((previousSale.receiptDocuments?.length ?? 0) > 0 || previousSale.receiptPath));
    const awaitingCheckoutDetail = Boolean(previousSale.productId &&
      (["name", "details", "address", "quantity", "variant", "city"].includes(String(previousSale.awaiting ?? "")) ||
        hasPendingDocumentedCheckout) &&
      !/\b(?:gracias|chau|adios|no quiero|cancelar|reclamo|mi pedido|donde esta)\b/i.test(normalizeIntentText(body)));
    // Los archivos de pago forman parte del checkout activo aunque el clasificador
    // de intención no reconozca texto de una imagen. No tratar imágenes aisladas
    // como comprobantes cuando no hay una compra anticipada en curso.
    const pendingAdvanceReceipt = Boolean(previousSale.productId &&
      /anticip|transfer|deposit|giro/i.test(String(previousSale.paymentMethod ?? "")) &&
      mediaPath && media && (media.type === "image" || media.type === "document"));
    // Preguntar por la tienda no es proporcionar ciudad ni continuar checkout.
    // Solo se clasifica la intención: el contenido de la respuesta lo crea la IA
    // desde el entrenamiento de este workspace.
    const asksAboutSeller = /\b(?:de\s+d[oó]nde\s+(?:son|son\s+ustedes|es\s+(?:la\s+)?tienda|est[aá]n|queda)|d[oó]nde\s+(?:queda|est[aá])\s+(?:la\s+)?(?:tienda|local|negocio)|tienen\s+(?:local|sucursal|direcci[oó]n)|cu[aá]l\s+es\s+(?:su|la)\s+direcci[oó]n)\b/i.test(body);
    const bypassSale = asksAboutSeller || (!pendingAdvanceReceipt && intent !== "checkout" && !savedSaleReadyForFinalization && !awaitingCheckoutDetail &&
      !(previousSale.productId && !conversation.sale_closed && /(?:calle|barrio|casi|esquina|avenida|ruta|direccion|ubicacion|^[\p{L}]+(?:\s+[\p{L}]+){1,3}$)/iu.test(body)));
    const answerContextBase = intent === "order_status"
      ? await addVerifiedOrderContext(supabaseAdmin, ctx, workspaceId, phone)
      : ctx;
    const answerContext = isGpsMessage ? {...answerContextBase, systemInstruction:answerContextBase.systemInstruction +
          `\nUBICACIÓN RECIBIDA: GPS guardado: ${Boolean(previousSale.locationUrl)}. `+
          `Ciudad verificada: ${previousSale.cityVerified ? previousSale.city : "NO VERIFICADA"}. `+
          `Estado de cobertura: ${previousSale.coverageStatus??"unknown"}. `+
          `No inventes ciudad, departamento ni cobertura. Si está NO VERIFICADA, pedí ciudad. `+
          `Nunca pidas pago anticipado por una ubicación desconocida. `+
          `La IA no puede registrar un pedido ni modificar precios a partir de la ubicación.`}
      : bypassSale ? addPendingSaleContext(answerContextBase, previousSale) : answerContextBase;
    if (asksAboutSeller) {
      answerContext.systemInstruction += "\nPRIORIDAD PARA ESTE MENSAJE: el cliente pregunta por la ubicación u origen de LA TIENDA, NO informa su ciudad de entrega. Respondé la consulta concreta basándote exclusivamente en el entrenamiento de este vendedor. Si la dirección de la tienda no está documentada, indicá que no tenés ese dato confirmado. No repitas la pregunta anterior de ciudad en esta respuesta ni cambies los datos guardados del pedido. Conservá el progreso para el siguiente turno.";
    }
    const ruleStep = !bypassSale
      ? advanceRuleSale(ctx, saleInput, previousSale, media && (media.type === "image" || media.type === "document") ? mediaPath : null, gpsUrl)
      : null;
    // Inyectar a la IA solo datos de venta efectivamente reconocidos por código.
    const verifiedSaleState = ruleStep?.state ?? previousSale;
    // Fuente autoritativa: cobertura del vendedor, nunca una inferencia de IA.
    const officialDelivery = verifiedSaleState.cityVerified
      ? deliveryPolicyForCity(verifiedSaleState.city,verifiedSaleState.department,ctx.training) : null;
    if (officialDelivery?.paymentMethod) verifiedSaleState.paymentMethod = officialDelivery.paymentMethod;
    answerContext.saleState = verifiedSaleState;
    console.info("[BOT_SKY_CHECKOUT_STATE]", JSON.stringify({conversationId:conversation.id,
      coverageRows:parseCoverage(ctx.training).length,productId:verifiedSaleState.productId,
      city:verifiedSaleState.city,department:verifiedSaleState.department,
      cityVerified:verifiedSaleState.cityVerified,hasName:Boolean(verifiedSaleState.customerName),
      hasAddress:Boolean(verifiedSaleState.street||verifiedSaleState.locationUrl),
      optionId:verifiedSaleState.optionId,awaiting:verifiedSaleState.awaiting,
      paymentMethod:verifiedSaleState.paymentMethod,receiptCount:verifiedSaleState.receiptDocuments?.length??0,
      receiptReview:verifiedSaleState.receiptReview??null}));
    const officialPolicyInstruction = officialDelivery?.paymentMethod
      ? `\nCOBERTURA DEL VENDEDOR COMPROBADA: ciudad ${officialDelivery.city}, departamento ${officialDelivery.department}; modalidad EXACTA ${officialDelivery.method}; pago permitido ${officialDelivery.paymentMethod}. Esta información es obligatoria, no la reemplaces con pago anticipado ni preguntes cómo quiere pagar cuando el vendedor exige una modalidad. No confundas envío con modalidad de pago.`
      : `\n${sellerAllowsNationwideAdvance(ctx.training) ? "ENCOMIENDA NACIONAL AUTORIZADA: fuera de contraentrega se puede ofrecer pago anticipado sujeto a verificar logística; NO negar todo envío por ausencia en la lista. " : ""}COBERTURA PENDIENTE: la CIUDAD DE ENTREGA es el primer dato logístico obligatorio; NO solicites nombre, dirección, GPS, método de pago ni transferencia antes de verificarla. La ciudad debe estar en la cobertura activa de este vendedor o resolverse según su política de encomienda. No deduzcas municipio desde GPS ni barrio. Si el cliente hace otra consulta, respondela primero sin repetir automáticamente la pregunta de ciudad y conservá la venta.`;
    const aiAnswerContext = {
      ...answerContext,
      systemInstruction: answerContext.systemInstruction + officialPolicyInstruction + `\nMODO IA + ENTRENAMIENTO BOT SKY, PRIORIDAD ALTA: Las respuestas comerciales las generás vos usando únicamente catálogo y entrenamiento de esta tienda. CONVERSÁ VOS con el comprador de forma natural: resolvé una sola pregunta por vez y no repitas catálogo/precios completos ni datos ya recibidos. Cantidad y variante se capturan mediante código y deben respetarse. No confirmes pedidos sin número real generado por Supabase. El cliente puede comprar varias veces. DATOS VERIFICADOS DEL CICLO ACTUAL (no mezclar con pedidos previos): ${JSON.stringify({productId:verifiedSaleState.productId,optionId:verifiedSaleState.optionId,quantity:verifiedSaleState.quantity,city:verifiedSaleState.city,department:verifiedSaleState.department,cityVerified:verifiedSaleState.cityVerified===true,coverageStatus:verifiedSaleState.coverageStatus,customerName:verifiedSaleState.customerName,hasAddress:Boolean(verifiedSaleState.street),gpsReceived:Boolean(verifiedSaleState.locationUrl),paymentMethod:verifiedSaleState.paymentMethod,awaiting:verifiedSaleState.awaiting})}. COBERTURA: si cityVerified no es true, NUNCA digas que tenemos cobertura; cuando nombres la ciudad escribila SIEMPRE exactamente como figura en el campo city de los datos verificados (bien escrita, con tildes y ñ), nunca copies cómo la escribió el cliente; consultá la ciudad si falta. GPS no prueba por sí mismo ninguna ciudad. Si recibiste GPS no vuelvas a solicitarlo. El GPS es dirección suficiente si la configuración de la ciudad admite dirección por ubicación. Respetá el orden de preguntas definido en el entrenamiento del vendedor; nunca repitas hechos conocidos. Si no tenés precio/variante sin ambigüedad pedí aclaración. Si está completo, el código registrará el pedido; no inventes un número de orden ni digas que está confirmado.
AVANCE DEL CIERRE, OBLIGATORIO EN EL MISMO TURNO: si ya identificaste producto, variante, cantidad y ciudad, NO termines una respuesta mostrando solo el detalle o preguntando «¿seguimos?», «¿está bien?» o «¿confirmás?»; pedí inmediatamente el SIGUIENTE dato faltante del estado técnico. Si awaiting="name", solicitá nombre Y apellido en ese mismo mensaje, aun cuando acabes de explicar el pago al recibir y el total. Cuando te respondan el nombre, si awaiting="address", pedí dirección o ubicación. Si awaiting="receipt" para encomienda, explicá las instrucciones de pago SOLO desde los datos bancarios reales de este vendedor y decí que envíe el comprobante; no pidas dirección ni GPS. Si el cliente hace una consulta concreta, respondela y retomá el dato pendiente sin repetición. Nunca digas «pedido confirmado» antes de que el servidor lo registre.
Respetá el estilo, productos y condiciones del entrenamiento particular del vendedor; el backend solamente asegura que la venta NO se estanque sin pedir el siguiente dato obligatorio.`
    };
    // Comprobantes: pasar a la IA el RESULTADO DOCUMENTAL del backend, no
    // solamente la transcripción visual. El backend valida, la IA conversa.
    // Este contexto nunca implica acreditación del dinero por el banco.
    const currentReceipt = mediaPath && media &&
      (media.type === "image" || media.type === "document")
      ? parseReceiptFields(transcript) : null;
    const receiptInCurrentOrder = Boolean(currentReceipt && mediaPath &&
      verifiedSaleState.receiptDocuments?.some(document => document.path === mediaPath) &&
      !verifiedSaleState.receiptReview);
    if (currentReceipt && !conversation.sale_closed) {
      const productForReceipt = ctx.products.find(p => p.id === verifiedSaleState.productId);
      const chosenOption = productForReceipt?.product_prices?.find(
        o => o.id === verifiedSaleState.optionId);
      const expectedReceiptTotal = chosenOption ? Number(chosenOption.price) : null;
      const documentedReceiptTotal = (verifiedSaleState.receiptDocuments ?? [])
        .reduce((sum, document) => sum + document.amountGs, 0);
      const isEncomiendaReceipt = isEncomiendaAdvanceOrder(ctx.training,
        verifiedSaleState.city, verifiedSaleState.department, verifiedSaleState.paymentMethod);
      const requiresCiAfterReceipt = isEncomiendaReceipt && sellerRequiresEncomiendaCi(ctx.training);
      aiAnswerContext.systemInstruction += `
RESULTADO TÉCNICO DE LA IMAGEN DE COMPROBANTE RECIBIDA AHORA (NO EQUIVALE A ACREDITACIÓN BANCARIA):
- Archivo almacenado: ${Boolean(mediaPath)}.
- Comprobante de ESTE turno compatible y guardado para este pedido: ${receiptInCurrentOrder}.
- Revisión documental: ${verifiedSaleState.receiptReview ?? (receiptInCurrentOrder ? "sin discrepancias detectadas" : "no validada")}.
- Cantidad de comprobantes de esta compra: ${verifiedSaleState.receiptDocuments?.length ?? 0}.
- Importe total documentado compatible: ${documentedReceiptTotal} Gs.
- Total de la variante seleccionada según catálogo: ${expectedReceiptTotal ?? "pendiente de identificación inequívoca"} Gs.
- Ciudad de destino conservada: ${verifiedSaleState.cityVerified ? verifiedSaleState.city : "aún no verificada"}.
- Nombre y apellido del destinatario: ${verifiedSaleState.customerName ? "recibidos" : "faltantes"}.
- Cédula de destinatario: ${requiresCiAfterReceipt ? "se pide SOLO DESPUÉS de que el backend confirme el pedido; NO la pidas ahora" : "no requerida"}.
${expectedReceiptTotal !== null && documentedReceiptTotal > expectedReceiptTotal ? `- PAGO MAYOR AL TOTAL: el cliente transfirió ${documentedReceiptTotal} Gs y el total es ${expectedReceiptTotal} Gs. El comprobante SE ACEPTA. NO pidas otro comprobante ni que lo reenvíe. Decí solamente que el comprobante quedó recibido, que tiene un SALDO A FAVOR de ${documentedReceiptTotal - expectedReceiptTotal} Gs, y pedí el siguiente dato faltante (nombre y apellido del destinatario).
` : ""}INSTRUCCIÓN PARA ESTA ÚNICA RESPUESTA: la verificación DOCUMENTAL que puede hacer el backend YA SE EJECUTÓ; NO digas 'ahora voy a verificar', 'un momento', 'te aviso después' ni prometas que se ejecutará otra tarea. Respondé ahora al cliente con la IA y el entrenamiento ACTIVO del vendedor, según los hechos anteriores. Si el comprobante quedó en revisión o es ilegible, explicá que requiere revisión y NO pidas otra transferencia. Si quedó documentado como compatible y el monto es insuficiente frente al total OFICIAL, informá la diferencia exacta; si el total oficial aún no es comprobable, pedí únicamente el dato de producto/variante que falta. Si es suficiente y es encomienda, pedí solo nombre y apellido si faltan (la cédula NO se pide ahora: el backend la pide después de confirmar), sin dirección, barrio, GPS ni calle. Si ya está todo, no inventes número de pedido: el backend hace el INSERT y envía la confirmación. No confundas la cédula del beneficiario bancario con la del destinatario ni creas que una imagen acredita el dinero.`;
      console.info("[BOT_SKY_RECEIPT_TURN_STATUS]", JSON.stringify({
        conversationId: conversation.id, receiptInCurrentOrder,
        receiptReview: verifiedSaleState.receiptReview ?? null,
        documentedReceiptTotal, expectedReceiptTotal,
        hasRecipientName: Boolean(verifiedSaleState.customerName),
        hasRecipientCi: isValidRecipientCi(verifiedSaleState.recipientCi),
      }));
    }
    // Comprobante anterior con monto INSUFICIENTE: el extractor sigue esperando
    // el pago; la IA debe informar la diferencia exacta, no pedir nombre ni cerrar.
    if (!currentReceipt && !conversation.sale_closed && verifiedSaleState.awaiting === "receipt" &&
        verifiedSaleState.receiptDocuments?.length && !verifiedSaleState.receiptReview) {
      const shortfallProduct = ctx.products.find(p => p.id === verifiedSaleState.productId);
      const shortfallOptions = shortfallProduct?.product_prices ?? [];
      const officialTotal = verifiedSaleState.cartLines?.length
        ? verifiedSaleState.cartLines.reduce((sum, line) =>
            sum + Number(shortfallOptions.find(o => o.id === line.optionId)?.price ?? 0) * line.quantity, 0)
        : Number(shortfallOptions.find(o => o.id === verifiedSaleState.optionId)?.price ?? 0);
      const documented = verifiedSaleState.receiptDocuments.reduce((sum, r) => sum + r.amountGs, 0);
      if (officialTotal > 0 && documented < officialTotal) {
        aiAnswerContext.systemInstruction += `\nPAGO ANTICIPADO INCOMPLETO (dato del backend): comprobantes documentados ${formatGs(documented)}; total oficial ${formatGs(officialTotal)}; falta ${formatGs(officialTotal - documented)}. Informá amablemente la diferencia exacta y pedí el comprobante del complemento. No confirmes el pedido ni pidas otros datos todavía.`;
      }
    }
    // El motor nunca puede borrar hechos ya verificados al procesar una dirección.
    if (ruleStep && previousSale.cityVerified && previousSale.city && previousSale.department &&
        !ruleStep.state.cityVerified && !/\b(?:soy de|vivo en|para)\b/i.test(body)) {
      ruleStep.state.city = previousSale.city;
      ruleStep.state.department = previousSale.department;
      ruleStep.state.cityVerified = true;
      ruleStep.state.coverageStatus = previousSale.coverageStatus;
    }
    if (ruleStep) {
      ruleStep.state.receiptDocuments = previousSale.receiptDocuments;
      ruleStep.state.receiptReview = previousSale.receiptReview;
      if (previousSale.receiptPath && !ruleStep.state.receiptPath) ruleStep.state.receiptPath = previousSale.receiptPath;
    }
    const saveStep=ruleStep;
    // Persistir ANTES de pedir una respuesta al proveedor. Si Gemini/OpenAI
    // falla, no perdemos ciudad ni presentación («2 para Capiatá»).
    if (saveStep && !conversation.sale_closed && !bypassSale) {
      const {error: pendingStateError}=await supabaseAdmin.from("bot_sale_states")
        .upsert({workspace_id:workspaceId,conversation_id:conversation.id,
          state:saveStep.state,updated_at:new Date().toISOString()},
          {onConflict:"workspace_id,conversation_id"});
      if (pendingStateError) throw pendingStateError;
    }
    let result: Awaited<ReturnType<typeof generateAiReply>>;
    // Si el motor ya verificó que el checkout está COMPLETO, no depender de
    // una nueva respuesta de Gemini para ejecutar el INSERT. El mensaje de
    // confirmación se construye únicamente tras registrar la orden real.
    const checkoutCompleteByRules = Boolean(saveStep?.complete && !bypassSale && !conversation.sale_closed);
    const responseOrigin = checkoutCompleteByRules ? "code" : "ai";
    try {
      result = checkoutCompleteByRules
        ? { reply:"", sale_closed:false, order:null, product_id:saveStep?.productId ?? null } as Awaited<ReturnType<typeof generateAiReply>>
        : await generateAiReplyWithRetry(aiAnswerContext);
      if (checkoutCompleteByRules) console.info("[BOT_SKY_CHECKOUT_READY_WITHOUT_AI]", JSON.stringify({
        conversationId:conversation.id,hasName:isValidCustomerName(saveStep?.state.customerName),
        hasDocument:Boolean(saveStep?.state.receiptDocuments?.length),paymentMethod:saveStep?.state.paymentMethod,
      }));
    } catch (aiError) {
      console.error("[BOT SKY IA] Mensaje pendiente, proveedor sin respuesta",{
        workspaceId,conversationId:conversation.id,error:aiError instanceof Error?aiError.message:String(aiError)});
      await supabaseAdmin.from("integration_logs").insert({workspace_id:workspaceId,user_id:ownerId,
        integration:"ai",level:"error",message:`IA sin respuesta en conversación ${conversation.id}; mensaje ${message.id}`});
      await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,
        phone,wamid:message.id,reason:`IA sin respuesta: ${aiError instanceof Error?aiError.message:String(aiError)}`});
      return;
    }
    // Una respuesta de espera no realiza trabajo futuro en Vercel. Si llegó un
    // comprobante legible, pedir a la IA una respuesta de acción en ESTE turno.
    // NO se construyen preguntas comerciales desde el código.
    if (currentReceipt && !conversation.sale_closed &&
        /\b(?:un momento|aguard[aá]|esper[aá] (?:un|unos)|proceder[eé]? a verificar|voy a verificar|verificaremos (?:los|tus|el)|te aviso|le avisaremos|cuando termine de revisar|ahora (?:revisar[eé]|revisaremos))\b/i.test(result.reply) &&
        !/[?¿]/.test(result.reply)) {
      const revised = await generateAiReplyWithRetry({
        ...aiAnswerContext,
        systemInstruction: aiAnswerContext.systemInstruction +
          "\nTU BORRADOR ES INCORRECTO: promete verificar después y deja al cliente esperando. " +
          "En esta solicitud YA tenés el estado documental arriba. Contestá en presente, " +
          "con la acción o el siguiente dato permitido por el entrenamiento. " +
          "No afirmes acreditación bancaria ni pedido confirmado sin registro real."
      });
      if (/\b(?:un momento|aguard[aá]|proceder[eé]? a verificar|voy a verificar|te aviso|le avisaremos)\b/i.test(revised.reply) &&
          !/[?¿]/.test(revised.reply)) {
        console.error("[BOT_SKY_RECEIPT_NO_PROGRESS] La IA insistió en una respuesta de espera", conversation.id);
        await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,
          adId:attributedAdId,phone,wamid:message.id,
          reason:"La IA reiteró una espera sin avanzar el comprobante", reply:"El comprobante ya fue recibido y revisado por el sistema. Agradecé y pedí el siguiente dato faltante del pedido (nombre y apellido de quien recibe, si falta)."});
        return;
      }
      result = {...result, reply: revised.reply};
    }
    // GARANTÍA DE ORDEN COMERCIAL: la IA redacta, pero no puede saltarse ciudad.
    // Si propone pedir datos personales o una dirección sin ciudad verificada,
    // volver a consultar a LA MISMA IA con el entrenamiento del workspace.
    const cityMissingForCheckout = Boolean(
      !bypassSale && verifiedSaleState.productId && !verifiedSaleState.cityVerified
    );
    if (cityMissingForCheckout && /(?:\b(?:nombre|apellido|direcci[oó]n|domicilio|ubicaci[oó]n|google maps|transferencia|pago anticipado|m[eé]todo de pago)\b)/i.test(result.reply) &&
        /[¿?]|(?:pas[aá]me|indic[aá]me|confirm[aá]me|envi[aá]me|compart[ií]me|necesito|falta)/i.test(result.reply)) {
      try {
        const retried = await generateAiReply({
          ...aiAnswerContext,
          systemInstruction: aiAnswerContext.systemInstruction +
            "\nCONTROL DE SECUENCIA OBLIGATORIO: La ciudad de entrega NO está verificada. " +
            "Tu respuesta anterior intentó pedir nombre, apellido, dirección, GPS o método de pago antes de conocer la ciudad. " +
            "Eso contradice el entrenamiento del vendedor. Redactá de nuevo una respuesta natural, " +
            "sobre lo que acaba de decir el comprador y, cuando corresponda continuar el pedido, solicitá ÚNICAMENTE " +
            "la ciudad de entrega; no solicites datos posteriores. Nunca inventes cobertura ni modalidad."
        });
        if (/(?:\b(?:nombre|apellido|direcci[oó]n|domicilio|ubicaci[oó]n|google maps|transferencia|pago anticipado|m[eé]todo de pago)\b)/i.test(retried.reply) &&
            /[¿?]|(?:pas[aá]me|indic[aá]me|confirm[aá]me|envi[aá]me|compart[ií]me|necesito|falta)/i.test(retried.reply)) {
          console.error("[BOT SKY CITY GUARD] IA reiteró datos posteriores sin ciudad", conversation.id);
          // Nunca dejar al cliente sin respuesta: pedir solo la ciudad.
          result = {...result, reply:(await aiCompose(aiAnswerContext, "La ciudad de entrega todavía no está verificada: pedí ÚNICAMENTE la ciudad donde quiere recibir el pedido, sin pedir nombre, dirección ni pago.")) ?? ""};
        } else {
          result = {...result, reply: retried.reply};
        }
      } catch (error) {
        console.error("[BOT SKY CITY GUARD] No se pudo revalidar respuesta", error);
        result = {...result, reply:(await aiCompose(aiAnswerContext, "La ciudad de entrega todavía no está verificada: pedí ÚNICAMENTE la ciudad donde quiere recibir el pedido.")) ?? ""};
      }
    }
    // El cliente todavía NO indicó nombre completo: nunca saltar directo a GPS/dirección.
    // La IA redacta normalmente; esta barrera evita confirmar sin identidad verificable.
    if (!bypassSale && verifiedSaleState.productId && verifiedSaleState.cityVerified &&
        verifiedSaleState.quantity && !isValidCustomerName(verifiedSaleState.customerName) &&
        /(?:\b(?:direcci[oó]n|domicilio|ubicaci[oó]n|google maps|calle|referencia)\b)/i.test(result.reply) &&
        /[¿?]|(?:pas[aá]me|indic[aá]me|envi[aá]me|compart[ií]me)/i.test(result.reply)) {
      result = {...result, sale_closed:false, order:null,
        reply:(await aiCompose(aiAnswerContext, "Todavía falta el nombre y apellido de quien recibe: pedilo ahora, antes de pedir dirección o ubicación.")) ?? ""};
    }
    if (bypassSale && !result.order) result = {...result, sale_closed:false, order:null};
    if (saveStep) {
      const {error: saveStateError} = await supabaseAdmin.from("bot_sale_states")
        .upsert({workspace_id:workspaceId,conversation_id:conversation.id,
          state:saveStep.state,updated_at:new Date().toISOString()},
          {onConflict:"workspace_id,conversation_id"});
      if(saveStateError) throw saveStateError;
      if(saveStep.complete && !conversation.sale_closed && !bypassSale && !result.order) {
        const st=saveStep.state;
        result = {reply:result.reply,product_id:saveStep.productId,sale_closed:true,
          order:{customer_name:st.customerName!,city:st.city!,departamento:st.department!,
            street:isValidDeliveryAddress(st.street) ? st.street : (isValidDeliveryAddress(result.order?.street) ? result.order?.street : undefined),quantity:(result.order?.promo_quantity ?? 1) > 1 ? result.order?.quantity : st.quantity!,
            promo_quantity:result.order?.promo_quantity,
            product_price_id:(result.order?.promo_quantity ?? 1) > 1 ? result.order?.product_price_id : st.optionId??undefined,
            recipient_ci:isValidRecipientCi(st.recipientCi) ? st.recipientCi!.replace(/\D/g,"") : undefined,
            payment_method:st.paymentMethod!,phone}};
      }
    }
    console.info("[BOT SKY híbrido] respuesta", {workspaceId, conversationId:conversation.id, origin:responseOrigin});

    const detectedProduct =
      result.product_id && ctx.products.some((p) => p.id === result.product_id)
        ? result.product_id
        : (saveStep?.state.productId ?? previousSale.productId ?? conversation.product_id);

    // Segunda barrera anti-repetición:
    // si la IA intenta volver a mandar prácticamente el mismo copy largo del
    // catálogo, lo reemplazamos por una oferta breve con los precios reales.
    // Corregir una afirmación logística errónea con IA, no con un guion fijo.
    if (officialDelivery?.paymentMethod === "contraentrega" &&
        /(?:pago\s+anticipado|pag[oa]r?\s+por\s+transferencia|transferencia\s+obligatoria|solo\s+transferencia)/i.test(result.reply)) {
      try {
        const correction = await generateAiReply({...aiAnswerContext,
          systemInstruction:aiAnswerContext.systemInstruction +
            `\nCORRECCIÓN PRIORITARIA: la respuesta anterior contradecía el entrenamiento. El destino ${officialDelivery.city} admite ${officialDelivery.method} y método ${officialDelivery.paymentMethod}. Reformulá la respuesta al cliente respetando esa modalidad. No preguntes pago anticipado ni inventes condiciones.`});
        result = {...result, reply:correction.reply};
      } catch (error) {
        console.error("[BOT SKY cobertura] IA no pudo corregir respuesta",error);
        await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
          reason:"La IA no pudo corregir una respuesta de cobertura"});
        return;
      }
    }
    // Si el vendedor habilitó encomienda nacional, una ciudad fuera de
    // contraentrega NO justifica negar también la modalidad anticipada.
    // La IA redacta la corrección; jamás prometemos transportista ni tarifa.
    const nationalSellerPolicy = sellerAllowsNationwideAdvance(ctx.training);
    const explicitlyOffersAdvance = /(?:s[ií] (?:hacemos|enviamos|trabajamos|podemos|ofrecemos)|(?:trabajamos|ofrecemos|enviamos|podemos (?:enviar|gestionar))[^.!?]*encomienda|encomienda[^.!?]*pago anticipado)/i.test(result.reply);
    const falseNationalDenial = !explicitlyOffersAdvance &&
      /(?:no (?:hacemos|realizamos|podemos|tenemos|ofrecemos|enviamos|llegamos)|tampoco (?:hacemos|enviamos|tenemos|llegamos)|no es posible|no se puede|lamentablemente)/i.test(result.reply) &&
      /(?:env[ií]os?|entregas?|cobertura|encomienda|interior|anticipad[oa])/i.test(result.reply);
    const askingAboutNationalShipping = /(?:encomienda|env[ií]o|entrega|interior|capit[aá]n bado|pedro juan|pago|transferencia|cobertura)/i.test(body) ||
      verifiedSaleState.coverageStatus === "uncovered";
    if (nationalSellerPolicy && falseNationalDenial && askingAboutNationalShipping && !officialDelivery?.active) {
      try {
        const revised = await generateAiReply({...aiAnswerContext,
          systemInstruction:aiAnswerContext.systemInstruction +
            "\nCORRECCIÓN DE ENCOMIENDA AUTORIZADA: el vendedor ofrece encomienda nacional anticipada para ciudades sin CONTRAENTREGA. Tu respuesta anterior negó erróneamente TODO envío. Reformulá en español paraguayo la respuesta al último mensaje del cliente: sí se puede gestionar encomienda con pago anticipado, siempre sujeta a disponibilidad real de transporte y costo verificable. No afirmes fecha ni tarifa; si falta ciudad/departamento, pedí solamente ese dato. No prometas entrega asegurada, no inventes logística."});
        if (!/(?:no (?:hacemos|realizamos|podemos|tenemos|ofrecemos|enviamos|llegamos)|tampoco (?:hacemos|enviamos|llegamos))/i.test(revised.reply)) result={...result,reply:revised.reply};
        else {
          console.error("[BOT SKY encomienda] La IA reiteró rechazo contrario al entrenamiento");
          await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
            reason:"La IA negó la encomienda contra el entrenamiento", reply:"El vendedor SÍ hace envíos por encomienda a todo el país con pago anticipado. Confirmalo y pedí la ciudad donde quiere recibirlo."});
          return;
        }
      } catch(error) {
        console.error("[BOT SKY encomienda] No se pudo corregir rechazo",error);
        await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
          reason:"La IA no pudo corregir una respuesta de encomienda", reply:"El vendedor SÍ hace envíos por encomienda a todo el país con pago anticipado. Confirmalo y pedí la ciudad donde quiere recibirlo."});
        return;
      }
    }
    // Cierre completo por reglas: la respuesta queda vacía A PROPÓSITO porque el
    // mensaje al cliente se genera recién tras el INSERT. No tratarlo como fallo
    // de la IA (antes lanzaba error y el pedido nunca se registraba).
    const safeReply = bypassSale || (checkoutCompleteByRules && !result.reply.trim()) ? result.reply : buildSafeAiReply({
      reply: result.reply,
      history: chatHistory,
      products: ctx.products,
      productId: detectedProduct,
      lastCustomerMessage: body,
    });

    result.order=applySellerFirstOffer(result.order,detectedProduct,ctx.products,ctx.training,chatHistory);
    result.order = reconcileOrderWithSaleState(result.order, saveStep?.state ?? previousSale, ctx.training);
    // Garantía final para la persistencia: ninguna salida del modelo ni un estado
    // antiguo puede imponer transferencia en una ciudad con contraentrega.
    if (result.order && verifiedSaleState.cityVerified) {
      const verifiedPolicy = deliveryPolicyForCity(result.order.city,result.order.departamento,ctx.training);
      if (verifiedPolicy?.paymentMethod) result.order.payment_method = verifiedPolicy.paymentMethod;
    }
    // Pago al recibir solo en ciudad explícitamente autorizada por ESTA tienda.
    // Una localidad ajena a la lista puede ser encomienda únicamente cuando
    // existe autorización nacional y destino declarado en este ciclo.
    if (result.order) {
      const resolved = verifiedCoverage(String(result.order.city??""), String(result.order.departamento??""), parseCoverage(ctx.training));
      const outside = !resolved?.active;
      if (outside && sellerAllowsNationwideAdvance(ctx.training) &&
          verifiedSaleState.cityVerified && verifiedSaleState.city && verifiedSaleState.department &&
          normalizeIntentText(String(result.order.city??""))===normalizeIntentText(verifiedSaleState.city) &&
          normalizeIntentText(String(result.order.departamento??""))===normalizeIntentText(verifiedSaleState.department)) {
        result.order.payment_method="anticipado";
      }
    }
    // No depender del indicador sale_closed del modelo: cuando nombre, ciudad,
    // producto y cantidad estén completos, usar la información técnica recuperada.
    if (result.order && previousSale.paymentMethod === "anticipado" && !deliveryPolicyForCity(result.order.city,result.order.departamento,ctx.training)?.paymentMethod)
      result.order.payment_method = "anticipado";
    // Con estado reconocido, nunca depender de un JSON completo de Gemini.
    // El backend continuará validando variante, dirección y pago antes del INSERT.
    const optionConfirmed = Boolean(saveStep?.state.cartLines?.length) || isUnambiguousPriceSelection(result.order, detectedProduct, ctx.products, chatHistory);
    const deliveryCoverage = verifiedSaleState.city && verifiedSaleState.department
      ? verifiedCoverage(verifiedSaleState.city,verifiedSaleState.department,parseCoverage(ctx.training)) : null;
    const needsNationalAdvance = Boolean(verifiedSaleState.cityVerified && verifiedSaleState.city &&
      verifiedSaleState.department && !deliveryCoverage?.active && sellerAllowsNationwideAdvance(ctx.training));
    // Barrera de salida: impedir una promesa de contraentrega no autorizada.
    // No reemplazar todo el mensaje salvo que realmente prometa pago al recibir.
    let finalReply = safeReply;
    if (needsNationalAdvance && !isNonCityPhrase(verifiedSaleState.city ?? "") && /(?:pago\s+al\s+recibir|pag[aá]s?\s+al\s+recibir|contra\s*entrega|pag[aá]s?\s+cuando\s+recib)/i.test(safeReply)) {
      const revised = await generateAiReplyWithRetry({...aiAnswerContext,
        systemInstruction:aiAnswerContext.systemInstruction +
          `\nLa modalidad verificada para ${verifiedSaleState.city} es encomienda anticipada (sujeta a disponibilidad y costo). Tu borrador decía contraentrega. Reformulalo sin inventar modalidad, preguntas o precios.`});
      // Nunca quedar en silencio: si la IA insiste, usar un texto fijo correcto.
      finalReply = /(?:pago\s+al\s+recibir|contra\s*entrega)/i.test(revised.reply)
        ? ((await aiCompose(aiAnswerContext, `Para ${verifiedSaleState.city} el envío es por encomienda con pago anticipado (NO contraentrega); el costo del envío depende de la transportadora. Ofrecé seguir con el pedido.`)) ?? "")
        : revised.reply;
    }
    // Una ciudad declarada por el comprador nunca se sustituye por una ciudad
    // distinta tomada de respuestas anteriores o ejemplos del entrenamiento.
    const cityDeclared = verifiedSaleState.city;
    if (cityDeclared && /(?:\bpara\s+asunci[oó]n\b|\ben\s+asunci[oó]n\b|\ba\s+asunci[oó]n\b)/i.test(finalReply) &&
        !/asunci[oó]n/i.test(cityDeclared) &&
        /(?:env[ií]o|entrega|contra\s*entrega|pago\s+al\s+recibir)/i.test(finalReply)) {
      const rewritten=await generateAiReplyWithRetry({...aiAnswerContext,
        systemInstruction:aiAnswerContext.systemInstruction +
          `\nEl cliente indicó como destino ${cityDeclared}. Tu respuesta anterior sustituyó esa ciudad por Asunción sin autorización. Redactá de nuevo usando SOLO el destino realmente proporcionado. Si falta departamento o verificación logística, no los inventes.`});
      finalReply = /(?:\bpara\s+asunci[oó]n\b|\ben\s+asunci[oó]n\b)/i.test(rewritten.reply)
        ? ((await aiCompose(aiAnswerContext, `El destino del cliente es ${cityDeclared} (no Asunción). Confirmá ese destino y seguí con el siguiente dato del pedido.`)) ?? "")
        : rewritten.reply;
    }
    // Ciudad con pago al recibir: nunca enviar datos bancarios ni pedir comprobante.
    const codPolicy = verifiedSaleState.cityVerified
      ? deliveryPolicyForCity(verifiedSaleState.city, verifiedSaleState.department, ctx.training) : null;
    const BANK_RE = /(?:\bbanco\b|\btitular\b|cuenta desde|alias\s+eko|comprobante|realices el pago)/i;
    if (codPolicy?.paymentMethod === "contraentrega" && BANK_RE.test(finalReply)) {
      const rewritten = await generateAiReplyWithRetry({...aiAnswerContext,
        systemInstruction: aiAnswerContext.systemInstruction +
          `\nPara ${verifiedSaleState.city} el pago es AL RECIBIR (contraentrega). NO envíes datos bancarios, cuentas, alias ni pidas comprobante. Pedí solo el siguiente dato faltante (nombre y apellido, dirección).`});
      finalReply = BANK_RE.test(rewritten.reply) ? stripBankDetailsForCod(rewritten.reply) : rewritten.reply;
    }
    // Nunca enviar marcadores de plantilla como [PRECIO REAL] o URL_DE_LA_IMAGEN.
    if (hasTemplatePlaceholder(finalReply)) {
      const rewritten = await generateAiReplyWithRetry({...aiAnswerContext,
        systemInstruction: aiAnswerContext.systemInstruction +
          `\nTu borrador contenía marcadores como [PRECIO REAL] o URL_DE_LA_IMAGEN. Usá SOLO el precio real del catálogo; si no hay foto disponible, decí que se la envías enseguida. Jamás escribas corchetes ni marcadores.`});
      finalReply = rewritten.reply.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[[A-ZÁÉÍÓÚ _]+\]/g, "").trim();
    }
    // No prometer que el pedido quedó registrado ANTES del INSERT.
    // No permitir confirmaciones comerciales falsas, incluso si la IA no entrega
    // result.order o sale_closed. Sólo el bloque posterior al INSERT confirmado
    // puede anunciar "PEDIDO REGISTRADO" con número real.
    const safeBeforeInsert = finalReply
      .replace(/\bya\s+(?:tenemos|tengo)\s+tu\s+pedido\b/gi, "Estamos preparando los datos de tu pedido")
      .replace(/\b(?:pedido|compra)\s+(?:qued[oó]|est[aá])\s+(?:listo|confirmado|registrado)\b/gi, "pedido pendiente de registro")
      .replace(/(?:✅\s*)?PEDIDO\s+(?:CONFIRMADO|REGISTRADO)/gi, "Pedido pendiente de verificación")
      .replace(/\b(?:ya\s+)?(?:registre|registramos|tome|tomamos|agende|agendamos)\s+(?:tu|su|el)\s+pedido\b/gi,
        "Estoy verificando los datos de tu pedido")
      .replace(/\b(?:tu|su)\s+pedido\s+(?:ya\s+)?(?:quedo|esta)\s+(?:confirmado|registrado|agendado)\b/gi,
        "Tu pedido está pendiente de verificación");
    const deferGpsReply = Boolean(saveStep?.complete && result.order && !conversation.sale_closed);
    // Primero validar e insertar. Nunca enviar la respuesta libre del modelo antes del INSERT.
    // Pago anticipado: no registrar si todavía no hay archivo de comprobante.
    // La recepción del archivo NO equivale a dinero acreditado.
    const isAdvance = /anticip|transfer|deposit|giro/i.test(result.order?.payment_method ?? "");
    // El archivo debe pertenecer al pago pendiente del ciclo actual.
    // Nunca tomar una imagen antigua de producto como comprobante.
    const hasReceiptForOrder = Boolean((saveStep?.state.receiptDocuments?.length ?? 0)>0 || (previousSale.receiptDocuments?.length ?? 0)>0);
    if (result.order && isEncomiendaAdvanceOrder(ctx.training,result.order.city,result.order.departamento,result.order.payment_method)) {
      // El destino de encomienda es la ciudad; no heredar GPS o dirección de otros turnos.
      delete result.order.street;
    }
    if (result.order && !isEncomiendaAdvanceOrder(ctx.training,result.order.city,result.order.departamento,result.order.payment_method) &&
        !result.order.street?.trim() && (saveStep?.state.locationUrl || previousSale.locationUrl)) {
      result.order.street = saveStep?.state.locationUrl || previousSale.locationUrl || undefined;
    }
    // Barrera de monto: para anticipado no confirmar por un archivo cualquiera.
    // Se calcula con product_prices; si no existe selección inequívoca, no se infiere importe.
    const selectedCatalogProduct = ctx.products.find(p=>p.id===detectedProduct);
    const paymentSaleState = saveStep?.state ?? previousSale;
    const selectedCatalogOption = selectedCatalogProduct?.product_prices?.find(o=>o.id===result.order?.product_price_id);
    // Total OFICIAL calculado desde la selección guardada en el estado de venta
    // (opción + cantidad), no desde el JSON de la IA. La IA a veces devuelve
    // promo_quantity=4 para "1 caja (4 unidades)" y el total se multiplicaba x4,
    // por eso un pago correcto o de más nunca alcanzaba y el pedido no se registraba.
    const stateOptions = selectedCatalogProduct?.product_prices ?? [];
    let stateExpectedTotal: number | null = null;
    if (paymentSaleState.cartLines?.length) {
      let sum = 0; let ok = true;
      for (const line of paymentSaleState.cartLines) {
        const opt = stateOptions.find(o => o.id === line.optionId);
        if (!opt || !(Number(opt.price) > 0) || !(line.quantity > 0)) { ok = false; break; }
        sum += Number(opt.price) * line.quantity;
      }
      if (ok && sum > 0) stateExpectedTotal = sum;
    } else if (paymentSaleState.optionId) {
      const opt = stateOptions.find(o => o.id === paymentSaleState.optionId);
      const q = Number(paymentSaleState.quantity ?? opt?.quantity ?? 1);
      if (opt && Number(opt.price) > 0) {
        const optQty = Number(opt.quantity ?? 1);
        if (q === optQty || !q) stateExpectedTotal = Number(opt.price);
        else if (optQty === 1 && q > 0) stateExpectedTotal = Number(opt.price) * q;
        else if (optQty > 1 && q % optQty === 0) stateExpectedTotal = Number(opt.price) * (q / optQty);
      }
      // Alinear el pedido con la selección real para que el total guardado coincida.
      if (opt && result.order && stateExpectedTotal !== null) {
        const optQty = Number(opt.quantity ?? 1);
        result.order.product_price_id = opt.id;
        result.order.quantity = q || optQty;
        result.order.promo_quantity = optQty > 1 && q > optQty ? q / optQty : 1;
      }
    }
    const explicitPromos = Number(result.order?.promo_quantity ?? 1);
    const aiExpectedTotal = selectedCatalogOption && Number.isSafeInteger(explicitPromos) && explicitPromos>0
      ? Number(selectedCatalogOption.price)*explicitPromos : null;
    const expectedTotal = stateExpectedTotal ?? aiExpectedTotal;
    const receivedTotal = (paymentSaleState.receiptDocuments ?? []).reduce((n,r)=>n+r.amountGs,0);
    const financiallyReady = !isAdvance || Boolean(paymentSaleState.receiptPath &&
      !paymentSaleState.receiptReview && expectedTotal !== null && Number.isFinite(expectedTotal) &&
      receivedTotal >= expectedTotal);
    if (isAdvance && paymentSaleState.receiptDocuments?.length && expectedTotal !== null && receivedTotal < expectedTotal) {
      console.info("[BOT_SKY_RECEIPT_SHORTFALL]",JSON.stringify({conversationId:conversation.id,expectedTotal,receivedTotal,missing:expectedTotal-receivedTotal}));
    }
    const orderReady = financiallyReady && isOrderReady(result.order, detectedProduct) &&
      // Nombre verificado desde el mensaje del cliente, no solamente del JSON de IA.
      isValidCustomerName(verifiedSaleState.customerName) &&
      (Boolean(saveStep?.state.cartLines?.length) || stateExpectedTotal !== null || isUnambiguousPriceSelection(result.order, detectedProduct, ctx.products, chatHistory)) &&
      (!isAdvance || hasReceiptForOrder);
    // La cédula del destinatario de encomienda se pide DESPUÉS de confirmar
    // (shouldAskPostSaleCi). Nunca bloquea el registro del pedido.

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
    // La política nacional se obtiene del entrenamiento activo, NO de ciudades fijas.
    // Para pedidos fuera de la lista, exigir ciudad/departamento conservados en el
    // ciclo actual; no aceptar el destino inventado solo en el JSON de Gemini.
    const nationwideAdvanceApproved = isAdvance &&
      sellerAllowsNationwideAdvance(ctx.training) &&
      Boolean(verifiedSaleState.cityVerified && verifiedSaleState.city && verifiedSaleState.department &&
        verifiedSaleState.coverageStatus === "uncovered" &&
        result.order && normalizeIntentText(String(result.order.city??"")) === normalizeIntentText(verifiedSaleState.city) &&
        normalizeIntentText(String(result.order.departamento??"")) === normalizeIntentText(verifiedSaleState.department)) &&
      !verifiedOrderCoverage?.active;
    let orderWasCreated = false;
    if (saveStep?.complete && !conversation.sale_closed && !orderReady) {
      console.warn("[BOT_SKY_ORDER_NOT_READY]", JSON.stringify({
        conversationId: conversation.id,
        financiallyReady, isAdvance, hasReceiptForOrder,
        structurallyReady: isOrderReady(result.order, detectedProduct),
        expectedTotal, stateExpectedTotal, aiExpectedTotal, receivedTotal,
        receiptReview: paymentSaleState.receiptReview ?? null,
        hasName: Boolean(result.order?.customer_name),
        paymentMethod: result.order?.payment_method ?? null,
        city: result.order?.city ?? null,
      }));
    }
    if (!conversation.sale_closed && result.order && orderReady && (verifiedOrderCoverage?.active || (isAdvance && /ENCOMIENDA|ANTICIPADO|TRANSFERENCIA/i.test(verifiedOrderCoverage?.method ?? "")) || nationwideAdvanceApproved) &&
      // La dirección de domicilio se exige solo a entregas domiciliarias con esa obligación.
      // Encomienda anticipada nacional autorizada: ciudad y departamento bastan como destino.
      (isEncomiendaAdvanceOrder(ctx.training,result.order.city,result.order.departamento,result.order.payment_method) ||
       !verifiedOrderCoverage?.addressRequired ||
       Boolean(isValidDeliveryAddress(result.order.street) || isValidDeliveryAddress(saveStep?.state.locationUrl) || isValidDeliveryAddress(previousSale.locationUrl)))) {
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
        training: ctx.training,
        // Excedente del comprobante documentado; NO equivale a crédito acreditado.
        documentedReceiptTotal: isAdvance && financiallyReady ? receivedTotal : null,
      });
      orderWasCreated = true;

      /*
       * CASO 1:
       * Si el mismo mensaje que terminó de confirmar el pedido contenía el
       * comprobante, en el primer intento todavía no existía la orden.
       * Reintentamos ahora que createOrderFromAi() ya la creó.
       */
      // El INSERT ya tuvo éxito: fallos secundarios de vinculación del archivo
      // o limpieza del estado NO deben ocultar el pedido ni impedir la respuesta.
      // Cuando el comprador envió el comprobante antes del nombre, usamos el
      // PATH DOCUMENTAL VALIDADO del ciclo actual, incluso si pasaron horas.
      try {
        if (isAdvance && paymentSaleState.receiptPath && !paymentSaleState.receiptReview &&
            paymentSaleState.receiptDocuments?.some(r => r.path === paymentSaleState.receiptPath)) {
          const linked = await linkVerifiedReceiptToOrder({
            workspaceId, ownerId, conversationId: conversation.id,
            orderId: createdOrder.id, verifiedReceiptPath: paymentSaleState.receiptPath,
          });
          if (!linked) console.error("[BOT_SKY_ORDER_RECEIPT_LINK_PENDING]", JSON.stringify({
            workspaceId,conversationId:conversation.id,orderId:createdOrder.id,
          }));
        } else if (mediaPath && media) {
          await attachPaymentReceiptToLatestOrder({
            workspaceId, ownerId, conversationId: conversation.id,
            mediaPath, mediaType: media.type, transcript,
          });
        } else {
          await recoverRecentPaymentReceiptForOrder({
            workspaceId, ownerId, conversationId: conversation.id,
            orderId: createdOrder.id,
          });
        }
      } catch (receiptLinkError) {
        console.error("[BOT_SKY_ORDER_RECEIPT_LINK_ERROR]", {
          orderId: createdOrder.id,
          error: receiptLinkError instanceof Error ? receiptLinkError.message : String(receiptLinkError),
        });
      }
      try {
        const {error: clearStateError}=await supabaseAdmin.from("bot_sale_states").delete()
          .eq("workspace_id", workspaceId).eq("conversation_id", conversation.id);
        if (clearStateError) console.error("[BOT_SKY_CHECKOUT_STATE_CLEANUP_ERROR]",{
          orderId: createdOrder.id, error: clearStateError.message,
        });
      } catch (cleanupError) {
        console.error("[BOT_SKY_CHECKOUT_STATE_CLEANUP_ERROR]", {
          orderId: createdOrder.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
      // Confirmar SOLO después de que Supabase haya insertado el pedido.
      // No afirmar que una transferencia quedó acreditada sin validarla.
      const createdProduct = ctx.products.find(p => p.id === detectedProduct);
      const confirmedOption = createdProduct?.product_prices?.find(
        opt => opt.id === completedOrder.product_price_id,
      );
      // Leer el registro guardado: quantity/street/método no se infieren de la IA.
      const { data: savedConfirmationOrder, error: confirmationReadError } = await supabaseAdmin
        .from("orders")
        .select("id,order_number,customer_name,phone,total,quantity,street,payment_method,payment_status,observations")
        .eq("workspace_id", workspaceId).eq("id", createdOrder.id).single();
      if (confirmationReadError || !savedConfirmationOrder) throw confirmationReadError || new Error("Pedido no encontrado tras el INSERT");
      const confirmedMessage = buildRegisteredOrderConfirmation({
        created: savedConfirmationOrder,
        requestRecipientCi: shouldAskPostSaleCi(ctx.training,completedOrder,savedConfirmationOrder.observations),
        order: { ...completedOrder, payment_method: savedConfirmationOrder.payment_method },
        productName: createdProduct?.name ?? "Producto del pedido",
        productOption: confirmedOption?.label ?? completedOrder.price_option_label,
        savedQuantity: Number(savedConfirmationOrder.quantity),
        recipientCi: isValidRecipientCi(completedOrder.recipient_ci) ? completedOrder.recipient_ci : null,
        address: savedConfirmationOrder.street,
        paymentStatus: savedConfirmationOrder.payment_status,
        // Informar la diferencia positiva solo después del INSERT y con base
        // en el total REAL persistido de orders, no en el estimado por la IA.
        pendingCreditGs: isAdvance && financiallyReady && Number.isSafeInteger(receivedTotal)
          ? Math.max(0, receivedTotal - Number(savedConfirmationOrder.total)) : 0,
        deliveryMethod: isEncomiendaAdvanceOrder(ctx.training,completedOrder.city,completedOrder.departamento,completedOrder.payment_method)
          ? "Encomienda con pago anticipado" : verifiedOrderCoverage?.method,
      });
      // La IA redacta la confirmación con el estilo del vendedor, pero el número
      // de pedido y el total deben aparecer EXACTOS; si no, se usa el resumen del registro.
      const aiConfirmation = await aiCompose(aiAnswerContext,
        `El pedido QUEDÓ REGISTRADO en el sistema. Confirmalo al cliente con el formato de cierre del entrenamiento, ` +
        `usando EXACTAMENTE estos datos (no cambies número de pedido, total, cantidad ni modalidad):\n${confirmedMessage}`);
      const confirmationText = aiConfirmation &&
        aiConfirmation.includes(savedConfirmationOrder.order_number) &&
        aiConfirmation.replace(/\D/g, "").includes(String(Math.round(Number(savedConfirmationOrder.total))))
        ? aiConfirmation : confirmedMessage;
      try {
        const confirmationWamid = await sendWhatsAppText(conn, phone, confirmationText);
        await supabaseAdmin.from("messages").insert({
          workspace_id: workspaceId, user_id: ownerId,
          conversation_id: conversation.id, ad_id: attributedAdId,
          direction: "outbound", sender: "ai", body: confirmationText,
          wamid: confirmationWamid, status: "sent",
        });
        await supabaseAdmin.from("conversations").update({
          last_message: confirmationText,
          last_message_at: new Date().toISOString(),
        }).eq("id", conversation.id).eq("workspace_id", workspaceId);
      } catch (confirmationError) {
        console.error("[Pedidos] Pedido creado, pero falló el aviso de registro", {
          orderId: createdOrder.id,
          error: confirmationError instanceof Error ? confirmationError.message : String(confirmationError),
        });
      }
    } else if (deferGpsReply) {
      // Si la validación final impidió guardar, no dejar el GPS sin respuesta.
      // No formular preguntas fijas cuando el INSERT no procedió. La IA es la autora de la conversación.
      // No decir "estoy registrando tu pedido" si el registro NO se hizo.
      // Contra entrega sin calle válida: pedir la dirección en vez de "un asesor verifica".
      const pendingIsEncomienda = Boolean(result.order && isEncomiendaAdvanceOrder(ctx.training, result.order.city, result.order.departamento, result.order.payment_method));
      const pendingHasAddress = Boolean(isValidDeliveryAddress(result.order?.street) || isValidDeliveryAddress(verifiedSaleState.street) || saveStep?.state.locationUrl || previousSale.locationUrl || verifiedSaleState.locationUrl);
      const pendingFirstName = String(verifiedSaleState.customerName || result.order?.customer_name || "").trim().split(/\s+/)[0] || "";
      const pendingNeedsName = !isValidCustomerName(verifiedSaleState.customerName) &&
        !isValidCustomerName(result.order?.customer_name);
      const pendingProposal = pendingNeedsName
        ? ((await aiCompose(aiAnswerContext, "Para registrar el pedido falta el nombre y apellido de quien recibe: pedilo.")) ?? "")
        : (!pendingIsEncomienda && !pendingHasAddress)
        ? ((await aiCompose(aiAnswerContext, `Para registrar el pedido falta una dirección concreta (calle y referencia) o la ubicación de Google Maps${pendingFirstName ? `; el cliente se llama ${pendingFirstName}` : ""}: pedila.`)) ?? "")
        : (!safeBeforeInsert || /registrand|registrar[eé]?\s+tu\s+pedido|confirmand/i.test(safeBeforeInsert))
        ? await pendingCheckoutAiReply({
            ctx: aiAnswerContext,
            facts: {
              paymentMethod: result.order?.payment_method ?? null,
              isAdvance, hasReceiptForOrder, financiallyReady,
              expectedTotal, receivedTotal,
              receiptReview: paymentSaleState.receiptReview ?? null,
              priceSelected: Boolean(saveStep?.state.cartLines?.length) || stateExpectedTotal !== null,
              coverageMethod: verifiedOrderCoverage?.method ?? null,
            },
          })
        : safeBeforeInsert;
      const pendingChecked = enforceVerifiedPaymentReply({
        reply: pendingProposal, city:verifiedSaleState.city, department:verifiedSaleState.department,
        cityVerified:verifiedSaleState.cityVerified, training:ctx.training,
        saleState:verifiedSaleState, productId:detectedProduct, products:ctx.products,
      });
      if (pendingChecked.corrected) console.warn("[BOT_SKY_COVERAGE_OUTPUT_GUARD]", JSON.stringify({
        conversationId:conversation.id, paymentMethod:pendingChecked.paymentMethod, channel:"whatsapp_gps"
      }));
      const pendingText = pendingChecked.reply;
      if (!pendingText.trim()) {
        await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
          reason:"La IA no pudo redactar la respuesta del cierre pendiente", queue:false});
        return;
      }
      const pendingWamid = await sendWhatsAppText(conn, phone, pendingText);
      await supabaseAdmin.from("messages").insert({workspace_id:workspaceId,user_id:ownerId,
        conversation_id:conversation.id,ad_id:attributedAdId,direction:"outbound",sender:"ai",
        response_origin:"code",body:pendingText,wamid:pendingWamid,status:"sent"} as any);
      await supabaseAdmin.from("conversations").update({last_message:pendingText,
        last_message_at:new Date().toISOString(),unread_count:0}).eq("workspace_id",workspaceId).eq("id",conversation.id);
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
          `Causas: ${JSON.stringify({
            structurallyReady:isOrderReady(result.order,detectedProduct),
            financiallyReady,
            hasReceiptForOrder,
            receiptPaths:(paymentSaleState.receiptDocuments??[]).map(r=>r.path),
            receiptReview:paymentSaleState.receiptReview??null,
            expectedTotal,receivedTotal,
            priceSelected:isUnambiguousPriceSelection(result.order,detectedProduct,ctx.products,chatHistory),
            coverageApproved:Boolean(verifiedOrderCoverage?.active || (isAdvance && /ENCOMIENDA|ANTICIPADO|TRANSFERENCIA/i.test(verifiedOrderCoverage?.method??"")) || nationwideAdvanceApproved),
            nationwideAdvanceApproved,
          })}. Pedido recibido: ${JSON.stringify(result.order)}`,
      });
    }
    // Respuesta normal SOLO si no se registró pedido. Nunca anunciar un cierre ficticio.
    if (!orderWasCreated && !deferGpsReply) {
      const claimsClosed = /(?:ya\s+(?:qued[oó]|est[aá])\s+(?:registrad[oa]|confirmad[oa])|(?:pedido|compra)\s+(?:ya\s+)?(?:qued[oó]|est[aá])\s+(?:registrad[oa]|confirmad[oa])|gracias\s+por\s+tu\s+compra|(?:tu|su)\s+pedido[\s\S]{0,35}(?:registrad[oa]|confirmad[oa])|te\s+llegar[aá]\s+en\s+breve)/i.test(safeBeforeInsert);
      // La IA controla TODAS las preguntas; el servidor solo bloquea confirmaciones falsas.
      // Los estados documentales son técnicos; su explicación al cliente
      // pertenece a la IA con entrenamiento. Nunca imponer preguntas aquí.
      let outgoingProposal = safeBeforeInsert;
      const paidEnoughOrMore=isAdvance && expectedTotal!==null && receivedTotal>=expectedTotal && receivedTotal>0;
      const resendRe=/(complemento|comprobante\s+de\s+la\s+diferencia|faltan?\s+gs|nuevamente|reenvi|monto\s+sea\s+el\s+correcto|otro\s+comprobante)/i;
      // Dudas sobre un pago MAYOR al total ("¿realizaste un pago adicional o hay algún error?").
      const overpayDoubtRe=/(pago\s+adicional|alg[uú]n\s+error|hay\s+un\s+error|un\s+error|no\s+coincide|diferencia|monto\s+(?:distinto|diferente|mayor)|pero\s+el\s+comprobante\s+muestra|verificar\s+(?:los\s+datos\s+y\s+)?el\s+monto|confirm(?:ar|á|ame|arme|es)[\s\S]{0,60}(?:monto|pago|transferencia|error))/i;
      const overpaid=paidEnoughOrMore && expectedTotal!==null && receivedTotal>expectedTotal;
      const overpayWordsRe=/(excedente|sobrante|provisional|verificaci[oó]n\s+bancaria|pagaste\s+(?:de\s+)?m[aá]s|monto\s+transferido)/i;
      if (overpaid && (!paymentSaleState.customerName || resendRe.test(outgoingProposal) ||
          overpayDoubtRe.test(outgoingProposal) || overpayWordsRe.test(outgoingProposal))) {
        // Respuesta fija: comprobante aceptado + saldo a favor + pedir nombre y apellido.
        const fav=receivedTotal-(expectedTotal as number);
        outgoingProposal=(await aiCompose(aiAnswerContext, `El comprobante fue recibido y cubre el total; el cliente tiene un saldo a favor de Gs. ${fav.toLocaleString("es-PY")} (pendiente de acreditación). No pidas otro comprobante.`+
          (paymentSaleState.customerName?"":" Pedí el nombre y apellido de quien va a recibir el pedido."))) ?? "";
        console.warn("[BOT_SKY_OVERPAY_GUARD]",JSON.stringify({conversationId:conversation.id,expectedTotal,receivedTotal,fav}));
      }
      const asksForComplement=resendRe.test(outgoingProposal);
      const wrongReceiptMessage=Boolean(
        (paidEnoughOrMore && asksForComplement) ||
        (isAdvance && paymentSaleState.receiptReview &&
          /(?:pedido\s+confirmado|pago\s+acreditado|transferencia\s+verificada)/i.test(outgoingProposal)));
      if (wrongReceiptMessage) {
        const corrected=await generateAiReplyWithRetry({...aiAnswerContext,
          systemInstruction:aiAnswerContext.systemInstruction+`\nHECHOS DOCUMENTALES DEL SERVIDOR: revisión ${paymentSaleState.receiptReview??"ninguna"}; total oficial ${expectedTotal??"no verificado"}; montos documentados únicos ${receivedTotal}. Nunca pidas diferencia ni otro comprobante si alcanza o supera el total; si lo supera, informá el saldo a favor y pedí nombre y apellido. No afirmes acreditación. Contestá al comprador con el entrenamiento de la tienda, sin inventar una confirmación.`});
        outgoingProposal=corrected.reply;
        if (paidEnoughOrMore && expectedTotal!==null && resendRe.test(outgoingProposal)) {
          const fav=receivedTotal-expectedTotal;
          outgoingProposal=(await aiCompose(aiAnswerContext, `El comprobante fue recibido y cubre el total; NO pidas otro comprobante ni diferencia.`+
            (fav>0?` Saldo a favor: Gs. ${fav.toLocaleString("es-PY")}.`:"")+
            (paymentSaleState.customerName?"":" Pedí el nombre y apellido de quien va a recibir el pedido."))) ?? "";
        } else if ((paidEnoughOrMore && resendRe.test(outgoingProposal)) ||
            (paymentSaleState.receiptReview && /(?:pago\s+acreditado|transferencia\s+verificada)/i.test(outgoingProposal)))
          throw new Error("La IA repitió información documental no válida");
      }
      if (claimsClosed || result.sale_closed) {
        console.warn("[BOT_SKY_CLOSE_BLOCKED]",JSON.stringify({conversationId:conversation.id,
          financiallyReady,hasReceiptForOrder,cityVerified:verifiedSaleState.cityVerified,
          hasProduct:Boolean(detectedProduct)}));
        // Si la IA intentó cerrar ANTES de recoger datos obligatorios,
        // continuar el checkout (sin afirmar una venta registrada). La espera
        // de un asesor se reserva para bloqueos no recuperables por el cliente.
        if (!orderWasCreated) {
          const nextRequired = !bypassSale
            ? requiredCheckoutPrompt(verifiedSaleState, isValidCustomerName(verifiedSaleState.customerName))
            : null;
          // Cuando no falta una respuesta del comprador, no decir vagamente
          // «faltan datos» ni prometer que el pedido se registrará solo.
          const receiptNeedsReview = Boolean(paymentSaleState.receiptReview);
          const coverageReady = Boolean(verifiedSaleState.cityVerified &&
            (deliveryPolicyForCity(verifiedSaleState.city, verifiedSaleState.department, ctx.training)?.paymentMethod ||
             (sellerAllowsNationwideAdvance(ctx.training) && verifiedSaleState.coverageStatus === "uncovered")));
          const technicalReason = receiptNeedsReview
            ? "El comprobante necesita revisión de cuenta o titular destinatario; no hace falta transferir de nuevo por ahora."
            : isAdvance && !hasReceiptForOrder
              ? "Todavía no hay un comprobante compatible registrado para este pedido. Si ya lo enviaste, un asesor debe revisar el archivo."
              : isAdvance && expectedTotal === null
                ? "No pude verificar el importe oficial de la presentación seleccionada."
                : isAdvance && expectedTotal !== null && receivedTotal < expectedTotal
                  ? `El importe documentado es inferior al total oficial. Falta revisar la diferencia de Gs. ${(expectedTotal-receivedTotal).toLocaleString("es-PY")}.`
                  : !coverageReady
                    ? "La modalidad de entrega de esa ciudad necesita revisión en la cobertura de esta tienda."
                    : "Ya tengo los datos que compartiste, pero el pedido no aparece registrado. Necesitamos revisión del sistema antes de confirmarlo.";
          outgoingProposal = (await aiCompose(aiAnswerContext, nextRequired
            ? `El pedido todavía no está registrado porque falta un dato. Pedilo: ${nextRequired.question}`
            : `El pedido todavía no está confirmado. Motivo técnico: ${technicalReason}`)) ?? "";
        }
      }
      // Si pregunta «¿A la cuenta de quién transfiero?» en una zona verificada
      // como contraentrega, la respuesta debe despejar ESA duda, no repetir el total.
      // La modalidad proviene exclusivamente de la cobertura de este vendedor.
      const paymentQuestionPolicy = verifiedSaleState.cityVerified
        ? deliveryPolicyForCity(verifiedSaleState.city, verifiedSaleState.department, ctx.training) : null;
      if (!conversation.sale_closed && verifiedSaleState.productId && paymentQuestionPolicy?.paymentMethod === "contraentrega" &&
          /(?:\b(?:cuenta|cta|alias|titular|transferencia|transferir|depositar)\b)/i.test(body) &&
          /(?:\?|\b(?:quien|quién|donde|dónde|cual|cuál|pas[aá]me|a la|a qu[eé])\b)/i.test(body)) {
        const next = requiredCheckoutPrompt(verifiedSaleState, isValidCustomerName(verifiedSaleState.customerName));
        const missingName = !isValidCustomerName(verifiedSaleState.customerName) && verifiedSaleState.quantity;
        const followQuestion = next?.question ?? (missingName
          ? "😊 Para completar tu pedido, ¿me pasás tu nombre y apellido?"
          : !isValidDeliveryAddress(verifiedSaleState.street) && !isValidDeliveryAddress(verifiedSaleState.locationUrl)
            ? "📍 ¿Me pasás tu dirección o ubicación para coordinar la entrega?"
            : "");
        outgoingProposal = (await aiCompose(aiAnswerContext, `Para ${paymentQuestionPolicy.city} el pago es AL RECIBIR (contraentrega): no hace falta transferencia ni datos bancarios.${followQuestion ? ` Después pedí: ${followQuestion}` : ""}`)) ?? "";
      }
      // Comparación aritmética independiente de la verificación documental:
      // un comprobante con 130.000 Gs nunca significa que falten 100 Gs
      // frente a un pedido de 129.900 Gs. No equivale a pago acreditado.
      const parsedCurrentReceipt = mediaPath && media &&
        (media.type === "image" || media.type === "document")
          ? parseReceiptFields(transcript) : null;
      const amountFixedProposal = correctReceiptAmountReply({
        reply: outgoingProposal,
        expectedTotal,
        parsedAmount: parsedCurrentReceipt?.amountGs ?? null,
        documentAccepted: Boolean(!paymentSaleState.receiptReview &&
          paymentSaleState.receiptDocuments?.some(doc => doc.path === mediaPath)),
        customerNameValid: isValidCustomerName(verifiedSaleState.customerName),
      });
      if (amountFixedProposal !== outgoingProposal)
        outgoingProposal = (await aiCompose(aiAnswerContext, `Corregí el cálculo del pago: ${amountFixedProposal}`)) ?? "";
      // Segunda verificación determinista DESPUÉS de generar/corregir el texto
      // y ANTES de WhatsApp: una IA que insiste no vuelve a imponer encomienda
      // sobre una ciudad cubierta por contraentrega (ni el caso inverso).
      const outgoingChecked = enforceVerifiedPaymentReply({
        reply: outgoingProposal, city:verifiedSaleState.city, department:verifiedSaleState.department,
        cityVerified:verifiedSaleState.cityVerified, training:ctx.training,
        saleState:verifiedSaleState, productId:detectedProduct, products:ctx.products,
      });
      if (outgoingChecked.corrected) console.warn("[BOT_SKY_COVERAGE_OUTPUT_GUARD]", JSON.stringify({
        conversationId:conversation.id, paymentMethod:outgoingChecked.paymentMethod, channel:"whatsapp"
      }));
      let outgoingText = outgoingChecked.reply;
      if (outgoingChecked.corrected) {
        const revised=await generateAiReplyWithRetry({...aiAnswerContext,
          systemInstruction:aiAnswerContext.systemInstruction +
            `\nReformulá tu respuesta anterior porque contradice la modalidad del vendedor. Ciudad: ${verifiedSaleState.city??"no confirmada"}; método autorizado: ${outgoingChecked.paymentMethod??"pendiente de verificar"}. Usá el entrenamiento activo sin preguntas programadas.`});
        const second=enforceVerifiedPaymentReply({...{reply:revised.reply,city:verifiedSaleState.city,department:verifiedSaleState.department,cityVerified:verifiedSaleState.cityVerified,training:ctx.training},saleState:verifiedSaleState});
        // Si la IA vuelve a imponer una modalidad prohibida, NO enviar el
        // borrador original (que contenía «Total a transferir» en contraentrega).
        if (second.corrected) {
          const next = requiredCheckoutPrompt(verifiedSaleState, isValidCustomerName(verifiedSaleState.customerName));
          const mode = outgoingChecked.paymentMethod === "contraentrega"
            ? `Para ${verifiedSaleState.city} el pago es AL RECIBIR (contraentrega); no menciones transferencia ni datos bancarios.`
            : outgoingChecked.paymentMethod === "anticipado"
              ? `Para ${verifiedSaleState.city} la modalidad es pago anticipado (encomienda); no prometas pago al recibir.`
              : "La modalidad de entrega de su ciudad todavía no está confirmada.";
          outgoingText = (await aiCompose(aiAnswerContext, `${mode}${next ? ` Después pedí: ${next.question}` : ""}`)) ?? "";
        } else outgoingText = second.reply;
      }
      // Garantía de continuidad: no esperar a que el comprador escriba
      // «Excelente» luego del resumen de producto, precio y cobertura.
      // Las preguntas técnicas son universales; los textos comerciales y las
      // políticas de cada vendedor siguen viniendo de su entrenamiento + IA.
      const progressed = ensureCheckoutProgressReply({
        reply: outgoingText,
        state: verifiedSaleState,
        customerNameValid: isValidCustomerName(verifiedSaleState.customerName),
        checkoutActive: !bypassSale && !conversation.sale_closed,
      });
      // Si falta pedir el siguiente dato, la IA reescribe su respuesta incluyéndolo.
      if (progressed !== outgoingText.trim()) {
        const pendingAsk = requiredCheckoutPrompt(verifiedSaleState, isValidCustomerName(verifiedSaleState.customerName));
        outgoingText = (await aiCompose(aiAnswerContext,
          `Tu borrador fue: «${outgoingText.trim()}». Mantené su contenido y terminá pidiendo el siguiente dato obligatorio: ${pendingAsk?.question ?? ""}`)) ?? outgoingText;
      }
      // Regla declarativa del vendedor: si entrenó explícitamente un catálogo
      // para saludos sin producto, respetar la URL del entrenamiento aun cuando
      // el modelo la haya omitido. NO intervenir en checkout ni postventa.
      outgoingText = applyDynamicSellerTrainingReply({
        reply: outgoingText,
        customerText: body,
        history: chatHistory,
        training: ctx.training,
        products: ctx.products,
        activeProductId: verifiedSaleState.productId ?? conversation.product_id,
        checkoutActive: Boolean(verifiedSaleState.productId &&
          (verifiedSaleState.quantity || verifiedSaleState.customerName || verifiedSaleState.cityVerified)),
      });
      // ÚLTIMA barrera de precio, luego de todos los ajustes de IA y
      // entrenamiento. El catálogo sigue siendo la fuente de importes reales.
      outgoingText = enforceVerifiedCatalogPriceReply({
        reply: outgoingText,
        customerText: body,
        productId: detectedProduct,
        products: ctx.products,
        selectedOptionId: verifiedSaleState.optionId,
      });
      // Un mismo total no se repite dos veces en el resumen automático.
      // Aplica solo a líneas de total idénticas; no borra otros detalles.
      const sentTotalLines = new Set<string>();
      outgoingText = outgoingText.split("\n").filter(line => {
        const normalizedLine = line.toLowerCase().replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
        if (!/(?:total a transferir|total a pagar|total del pedido)\s*:/i.test(normalizedLine)) return true;
        if (sentTotalLines.has(normalizedLine)) return false;
        sentTotalLines.add(normalizedLine); return true;
      }).join("\n").replace(/\n{3,}/g,"\n\n").trim();
      if (!outgoingText) {
        await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
          reason:"La IA no pudo redactar la respuesta", queue:false});
        return;
      }
      const outgoingWamid = await sendWhatsAppText(conn, phone, outgoingText);
      await supabaseAdmin.from("messages").insert({
        workspace_id: workspaceId, user_id: ownerId, conversation_id: conversation.id,
        ad_id: attributedAdId, direction: "outbound", sender: "ai",
        response_origin: "ai",
        body: outgoingText, wamid: outgoingWamid, status: "sent",
      } as any);
      await supabaseAdmin.from("conversations").update({
        last_message: outgoingText, last_message_at: new Date().toISOString(),
        product_id: detectedProduct, unread_count: 0,
      }).eq("workspace_id", workspaceId).eq("id", conversation.id);
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
    try {
      await sendSilenceFallback({conn,workspaceId,ownerId,conversationId:conversation.id,adId:attributedAdId,phone,wamid:message.id,
        reason:`Error al responder: ${messageText.slice(0, 300)}`, queue:false});
    } catch (fallbackError) {
      console.error("[BOT SKY] No se pudo enviar respuesta de respaldo", fallbackError);
    }
  }
}

function cleanOrderText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type PriceOption = { id: string; label: string; quantity: number; price: number; sort_order: number };

/** Respeta la política del vendedor sin inventar promociones ni pisar selecciones. */
export function applySellerFirstOffer(
  order: Awaited<ReturnType<typeof generateAiReply>>["order"],
  productId: string | null,
  products: AiContextProducts,
  training: import("@/lib/ai.server").AiContext["training"],
  history: {role:"user"|"assistant";content:string}[] = [],
) {
  if (!order || !productId || !sellerUsesFirstOffer({training})) return order;
  const product=products.find(p=>p.id===productId);
  const options=[...(product?.product_prices??[])].filter(o=>o.price>0).sort((a,b)=>a.sort_order-b.sort_order);
  if (!options.length || order.product_price_id || order.price_option_label || order.quantity || order.promo_quantity) return order;
  // Una capacidad/modelo indicado por el comprador no se sustituye silenciosamente.
  const words=history.filter(h=>h.role==="user").slice(-12).map(h=>normalizeIntentText(h.content)).join(" ");
  const hasDistinctModel=options.some(o=>/\b\d+(?:[.,]\d+)?\s*(?:litros?|lts?|ml|kg|cm|mm)\b/.test(normalizeIntentText(o.label)));
  if(hasDistinctModel) return order;
  if(options.some(o=>normalizeIntentText(o.label).split(" ").some(token=>token.length>3&&words.includes(token)&&/\d/.test(token))))return order;
  const first=options[0];
  return {...order,product_price_id:first.id,price_option_label:first.label,quantity:first.quantity,promo_quantity:1};
}



function matchSelectedOption(
  order: Awaited<ReturnType<typeof generateAiReply>>["order"],
  options: PriceOption[],
  history: { role: "user" | "assistant"; content: string }[] = [],
): PriceOption | null {
  if (!order || options.length === 0) return null;
  if (options.length === 1) return options[0];
  // Si Gemini señaló una opción exacta del catálogo, usarla antes que
  // inferencias desde mensajes viejos de esta conversación.
  const exactId = cleanOrderText(order.product_price_id);
  if (exactId) return options.find((o) => o.id === exactId) ?? null;
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
    isValidCustomerName(customerName) &&
      city &&
      /^(?:contraentrega|anticipado|transferencia|deposito|depósito|giro)$/i.test(paymentMethod) &&
      (!order.street || isValidDeliveryAddress(order.street)) &&
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
  /** Importe documental de comprobantes únicos y compatibles (no pago acreditado). */
  documentedReceiptTotal?: number | null;
  /** Entrenamiento ACTIVO del workspace para validar requisitos por modalidad. */
  training?: AiContext["training"];
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
  // Última barrera: ninguna ruta de creación puede saltarse estas verificaciones.
  const orderIsEncomienda=Boolean(args.training && isEncomiendaAdvanceOrder(args.training,args.order.city,args.order.departamento,args.order.payment_method));
  // Para encomienda no se lee ni se valida el domicilio de entrega.
  const orderForValidation = orderIsEncomienda ? {...args.order, street: undefined} : args.order;
  if (!isOrderReady(orderForValidation, args.productId) ||
      (!orderIsEncomienda && args.order.street && !isValidDeliveryAddress(args.order.street))) {
    throw new Error("Pedido incompleto: nombre, ciudad, cantidad o pago inválidos. No se registró la venta.");
  }
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
  const parsedPromoCount = Number(args.order.promo_quantity ?? 1);
  if (!Number.isSafeInteger(parsedPromoCount) || parsedPromoCount < 1 || parsedPromoCount > 25) {
    throw new Error("Cantidad de promociones inválida");
  }
  const promoCount = parsedPromoCount;
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
    // Una presentación es un paquete comercial. Puede adquirirse varias veces.
    // El total SIEMPRE sale del precio verificado en product_prices.
    const unitsPerPack = selectedPrice.quantity;
    if (promoCount > 1) {
      const expectedUnits = unitsPerPack * promoCount;
      if (requestedQuantity !== expectedUnits) {
        throw new Error(`Promociones incompatibles: ${promoCount} x ${unitsPerPack} exige ${expectedUnits} unidades, recibidas ${requestedQuantity}`);
      }
      quantity = expectedUnits;
      total = selectedPrice.price * promoCount;
      unitPrice = total / quantity;
    } else if (unitsPerPack === 1) {
      quantity = requestedQuantity;
      total = selectedPrice.price * requestedQuantity;
      unitPrice = selectedPrice.price;
    } else {
      if (requestedQuantity !== unitsPerPack) {
        throw new Error(`Cantidad ${requestedQuantity} incompatible con la promoción ${selectedPrice.label} (${unitsPerPack} unidades)`);
      }
      quantity = unitsPerPack;
      total = selectedPrice.price;
      unitPrice = total / quantity;
    }
    selectedPriceLabel = promoCount > 1 ? `${promoCount} x ${selectedPrice.label}` : selectedPrice.label;
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

  // Verificación definitiva contra el total calculado para el INSERT (no
  // contra un estimado de la IA). El excedente solo existe si ambos importes
  // son coherentes y el comprobante es documentalmente compatible.
  if (args.documentedReceiptTotal !== undefined && args.documentedReceiptTotal !== null &&
      /anticip|transfer|deposit|giro/i.test(args.order.payment_method ?? "")) {
    if (!Number.isSafeInteger(args.documentedReceiptTotal) ||
        Number(args.documentedReceiptTotal) < total) {
      throw new Error("El comprobante documentado no cubre el total definitivo del pedido; no se registra la venta.");
    }
  }

  const customerName = cleanOrderText(args.order.customer_name) || "Cliente";

  const city = cleanOrderText(args.order.city);
  // Asunción (y sus variantes de la planilla) se guarda como departamento Central.
  const departamento = resolveDepartamento(
    cleanOrderText(args.order.departamento),
    cleanOrderText(args.order.city),
  ) || null;
  const district = cleanOrderText(args.order.district) || null;
  const street = orderIsEncomienda ? "" : cleanOrderText(args.order.street);
  const baseObservations =
    cleanOrderText(args.order.observations) || null;

  const observations = [
    // Guardar la CI de encomienda en la columna existente; no imprimirla en logs.
    orderIsEncomienda && isValidRecipientCi(args.order.recipient_ci)
      ? `C.I. destinatario encomienda: ${String(args.order.recipient_ci).replace(/\D/g,"")}` : null,
    baseObservations,
    // Conservar la diferencia en el pedido para revisión del vendedor.
    // Esto NO crea un saldo bancariamente acreditado ni autoriza su consumo.
    Number.isSafeInteger(args.documentedReceiptTotal) &&
      Number(args.documentedReceiptTotal) > total &&
      /anticip|transfer|deposit|giro/i.test(args.order.payment_method ?? "")
      ? `SALDO A FAVOR DOCUMENTAL PENDIENTE DE ACREDITACION BANCARIA: ${(Number(args.documentedReceiptTotal) - total).toLocaleString('es-PY')} Gs.; comprobante ${(Number(args.documentedReceiptTotal)).toLocaleString('es-PY')} Gs.; total ${total.toLocaleString('es-PY')} Gs.; habilitar para futuras compras SOLO despues de validar acreditacion, sin duplicar el credito.` : null,
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
        `Pedido: ${orderNumber}; workspace: ${args.workspaceId}; conversación: ${args.conversationId}`,
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

  let settings: {apps_script_url?: string|null}|null = null;
  try {
    const {data: fetchedSettings, error: settingsError} = await supabaseAdmin
      .from("user_settings")
      .select("apps_script_url")
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (settingsError) throw settingsError;
    settings = fetchedSettings;
  } catch (settingsError) {
    console.error("[Pedidos] No se pudo consultar Apps Script; el pedido YA está registrado", {
      orderId: created.id,
      error: settingsError instanceof Error ? settingsError.message : String(settingsError),
    });
  }

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

function buildSafeAiReply(args: {
  reply: string;
  history: { role: "user" | "assistant"; content: string }[];
  products: AiContextProducts;
  productId: string | null;
  lastCustomerMessage: string;
}) {
  const cleanReply = args.reply.trim();

  if (!cleanReply) {
    throw new Error("La IA devolvió una respuesta vacía; no se enviará texto comercial fijo.");
  }

  // Los importes de opciones se toman del catálogo, jamás de redondeos de la IA.
  const product = args.products.find(p => p.id === args.productId);
  const catalogPrices = (product?.product_prices ?? []).map(o=>Math.round(Number(o.price)))
    .filter(n=>Number.isSafeInteger(n) && n>0);
  const correctedReply = cleanReply.replace(/(?:Gs\.?\s*|₲\s*)(\d[\d.,]{3,})/gi,(full,digits:string)=>{
    const parsed=Number(digits.replace(/[^0-9]/g,""));
    const near=catalogPrices.filter(p=>Math.abs(p-parsed)===1);
    if(near.length!==1) return full;
    return full.replace(digits,near[0].toLocaleString("es-PY"));
  });
  // Nunca reemplazar la respuesta de la IA por ofertas/preguntas programadas.
  // La corrección mínima de un guaraní de diferencia conserva el precio del catálogo.
  return correctedReply;
}

/**
 * Contrato de precios: una consulta de precio se responde con las opciones
 * verificadas de product_prices, aunque el modelo o el entrenamiento mencionen
 * un importe distinto. Solo afecta el texto de respuestas comerciales; NO
 * modifica el carrito, la modalidad de pago ni el proceso de registro del pedido.
 *
 * Es una validación de salida: también actúa cuando una consulta informativa
 * omite la conciliación del checkout (`bypassSale`).
 */
function enforceVerifiedCatalogPriceReply(args: {
  reply: string;
  customerText: string;
  productId: string | null;
  products: AiContextProducts;
  selectedOptionId?: string | null;
}): string {
  const question = normalizeIntentText(args.customerText);
  if (!/\b(?:precio|precios|cuanto cuesta|cuanto sale|cuanto vale|cuanto me sale|a cuanto|valor|costo)\b/.test(question)) {
    return args.reply;
  }

  const product = args.products.find(p => p.id === args.productId);
  if (!product) return args.reply;
  const options = [...(product.product_prices ?? [])]
    .filter(option => Number.isFinite(Number(option.price)) && Number(option.price) > 0)
    .sort((a, b) => a.sort_order - b.sort_order);
  // No crear precios para productos sin una presentación confirmada.
  if (!options.length) return args.reply;

  const officialPrices = new Set(options.map(option => Math.round(Number(option.price))));
  const amounts = new Set<number>();
  // Montos con moneda antes o después, con y sin separador de miles.
  const currencyBefore = /(?:₲|Gs\.?|guaran[ií]es?)\s*([0-9][0-9., ]{3,})/gi;
  const currencyAfter = /\b([0-9][0-9., ]{3,})\s*(?:Gs\.?|guaran[ií]es?)\b/gi;
  const numericPrice = /\b(?:precio|cuesta|sale|vale)\s*(?:de|es|a|:)?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{5,7})\b/gi;
  for (const expression of [currencyBefore, currencyAfter, numericPrice]) {
    for (const match of args.reply.matchAll(expression)) {
      const amount = Number(match[1].replace(/\D/g, ""));
      if (Number.isSafeInteger(amount) && amount > 0) amounts.add(amount);
    }
  }

  // Si el cliente pidió precios y el modelo omitió los importes o inventó
  // uno ajeno al producto, reemplazar por los datos actuales del catálogo.
  // Nunca "adivinar" cuál opción eligió el comprador.
  const wrongAmount = [...amounts].some(amount => !officialPrices.has(amount));
  if (!wrongAmount && amounts.size > 0) return args.reply;

  const priceLines = options.map(option =>
    `• *${option.label}* — Gs. ${Math.round(Number(option.price)).toLocaleString("es-PY")}`,
  ).join("\n");
  const chosen = options.find(option => option.id === args.selectedOptionId);
  // Mantener la siguiente pregunta comercial de la IA cuando la presentación
  // ya esté seleccionada; si hay variantes sin elegir, pedir esa elección.
  const questionFromAi = [...args.reply.matchAll(/¿[^?\n]{3,180}\?/g)]
    .map(match => match[0]).at(-1);
  const nextQuestion = options.length > 1 && !chosen
    ? "¿Cuál opción te interesa? 😊"
    : questionFromAi ?? "¿Querés que sigamos con tu pedido? 😊";
  console.warn("[BOT_SKY_PRICE_OUTPUT_GUARD] Respuesta ajustada al precio verificado", {
    productId: product.id,
    reason: wrongAmount ? "incorrect_amount" : "missing_price",
  });
  return `💰 *Precios disponibles: *\n${priceLines}\n\n${nextQuestion}`;
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
  identifyOnly?: boolean;
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
  if (args.identifyOnly) return { productId, sent: false };

  const { data: alreadySent } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("workspace_id", args.workspaceId)
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
    ? `\n\n💥 *Opciones disponibles:*\n${options.map((o) => `• *${o.label}* — ${formatGs(Number(o.price))}`).join("\n")}`
    : "";
  void variantLines;
  // Los precios se envían aparte, 5 segundos después del copy + imagen.
  const copy = baseCopy;
  const pricesMessage = options.length
    ? `💰 *Precios disponibles:*\n${options.map((o) => `• *${o.label}* — Gs. ${Math.round(Number(o.price)).toLocaleString("es-PY")}`).join("\n")}\n\n¿Cuál te interesa? 😊`
    : null;

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

  let lastMessage = copy;
  if (pricesMessage && (copySent || sentMediaCount > 0)) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const wamid = await sendWhatsAppText(args.conn, args.phone, pricesMessage);
      lastMessage = pricesMessage;
      const { error: pricesError } = await supabaseAdmin.from("messages").insert({
        workspace_id: args.workspaceId, user_id: args.ownerId,
        conversation_id: args.conversationId, ad_id: args.adId,
        direction: "outbound", sender: "ai", response_origin: "code",
        body: pricesMessage, status: "sent", wamid,
      });
      if (pricesError) console.error("[Catálogo] Error guardando precios", { productId, error: pricesError.message });
    } catch (error) {
      console.error("[Catálogo] Error enviando precios", {
        productId, error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await supabaseAdmin
    .from("conversations")
    .update({
      product_id: productId,
      last_message: lastMessage,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);

  return { productId, sent: copySent || sentMediaCount > 0 };
}


/**
 * TODA respuesta al cliente la redacta la IA con el entrenamiento del vendedor.
 * `goal` describe QUÉ comunicar (hechos verificados por el sistema y el
 * siguiente dato a pedir); la IA decide CÓMO decirlo con el estilo de la tienda.
 * Si la IA no responde devuelve null: el llamador NO envía texto fijo.
 */
async function aiCompose(ctx: Parameters<typeof generateAiReply>[0], goal: string): Promise<string | null> {
  if (!goal.trim()) return null;
  try {
    const { reply } = await generateAiReplyWithRetry({
      ...ctx,
      systemInstruction: ctx.systemInstruction +
        `\nOBJETIVO OBLIGATORIO DE ESTA RESPUESTA (hechos verificados por el sistema): ${goal}\n` +
        "Redactalo vos con el tono, estilo y reglas del entrenamiento de este vendedor, contestando también el último mensaje del cliente si corresponde. " +
        "No copies este objetivo literal, no agregues datos no verificados, no inventes número de pedido ni confirmes un pedido no registrado.",
    });
    const text = String(reply ?? "").trim();
    return text || null;
  } catch (error) {
    console.error("[BOT_SKY_AI_COMPOSE]", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * El extractor dio el cierre por completo pero el INSERT no procedió (monto,
 * variante o cobertura sin verificar). En lugar de un texto fijo, la IA con el
 * entrenamiento del vendedor explica al cliente qué falta, usando los hechos
 * técnicos del backend. Si la IA no responde, se usa el aviso de respaldo.
 */
async function pendingCheckoutAiReply(args: {
  ctx: Parameters<typeof generateAiReply>[0];
  facts: Record<string, unknown>;
}): Promise<string> {
  // Sin texto fijo: si la IA falla, no se envía nada y el vendedor recibe la alerta.
  const fallback = "";
  try {
    const { reply } = await generateAiReplyWithRetry({
      ...args.ctx,
      systemInstruction: args.ctx.systemInstruction +
        `\nCIERRE PENDIENTE: el backend NO pudo registrar todavía el pedido. Hechos técnicos: ${JSON.stringify(args.facts)}. ` +
        "Respondé al cliente con el entrenamiento de la tienda explicando SOLO lo que falta: si el pago anticipado no cubre el total, indicá la diferencia exacta y pedí el comprobante del complemento; " +
        "si falta elegir variante o cantidad, mostrá las opciones con sus precios reales del catálogo y preguntá cuál prefiere; si el comprobante está en revisión, decí que un asesor lo revisa sin pedir otra transferencia. " +
        "No digas que el pedido está confirmado ni inventes número de pedido.",
    });
    const text = String(reply ?? "").trim();
    if (!text || /pedido\s+(?:confirmado|registrado)/i.test(text)) return fallback;
    return text;
  } catch (error) {
    console.error("[BOT_SKY_PENDING_CHECKOUT_AI]", error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* NUNCA QUEDARSE CALLADO                                              */
/* ------------------------------------------------------------------ */
// Conservada solo por compatibilidad de importación; NO se envía al cliente.
export const SILENCE_FALLBACK_REPLY = "";

/** Reintenta una vez más (tras 2 s) si todos los proveedores de IA fallaron. */
async function generateAiReplyWithRetry(ctx: Parameters<typeof generateAiReply>[0]) {
  try {
    return await generateAiReply(ctx);
  } catch (firstError) {
    console.warn("[BOT SKY IA] Primer intento falló; reintentando", firstError instanceof Error ? firstError.message : firstError);
    await new Promise((r) => setTimeout(r, 2000));
    return await generateAiReply(ctx);
  }
}

/**
 * Cuando la IA no puede responder, el cliente recibe un aviso corto (una sola
 * vez seguida, sin repetirlo en cada mensaje) y el dueño recibe una
 * notificación con el motivo para contestar a mano.
 */
async function sendSilenceFallback(args: {
  conn: Conn; workspaceId: string; ownerId: string; conversationId: string;
  adId: string | null | undefined; phone: string; wamid: string; reason: string;
  reply?: string; queue?: boolean;
}) {
  // Si falla la IA, NO mandar «un asesor te responde» ni ningún guion
  // comercial programado. Mantener el último mensaje del comprador visible
  // en Inbox, registrar la falla y alertar al vendedor.
  if (args.queue !== false) {
    await supabaseAdmin.from("ai_failed_messages").upsert({
      workspace_id: args.workspaceId, user_id: args.ownerId, conversation_id: args.conversationId,
      wamid: args.wamid, error_message: args.reason.slice(0, 1500), status: "pending",
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,wamid" });
  }
  // No considerar como respuesta del mensaje ACTUAL un catálogo o promoción
  // que salió ANTES de que el cliente escribiera. Antes se usaban 45 s sin
  // mirar el mensaje entrante, por eso podía suprimir el único respaldo.
  try {
    const { data: inbound } = await supabaseAdmin.from("messages")
      .select("created_at").eq("workspace_id", args.workspaceId)
      .eq("wamid", args.wamid).maybeSingle();
    const since = inbound?.created_at ?? new Date(Date.now() - 45_000).toISOString();
    const { data: recent } = await supabaseAdmin.from("messages").select("id")
      .eq("workspace_id", args.workspaceId).eq("conversation_id", args.conversationId)
      .eq("direction", "outbound").gte("created_at", since).limit(1);
    if (!recent?.length) {
      // `reply` y la próxima pregunta son OBJETIVOS: la IA redacta el texto con
      // el entrenamiento del vendedor. Si la IA no responde, no se envía nada.
      const goal = args.reply?.trim() || await nextMissingQuestion(args.workspaceId, args.conversationId);
      const { data: lastRows } = await supabaseAdmin.from("messages").select("sender,body")
        .eq("workspace_id", args.workspaceId).eq("conversation_id", args.conversationId)
        .order("created_at", { ascending: false }).limit(24);
      const fallbackHistory = (lastRows ?? []).reverse().filter(m => Boolean(m.body)).map(m => ({
        role: m.sender === "customer" ? ("user" as const) : ("assistant" as const), content: String(m.body),
      }));
      const { data: convRow } = await supabaseAdmin.from("conversations").select("product_id")
        .eq("workspace_id", args.workspaceId).eq("id", args.conversationId).maybeSingle();
      const fallbackCtx = await buildWorkspaceAiContext(supabaseAdmin, args.workspaceId, fallbackHistory,
        convRow?.product_id ?? null, args.phone, args.conversationId);
      const text = await aiCompose(fallbackCtx, `Siguiente paso de la venta: ${goal}`);
      if (!text) throw new Error("IA sin respuesta para el mensaje de respaldo");
      const wamid = await sendWhatsAppText(args.conn, args.phone, text);
      await supabaseAdmin.from("messages").insert({
        workspace_id: args.workspaceId, user_id: args.ownerId, conversation_id: args.conversationId,
        ad_id: args.adId ?? null, direction: "outbound", sender: "ai", response_origin: "code",
        body: text, wamid, status: "sent",
      } as any);
      await supabaseAdmin.from("conversations").update({
        last_message: text, last_message_at: new Date().toISOString(),
      }).eq("workspace_id", args.workspaceId).eq("id", args.conversationId);
    }
  } catch (sendError) {
    console.error("[BOT SKY] No se pudo enviar respuesta de respaldo", sendError);
  }
  await supabaseAdmin.from("notifications").insert({
    workspace_id: args.workspaceId, user_id: args.ownerId, type: "ia",
    title: `La IA no pudo responder · ${args.phone}`,
    body: args.reason.slice(0, 240),
    link: "/inbox", audience: "user",
  });
}


/** Respaldo: en vez de callar, preguntar al cliente el próximo dato que falta. */
async function nextMissingQuestion(workspaceId: string, conversationId: string): Promise<string> {
  let st: any = {};
  try {
    const { data } = await supabaseAdmin.from("bot_sale_states").select("state")
      .eq("workspace_id", workspaceId).eq("conversation_id", conversationId).maybeSingle();
    st = (data?.state ?? {}) as any;
  } catch { /* sin estado: preguntar desde el inicio */ }
  const name = isValidCustomerName(st.customerName)
    ? String(st.customerName).trim().split(/\s+/)[0] : "";
  // Devuelve el OBJETIVO del próximo mensaje; la IA lo redacta (aiCompose).
  const hi = name ? `El cliente se llama ${name}.` : "";
  if (!st.productId) return `${hi} Preguntá qué producto le interesa para pasarle el precio.`;
  if (!st.optionId && !st.cartLines?.length) return `${hi} Preguntá qué opción o cantidad quiere llevar, con los precios reales del catálogo.`;
  if (!st.city || st.cityVerified !== true) return `${hi} Preguntá en qué ciudad quiere recibir el pedido.`;
  if (!isValidCustomerName(st.customerName)) return `${hi} Pedí el nombre y apellido de quien va a recibir el pedido.`;
  if (st.paymentMethod !== "anticipado" && !st.street && !st.locationUrl)
    return `${hi} Pedí la dirección (calle y una referencia) o la ubicación de Google Maps.`;
  if (st.paymentMethod === "anticipado") return `${hi} Indicá que envíe por acá el comprobante de la transferencia.`;
  return `${hi} El cliente ya dio todos los datos del pedido; el sistema todavía no pudo registrarlo. Avisá que un asesor lo confirma en breve, sin pedir más datos ni preguntar si necesita algo más.`;
}
