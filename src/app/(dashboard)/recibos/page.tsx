import {
  getReceiptsData,
} from "./action";

import {
  ReceiptsPage,
} from "@/components/recibos/receipts-page";

type PageProps = {
  searchParams: Promise<{
    search?: string;
    from?: string;
    to?: string;
    company?: string;
    status?: string;
    premium?: string;
    page?: string;
  }>;
};

export default async function Page({
  searchParams,
}: PageProps) {
  const params =
    await searchParams;

  const pageNumber =
    Number(params.page ?? "1");

  const filters = {
    search:
      params.search ?? "",

    from:
      params.from ?? "",

    to:
      params.to ?? "",

    company:
      params.company ?? "",

    status:
      params.status ?? "",

    page:
      Number.isFinite(pageNumber)
        ? Math.max(
            1,
            pageNumber,
          )
        : 1,
  };

  const data =
    await getReceiptsData(
      filters,
    );

  const premiumMode =
    params.premium === "total"
      ? "total"
      : "commercial";

  return (
    <ReceiptsPage
      data={data}
      filters={filters}
      premiumMode={
        premiumMode
      }
    />
  );
}