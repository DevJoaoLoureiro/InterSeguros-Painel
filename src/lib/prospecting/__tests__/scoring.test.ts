/*
 * Testes das regras de avaliação da prospeção (sem BD nem rede).
 *
 *   npx tsc --outDir <tmp> --module commonjs --moduleResolution node10 \
 *     --target es2022 --strict --skipLibCheck --esModuleInterop --types node \
 *     src/lib/prospecting/__tests__/scoring.test.ts
 *   node --test <tmp>/__tests__/scoring.test.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPlace } from "../google-places";
import { AT, FROTA, MR, gradeFromScore, isBigBrand, leadInsuranceType, scoreProspect } from "../scoring";
import { buildWebSearchRequest, parseWebCompanies, portuguesePhone } from "../web-search-request";

const facts = (primaryType: string | null, reviews = 60, types: string[] = []) => ({
  primaryType,
  types,
  reviews,
  hasWebsite: false,
});

describe("scoreProspect", () => {
  it("dá nota boa a setores com trabalhadores e risco", () => {
    const score = scoreProspect(facts("general_contractor"));

    assert.equal(score.grade, "boa");
    assert.equal(score.products[0], AT);
    assert.equal(score.excluded, false);
  });

  it("propõe frota primeiro a transportes", () => {
    assert.equal(scoreProspect(facts("moving_company")).products[0], FROTA);
  });

  it("dá nota fraca a escritórios pequenos sem avaliações", () => {
    assert.equal(scoreProspect(facts("lawyer", 0)).grade, "ma");
  });

  it("sobe com a dimensão: o mesmo restaurante passa de média a boa", () => {
    assert.equal(scoreProspect(facts("restaurant", 12)).grade, "media");
    assert.equal(scoreProspect(facts("restaurant", 400)).grade, "boa");
  });

  it("usa os tipos secundários quando o principal é desconhecido", () => {
    const score = scoreProspect(facts("point_of_interest", 60, ["establishment", "car_repair"]));

    assert.equal(score.sector, "Oficinas e automóvel");
  });

  it("cai no perfil genérico quando não conhece nenhum tipo", () => {
    const score = scoreProspect(facts(null, 60, ["establishment"]));

    assert.equal(score.sector, "Outra atividade");
    assert.deepEqual(score.products, [MR, AT]);
  });

  it("exclui concorrentes, mesmo como tipo secundário", () => {
    assert.equal(scoreProspect(facts("insurance_agency")).excluded, true);
    assert.equal(scoreProspect(facts("store", 60, ["insurance_agency"])).excluded, true);
  });

  it("marca contabilistas como possíveis parceiros", () => {
    assert.equal(scoreProspect(facts("accounting")).partnerHint, true);
    assert.equal(scoreProspect(facts("restaurant")).partnerHint, false);
  });

  it("mantém a nota entre 0 e 100", () => {
    const score = scoreProspect({ ...facts("general_contractor", 5000), hasWebsite: true });

    assert.ok(score.score <= 100);
  });
});

describe("gradeFromScore", () => {
  it("respeita os limites", () => {
    assert.equal(gradeFromScore(70), "boa");
    assert.equal(gradeFromScore(69), "media");
    assert.equal(gradeFromScore(50), "media");
    assert.equal(gradeFromScore(49), "ma");
  });
});

describe("leadInsuranceType", () => {
  it("converte o primeiro seguro para a lista do CRM", () => {
    assert.equal(leadInsuranceType([FROTA, AT]), "Automóvel");
    assert.equal(leadInsuranceType([AT]), "Acidentes de trabalho");
    assert.equal(leadInsuranceType([]), "Outros");
  });
});

describe("mapPlace", () => {
  it("converte a resposta do Google", () => {
    const place = mapPlace({
      id: "abc",
      displayName: { text: " Oficina Silva " },
      formattedAddress: "Rua A 1, 4700-000 Braga, Portugal",
      addressComponents: [
        { longText: "Rua A", types: ["route"] },
        { longText: "Braga", types: ["locality", "political"] },
      ],
      nationalPhoneNumber: "253 123 456",
      userRatingCount: 80,
      rating: 4.6,
      primaryType: "car_repair",
      primaryTypeDisplayName: { text: "Oficina de automóveis" },
      types: ["car_repair", "establishment"],
      businessStatus: "OPERATIONAL",
    });

    assert.equal(place?.name, "Oficina Silva");
    assert.equal(place?.locality, "Braga");
    assert.equal(place?.phone, "253 123 456");
    assert.equal(place?.operational, true);
  });

  it("marca fechados e ignora locais sem nome", () => {
    assert.equal(mapPlace({ id: "x", displayName: { text: "Café" }, businessStatus: "CLOSED_PERMANENTLY" })?.operational, false);
    assert.equal(mapPlace({ id: "x" }), null);
  });
});

describe("pesquisa na web", () => {
  it("usa o setor indicado e não penaliza a falta de avaliações", () => {
    const score = scoreProspect({ primaryType: null, types: [], sectorKey: "construcao", reviews: null, hasWebsite: false });

    assert.equal(score.sector, "Construção e obras");
    assert.equal(score.score, 80);
    assert.match(score.reason, /dimensão por confirmar/);
  });

  it("ignora um setor desconhecido", () => {
    const score = scoreProspect({ primaryType: null, types: [], sectorKey: "inventado", reviews: null, hasWebsite: false });

    assert.equal(score.sector, "Outra atividade");
  });

  it("só aceita telefones portugueses", () => {
    assert.equal(portuguesePhone("+351 253 123 456"), "253123456");
    assert.equal(portuguesePhone("912.345.678"), "912345678");
    assert.equal(portuguesePhone("253 123 45"), null);
    assert.equal(portuguesePhone("123 456 789"), null);
    assert.equal(portuguesePhone("+34 912 345 678"), null);
  });

  it("deita fora empresas sem telefone válido, sem fonte ou repetidas", () => {
    const company = (extra: object) => ({
      name: "Oficina Silva",
      activity: "Oficina",
      sectorKey: "automovel",
      address: "Rua A",
      locality: "Braga",
      phone: "253 123 456",
      website: null,
      sourceUrl: "https://exemplo.pt/contactos",
      ...extra,
    });

    const companies = parseWebCompanies(
      JSON.stringify({
        companies: [
          company({}),
          company({ name: "Repetida" }),
          company({ name: "Sem telefone", phone: "" }),
          company({ name: "Sem fonte", phone: "253 999 888", sourceUrl: "ver no site" }),
          company({ name: "Válida", phone: "912345678", website: "exemplo.pt" }),
        ],
      }),
    );

    assert.deepEqual(companies.map((c) => c.name), ["Oficina Silva", "Válida"]);
    assert.equal(companies[1].phone, "912 345 678");
    assert.equal(companies[1].website, null);
  });

  it("devolve lista vazia se a resposta não for JSON", () => {
    assert.deepEqual(parseWebCompanies("desculpa, não encontrei"), []);
  });

  it("limita o setor às opções das regras", () => {
    const request = buildWebSearchRequest("oficinas", "Braga");
    const sectorEnum = request.text.format.schema.properties.companies.items.properties.sectorKey.enum;

    assert.ok(sectorEnum.includes("automovel"));
    assert.ok(sectorEnum.includes("outro"));
  });
});

describe("só leads que valem a chamada", () => {
  const web = (extra: object) => ({
    primaryType: null,
    types: [],
    sectorKey: "comercio",
    reviews: null,
    hasWebsite: false,
    ...extra,
  });

  it("deixa de fora grandes empresas e cadeias, pelo nome ou pela dimensão", () => {
    for (const name of ["Sonae MC", "Continente Modelo - Braga", "Pingo Doce Guimarães", "McDonald's Braga", "Mota-Engil"]) {
      assert.equal(isBigBrand(name), true, name);
    }

    assert.equal(scoreProspect(web({ name: "Continente Bom Dia" })).tooBig, true);
    assert.equal(scoreProspect(web({ name: "Supermercado Local", sizeClass: "grande" })).tooBig, true);
  });

  it("não confunde pequenos negócios com marcas grandes", () => {
    for (const name of ["Oficina Modelo", "Café Brisa do Mar", "Auto Avis Lda", "Padaria Era Uma Vez", "Restaurante O Dia"]) {
      assert.equal(isBigBrand(name), false, name);
    }

    assert.equal(scoreProspect(web({ name: "Mercearia do Zé", sizeClass: "micro" })).tooBig, false);
  });

  it("distingue empresas do mesmo setor pela dimensão", () => {
    const pequena = scoreProspect(web({ sectorKey: "construcao", sizeClass: "pequena", sizeEvidence: "18 trabalhadores" }));
    const micro = scoreProspect(web({ sectorKey: "construcao", sizeClass: "micro" }));

    assert.ok(pequena.score > micro.score);
    assert.match(pequena.reason, /18 trabalhadores/);
  });

  it("põe o seguro-alvo à frente quando o setor costuma precisar dele", () => {
    const score = scoreProspect(web({ sectorKey: "construcao" }), { product: FROTA });

    assert.equal(score.products[0], FROTA);
    assert.equal(score.score, 85);
  });

  it("desce quem não costuma precisar do seguro-alvo", () => {
    const score = scoreProspect(web({ sectorKey: "comercio" }), { product: FROTA });

    assert.equal(score.grade, "ma");
    assert.notEqual(score.products[0], FROTA);
    assert.match(score.reason, /não é típico/);
  });

  it("guarda a dimensão que a pesquisa indicou e ignora valores estranhos", () => {
    const base = {
      name: "Construções Silva",
      activity: "Construção",
      sectorKey: "construcao",
      address: "",
      locality: null,
      website: null,
      sourceUrl: "https://exemplo.pt",
    };

    const companies = parseWebCompanies(
      JSON.stringify({
        companies: [
          { ...base, phone: "253 111 222", sizeClass: "pequena", sizeEvidence: " 15 trabalhadores " },
          { ...base, name: "Outra", phone: "253 333 444", sizeClass: "enorme", sizeEvidence: null },
        ],
      }),
    );

    assert.equal(companies[0].sizeClass, "pequena");
    assert.equal(companies[0].sizeEvidence, "15 trabalhadores");
    assert.equal(companies[1].sizeClass, "desconhecida");
  });
});
