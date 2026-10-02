import type { NextConfig } from "next";

/*
 * Cabeçalhos de segurança em todas as respostas.
 * (Uma Content-Security-Policy completa fica para depois: mal
 * afinada parte scripts/estilos — ver sugestões.)
 */
const securityHeaders = [
  // Não deixar a app ser embebida noutro site (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  // O browser não tenta "adivinhar" tipos de ficheiro.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Não enviar o URL completo (com ids) para sites externos.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // A app não usa câmara/microfone/localização.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Só HTTPS durante 1 ano (ignorado em http://localhost).
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Não anunciar "X-Powered-By: Next.js".
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
