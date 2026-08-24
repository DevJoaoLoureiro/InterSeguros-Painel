import {
  getLibaxContract,
  getLibaxBusinessSeller,
} from "@/lib/libax/client";

export async function GET() {
  try {
    const contract =
      await getLibaxContract(10350);

    const responsibleSeller =
      contract.sellers?.find(
        (seller) =>
          seller.sellerType === 2 ||
          seller.sellerType === 3,
      );

    if (!responsibleSeller?.sellerId) {
      return Response.json({
        success: true,
        contractId: 10350,
        responsible: null,
        sellers:
          contract.sellers ?? [],
      });
    }

    const seller =
      await getLibaxBusinessSeller(
        responsibleSeller.sellerId,
      );

    return Response.json({
      success: true,
      contractId: 10350,
      responsible: {
        sellerId:
          responsibleSeller.sellerId,
        sellerType:
          responsibleSeller.sellerType,
        name:
          seller.name ?? null,
        officeId:
          seller.officeId ?? null,
        libaxUserId:
          seller.libaxUserId ?? null,
      },
      sellers:
        contract.sellers ?? [],
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      },
    );
  }
}