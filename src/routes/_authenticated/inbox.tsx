import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BotOff,
  Zap,
  CheckCircle2,
  CalendarDays,
  Loader2,
  MessageSquare,
  MapPin,
  ExternalLink,
  Search,
  Save,
  Send,
  Sparkles,
  Activity,
  Layers3,
  Paperclip,
  ShoppingBag,
  Tag,
  Trash2,
  Wand2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  aiReplyNow,
  registerPendingSale,
  deleteMessages,
  sendManualMessage,
  sendMediaMessage,
  sendProductCatalog,
  transcribeMessage,
} from "@/lib/chat.functions";
import { ChatMedia } from "@/components/chat-media";
import { MAX_FILE_BYTES, guessMediaType, uploadWorkspaceFile } from "@/lib/storage";
import { AdOriginCard } from "@/components/ad-origin-card";
import { ContactInfoDialog } from "@/components/contact-info-dialog";


/** Resumen real de pedidos de hoy, aislado por workspace. El pago no se considera acreditado por una imagen. */
type OfficeOrder = {
  id: string;
  created_at: string;
  customer_name: string;
  order_number: string;
  total: number;
  payment_method: string | null;
  payment_status: string | null;
  receipt_url: string | null;
  status: string | null;
};

const moneyGs = (value: number) => `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(value)}`;
const shortName = (value: string) => value.trim().split(/\s+/).slice(0, 2).join(" ") || "Cliente";
const isAdvanceSale = (method: string | null) => /anticip|transfer|dep[oó]sit|giro|encomienda/i.test(method ?? "");

function OfficeScene({businessName, recentActivity}: {businessName: string;recentActivity: OfficeOrder | null}) {
  return (
    <div className="inbox-office-scene relative isolate h-full overflow-hidden bg-transparent">
      <style>{`
        @keyframes skyLiveTypeL { 0%,100% { transform: rotate(-8deg) translate(0,0) } 48% { transform: rotate(9deg) translate(2px,5px) } }
        @keyframes skyLiveTypeR { 0%,100% { transform: rotate(8deg) translate(0,0) } 52% { transform: rotate(-9deg) translate(-2px,5px) } }
        @keyframes skyLiveHead { 0%,100% { transform: rotate(-3deg) translateY(0) } 45% { transform: rotate(3deg) translateY(1px) } }
        @keyframes skyLiveBlink { 0%,88%,95%,100% { transform: scaleY(1) } 91% { transform: scaleY(.08) } }
        @keyframes skyLiveKey { 0%,100% { opacity: .35 } 40% { opacity: 1 } }
        @keyframes skyLiveFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes skyLiveBreath { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(1.022) } }
        @keyframes skyOfficeRise { from { opacity: 0; transform: translateY(22px) scale(.95) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes skyOfficeGlow { 0%,100% {opacity:.4} 50% {opacity:1} }
        @keyframes skyOfficeSweep { from { transform: translateX(-120%) } to { transform: translateX(350%) } }
        .inbox-office-scene .sky-live-motion { will-change:transform; }
        @media (prefers-reduced-motion: reduce) { .inbox-office-scene .sky-live-motion, .inbox-office-scene .office-floating { animation:none !important; } }
      `}</style>
      <div className="pointer-events-none absolute -left-20 top-12 h-44 w-44 rounded-full bg-sky-400/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-2 h-44 w-44 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="relative mx-auto h-full w-full max-w-[550px] px-2 py-0 sm:px-4">
        <svg viewBox="0 0 360 250" className="h-full w-full drop-shadow-[0_20px_26px_rgba(0,7,22,.48)]" role="img" aria-label={`Oficina virtual animada de ${businessName}: una persona trabaja continuamente en una computadora`}>
              <defs>
                <linearGradient id="liveWall" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#4775a4"/><stop offset="1" stopColor="#173556"/></linearGradient>
                <linearGradient id="liveDesk" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#f9c579"/><stop offset="1" stopColor="#cb8c4a"/></linearGradient>
                <linearGradient id="liveShirt" x1="0" x2="1"><stop stopColor="#3d83ee"/><stop offset="1" stopColor="#1e3e9b"/></linearGradient>
                <linearGradient id="liveScreen" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#152c50"/><stop offset="1" stopColor="#050c1b"/></linearGradient>
              </defs>
              {/* Suelo y paredes con profundidad isométrica */}
              <path d="M18 104 L176 28 L351 100 L192 214 Z" fill="#254364" opacity=".58"/>
              <path d="M18 88 L173 13 L173 112 L18 191 Z" fill="#1f3f64"/>
              <path d="M173 13 L350 83 L350 185 L173 112 Z" fill="url(#liveWall)"/>
              <path d="M28 126 L169 58" stroke="#4b78a5" strokeWidth="3" opacity=".7"/>
              <path d="M177 63 L339 124" stroke="#91bce0" strokeWidth="2" opacity=".25"/>
              <path d="M27 191 L180 119 L349 184 L194 246 Z" fill="#40648a"/>
              <path d="M27 191 L194 246 L194 252 L27 198 Z" fill="#172d4d"/>
              <path d="M194 246 L349 184 L349 192 L194 252 Z" fill="#203f66"/>
              {/* Decoración de la oficina */}
              <path d="M43 131 L61 122 L61 159 L43 167 Z" fill="#1a2b46"/>
              <path d="M47 138 L57 132 M47 145 L57 139" stroke="#31bbdb" strokeWidth="3"/>
              <path d="M283 108 L300 99 L316 108 L299 118 Z" fill="#3a4b59"/>
              <path className="sky-live-motion" style={{animation:'skyLiveFloat 3.9s ease-in-out infinite', transformOrigin:'297px 100px'}} d="M296 104 Q284 87 290 75 M298 105 Q303 86 315 78 M297 105 Q283 98 279 89" fill="none" stroke="#55c992" strokeWidth="5" strokeLinecap="round"/>
              {/* Silla */}
              <ellipse cx="175" cy="195" rx="65" ry="19" fill="#081527" opacity=".48"/>
              <path d="M143 129 Q144 112 179 112 Q216 114 211 140 L208 185 Q179 201 144 184 Z" fill="#182338" stroke="#6483a6" strokeWidth="3"/>
              {/* Cuerpo / cuello */}
              <g className="sky-live-motion" style={{transformOrigin:'180px 155px', animation:'skyLiveBreath 2.7s ease-in-out infinite'}}>
                <path d="M129 185 Q130 151 154 140 L206 139 Q229 153 234 192 L195 210 L156 206 Z" fill="url(#liveShirt)"/>
                <path d="M169 137 L170 151 Q180 162 193 146 L192 134" fill="#edab7b"/>
              </g>
              {/* Cabeza y pelo */}
              <g className="sky-live-motion" style={{transformOrigin:'181px 136px', animation:'skyLiveHead 3.3s ease-in-out infinite'}}>
                <ellipse cx="180" cy="114" rx="29" ry="34" fill="#edb18b"/>
                <path d="M150 111 Q145 78 171 76 Q180 61 202 81 Q216 86 210 114 L203 99 Q186 100 173 91 Q165 107 154 108 Z" fill="#172233"/>
                <path d="M154 105 L152 118 L157 129" fill="#172233"/>
                <g className="sky-live-motion" style={{transformOrigin:'181px 119px', animation:'skyLiveBlink 6s infinite'}}>
                  <path d="M167 114 h10 M187 114 h10" stroke="#1c2936" strokeWidth="2.5" strokeLinecap="round"/>
                </g>
                <path d="M176 132 Q182 137 190 131" stroke="#b56f64" strokeWidth="2" fill="none" strokeLinecap="round"/>
              </g>
              {/* Mesa 3D y patas */}
              <path d="M79 181 L203 155 L306 195 L181 226 Z" fill="url(#liveDesk)" stroke="#ffe0a9" strokeWidth="2"/>
              <path d="M79 181 L181 226 L181 234 L79 190 Z" fill="#ac6c35"/>
              <path d="M181 226 L306 195 L306 202 L181 234 Z" fill="#d89b56"/>
              <path d="M96 191 L96 227 M286 208 L286 232" stroke="#1e293b" strokeWidth="7"/>
              {/* Teclado con luces */}
              <path d="M155 197 L210 184 L238 195 L183 208 Z" fill="#1a2942" stroke="#6980a2" strokeWidth="2"/>
              <path className="sky-live-motion" style={{animation:'skyLiveKey .42s steps(2) infinite'}} d="M171 195 l36 -8 M181 201 l40 -9" stroke="#5eead4" strokeWidth="2" opacity=".6"/>
              {/* Brazos escribiendo de manera independiente */}
              <g className="sky-live-motion" style={{transformOrigin:'147px 168px', animation:'skyLiveTypeL .48s ease-in-out infinite'}}>
                <path d="M146 164 Q128 172 153 198" fill="none" stroke="#2d64bc" strokeWidth="16" strokeLinecap="round"/>
                <ellipse cx="159" cy="200" rx="12" ry="7" fill="#e9ad83"/>
              </g>
              <g className="sky-live-motion" style={{transformOrigin:'220px 162px', animation:'skyLiveTypeR .57s ease-in-out infinite'}}>
                <path d="M220 163 Q239 170 214 201" fill="none" stroke="#2458a6" strokeWidth="16" strokeLinecap="round"/>
                <ellipse cx="210" cy="202" rx="12" ry="7" fill="#f3b48b"/>
              </g>
              {/* Monitor y base */}
              <path d="M193 154 L252 136 L252 198 L193 214 Z" fill="#091321" stroke="#506684" strokeWidth="3"/>
              <path d="M198 159 L247 144 L247 193 L198 207 Z" fill="url(#liveScreen)"/>
              <path d="M207 171 L237 162 M207 180 L239 170 M207 187 L233 179" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" opacity=".8"/>
              <path d="M228 204 L230 216 L242 220 L220 226 L206 220 L223 216" fill="#243b58"/>
              {/* Taza de café */}
              <ellipse cx="276" cy="192" rx="11" ry="5" fill="#dceafe"/><path d="M265 193 L269 207 Q277 211 283 204 L287 193" fill="#dceafe"/><path d="M284 197 Q297 196 289 204" stroke="#dceafe" strokeWidth="3" fill="none"/>
            </svg>
      </div>
    </div>
  );
}

/** Banner superior: oficina vectorial animada con actividad real del workspace, sin videos ni librerías. */
function InboxPanoramicOffice({ businessName, recentActivity, pending, salesCount, amount, onHide }: {
  businessName: string;
  recentActivity: OfficeOrder | null;
  pending: number;
  salesCount: number;
  amount: number;
  onHide: () => void;
}) {
  return (
    <div className="relative isolate hidden h-[196px] shrink-0 overflow-hidden border-b border-sky-400/25 bg-[#071427] text-white shadow-[inset_0_-22px_55px_rgba(0,4,19,.55)] md:block xl:h-[213px]">
      <style>{`
        @keyframes officeBannerFloat {0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes officeBannerPulse {0%,100%{opacity:.45}50%{opacity:1}}
        @keyframes officeBannerScroll {0%{transform:translateX(-100%)}100%{transform:translateX(370%)}}
        @media (prefers-reduced-motion:reduce){.office-panorama-motion{animation:none!important}}
      `}</style>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_62%_42%,rgba(29,112,192,.42),transparent_48%),linear-gradient(108deg,#091326_0%,#071c37_42%,#0b1932_100%)]"/>
      {/* Profundidad de oficina panorámica, sin depender de imágenes externas. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1400 215" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="skyBannerWindows" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#193759"/><stop offset="1" stopColor="#071527"/></linearGradient>
          <linearGradient id="skyBannerFloor" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#153b69"/><stop offset="1" stopColor="#09182a"/></linearGradient>
        </defs>
        <path d="M0 177 L1400 147 L1400 215 L0 215Z" fill="url(#skyBannerFloor)" opacity=".75"/>
        <path d="M450 0H1400V146H450Z" fill="url(#skyBannerWindows)" opacity=".54"/>
        {[610,790,970,1150,1330].map(x=><g key={x}><path d={`M${x} 0V145`} stroke="#3a6d9e" strokeWidth="5" opacity=".35"/><path d={`M${x+15} 0V142`} stroke="#1a3552" strokeWidth="3" opacity=".65"/></g>)}
        {[25,50,76,103,131].map((y,i)=><path key={y} d={`M470 ${y}H1400`} stroke="#356193" opacity={i%2===0?'.23':'.13'}/>)}
        {[690,733,768,802,864,1000,1105,1170,1245,1320].map((x,i)=><rect key={x} x={x} y={33+(i%3)*12} width={5+i%3*3} height={20+(i%4)*9} fill={i%2===0?'#38bdf8':'#fdba74'} opacity=".17"/>)}
        <path d="M440 147H1400" stroke="#39b9f9" strokeWidth="2" opacity=".28"/>
        <path d="M500 173L1400 165 M430 198L1400 180" stroke="#1e4d7d" strokeWidth="1.5" opacity=".5"/>
        <path d="M440 10H1370V12H440Z" fill="#0ea5e9" opacity=".15"/>
      </svg>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#061427] via-[#061427]/30 to-[#071427]/35"/>
      <div className="relative z-10 flex h-full w-full items-center justify-between gap-3 px-4 sm:px-6 xl:px-8">
        <div className="z-20 flex h-full min-w-0 max-w-[40%] flex-col justify-center gap-2 py-3 sm:max-w-[37%] xl:max-w-[32%]">
          <div className="flex items-center gap-2"><span className="rounded-md border border-sky-300/25 bg-sky-400/10 p-1.5 text-sky-200"><Bot className="h-4 w-4"/></span><span className="truncate text-[10px] font-bold uppercase tracking-[.19em] text-sky-200">BOT SKY · INBOX PRO</span></div>
          <h2 className="max-w-[420px] truncate text-lg font-black tracking-tight text-white sm:text-xl xl:text-[25px]">{businessName}</h2>
          <p className="hidden max-w-[375px] text-[11px] leading-relaxed text-sky-100/75 lg:block">Tu centro de operaciones: conversá, organizá clientes y seguí cada pedido registrado.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5 text-[10px] font-semibold text-emerald-200"><span className="office-panorama-motion h-1.5 w-1.5 rounded-full bg-emerald-400" style={{animation:'officeBannerPulse 2s infinite'}}/> Oficina animada</span>
            <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-semibold text-white/90">{salesCount} pedido{salesCount===1?'':'s'} hoy</span>
            <span className="hidden rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-semibold text-white/90 xl:inline-flex">{pending} pendiente{pending===1?'':'s'}</span>
          </div>
          <p className="hidden truncate text-[10px] font-semibold text-sky-300 xl:block">Valor de pedidos de hoy: {moneyGs(amount)}</p>
        </div>
        <div className="pointer-events-none absolute bottom-0 right-[8%] top-0 w-[48%] min-w-[390px] max-w-[770px] overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_95%,transparent)]">
          <OfficeScene businessName={businessName} recentActivity={null}/>
        </div>
        <div className="z-20 ml-auto hidden w-[195px] shrink-0 space-y-2 xl:block 2xl:w-[225px]">
          <div className="office-panorama-motion rounded-xl border border-sky-300/20 bg-[#0a2444]/90 px-3 py-2.5 shadow-xl backdrop-blur-sm" style={{animation:'officeBannerFloat 5.4s ease-in-out infinite'}}>
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-300"/><span className="text-[10px] font-extrabold text-cyan-100">Centro de operaciones</span></div>
            <p className="mt-1 text-[10px] leading-relaxed text-sky-100/75">La oficina se mueve de forma continua, incluso mientras atendés clientes.</p>
          </div>
          <div className="rounded-xl border border-emerald-400/20 bg-[#092d2e]/85 px-3 py-2.5 shadow-xl backdrop-blur-sm">
            <span className="flex items-center gap-1.5 text-[10px] font-extrabold text-emerald-200"><ShoppingBag className="h-3.5 w-3.5"/>{recentActivity?'Nuevo pedido registrado':'Registro de pedidos'}</span>
            {recentActivity ? <><p className="mt-1 truncate text-[11px] font-medium text-white">{shortName(recentActivity.customer_name)}</p><p className="text-sm font-black text-emerald-300">{moneyGs(recentActivity.total)}</p></> : <p className="mt-1 text-[10px] text-emerald-100/65">Los pedidos nuevos aparecerán aquí cuando se registren.</p>}
          </div>
        </div>
        <button type="button" onClick={onHide} className="absolute right-3 top-2.5 z-30 rounded-lg border border-white/15 bg-[#081b32]/85 px-2.5 py-1.5 text-[10px] font-semibold text-sky-100 transition hover:bg-[#1b395a]" aria-label="Ocultar oficina animada" title="Ocultar oficina">Ocultar oficina</button>
      </div>
    </div>
  );
}

function InboxOperationsPanel({
  businessName, orders, pending, totalChats, loading, failed, recentActivity
}: {
  businessName: string;
  orders: OfficeOrder[];
  pending: number;
  totalChats: number;
  loading: boolean;
  failed: boolean;
  recentActivity: OfficeOrder | null;
}) {
  const sales = orders.filter(order => order.status !== "cancelado");
  const amount = sales.reduce((total, order) => total + (Number.isFinite(Number(order.total)) ? Number(order.total) : 0), 0);
  const transfers = sales.filter(order => isAdvanceSale(order.payment_method));
  const onDelivery = sales.filter(order => !isAdvanceSale(order.payment_method) && /contraentrega|contra entrega|al recibir/i.test(order.payment_method ?? ""));
  const attached = sales.filter(order => Boolean(order.receipt_url));
  const hourly = Array.from({length:24}, (_,hour) => sales.filter(order => new Date(order.created_at).getHours() === hour).reduce((sum,order) => sum + Number(order.total || 0),0));
  const peak = Math.max(1,...hourly);
  const line = hourly.map((number,hour) => `${hour === 0 ? "M" : "L"}${(hour*12.4+8).toFixed(1)},${(86-(number/peak)*69).toFixed(1)}`).join(" ");
  const fill = `${line} L293,92 L8,92 Z`;
  const statCards = [
    {label:"Ventas registradas", value: String(sales.length), icon:<ShoppingBag className="h-4 w-4"/>, tone:"text-sky-300 bg-sky-400/10"},
    {label:"Valor de pedidos", value: moneyGs(amount), icon:<Activity className="h-4 w-4"/>, tone:"text-emerald-300 bg-emerald-400/10"},
    {label:"Por transferencia", value: String(transfers.length), icon:<CheckCircle2 className="h-4 w-4"/>, tone:"text-violet-300 bg-violet-400/10"},
    {label:"Contraentregas", value: String(onDelivery.length), icon:<ShoppingBag className="h-4 w-4"/>, tone:"text-amber-300 bg-amber-400/10"},
    {label:"Comprobantes", value: String(attached.length), icon:<Paperclip className="h-4 w-4"/>, tone:"text-cyan-300 bg-cyan-400/10"},
    {label:"Chats del período", value: String(totalChats), icon:<MessageSquare className="h-4 w-4"/>, tone:"text-slate-200 bg-slate-400/10"},
  ];
  return (
    <div className="flex min-h-0 h-full flex-col bg-[#071527] text-white">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 [scrollbar-width:thin] [scrollbar-color:#274765_transparent]">
        <div className="rounded-[18px] border border-sky-500/20 bg-gradient-to-r from-[#122d4d] to-[#091d35] px-3 py-3">
          <p className="truncate text-[11px] font-black uppercase tracking-wide text-sky-100">{businessName}</p>
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-sky-200/75"><span>Panel de operaciones</span><span className="font-bold text-emerald-300">Datos registrados</span></div>
          {recentActivity && <p className="mt-2 truncate rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5 text-[10px] text-emerald-100">Nuevo pedido: {shortName(recentActivity.customer_name)} · {moneyGs(recentActivity.total)}</p>}
        </div>
        <div className="rounded-[20px] border border-sky-500/20 bg-[#0b2039] p-3.5 shadow-inner">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-extrabold tracking-tight">Resumen de hoy</h3><p className="mt-0.5 text-[10px] text-slate-400">Pedidos registrados en esta tienda</p></div>
            <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-200">{getTodayDate().split('-').reverse().join('/')}</span>
          </div>
          {failed ? <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-2 text-xs text-rose-200">No se pudieron cargar las estadísticas. Revisá permisos de pedidos.</p> : null}
          <div className="grid grid-cols-2 gap-2">
            {statCards.map(stat => (
              <div key={stat.label} className="min-w-0 rounded-xl border border-white/[.08] bg-[#102b4b] p-2.5">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] text-slate-300"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${stat.tone}`}>{stat.icon}</span><span className="leading-tight">{stat.label}</span></div>
                <p className="break-words text-[15px] font-black leading-tight tabular-nums sm:text-base">{loading && !orders.length ? "…" : stat.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-400/15 bg-sky-400/5 px-3 py-2 text-xs"><span className="text-slate-300">Respuestas pendientes</span><span className={`font-black ${pending > 0 ? 'text-amber-300':'text-emerald-300'}`}>{pending}</span></div>
        </div>
        <div className="rounded-[20px] border border-sky-500/20 bg-[#0b2039] p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-extrabold">Pedidos por hora</h3><span className="text-[10px] text-slate-400">Hoy · Gs.</span></div>
          <svg role="img" aria-label="Gráfico de valor de pedidos por hora de hoy" viewBox="0 0 306 111" className="h-[115px] w-full">
            <defs><linearGradient id="skyOfficeIncome" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#06b6d4" stopOpacity=".45"/><stop offset="1" stopColor="#06b6d4" stopOpacity="0"/></linearGradient></defs>
            {[18,42,66,92].map(y=><line key={y} x1="8" x2="293" y1={y} y2={y} stroke="#496987" strokeWidth=".7" opacity=".4"/>)}
            <path d={fill} fill="url(#skyOfficeIncome)"/><path d={line} fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
            {[0,6,12,18,23].map(h=><text key={h} x={h*12.4+8} y="106" fill="#94a3b8" fontSize="9" textAnchor="middle">{String(h).padStart(2,'0')}h</text>)}
          </svg>
          <p className="text-[10px] leading-relaxed text-slate-400">Valor de pedidos ingresados, no dinero acreditado. Los comprobantes requieren verificación bancaria.</p>
        </div>
        <div className="rounded-[20px] border border-sky-500/20 bg-[#0b2039] p-3.5">
          <h3 className="mb-2.5 text-sm font-extrabold">Últimos pedidos registrados</h3>
          {sales.length === 0 ? <p className="text-xs leading-relaxed text-slate-400">Todavía no hay ventas registradas hoy.</p> : (
            <div className="space-y-2">
              {sales.slice(0,5).map(order=>(
                <div key={order.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.035] px-2.5 py-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><ShoppingBag className="h-4 w-4"/></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold">{shortName(order.customer_name)}</p><p className="truncate text-[10px] text-slate-400">Pedido registrado · {new Date(order.created_at).toLocaleTimeString('es-PY',{hour:'2-digit',minute:'2-digit'})}</p></div>
                  <span className="shrink-0 text-right text-[11px] font-bold text-emerald-300">{moneyGs(Number(order.total || 0))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLocalDateRange(
  dateFrom: string,
  dateTo: string,
) {
  if (!dateFrom || !dateTo) return null;

  const [fromYear, fromMonth, fromDay] = dateFrom.split("-").map(Number);
  const [toYear, toMonth, toDay] = dateTo.split("-").map(Number);

  const start = new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0);
  const endExclusive = new Date(toYear, toMonth - 1, toDay + 1, 0, 0, 0, 0);

  return {
    start: start.toISOString(),
    endExclusive: endExclusive.toISOString(),
  };
}

export const Route = createFileRoute("/_authenticated/inbox")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === "string" ? search.c : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Inbox — BOT SKY" },
      { name: "description", content: "Conversaciones de WhatsApp en tiempo real con control humano." },
      { property: "og:title", content: "Inbox — BOT SKY" },
      { property: "og:description", content: "Atiende, pausa la IA y cierra ventas desde un solo lugar." },
    ],
  }),
  component: InboxPage,
});

function getGoogleMapsUrl(
  latitude?: number | string | null,
  longitude?: number | string | null,
) {
  if (latitude == null || longitude == null) return null;

  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function getResponseOrigin(message: any): "code" | "ai" | "human" | "unknown" | "incoming" {
  if (message.direction === "inbound") return "incoming";
  if (message.sender === "agent") return "human";
  if (message.response_origin === "code") return "code";
  if (message.response_origin === "ai") return "ai";
  return "unknown";
}

function OriginBadge({ origin }: { origin: ReturnType<typeof getResponseOrigin> }) {
  if (origin === "incoming") return null;
  const styles = {
    code: "border-lime-400 bg-lime-500/25 text-lime-200",
    ai: "border-sky-400 bg-sky-500/25 text-sky-200",
    human: "border-orange-400 bg-orange-500/25 text-orange-200",
    unknown: "border-slate-400 bg-slate-500/20 text-slate-200",
  };
  const names = {code:"⚡ RESPONDIDO POR CÓDIGO",ai:"✦ RESPONDIDO POR IA",human:"👤 RESPONDIDO POR HUMANO",unknown:"AUTOMÁTICO · ORIGEN SIN IDENTIFICAR"};
  return <span className={`inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${styles[origin]}`}>{names[origin]}</span>;
}


/** Categorías de atención. Se usan datos registrados; el texto solo indica prioridades. */
type SmartTab = "all" | "potential" | "order_query" | "complaints" | "advance" | "closed" | "closed_ai" | "closed_code" | "review";
const SMART_TABS: {id:SmartTab;label:string;icon:string}[] = [
  {id:"all",label:"Todos",icon:"📥"},
  {id:"potential",label:"Clientes potenciales",icon:"🛒"},
  {id:"order_query",label:"Consulta de pedido",icon:"📦"},
  {id:"complaints",label:"Reclamos",icon:"🚨"},
  {id:"advance",label:"Pago anticipado",icon:"💳"},
  {id:"closed",label:"Ventas cerradas",icon:"✅"},
  {id:"closed_ai",label:"Cierre IA",icon:"🧠"},
  {id:"closed_code",label:"Cierre código",icon:"⚡"},
  {id:"review",label:"Por revisar",icon:"❔"},
];
const normalizeSmartText = (value:unknown) => String(value ?? "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function messageTopic(text:unknown):"complaint"|"order"|null {
  const s=normalizeSmartText(text);
  if(/\b(reclamo|queja|no (?:llega|llego|cumplieron|quieren vender|responden)|estafa|devoluci[oó]n|reembolso|demora|atrasad[oa]|supervisor|encargado|molest[oa]|no recibi|mal servicio|denuncia)\b/.test(s)) return "complaint";
  if(/\b(donde esta mi pedido|estado de mi pedido|seguimiento|numero de guia|mi entrega|cuando llega|cuando entregan|ya hice el pedido|ya compre|pedido que hice|mi compra)\b/.test(s))return "order";
  return null;
}
function isAdvanceOrder(order: {payment_method?:string|null;payment_status?:string|null;receipt_url?:string|null}){
  const method=normalizeSmartText(order.payment_method);
  return /anticip|transfer|deposit|giro|encomienda/.test(method) || order.payment_status === "anticipado";
}

function InboxPage() {
  const { c: initialConversationId } = Route.useSearch();
  const { profile } = useAuth();
  const workspaceId = profile?.workspace_id ?? null;
  const { data: inboxWorkspace } = useQuery({
    queryKey: ["inbox-workspace-name", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase.from("workspaces")
        .select("name").eq("id", workspaceId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Consulta solo los pedidos reales del workspace durante el día LOCAL del usuario.
  // Son pedidos, NO transferencias bancarias acreditadas.
  const todayOfficeDate = getTodayDate();
  const { data: todayOfficeOrders, isLoading: officeLoading, error: officeError } = useQuery({
    queryKey: ["inbox-office-orders-today", workspaceId, todayOfficeDate],
    enabled: Boolean(workspaceId),
    refetchInterval: 15000,
    queryFn: async (): Promise<OfficeOrder[]> => {
      const period = getLocalDateRange(todayOfficeDate, todayOfficeDate);
      if (!period) return [];
      const all: OfficeOrder[] = [];
      const pageSize = 1000;
      for (let page = 0; page < 100; page++) {
        const { data, error } = await supabase.from("orders")
          .select("id,created_at,customer_name,order_number,total,payment_method,payment_status,receipt_url,status")
          .eq("workspace_id",workspaceId!)
          .gte("created_at",period.start)
          .lt("created_at",period.endExclusive)
          .order("created_at",{ascending:false})
          .order("id",{ascending:false})
          .range(page*pageSize, (page+1)*pageSize-1);
        if (error) throw error;
        all.push(...(data ?? []));
        if (!data || data.length < pageSize) break;
      }
      return all;
    },
  });
  const [officeActivity, setOfficeActivity] = useState<OfficeOrder | null>(null);
  const knownOfficeOrderIds = useRef<Set<string> | null>(null);
  const activityClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!todayOfficeOrders) return;
    const current = new Set(todayOfficeOrders.map(order => order.id));
    if (knownOfficeOrderIds.current) {
      const newOrder = todayOfficeOrders.find(order => !knownOfficeOrderIds.current!.has(order.id) && order.status !== "cancelado");
      if (newOrder) {
        setOfficeActivity(newOrder);
        if (activityClearRef.current) clearTimeout(activityClearRef.current);
        activityClearRef.current = setTimeout(() => setOfficeActivity(null), 8000);
      }
    }
    knownOfficeOrderIds.current = current;
  }, [todayOfficeOrders]);
  useEffect(() => () => { if (activityClearRef.current) clearTimeout(activityClearRef.current); }, []);
  useEffect(() => { knownOfficeOrderIds.current = null; setOfficeActivity(null); }, [workspaceId]);
  const [smallOfficeOpen, setSmallOfficeOpen] = useState(false);
  const [showPanoramaOffice, setShowPanoramaOffice] = useState(true);
  const [showAdvancedInboxFilters, setShowAdvancedInboxFilters] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase.channel(`inbox-office-orders-${workspaceId}`)
      .on("postgres_changes", {event:"*",schema:"public",table:"orders",filter:`workspace_id=eq.${workspaceId}`}, () => {
        queryClient.invalidateQueries({queryKey:["inbox-office-orders-today",workspaceId]});
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId, queryClient]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [search, setSearch] = useState("");
  const [smartTab, setSmartTab] = useState<SmartTab>("all");
  const [dateFrom, setDateFrom] = useState(getTodayDate);
  const [dateTo, setDateTo] = useState(getTodayDate);
  const [selectedLabelId, setSelectedLabelId] = useState("all");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recovery, setRecovery] = useState({
    productId:"",optionId:"",promoCount:1,customerName:"",city:"",department:"",street:"",paymentMethod:"contraentrega" as "contraentrega"|"anticipado",sourceMessageId:"",
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [adName, setAdName] = useState("");
  const [adProductId, setAdProductId] = useState("");
  const [statusNow, setStatusNow] = useState(() => Date.now());
  const [verifiedPendingIds, setVerifiedPendingIds] = useState<string[] | null>(null);
  // Último inbound realmente sin contestar en un turno que corresponde a la IA.
  // Nunca usar conversations.last_message_at: puede representar un copy/imagen enviado por código.
  const [aiUnansweredSince, setAiUnansweredSince] = useState<Record<string, string>>({});
  const [isCheckingPending, setIsCheckingPending] = useState(false);
  const { data: inboxAiSettings } = useQuery({
    queryKey: ["inbox-ai-monitoring-enabled", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_settings")
        .select("ai_enabled")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });


  const { data: conversations } = useQuery({
    queryKey: ["conversations", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "*, contacts(name, phone, city), products(name, sales_copy), conversation_labels(label_id, labels(name, color))",
        )
        .eq("workspace_id", workspaceId!)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const {
    data: dateConversationIds,
    isLoading: isLoadingDateConversationIds,
    error: dateConversationIdsError,
  } = useQuery({
    queryKey: [
      "inbox-conversation-ids-by-message-date",
      workspaceId,
      dateFrom,
      dateTo,
    ],
    enabled: Boolean(workspaceId && dateFrom && dateTo),
    queryFn: async () => {
      const range = getLocalDateRange(dateFrom, dateTo);
      if (!range) return [] as string[];

      const conversationIds = new Set<string>();
      const pageSize = 1000;
      let page = 0;

      // Pagina todos los mensajes del período para no perder resultados por
      // el límite de 1000 filas de Supabase.
      while (true) {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data, error } = await supabase
          .from("messages")
          .select("id, conversation_id, created_at")
          .gte("created_at", range.start)
          .lt("created_at", range.endExclusive)
          .not("conversation_id", "is", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        if (error) throw error;

        for (const message of data ?? []) {
          if (message.conversation_id) {
            conversationIds.add(message.conversation_id);
          }
        }

        if (!data || data.length < pageSize) break;
        page += 1;
      }

      return Array.from(conversationIds);
    },
  });

  const {
    data: dateConversations,
    isLoading: isLoadingDateConversations,
    error: dateConversationsError,
  } = useQuery({
    queryKey: [
      "inbox-conversations-by-message-date",
      workspaceId,
      dateFrom,
      dateTo,
      dateConversationIds,
    ],
    enabled: Boolean(
      workspaceId &&
        dateConversationIds &&
        dateConversationIds.length > 0,
    ),
    queryFn: async () => {
      const allConversations = [] as NonNullable<typeof conversations>;
      const ids = dateConversationIds ?? [];
      const batchSize = 100;

      for (let index = 0; index < ids.length; index += batchSize) {
        const batch = ids.slice(index, index + batchSize);
        const { data, error } = await supabase
          .from("conversations")
          .select(
            "*, contacts(name, phone, city), products(name, sales_copy), conversation_labels(label_id, labels(name, color))",
          )
          .eq("workspace_id", workspaceId!)
          .in("id", batch);

        if (error) throw error;
        allConversations.push(...(data ?? []));
      }

      return allConversations.sort((a, b) => {
        const aTime = a.last_message_at
          ? new Date(a.last_message_at).getTime()
          : 0;
        const bTime = b.last_message_at
          ? new Date(b.last_message_at).getTime()
          : 0;
        return bTime - aTime;
      });
    },
  });

  const isLoadingDateFilter =
    isLoadingDateConversationIds ||
    (Boolean(dateConversationIds?.length) && isLoadingDateConversations);
  const dateFilterError =
    dateConversationIdsError ?? dateConversationsError;

  const { data: labels } = useQuery({
    queryKey: ["labels", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labels")
        .select("*")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: products } = useQuery({
    queryKey: ["catalog-products", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, promo_price, product_prices(id,label,quantity,price,sort_order)")
        .eq("workspace_id", workspaceId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: lastReplyOrigins } = useQuery({
    queryKey: ["inbox-reply-origins", workspaceId, dateConversationIds],
    enabled: Boolean(workspaceId && dateConversationIds?.length),
    queryFn: async () => {
      const result: Record<string, string> = {};
      const ids = dateConversationIds ?? [];
      // Sólo se leen los mensajes más recientes por lotes. Para evitar consultas
      // costosas en chats largos, cada chat se consulta una vez.
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        const rows = await Promise.all(chunk.map(async (id) => {
          const { data, error } = await supabase.from("messages")
            .select("sender,direction,response_origin")
            .eq("conversation_id", id)
            .order("created_at", { ascending: false })
            .limit(1).maybeSingle();
          if (error) throw error;
          return {id, data};
        }));
        for (const row of rows) if (row.data) {
          result[row.id] = getResponseOrigin(row.data);
        }
      }
      return result;
    },
  });

  // Pedido real = venta cerrada. No utilizar sale_closed ni la última burbuja como prueba exclusiva.
  const { data: inboxOrders, error: inboxOrdersError, isLoading: loadingInboxOrders } = useQuery({
    queryKey: ["inbox-smart-orders", workspaceId, dateConversationIds],
    enabled: Boolean(workspaceId && dateConversationIds?.length),
    queryFn: async () => {
      const ids=dateConversationIds ?? [];
      const all: Array<{id:string;conversation_id:string|null;created_at:string;payment_method:string|null;payment_status:string|null;receipt_url:string|null;status:string|null}> = [];
      for(let i=0;i<ids.length;i+=80){
        const {data,error}=await supabase.from("orders")
          .select("id,conversation_id,created_at,payment_method,payment_status,receipt_url,status")
          .eq("workspace_id",workspaceId!).in("conversation_id",ids.slice(i,i+80));
        if(error)throw error;
        all.push(...(data??[]));
      }
      return all;
    },
  });
  const { data: latestCustomerTexts, error: smartMessagesError, isLoading: loadingSmartMessages }=useQuery({
    queryKey:["inbox-smart-last-customer",workspaceId,dateConversationIds],
    enabled:Boolean(workspaceId && dateConversationIds?.length),
    queryFn:async()=>{
      const result:Record<string,string>={};
      const ids=dateConversationIds??[];
      for(let i=0;i<ids.length;i+=15){
        const batch=await Promise.all(ids.slice(i,i+15).map(async(id)=>{
          const {data,error}=await supabase.from("messages")
            .select("body").eq("conversation_id",id).eq("direction","inbound")
            .order("created_at",{ascending:false}).limit(1).maybeSingle();
          if(error)throw error;
          return {id,body:data?.body??""};
        }));
        for(const item of batch)result[item.id]=item.body;
      }
      return result;
    },
  });
  // Origen del cierre: último mensaje de CONFIRMACIÓN asociado al pedido, no cualquier respuesta posterior.
  const {data: orderClosingOrigins, error: closingOriginsError, isLoading: loadingClosingOrigins}=useQuery({
    queryKey:["inbox-smart-closing-origin",workspaceId,inboxOrders?.map(o=>`${o.id}:${o.created_at}`).join("|")],
    enabled:Boolean(workspaceId && inboxOrders?.length),
    queryFn:async()=>{
      const result:Record<string,"ai"|"code"|"unknown">={};
      const latestByChat=new Map<string,NonNullable<typeof inboxOrders>[number]>();
      for(const order of inboxOrders??[]){
        if(!order.conversation_id || order.status==="cancelado")continue;
        const old=latestByChat.get(order.conversation_id);
        if(!old || order.created_at>old.created_at)latestByChat.set(order.conversation_id,order);
      }
      const all=Array.from(latestByChat.entries());
      for(let i=0;i<all.length;i+=12){
        const batch=await Promise.all(all.slice(i,i+12).map(async([id,order])=>{
          const end=new Date(new Date(order.created_at).getTime()+10*60*1000).toISOString();
          const {data,error}=await supabase.from("messages")
            .select("body,response_origin,status")
            .eq("conversation_id",id).eq("direction","outbound")
            .gte("created_at",order.created_at).lte("created_at",end)
            .order("created_at",{ascending:true}).limit(10);
          if(error)throw error;
          const confirmed=(data??[]).find(m=>m.status!=="failed" && /pedido\s+(?:registrado|confirmado)/i.test(m.body??""));
          return {id,origin:confirmed?.response_origin==="code"?"code":confirmed?.response_origin==="ai"?"ai":"unknown"} as const;
        }));
        for(const item of batch)result[item.id]=item.origin;
      }
      return result;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", activeId],
    enabled: Boolean(activeId),
    queryFn: async () => {
      const pageSize = 1000;

      const loadMessagesPage = async (page: number) => {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", activeId!)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        if (error) throw error;
        return data ?? [];
      };

      // Carga el historial completo del chat, incluso cuando supera las 1000
      // filas que Supabase suele devolver por consulta.
      let page = 0;
      let pageMessages = await loadMessagesPage(page);
      const allMessages = [...pageMessages];

      while (pageMessages.length === pageSize) {
        page += 1;
        pageMessages = await loadMessagesPage(page);
        allMessages.push(...pageMessages);
      }

      return allMessages;
    },
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel("inbox-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["messages"] });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        queryClient.invalidateQueries({ queryKey: ["inbox-reply-origins"] });
        queryClient.invalidateQueries({
          queryKey: ["inbox-conversation-ids-by-message-date"],
        });
        queryClient.invalidateQueries({
          queryKey: ["inbox-conversations-by-message-date"],
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        queryClient.invalidateQueries({
          queryKey: ["inbox-conversations-by-message-date"],
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStatusNow(Date.now());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const knownConversationsById = new Map(
    (conversations ?? []).map((conversation) => [conversation.id, conversation]),
  );

  for (const conversation of dateConversations ?? []) {
    knownConversationsById.set(conversation.id, conversation);
  }

  const allKnownConversations = Array.from(knownConversationsById.values());
  const active =
    allKnownConversations.find((conversation) => conversation.id === activeId) ??
    null;

  const { data: ad } = useQuery({
    queryKey: ["ad", workspaceId, active?.ad_id],
    enabled: Boolean(workspaceId && active?.ad_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ads")
        .select("*, products(name, sales_copy)")
        .eq("workspace_id", workspaceId!)
        .eq("ad_id", active!.ad_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setAdName(ad?.name ?? active?.ad_name ?? "");
    setAdProductId(ad?.product_id ?? active?.product_id ?? "");
  }, [ad?.name, ad?.product_id, active?.ad_name, active?.product_id, active?.ad_id]);

  const saveAd = useMutation({
    mutationFn: async () => {
      const userId = profile?.id;

      if (!workspaceId || !userId || !activeId || !active?.ad_id) {
        throw new Error(
          "Faltan datos del usuario, workspace o anuncio para poder guardarlo.",
        );
      }

      const cleanName = adName.trim();

      if (!cleanName) {
        throw new Error("Escribí el nombre del anuncio.");
      }

      if (!adProductId) {
        throw new Error("Seleccioná un producto.");
      }

      const adPayload = {
        workspace_id: workspaceId,
        user_id: userId,
        ad_id: active.ad_id,
        name: cleanName,
        product_id: adProductId,
        source_url: active.ad_url ?? ad?.source_url ?? null,
        media_url: active.ad_media_url ?? ad?.media_url ?? null,
        media_type: active.ad_media_type ?? ad?.media_type ?? null,
        is_active: true,
      };

      const { error: adError } = await supabase
        .from("ads")
        .upsert(adPayload, {
          onConflict: "workspace_id,ad_id",
        });

      if (adError) {
        throw new Error(`No se pudo guardar el anuncio: ${adError.message}`);
      }

      const { error: conversationError } = await supabase
        .from("conversations")
        .update({
          ad_name: cleanName,
          product_id: adProductId,
        })
        .eq("id", activeId)
        .eq("workspace_id", workspaceId);

      if (conversationError) {
        throw new Error(
          `El anuncio se guardó, pero no se pudo actualizar la conversación: ${conversationError.message}`,
        );
      }
    },

    onSuccess: () => {
      toast.success(ad ? "Anuncio actualizado correctamente" : "Anuncio registrado correctamente");

      queryClient.invalidateQueries({
        queryKey: ["ad", workspaceId, active?.ad_id],
      });

      queryClient.invalidateQueries({
        queryKey: ["conversations", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["dashboard", workspaceId],
      });
    },

    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!activeId || !draft.trim()) return;
      await sendManualMessage({ data: { conversationId: activeId, body: draft.trim() } });
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAi = useMutation({
    mutationFn: async (paused: boolean) => {
      if (!activeId) return;
      const { error } = await supabase
        .from("conversations")
        .update({ ai_paused: paused })
        .eq("id", activeId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });

  const toggleLabel = useMutation({
    mutationFn: async (labelId: string) => {
      if (!activeId || !workspaceId || !profile) return;
      const existing = active?.conversation_labels.find((l) => l.label_id === labelId);
      if (existing) {
        const { error } = await supabase
          .from("conversation_labels")
          .delete()
          .eq("conversation_id", activeId)
          .eq("label_id", labelId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("conversation_labels").insert({
          workspace_id: workspaceId,
          user_id: profile.id,
          conversation_id: activeId,
          label_id: labelId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const registerRecovery = useMutation({
    mutationFn: async () => {
      if(!activeId)throw new Error("Seleccioná una conversación");
      const result=await registerPendingSale({data:{
        conversationId:activeId,productId:recovery.productId,
        optionId:recovery.optionId||null,promoCount:Number(recovery.promoCount),
        customerName:recovery.customerName,city:recovery.city,department:recovery.department,
        street:recovery.street,paymentMethod:recovery.paymentMethod,
        sourceMessageId:recovery.sourceMessageId,
      }});
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Venta registrada: ${result.orderNumber}`);
      setRecoverOpen(false);
      for(const key of ["conversations","inbox-smart-orders","inbox-smart-closing-origin","messages"])
        queryClient.invalidateQueries({queryKey:[key]});
    },
    onError:(e:Error)=>toast.error(e.message),
  });

  const aiNow = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await aiReplyNow({ data: { conversationId: activeId } });
    },
    onSuccess: () => {
      toast.success("Respuesta enviada");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unreadCandidates = allKnownConversations.filter(
    (conversation) =>
      Number(conversation.unread_count ?? 0) > 0 &&
      !conversation.ai_paused &&
      !conversation.sale_closed,
  );

  const unreadCandidatesSignature = unreadCandidates
    .map(
      (conversation) =>
        `${conversation.id}:${conversation.last_message_at ?? ""}:${conversation.unread_count ?? 0}`,
    )
    .join("|");

  useEffect(() => {
    let cancelled = false;

    if (!workspaceId || unreadCandidates.length === 0) {
      setVerifiedPendingIds([]);
      setAiUnansweredSince({});
      setIsCheckingPending(false);
      return () => {
        cancelled = true;
      };
    }

    setIsCheckingPending(true);

    const verifyPendingConversations = async () => {
      const confirmedPendingIds: string[] = [];
      const unansweredAi: Record<string, string> = {};
      const batchSize = 10;

      // Mirar mensajes reales, no solo unread_count ni conversations.last_message_at.
      // Un copy, foto o plantilla saliente por código también cuenta como respuesta
      // para ese inbound: NO es un fallo de IA.
      for (let index = 0; index < unreadCandidates.length; index += batchSize) {
        if (cancelled) return;
        const batch = unreadCandidates.slice(index, index + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (conversation) => {
            const { data: recentMessages, error } = await supabase
              .from("messages")
              .select("id,direction,sender,response_origin,status,created_at")
              .eq("workspace_id", workspaceId)
              .eq("conversation_id", conversation.id)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(40);
            if (error) throw error;

            const rows = recentMessages ?? [];
            // Mantener exactamente la definición original de pendiente:
            // el último mensaje del chat tiene que venir del cliente.
            if (rows[0]?.direction !== "inbound") return null;
            const lastCustomer = rows.find(
              (message) => message.direction === "inbound" && message.sender === "customer",
            );
            if (!lastCustomer) return null;
            const lastInboundTime = Date.parse(lastCustomer.created_at);
            if (!Number.isFinite(lastInboundTime)) return null;

            // Un envío exitoso posterior (IA, humano o código con copy/imagen)
            // resuelve el turno. Empates de timestamp se toman como respondidos
            // para evitar alarmas falsas por inserciones muy próximas.
            const laterOutbound = rows.filter((message) =>
              message.direction === "outbound" &&
              Date.parse(message.created_at) >= lastInboundTime,
            );
            const validOutbound = laterOutbound.some((message) => {
              const status = String(message.status ?? "").toLowerCase();
              return !status || ["sent", "delivered", "read"].includes(status);
            });
            if (validOutbound) return null;

            const pending = { id: conversation.id, lastInboundAt: lastCustomer.created_at };

            // Si lo que falló fue exclusivamente el envío técnico del copy/imagen,
            // no atribuirlo falsamente al modelo de IA.
            const failedCodeOnly = laterOutbound.some((message) =>
              message.response_origin === "code" &&
              ["failed", "error"].includes(String(message.status ?? "").toLowerCase()),
            ) && !laterOutbound.some((message) =>
              message.response_origin === "ai" || message.sender === "ai",
            );
            if (failedCodeOnly) return { ...pending, aiExpected: false };

            // Solo una conversación que ya tuvo atención anterior o un intento
            // explícito de IA permite inferir que el siguiente turno requería IA.
            // Sin esa evidencia podría tratarse del PRIMER copy/imagen por código.
            const previousOutbound = rows.some((message) =>
              message.direction === "outbound" &&
              Date.parse(message.created_at) < lastInboundTime &&
              !["failed", "error"].includes(String(message.status ?? "").toLowerCase()),
            );
            const failedAiAttempt = laterOutbound.some((message) =>
              message.response_origin === "ai" || message.sender === "ai",
            );
            return { ...pending, aiExpected: previousOutbound || failedAiAttempt };
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            confirmedPendingIds.push(result.value.id);
            if (result.value.aiExpected) {
              unansweredAi[result.value.id] = result.value.lastInboundAt;
            }
          } else if (result.status === "rejected") {
            console.error("No se pudo comprobar si la IA dejó de responder:", result.reason);
          }
        }
      }

      if (!cancelled) {
        setVerifiedPendingIds(confirmedPendingIds);
        setAiUnansweredSince(unansweredAi);
        setIsCheckingPending(false);
      }
    };

    void verifyPendingConversations();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, unreadCandidatesSignature]);

  const verifiedPendingIdSet = new Set(verifiedPendingIds ?? []);
  const pendingCandidates = unreadCandidates.filter((conversation) =>
    verifiedPendingIdSet.has(conversation.id),
  );

  const removeVerifiedPendingIds = (conversationIds: string[]) => {
    if (conversationIds.length === 0) return;

    const resolvedIds = new Set(conversationIds);

    setVerifiedPendingIds((current) =>
      current?.filter((conversationId) => !resolvedIds.has(conversationId)) ??
      current,
    );
  };

  const aiReplyAll = useMutation({
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("No se encontró el workspace.");
      }

      if (pendingCandidates.length === 0) {
        return { total: 0, responded: 0, skipped: 0, failed: 0 };
      }

      let responded = 0;
      let skipped = 0;
      let failed = 0;
      const batchSize = 5;

      // La comprobación exacta se hace únicamente al presionar el botón.
      // Solo responde si el último mensaje real de ese chat es del cliente.
      for (let index = 0; index < pendingCandidates.length; index += batchSize) {
        const batch = pendingCandidates.slice(index, index + batchSize);

        const results = await Promise.allSettled(
          batch.map(async (conversation) => {
            const { data: lastMessage, error } = await supabase
              .from("messages")
              .select("direction")
              .eq("conversation_id", conversation.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (error) throw error;

            if (!lastMessage || lastMessage.direction !== "inbound") {
              return {
                status: "skipped" as const,
                conversationId: conversation.id,
              };
            }

            const recovery = await aiReplyNow({
              data: { conversationId: conversation.id },
            });
            if ("skipped" in recovery && recovery.skipped) return {status:"skipped" as const,conversationId:conversation.id};

            return {
              status: "responded" as const,
              conversationId: conversation.id,
            };
          }),
        );

        const resolvedInThisBatch: string[] = [];

        results.forEach((result) => {
          if (result.status === "rejected") {
            failed += 1;
            console.error("Error al responder una conversación pendiente:", result.reason);
          } else if (result.value.status === "responded") {
            responded += 1;
            resolvedInThisBatch.push(result.value.conversationId);
          } else {
            skipped += 1;
            resolvedInThisBatch.push(result.value.conversationId);
          }
        });

        // Actualiza el KPI después de cada tanda para que el número vaya bajando
        // inmediatamente, sin esperar a que termine todo el proceso.
        removeVerifiedPendingIds(resolvedInThisBatch);
      }

      return {
        total: pendingCandidates.length,
        responded,
        skipped,
        failed,
      };
    },
    onSuccess: (result) => {
      if (result.total === 0) {
        toast.info("No hay respuestas pendientes");
      } else if (result.failed > 0) {
        toast.warning(
          `Respondidas: ${result.responded} · Omitidas: ${result.skipped} · Fallaron: ${result.failed}`,
        );
      } else if (result.responded === 0) {
        toast.info("No se encontraron chats cuyo último mensaje sea del cliente");
      } else {
        toast.success(
          `Respuestas IA enviadas en ${result.responded} conversación${result.responded === 1 ? "" : "es"}`,
        );
      }

      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => {
      toast.error(`No se pudieron responder los chats pendientes: ${error.message}`);
    },
  });

  const codeReplyAll = useMutation({
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("No se encontró el workspace.");
      }

      if (pendingCandidates.length === 0) {
        return { total: 0, responded: 0, skipped: 0, failed: 0 };
      }

      let responded = 0;
      let skipped = 0;
      let failed = 0;
      const batchSize = 5;

      // La comprobación exacta se hace únicamente al presionar el botón.
      // Solo responde si el último mensaje real de ese chat es del cliente.
      for (let index = 0; index < pendingCandidates.length; index += batchSize) {
        const batch = pendingCandidates.slice(index, index + batchSize);

        const results = await Promise.allSettled(
          batch.map(async (conversation) => {
            const { data: lastMessage, error } = await supabase
              .from("messages")
              .select("direction")
              .eq("conversation_id", conversation.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (error) throw error;

            if (!lastMessage || lastMessage.direction !== "inbound") {
              return {
                status: "skipped" as const,
                conversationId: conversation.id,
              };
            }

            const recovery = await aiReplyNow({
              data: { conversationId: conversation.id },
            });
            if (recovery.skipped) return {status:"skipped" as const,conversationId:conversation.id};

            return {
              status: "responded" as const,
              conversationId: conversation.id,
            };
          }),
        );

        const resolvedInThisBatch: string[] = [];

        results.forEach((result) => {
          if (result.status === "rejected") {
            failed += 1;
            console.error("Error al recuperar conversación con IA:", result.reason);
          } else if (result.value.status === "responded") {
            responded += 1;
            resolvedInThisBatch.push(result.value.conversationId);
          } else {
            skipped += 1;
            resolvedInThisBatch.push(result.value.conversationId);
          }
        });

        // Actualiza el KPI después de cada tanda para que el número vaya bajando
        // inmediatamente, sin esperar a que termine todo el proceso.
        removeVerifiedPendingIds(resolvedInThisBatch);
      }

      return {
        total: pendingCandidates.length,
        responded,
        skipped,
        failed,
      };
    },
    onSuccess: (result) => {
      if (result.total === 0) {
        toast.info("No hay respuestas pendientes");
      } else if (result.failed > 0) {
        toast.warning(
          `Respondidas: ${result.responded} · Omitidas: ${result.skipped} · Fallaron: ${result.failed}`,
        );
      } else if (result.responded === 0) {
        toast.info("No se encontraron chats cuyo último mensaje sea del cliente");
      } else {
        toast.success(
          `Recuperadas por código: ${result.responded} conversación${result.responded === 1 ? "" : "es"}`,
        );
      }

      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error: Error) => {
      toast.error(`No se pudieron recuperar los chats por código: ${error.message}`);
    },
  });

  const removeMessages = useMutation({
    mutationFn: async (ids: string[]) => {
      await deleteMessages({ data: { ids } });
    },
    onSuccess: (_d, ids) => {
      setSelected([]);
      toast.success(ids.length > 1 ? `${ids.length} mensajes eliminados` : "Mensaje eliminado");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteConversation = useMutation({
    mutationFn: async () => {
      if (!activeId || !workspaceId) return;

      const conversationId = activeId;

      const { error: labelsError } = await supabase
        .from("conversation_labels")
        .delete()
        .eq("conversation_id", conversationId);

      if (labelsError) throw labelsError;

      const { error: messagesError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", conversationId);

      if (messagesError) throw messagesError;

      const { error: conversationError } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId)
        .eq("workspace_id", workspaceId);

      if (conversationError) throw conversationError;
    },
    onSuccess: () => {
      setActiveId(null);
      setSelected([]);
      setDraft("");
      toast.success("Chat eliminado");

      queryClient.removeQueries({ queryKey: ["messages", activeId] });
      queryClient.invalidateQueries({ queryKey: ["conversations", workspaceId] });
    },
    onError: (e: Error) => {
      toast.error(`No se pudo eliminar el chat: ${e.message}`);
    },
  });

  const sendFile = useMutation({
    mutationFn: async (file: File) => {
      if (!activeId || !workspaceId) return;
      if (file.size > MAX_FILE_BYTES) throw new Error("El archivo supera los 25 MB");
      const mediaType = guessMediaType(file) as "image" | "video" | "audio" | "document";
      const path = await uploadWorkspaceFile("chat-media", workspaceId, file, "outbound");
      await sendMediaMessage({
        data: { conversationId: activeId, storagePath: path, mediaType },
      });
    },
    onSuccess: () => {
      toast.success("Archivo enviado");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendCatalog = useMutation({
    mutationFn: async (productId: string) => {
      if (!activeId) return;
      await sendProductCatalog({ data: { conversationId: activeId, productId } });
    },
    onSuccess: () => {
      toast.success("Catálogo enviado");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transcribe = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await transcribeMessage({ data: { messageId } });
      return res.transcript;
    },
    onSuccess: () => {
      toast.success("Transcripción lista");
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    setSelected([]);
  }, [activeId]);


  const possibleAiFailures = inboxAiSettings?.ai_enabled === true && !isCheckingPending
    ? pendingCandidates.filter((conversation) => {
        const lastCustomerAt = aiUnansweredSince[conversation.id];
        if (!lastCustomerAt) return false;
        const inboundTime = Date.parse(lastCustomerAt);
        return Number.isFinite(inboundTime) && statusNow - inboundTime > 6 * 60 * 1000;
      })
    : [];

  const hasPossibleAiFailure = possibleAiFailures.length > 0;
  const aiAlertShownRef = useRef(false);

  useEffect(() => {
    if (hasPossibleAiFailure && !aiAlertShownRef.current) {
      toast.warning(
        `Posible fallo de IA: ${possibleAiFailures.length} conversación${
          possibleAiFailures.length === 1 ? "" : "es"
        } lleva${possibleAiFailures.length === 1 ? "" : "n"} más de 6 minutos pendiente${
          possibleAiFailures.length === 1 ? "" : "s"
        }`,
      );
      aiAlertShownRef.current = true;
    }

    if (!hasPossibleAiFailure) {
      aiAlertShownRef.current = false;
    }
  }, [hasPossibleAiFailure, possibleAiFailures.length]);

  const ordersByConversation = new Map<string, NonNullable<typeof inboxOrders>>();
  for(const order of inboxOrders??[]){
    if(!order.conversation_id || order.status==="cancelado")continue;
    const existing=ordersByConversation.get(order.conversation_id)??[];
    existing.push(order);
    ordersByConversation.set(order.conversation_id,existing);
  }
  const getSmartCategories=(c:NonNullable<typeof dateConversations>[number])=>{
    const sales=ordersByConversation.get(c.id)??[];
    const hasSale=sales.length>0;
    const customerText=latestCustomerTexts?.[c.id]??"";
    const topic=messageTopic(customerText);
    const advance=sales.some(isAdvanceOrder);
    const origin=orderClosingOrigins?.[c.id]??"unknown";
    return {
      potential:!hasSale && Boolean(c.product_id || c.ad_id || /(?:precio|quiero|comprar|cuanto|pedido|envio|llevar)/.test(normalizeSmartText(customerText))),
      order_query:topic==="order" && hasSale,
      complaints:topic==="complaint",
      advance,
      closed:hasSale,
      closed_ai:hasSale && origin==="ai",
      closed_code:hasSale && origin==="code",
      review:topic==="order" && !hasSale || hasSale && origin==="unknown" || !hasSale && !Boolean(c.product_id || c.ad_id) && topic!=="complaint",
    };
  };
  const smartCounts=Object.fromEntries(SMART_TABS.map(tab=>[
    tab.id,tab.id==="all"?(dateConversations??[]).length:(dateConversations??[]).filter(c=>getSmartCategories(c)[tab.id as Exclude<SmartTab,"all">]).length,
  ])) as Record<SmartTab,number>;

  const filtered = (dateConversations ?? []).filter((c) => {
    const q = search.trim().toLowerCase();

    const matchesSearch =
      !q ||
      (c.contacts?.name ?? "").toLowerCase().includes(q) ||
      (c.contacts?.phone ?? "").includes(q) ||
      (c.last_message ?? "").toLowerCase().includes(q);

    const matchesLabel =
      selectedLabelId === "all" ||
      c.conversation_labels.some(
        (conversationLabel) =>
          conversationLabel.label_id === selectedLabelId,
      );

    const matchesSmartTab=smartTab==="all" || getSmartCategories(c)[smartTab];
    return matchesSearch && matchesLabel && matchesSmartTab;
  });

  const resetFilters = () => {
    const today = getTodayDate();
    setSearch("");
    setDateFrom(today);
    setDateTo(today);
    setSelectedLabelId("all");
    setSmartTab("all");
  };

  const heroSales = (todayOfficeOrders ?? []).filter(order => order.status !== "cancelado");
  const heroSalesTotal = heroSales.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  return (
    <div className="relative flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden bg-gradient-to-br from-background via-background to-sky-500/[.035]">
      {/* Cabecera premium. Todos los contadores provienen del Inbox, no son simulados. */}
      <div className="flex min-h-[52px] shrink-0 items-center gap-3 border-b border-sky-500/15 bg-gradient-to-r from-[#0c2341] via-[#142e55] to-[#092a3f] px-3 py-2 text-white shadow-sm sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-sky-200 shadow-inner"><MessageSquare className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold tracking-wide sm:text-base">{inboxWorkspace?.name?.trim() || 'Mi tienda'} <span className="font-medium text-sky-200">· Inbox PRO</span></p>
          <p className="hidden truncate text-[11px] text-sky-100/70 sm:block">Centro de atención · WhatsApp · IA · Pedidos</p>
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <div className="min-w-[92px] rounded-xl border border-white/10 bg-white/10 px-3 py-1.5"><p className="text-[10px] text-sky-100/75">Conversaciones</p><p className="text-lg font-bold tabular-nums">{smartCounts.all}</p></div>
          <div className="min-w-[92px] rounded-xl border border-white/10 bg-white/10 px-3 py-1.5"><p className="text-[10px] text-sky-100/75">Pendientes</p><p className="text-lg font-bold tabular-nums">{pendingCandidates.length}</p></div>
          <div className="min-w-[105px] rounded-xl border border-white/10 bg-white/10 px-3 py-1.5"><p className="text-[10px] text-sky-100/75">Ventas registradas</p><p className="text-lg font-bold tabular-nums">{smartCounts.closed}</p></div>
        </div>
        <button type="button" onClick={() => setSmallOfficeOpen(true)} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-sky-300/25 bg-white/10 px-3 py-2 text-xs font-bold text-sky-50 transition hover:bg-white/15 2xl:hidden" aria-label="Abrir oficina y resumen de hoy"><Layers3 className="h-4 w-4"/><span className="hidden md:inline">Resumen de hoy</span></button>
        <span className={cn('hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold sm:inline-flex', hasPossibleAiFailure?'border-rose-400/35 bg-rose-400/15 text-rose-100':'border-emerald-400/25 bg-emerald-400/10 text-emerald-100')}>
          <span className={cn('h-1.5 w-1.5 rounded-full',hasPossibleAiFailure?'bg-rose-400':'bg-emerald-400')} />
          {hasPossibleAiFailure?'Revisar IA':'Sin alertas IA'}
        </span>
      </div>
      {showPanoramaOffice ? (
        <InboxPanoramicOffice businessName={inboxWorkspace?.name?.trim() || "Mi tienda"}
          recentActivity={officeActivity} pending={pendingCandidates.length}
          salesCount={heroSales.length} amount={heroSalesTotal}
          onHide={() => setShowPanoramaOffice(false)} />
      ) : (
        <div className="hidden shrink-0 items-center justify-between border-b border-sky-500/20 bg-[#0b2038] px-4 py-1.5 text-xs text-sky-100 md:flex">
          <span className="flex items-center gap-2"><Layers3 className="h-3.5 w-3.5 text-sky-300" /> Oficina de {inboxWorkspace?.name?.trim() || "Mi tienda"} · {heroSales.length} pedidos registrados hoy</span>
          <button type="button" onClick={() => setShowPanoramaOffice(true)} className="rounded-lg border border-sky-300/20 px-2.5 py-1 font-semibold hover:bg-white/10">Mostrar oficina 3D</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "flex min-h-0 w-full shrink-0 flex-col border-r border-sky-500/15 bg-card/85 shadow-[4px_0_20px_rgba(15,23,42,.035)] sm:w-64 lg:w-[290px] xl:w-[315px] 2xl:w-[330px]",
          activeId && "hidden sm:flex",
        )}
      >
        <div className="max-h-[min(52vh,390px)] shrink-0 space-y-2 overflow-y-auto border-b border-sky-500/15 bg-gradient-to-b from-sky-500/[.065] to-card/60 p-2.5 backdrop-blur [scrollbar-width:thin]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-sky-500/20 bg-background/85 p-3 shadow-sm">
              <p className="text-[11px] font-medium text-muted-foreground">
                Respuestas pendientes
              </p>
              <p className="mt-1 text-2xl font-bold">
                {isCheckingPending ? "…" : pendingCandidates.length}
              </p>
            </div>

            <div
              className={cn(
                "rounded-2xl border p-3 shadow-sm",
                isCheckingPending
                  ? "border-border bg-muted/40"
                  : hasPossibleAiFailure
                  ? "border-destructive/50 bg-destructive/10"
                  : "border-emerald-500/30 bg-emerald-500/10",
              )}
            >
              <p className="text-[11px] font-medium text-muted-foreground">Estado IA</p>
              <p
                className={cn(
                  "mt-1 text-sm font-bold",
                  isCheckingPending
                    ? "text-muted-foreground"
                    : hasPossibleAiFailure
                      ? "text-destructive"
                      : "text-emerald-600",
                )}
              >
                {isCheckingPending
                  ? "Verificando..."
                  : hasPossibleAiFailure
                    ? "Posible fallo"
                    : "Sin alertas"}
              </p>
            </div>
          </div>

          {hasPossibleAiFailure && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              <div className="flex items-start gap-2">
                <BotOff className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Posible fallo de la IA</p>
                  <p className="mt-1">
                    {possibleAiFailures.length} conversación{
                      possibleAiFailures.length === 1 ? "" : "es"
                    } lleva{possibleAiFailures.length === 1 ? "" : "n"} más de 6 minutos sin respuesta de IA tras el último mensaje del cliente. Los copies e imágenes enviados por código no cuentan como fallos.
                  </p>
                </div>
              </div>
            </div>
          )}

          <details className="group overflow-hidden rounded-xl border border-sky-500/15 bg-background/45">
            <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-sky-600 dark:text-sky-200">⚡ Acciones de recuperación de chats</summary>
            <div className="space-y-2 px-2 pb-2">
          <Button
            type="button"
            className="h-auto min-h-10 w-full whitespace-normal px-3 py-2 text-center text-xs"
            disabled={isCheckingPending || aiReplyAll.isPending || codeReplyAll.isPending || pendingCandidates.length === 0}
            onClick={() => {
              if (!pendingCandidates.length) { toast.info("No hay respuestas pendientes"); return; }
              if (window.confirm(`Se intentará responder con IA a ${pendingCandidates.length} conversación(es). Esta opción consume créditos de IA. ¿Continuar?`)) {
                aiReplyAll.mutate();
              }
            }}
          >
            {isCheckingPending || aiReplyAll.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {aiReplyAll.isPending ? "Respondiendo con IA..." : `Responder pendientes con IA (${pendingCandidates.length})`}
          </Button>

          <Button
            type="button"
            className="h-auto min-h-10 w-full whitespace-normal break-words px-3 py-2 text-center text-[11px] font-bold leading-snug bg-lime-500 text-slate-950 hover:bg-lime-400"
            disabled={isCheckingPending || codeReplyAll.isPending || aiReplyAll.isPending || pendingCandidates.length === 0}
            onClick={() => {
              if (!pendingCandidates.length) { toast.info("No hay respuestas pendientes"); return; }
              if (window.confirm(`Se intentará recuperar ${pendingCandidates.length} conversación(es) SOLO mediante código, sin utilizar la API de IA. Las consultas que no puedan resolverse con reglas quedarán pendientes. ¿Continuar?`)) {
                codeReplyAll.mutate();
              }
            }}
          >
            {isCheckingPending || codeReplyAll.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            {codeReplyAll.isPending ? "Recuperando por código..." : `⚡ RECUPERAR VENTAS Y CHATS POR CÓDIGO (${pendingCandidates.length})`}
          </Button>

            </div>
          </details>

          {/* Pestañas de atención: no modifican ni mueven mensajes en la base. */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">Organizar conversaciones</p>
            <div className="flex max-h-[104px] flex-wrap content-start gap-1.5 overflow-y-auto [scrollbar-width:thin]">
              {SMART_TABS.map(tab=>(
                <button key={tab.id} type="button" onClick={()=>setSmartTab(tab.id)}
                  aria-pressed={smartTab===tab.id}
                  className={cn("max-w-full whitespace-normal break-words rounded-lg border px-2 py-1.5 text-[11px] font-semibold leading-snug transition-colors",
                    smartTab===tab.id?"border-primary bg-primary text-primary-foreground":"border-border bg-background hover:bg-accent")}
                >{tab.icon} {tab.label} ({smartCounts[tab.id]??0})</button>
              ))}
            </div>
            {(loadingInboxOrders || loadingSmartMessages || loadingClosingOrigins) &&
              <p className="text-[11px] text-muted-foreground">Clasificando mensajes y verificando pedidos…</p>}
            {(inboxOrdersError || smartMessagesError || closingOriginsError) &&
              <p className="text-[11px] text-destructive">No se pudo completar la clasificación. Revisá permisos de pedidos y mensajes.</p>}
            <p className="text-[10px] text-muted-foreground">Las categorías pueden superponerse. El origen del cierre se muestra solo cuando se puede verificar.</p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por nombre, teléfono o mensaje"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button type="button" onClick={() => setShowAdvancedInboxFilters(value => !value)}
            className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-background/55 px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            aria-expanded={showAdvancedInboxFilters}>
            <span><Tag className="mr-1 inline h-3 w-3"/> Filtrar por fecha y etiqueta</span>
            <span>{showAdvancedInboxFilters ? "Ocultar −" : "Mostrar +"}</span>
          </button>
          {showAdvancedInboxFilters && <div className="space-y-2 rounded-xl border border-border/70 bg-background/30 p-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Desde
              </span>
              <Input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  const value = event.target.value;
                  setDateFrom(value);
                  if (value > dateTo) setDateTo(value);
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Hasta
              </span>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => {
                  const value = event.target.value;
                  setDateTo(value);
                  if (value < dateFrom) setDateFrom(value);
                }}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <label className="min-w-0 flex-1 space-y-1">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Tag className="h-3.5 w-3.5" /> Etiqueta
              </span>
              <select
                value={selectedLabelId}
                onChange={(event) => setSelectedLabelId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="all">Todas las etiquetas</option>
                {labels?.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-5 shrink-0"
              onClick={resetFilters}
              title="Restablecer filtros"
              aria-label="Restablecer filtros"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          </div>}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {isLoadingDateFilter
                ? "Buscando mensajes del período..."
                : `Mostrando ${filtered.length} conversación${
                    filtered.length === 1 ? "" : "es"
                  }`}
            </span>
            <span>{dateFrom === dateTo ? dateFrom : `${dateFrom} — ${dateTo}`}</span>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {dateFilterError && (
            <p className="p-4 text-sm text-destructive">
              No se pudieron cargar los mensajes de la fecha seleccionada. Volvé a intentar.
            </p>
          )}
          {!dateFilterError && isLoadingDateFilter && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando todos los mensajes de la fecha seleccionada...
            </div>
          )}
          {!dateFilterError && !isLoadingDateFilter && filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No hay conversaciones que coincidan con los filtros.</p>
          )}
          {!dateFilterError && !isLoadingDateFilter && filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                "mx-1 my-1 flex w-[calc(100%_-_0.5rem)] flex-col gap-1 rounded-xl border border-transparent px-3 py-3 text-left transition-all hover:border-sky-500/20 hover:bg-sky-500/[.055]",
                activeId === c.id && "!border-sky-500/30 !bg-sky-500/10 shadow-sm ring-1 ring-sky-500/10",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {c.contacts?.name || c.contacts?.phone}
                </span>
                {c.unread_count > 0 && (
                  <Badge className="h-5 min-w-5 justify-center px-1 text-[10px]">
                    {c.unread_count}
                  </Badge>
                )}
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {c.last_message || "Sin mensajes"}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                 {lastReplyOrigins?.[c.id] === "code" && <span className="rounded-md border border-lime-400 bg-lime-500/25 px-2 py-0.5 text-[10px] font-bold text-lime-200">⚡ RESPONDIDO POR CÓDIGO</span>}
                 {lastReplyOrigins?.[c.id] === "ai" && <span className="rounded-md border border-sky-400 bg-sky-500/25 px-2 py-0.5 text-[10px] font-bold text-sky-200">✦ RESPONDIDO POR IA</span>}
                 {lastReplyOrigins?.[c.id] === "human" && <span className="rounded-md border border-orange-400 bg-orange-500/25 px-2 py-0.5 text-[10px] font-bold text-orange-200">👤 HUMANO</span>}
                 {lastReplyOrigins?.[c.id] === "incoming" && <span className="rounded-md border border-red-400 bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-200">● CLIENTE ESPERANDO</span>}
                 {lastReplyOrigins?.[c.id] === "unknown" && <span className="rounded-md border border-slate-400 bg-slate-500/20 px-2 py-0.5 text-[10px] text-slate-200">AUTOMÁTICO · SIN ORIGEN</span>}
                 {getSmartCategories(c).complaints && <span className="rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">🚨 Reclamo</span>}
                 {getSmartCategories(c).order_query && <span className="rounded border border-blue-500/40 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">📦 Consulta pedido</span>}
                 {getSmartCategories(c).advance && <span className="rounded border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">💳 Anticipado</span>}
                 {getSmartCategories(c).closed && <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">✅ Venta registrada</span>}
                 {getSmartCategories(c).potential && <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">🛒 Potencial</span>}
                 {Boolean(ordersByConversation.get(c.id)?.length) && (
                  <Badge variant="default" className="text-[10px]">
                    ✅ VENTA
                  </Badge>
                )}
                {c.ad_id && (
                  <Badge variant="secondary" className="text-[10px]">
                    anuncio
                  </Badge>
                )}
                {c.ai_paused && (
                  <Badge variant="outline" className="text-[10px]">
                    IA pausada
                  </Badge>
                )}
                {c.conversation_labels.map((l) => (
                  <span
                    key={l.label_id}
                    className="rounded-full px-1.5 py-0.5 text-[10px] text-background"
                    style={{ backgroundColor: l.labels?.color ?? "#64748b" }}
                  >
                    {l.labels?.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </ScrollArea>
      </aside>

      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background/70", !activeId && "hidden sm:flex")}>
        {!active ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-7">
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-[24px] border border-sky-500/15 bg-card/85 px-8 py-10 text-center shadow-[0_16px_40px_rgba(0,0,0,.08)]"><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-400/25 bg-sky-400/10"><MessageSquare className="h-8 w-8 text-sky-500"/></div><div><h2 className="text-xl font-extrabold">Tu centro de atención está listo</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Seleccioná una conversación para responder. La oficina animada está arriba y el resumen real de pedidos a la derecha.</p></div></div>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b border-sky-500/15 bg-card/80 p-3 shadow-sm backdrop-blur">
              <Button
                variant="ghost"
                size="sm"
                className="sm:hidden"
                onClick={() => setActiveId(null)}
              >
                Volver
              </Button>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {active.contacts?.name || active.contacts?.phone}
                </p>
                <p className="text-xs text-muted-foreground">
                  {active.contacts?.phone}
                  {active.contacts?.city ? ` · ${active.contacts.city}` : ""}
                  {active.products?.name ? ` · ${active.products.name}` : ""}
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setInfoOpen(true)}>
                  <User className="mr-1 h-4 w-4" /> Info
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteConversation.isPending}
                  onClick={() => {
                    const confirmed = window.confirm(
                      "¿Seguro que quieres borrar este chat? Se eliminarán todos sus mensajes.",
                    );

                    if (confirmed) {
                      deleteConversation.mutate();
                    }
                  }}
                >
                  {deleteConversation.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-4 w-4" />
                  )}
                  Borrar chat
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" disabled={sendCatalog.isPending}>
                      {sendCatalog.isPending ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <ShoppingBag className="mr-1 h-4 w-4" />
                      )}
                      Catálogo
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-1">
                    {!products?.length && (
                      <p className="text-sm text-muted-foreground">Crea productos primero.</p>
                    )}
                    {products?.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => sendCatalog.mutate(p.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{p.name}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <Popover>

                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Tag className="mr-1 h-4 w-4" /> Etiquetas
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 space-y-1">
                    {!labels?.length && (
                      <p className="text-sm text-muted-foreground">Crea etiquetas primero.</p>
                    )}
                    {labels?.map((l) => {
                      const on = active.conversation_labels.some((cl) => cl.label_id === l.id);
                      return (
                        <button
                          key={l.id}
                          onClick={() => toggleLabel.mutate(l.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
                            on && "bg-accent",
                          )}
                        >
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: l.color }}
                          />
                          {l.name}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => aiNow.mutate()}
                  disabled={aiNow.isPending}
                >
                  {aiNow.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  Responder IA
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const customerMessages=(messages??[]).filter(m=>m.direction==="inbound");
                  const latestCustomer=customerMessages.at(-1);
                  setRecovery({productId:active.product_id??"",optionId:"",promoCount:1,
                    customerName:active.contacts?.name??"",city:active.contacts?.city??"",
                    department:"",street:"",paymentMethod:"contraentrega",
                    sourceMessageId:latestCustomer?.id??""});
                  setRecoverOpen(true);
                }}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Registrar venta pendiente
                </Button>
                <Button
                  variant={active.ai_paused ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleAi.mutate(!active.ai_paused)}
                >
                  {active.ai_paused ? (
                    <>
                      <Bot className="mr-1 h-4 w-4" /> Reactivar IA
                    </>
                  ) : (
                    <>
                      <BotOff className="mr-1 h-4 w-4" /> Pausar IA
                    </>
                  )}
                </Button>
                {Boolean(ordersByConversation.get(active.id)?.length) && (
                  <Badge>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> ✅ VENTA
                  </Badge>
                )}
              </div>
            </header>

            {recoverOpen && (
              <div className="border-b border-border bg-card p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <strong>Recuperar venta — revisá los datos antes de guardar</strong>
                  <Button size="sm" variant="ghost" onClick={()=>setRecoverOpen(false)}><X className="h-4 w-4" /></Button>
                </div>
                <p className="text-xs text-muted-foreground">No envía un WhatsApp automáticamente. Registra un pedido real y comprueba duplicados, ciudad, modalidad y precio. Si la dirección es obligatoria, debe completarse.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-xs">Nombre completo<Input value={recovery.customerName} onChange={e=>setRecovery(r=>({...r,customerName:e.target.value}))}/></label>
                  <label className="text-xs">Producto
                    <select className="h-10 w-full rounded-md border bg-background px-2" value={recovery.productId} onChange={e=>setRecovery(r=>({...r,productId:e.target.value,optionId:""}))}>
                      <option value="">Seleccionar producto</option>
                      {(products??[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs">Presentación
                    <select className="h-10 w-full rounded-md border bg-background px-2" value={recovery.optionId} onChange={e=>setRecovery(r=>({...r,optionId:e.target.value}))}>
                      <option value="">{(products??[]).find(p=>p.id===recovery.productId)?.product_prices?.length ? "Seleccionar presentación" : "Sin promociones"}</option>
                      {[...((products??[]).find(p=>p.id===recovery.productId)?.product_prices??[])].sort((a,b)=>a.sort_order-b.sort_order).map(o=><option key={o.id} value={o.id}>{o.label} — Gs. {o.price.toLocaleString("es-PY")}</option>)}
                    </select>
                  </label>
                  <label className="text-xs">Cantidad de paquetes/promociones<Input type="number" min={1} max={25} value={recovery.promoCount} onChange={e=>setRecovery(r=>({...r,promoCount:Number(e.target.value)}))}/></label>
                  <label className="text-xs">Ciudad<Input value={recovery.city} onChange={e=>setRecovery(r=>({...r,city:e.target.value}))}/></label>
                  <label className="text-xs">Departamento<Input value={recovery.department} onChange={e=>setRecovery(r=>({...r,department:e.target.value}))}/></label>
                  <label className="text-xs sm:col-span-2">Dirección o GPS (según modalidad)<Input value={recovery.street} onChange={e=>setRecovery(r=>({...r,street:e.target.value}))}/></label>
                  <label className="text-xs">Forma de pago
                    <select className="h-10 w-full rounded-md border bg-background px-2" value={recovery.paymentMethod} onChange={e=>setRecovery(r=>({...r,paymentMethod:e.target.value as typeof r.paymentMethod}))}>
                      <option value="contraentrega">Pago al recibir</option><option value="anticipado">Pago anticipado</option>
                    </select>
                  </label>
                  <label className="text-xs sm:col-span-2 lg:col-span-3">Mensaje del cliente asociado a esta venta
                    <select className="h-10 w-full rounded-md border bg-background px-2" value={recovery.sourceMessageId} onChange={e=>setRecovery(r=>({...r,sourceMessageId:e.target.value}))}>
                      <option value="">Seleccionar mensaje</option>
                      {(messages??[]).filter(m=>m.direction==="inbound").slice(-50).reverse().map(m=><option key={m.id} value={m.id}>{new Date(m.created_at).toLocaleString("es-PY")} — {String(m.body??"").slice(0,90)}</option>)}
                    </select>
                  </label>
                </div>
                <Button disabled={registerRecovery.isPending || !recovery.productId || !recovery.sourceMessageId || !recovery.customerName.trim() || !recovery.city.trim() || !recovery.department.trim() || !(products??[]).find(p=>p.id===recovery.productId) || Boolean((products??[]).find(p=>p.id===recovery.productId)?.product_prices?.length && !recovery.optionId)} onClick={()=>{
                  if(window.confirm("¿Confirmás que verificaste la conversación y que esta compra NO está ya registrada? Se creará el pedido en Supabase."))registerRecovery.mutate();
                }}>
                  {registerRecovery.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<CheckCircle2 className="mr-2 h-4 w-4"/>} Guardar pedido real
                </Button>
              </div>
            )}

            {selected.length > 0 && (
              <div className="flex items-center gap-2 border-b border-border bg-accent/50 px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                  <X className="mr-1 h-4 w-4" /> Cancelar
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selected.length} seleccionado{selected.length > 1 ? "s" : ""}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="ml-auto"
                  disabled={removeMessages.isPending}
                  onClick={() => removeMessages.mutate(selected)}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Eliminar
                </Button>
              </div>
            )}

            <ScrollArea className="min-h-0 flex-1 bg-[radial-gradient(circle_at_25%_20%,rgba(56,189,248,.035),transparent_45%),radial-gradient(circle_at_80%_60%,rgba(16,185,129,.025),transparent_45%)] p-4">
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                {active.ad_id && (
                  <div className="mb-2 rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">Registrar anuncio</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ID detectado: <span className="font-mono">{active.ad_id}</span>
                        </p>
                      </div>
                      <Badge variant={ad ? "default" : "secondary"}>
                        {ad ? "Registrado" : "Sin registrar"}
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                      <Input
                        value={adName}
                        onChange={(event) => setAdName(event.target.value)}
                        placeholder="Nombre del anuncio"
                      />

                      <select
                        value={adProductId}
                        onChange={(event) => setAdProductId(event.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="">Seleccionar producto</option>
                        {products?.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>

                      <Button
                        type="button"
                        onClick={() => saveAd.mutate()}
                        disabled={saveAd.isPending || !adName.trim() || !adProductId}
                      >
                        {saveAd.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        {ad ? "Actualizar" : "Guardar"}
                      </Button>
                    </div>
                  </div>
                )}

                {active.ad_id && (
                  <AdOriginCard
                    adId={active.ad_id}
                    mediaUrl={active.ad_media_url ?? ad?.media_url}
                    mediaType={active.ad_media_type ?? ad?.media_type}
                    sourceUrl={active.ad_url ?? ad?.source_url}
                    title={
                      ad?.name ??
                      active.ad_name ??
                      ad?.products?.name ??
                      active.products?.name
                    }
                    copy={ad?.products?.sales_copy ?? active.products?.sales_copy}
                    date={active.created_at}
                  />
                )}

                {messages?.map((m) => {
                  const isSelected = selected.includes(m.id);
                  const googleMapsUrl = getGoogleMapsUrl(m.latitude, m.longitude);
                  const isLocation = Boolean(googleMapsUrl);
                  const toggleSelect = () =>
                    setSelected((prev) =>
                      prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                    );
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "group flex items-center gap-2",
                        m.direction === "inbound" ? "self-start" : "flex-row-reverse self-end",
                        "max-w-[90%]",
                      )}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => selected.length > 0 && toggleSelect()}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleSelect();
                        }}
                        className={cn(
                          "cursor-pointer rounded-2xl px-3 py-2.5 text-sm shadow-sm ring-1 ring-border/20",
                          m.direction === "inbound"
                            ? "rounded-bl-sm bg-card"
                            : "rounded-br-sm bg-primary text-primary-foreground",
                          isSelected && "ring-2 ring-destructive",
                        )}
                      >
                        {m.media_url ? (
                          <div
                            className="mb-1"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ChatMedia path={m.media_url} type={m.media_type} />
                          </div>
                        ) : m.media_type ? (
                          <p className="mb-1 rounded-md bg-background/20 px-2 py-1 text-xs opacity-75">
                            No se encontró el archivo de este mensaje.
                          </p>
                        ) : null}

                        {isLocation && googleMapsUrl ? (
                          <div className="min-w-[230px] space-y-2">
                            <div className="flex items-start gap-2">
                              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-semibold">Ubicación del cliente</p>

                                {m.location_name && (
                                  <p className="mt-1 text-xs">{m.location_name}</p>
                                )}

                                {m.location_address && (
                                  <p className="text-xs opacity-80">{m.location_address}</p>
                                )}

                                <p className="mt-1 break-all text-[10px] opacity-60">
                                  {m.latitude}, {m.longitude}
                                </p>
                              </div>
                            </div>

                            <a
                              href={googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="flex w-full items-center justify-center gap-2 rounded-lg bg-background/20 px-3 py-2 text-xs font-semibold transition-colors hover:bg-background/30"
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              Abrir en Google Maps
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        ) : (
                          m.body &&
                          !(
                            m.media_type === "audio" &&
                            (m.body === "[audio]" || m.body === "[voice]")
                          ) && (
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          )
                        )}

                        {m.transcript && (
                          <div className="mt-1 rounded-md bg-background/20 p-2 text-xs">
                            <p className="mb-0.5 font-medium opacity-80">
                              {m.media_type === "audio" ? "Transcripción" : "Interpretación"}
                            </p>
                            <p className="whitespace-pre-wrap italic opacity-90">{m.transcript}</p>
                          </div>
                        )}

                        {m.media_url &&
                          (m.media_type === "audio" || m.media_type === "image") &&
                          !m.transcript && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                transcribe.mutate(m.id);
                              }}
                              disabled={transcribe.isPending}
                              className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] underline opacity-80 hover:bg-background/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {transcribe.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Wand2 className="h-3 w-3" />
                              )}
                              {m.media_type === "audio"
                                ? "Transcribir con IA"
                                : "Interpretar con IA"}
                            </button>
                          )}
                        <div className="mt-2"><OriginBadge origin={getResponseOrigin(m)} /></div>
                        <p className="mt-1 text-[10px] opacity-70">
                          {getResponseOrigin(m) === "human" ? "Tú · " : ""}
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          aria-label="Seleccionar mensaje"
                          onClick={toggleSelect}
                          className={cn(
                            "h-4 w-4 rounded-full border border-muted-foreground",
                            isSelected && "border-destructive bg-destructive",
                          )}
                        />
                        <button
                          aria-label="Eliminar mensaje"
                          onClick={() => removeMessages.mutate([m.id])}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>


            <footer className="flex items-end gap-2 border-t border-sky-500/15 bg-card/90 p-3 shadow-[0_-5px_18px_rgba(2,8,23,.035)]">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,audio/*,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) sendFile.mutate(file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="icon"
                disabled={sendFile.isPending}
                onClick={() => fileRef.current?.click()}
                aria-label="Adjuntar archivo"
              >
                {sendFile.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </Button>
              <Textarea
                rows={1}
                value={draft}
                placeholder="Escribe un mensaje..."
                className="max-h-32 min-h-10 resize-none"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send.mutate();
                  }
                }}
              />
              <Button onClick={() => send.mutate()} disabled={send.isPending || !draft.trim()}>
                {send.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </footer>

            <ContactInfoDialog
              contactId={active.contact_id}
              open={infoOpen}
              onOpenChange={setInfoOpen}
            />
          </>

        )}
      </section>
      <aside className="hidden h-full min-h-0 w-[290px] shrink-0 border-l border-sky-500/20 xl:flex 2xl:w-[325px]">
        <InboxOperationsPanel businessName={inboxWorkspace?.name?.trim() || "Mi tienda"} orders={todayOfficeOrders ?? []} pending={pendingCandidates.length} totalChats={smartCounts.all} loading={officeLoading} failed={Boolean(officeError)} recentActivity={officeActivity}/>
      </aside>
      </div>
      {smallOfficeOpen && <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm xl:hidden" onClick={() => setSmallOfficeOpen(false)} role="presentation">
        <aside role="dialog" aria-label="Oficina y ventas de hoy" aria-modal="true" className="absolute inset-y-0 right-0 w-[min(420px,94vw)] border-l border-sky-500/20 shadow-2xl" onClick={event=>event.stopPropagation()}>
          <button onClick={() => setSmallOfficeOpen(false)} type="button" className="absolute right-3 top-3 z-30 rounded-lg bg-[#071527] p-2 text-white shadow-lg" aria-label="Cerrar oficina"><X className="h-4 w-4"/></button>
          <InboxOperationsPanel businessName={inboxWorkspace?.name?.trim() || "Mi tienda"} orders={todayOfficeOrders ?? []} pending={pendingCandidates.length} totalChats={smartCounts.all} loading={officeLoading} failed={Boolean(officeError)} recentActivity={officeActivity}/>
        </aside>
      </div>}
    </div>
  );
}
