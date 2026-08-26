import {
  cookies,
} from "next/headers";

import {
  redirect,
} from "next/navigation";

import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";

import ClientsList from "@/components/clientes/client-list";

import {
  getClientsPortfolioData,
} from "@/app/(dashboard)/clientes/action";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
    company?: string;
    responsible?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const profile =
    await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  const canAccessAllStores =
    profile.role === "OWNER" ||
    profile.role === "ADMIN";

  const cookieStore =
    await cookies();

  const cookieStoreId =
    cookieStore.get(
      "selected_store_id",
    )?.value ?? "all";

  const selectedStoreId =
    canAccessAllStores
      ? cookieStoreId
      : profile.store?.id ?? null;

  if (
    !canAccessAllStores &&
    !selectedStoreId
  ) {
    throw new Error(
      "O utilizador não tem uma loja associada.",
    );
  }

  const params =
    await searchParams;

  const storeId =
    selectedStoreId &&
    selectedStoreId !== "all"
      ? selectedStoreId
      : null;

  const sort: "newest" | "oldest" =
    params.sort === "oldest"
      ? "oldest"
      : "newest";

  const page =
    Number(params.page ?? "1") ||
    1;

  const data =
    await getClientsPortfolioData({
      storeId,
      search: params.q ?? "",
      from: params.from ?? "",
      to: params.to ?? "",
      company: params.company ?? "",
      responsible:
        params.responsible ?? "",
      sort,
      page,
    });

  return (
    <ClientsList
      data={data}
      filters={{
        q: params.q ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
        company: params.company ?? "",
        responsible:
          params.responsible ?? "",
        sort,
        page: data.page,
      }}
    />
  );
}