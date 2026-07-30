import { createFileRoute } from "@tanstack/react-router";
import { getPublicCatalog } from "@/lib/catalog.functions";
import { CatalogDisabled, CatalogGrid } from "@/components/catalog-view";

export const Route = createFileRoute("/c/$workspaceId/")({
  loader: ({ params }) => getPublicCatalog({ data: { workspaceId: params.workspaceId } }),
  head: ({ loaderData }) => {
    const title = loaderData?.workspaceName
      ? `Catálogo de ${loaderData.workspaceName}`
      : "Catálogo online";
    const description = "Mirá los productos, precios y comprá al instante por WhatsApp.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: () => <CatalogDisabled name="" />,
  notFoundComponent: () => <CatalogDisabled name="" />,
  component: CatalogPage,
});

function CatalogPage() {
  const data = Route.useLoaderData();
  const { workspaceId } = Route.useParams();
  if (!data.enabled) return <CatalogDisabled name={data.workspaceName} />;
  return <CatalogGrid data={data} workspaceId={workspaceId} />;
}
