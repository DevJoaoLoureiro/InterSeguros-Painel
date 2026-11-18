/*
 * Nome/morada de um cliente que existe em várias companhias (o mesmo
 * NIF). Cada sync escrevia os dados da sua companhia por cima: a
 * Generali envia tudo em maiúsculas, e "Oscar Luís Brito" (Zurich)
 * passava a "OSCAR LUIS BRITO" — e voltava, ao sabor do último sync.
 *
 * Regra: se for o mesmo texto a menos de maiúsculas, acentos e espaços,
 * fica a versão com mais informação (minúsculas, acentos). Se for
 * mesmo diferente (ex.: mudou de morada), vale o que chegou agora. Um
 * valor vazio nunca apaga o que já existe.
 */

export function normalizeClientText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function richness(value: string): number {
  const hasLower = /\p{Ll}/u.test(value) ? 2 : 0;
  const hasAccent = value.normalize("NFD") !== value ? 1 : 0;
  return hasLower + hasAccent;
}

export function mergeClientText(
  current: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const cur = current?.trim() || null;
  const inc = incoming?.trim() || null;

  if (!inc) return cur;
  if (!cur) return inc;

  if (normalizeClientText(cur) === normalizeClientText(inc)) {
    return richness(inc) > richness(cur) ? inc : cur;
  }

  return inc;
}
