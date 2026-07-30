import { createFileRoute } from "@tanstack/react-router";
import { getPublicCatalog } from "@/lib/catalog.functions";
import { CatalogDetail, CatalogDisabled } from "@/components/catalog-view";

export const Route = createFileRoute("/c/$workspaceId/$productId")({
  loader: ({ params }) =>
    getPublicCatalog({ data: { workspaceId: params.workspaceId, productId: params.productId } }),
  head: ({ loaderData }) => {
    const p = loaderData?.products?.[0];
    const title = p ? `${p.name} — ${loaderData.workspaceName}` : "Producto — Catálogo online";
    const description =
      (p?.sales_copy || p?.description || "Comprá al instante por WhatsApp.").slice(0, 150);
    const image = p?.media.find((m) => m.media_type === "image")?.url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
      ],
    };
  },
  errorComponent: () => <CatalogDisabled name="" />,
  notFoundComponent: () => <CatalogDisabled name="" />,
  component: ProductPage,
});

function ProductPage() {
  const data = Route.useLoaderData();
  const { workspaceId } = Route.useParams();
  const product = data.products[0];
  if (!data.enabled || !product) return <CatalogDisabled name={data.workspaceName} />;
  return <CatalogDetail data={data} workspaceId={workspaceId} product={product} />;
}
