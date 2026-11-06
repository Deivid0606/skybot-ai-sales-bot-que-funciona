import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ownWorkspace(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile, error } = await supabaseAdmin.from("profiles")
    .select("workspace_id,status").eq("id", userId).single();
  if (error || !profile?.workspace_id ||
      !["approved","active"].includes(profile.status)) throw new Error("Cuenta sin tienda habilitada");
  return { admin: supabaseAdmin, workspaceId: profile.workspace_id };
}

/** Only the current store's owner can enable or disable sharing of its products. */
export const listMyProductShares = createServerFn({ method:"POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, workspaceId } = await ownWorkspace(context.userId);
    const { data: products, error: productsError } = await admin.from("products").select("id").eq("workspace_id",workspaceId);
    if (productsError) throw productsError;
    const ids = (products ?? []).map(p => p.id);
    if (!ids.length) return [] as {product_id:string;share_code:string;enabled:boolean}[];
    const { data, error } = await admin.from("bot_sky_product_shares")
      .select("product_id,share_code,enabled").in("product_id",ids);
    if (error) throw error;
    return data ?? [];
  });

export const setProductSharing = createServerFn({ method:"POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ productId:z.string().uuid(),enabled:z.boolean() }).parse(input))
  .handler(async ({ data,context }) => {
    const { admin,workspaceId } = await ownWorkspace(context.userId);
    const { data: product, error } = await admin.from("products").select("id")
      .eq("id",data.productId).eq("workspace_id",workspaceId).maybeSingle();
    if (error || !product) throw new Error("No tenés permiso para compartir este producto");
    const { data: share, error: updated } = await admin.from("bot_sky_product_shares")
      .update({enabled:data.enabled}).eq("product_id",product.id)
      .select("share_code,enabled").single();
    if (updated || !share) throw updated ?? new Error("No se encontró el código del producto");
    return share;
  });

export const importProductByCode = createServerFn({ method:"POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({code:z.string().trim().min(8).max(40)}).parse(input))
  .handler(async ({ data,context }) => {
    const { admin,workspaceId } = await ownWorkspace(context.userId);
    const code = data.code.toUpperCase();
    // The code is opt-in; no arbitrary UUID or SKU can import another seller's product.
    const { data: registration, error } = await (admin as any).rpc("bot_sky_clone_shared_product",{
      p_code:code,p_workspace:workspaceId,p_user:context.userId,
    });
    if (error || !registration?.product_id || !registration?.source_product_id)
      throw new Error(error?.message ?? "No se pudo importar el producto");
    const targetId = String(registration.product_id);
    const sourceId = String(registration.source_product_id);
    // Source files are copied inside private storage to the importing workspace.
    // No media path or bucket permissions from the seller are transferred.
    const { data: media, error: mediaError } = await admin.from("product_media")
      .select("id,media_type,storage_path,url,position")
      .eq("product_id",sourceId).order("position",{ascending:true});
    if (mediaError) throw mediaError;
    const { data: already, error: existingError } = await admin.from("product_media")
      .select("storage_path,position").eq("product_id",targetId);
    if (existingError) throw existingError;
    const paths = new Set((already ?? []).map(m => String(m.storage_path ?? "")));
    let copied=0;
    for (const file of media ?? []) {
      const sourcePath = String(file.storage_path || file.url || "");
      if (!sourcePath) continue;
      const extension = sourcePath.split("?")[0].split(".").pop()?.replace(/[^a-z0-9]/gi,"").slice(0,8) || "bin";
      const targetPath = `${workspaceId}/${targetId}/shared-${file.id}.${extension}`;
      if (paths.has(targetPath)) continue;
      if (file.storage_path) {
        const { error: copyError } = await admin.storage.from("product-media").copy(file.storage_path,targetPath);
        if (copyError && !/already exists|duplicate|resource already/i.test(copyError.message))
          throw new Error(`Producto copiado; faltó copiar un archivo. Volvé a importar con el mismo ID: ${copyError.message}`);
      } else if (!/^https:\/\//i.test(sourcePath)) {
        throw new Error("Un archivo del producto no tiene ruta válida para copiar");
      }
      const finalUrl = file.storage_path ? targetPath : sourcePath;
      const { error: insertionError } = await admin.from("product_media").insert({
        workspace_id:workspaceId,user_id:context.userId,product_id:targetId,
        media_type:file.media_type,url:finalUrl,
        storage_path:file.storage_path ? targetPath : null,position:file.position ?? 0,
      });
      if (insertionError) throw new Error(`Producto copiado; faltó registrar un archivo: ${insertionError.message}`);
      paths.add(targetPath);
      copied++;
    }
    return {productId:targetId,existing:Boolean(registration.existing),mediaCopied:copied};
  });

/** Immediately retry eligible unsynced DCANP orders when a product SKU changes. */
export const retryAfterProductSkuSave = createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:unknown)=>z.object({productId:z.string().uuid(),sku:z.string().trim().min(1)}).parse(input))
  .handler(async ({data,context})=>{
    const {supabase,userId}=context;
    const {data:profile}=await supabase.from("profiles").select("workspace_id,status").eq("id",userId).single();
    const {data:isAdmin}=await supabase.rpc("has_role",{_user_id:userId,_role:"admin"});
    if (!profile || !["active","approved"].includes(profile.status)) throw new Error("Usuario sin tienda habilitada");
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const {data:product,error}=await supabaseAdmin.from("products")
      .select("id,workspace_id,sku").eq("id",data.productId).single();
    if (error || !product) throw new Error("Producto no encontrado");
    if (!isAdmin && product.workspace_id!==profile.workspace_id) throw new Error("Acceso denegado");
    if (String(product.sku??"").trim()!==data.sku) throw new Error("SKU no coincide con el catálogo");
    const {data:workspace}=await supabaseAdmin.from("workspaces")
      .select("dcanp_auto_import,dcanp_verified_at,dcanp_email" as never)
      .eq("id",product.workspace_id).single();
    if (!(workspace as any)?.dcanp_auto_import || !(workspace as any)?.dcanp_verified_at || !(workspace as any)?.dcanp_email)
      return {enabled:false,updated:0,sent:0,loaded:0,failed:0};
    // Repair stale SKU snapshots only on unsynced orders of this specific product.
    const {data:updated,error:updateError}=await supabaseAdmin.from("orders")
      .update({sku:data.sku} as never).eq("workspace_id",product.workspace_id)
      .eq("product_id",product.id).in("status",["nuevo","confirmado"])
      .is("ecommerce_synced_at",null).select("id");
    if (updateError) throw updateError;
    // A SKU correction must also repair the pending line snapshot used by
    // multi-product imports. Never rewrite lines on already synced orders.
    const pendingIds=(updated??[]).map(row=>row.id);
    for(let index=0;index<pendingIds.length;index+=200){
      const batch=pendingIds.slice(index,index+200);
      if(!batch.length)continue;
      const {error:itemsError}=await supabaseAdmin.from("order_items")
        .update({sku:data.sku}).eq("workspace_id",product.workspace_id)
        .eq("product_id",product.id).in("order_id",batch);
      if(itemsError) throw itemsError;
    }
    const {retryDcanpForProductSku}=await import("@/lib/dcanp-auto-import.server");
    const result=await retryDcanpForProductSku(product.workspace_id,product.id);
    return {...result,updated:(updated??[]).length};
  });
