"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Mail } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError("");
    setLoading(true);

    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError("Email ou palavra-passe incorretos.");
      setLoading(false);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
      <div>
        <label
          htmlFor="email"
          className="text-sm font-medium text-[#333842]"
        >
          Email
        </label>

        <div className="relative mt-2">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9298a1]" />

          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nome@interseguros.pt"
            className="h-12 w-full rounded-xl border border-[#dde1e6] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="text-sm font-medium text-[#333842]"
        >
          Palavra-passe
        </label>

        <div className="relative mt-2">
          <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9298a1]" />

          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className="h-12 w-full rounded-xl border border-[#dde1e6] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[#ff4b0a] focus:ring-2 focus:ring-orange-100"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-[#ff4b0a] text-sm font-semibold text-white transition hover:bg-[#e94308] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "A entrar..." : "Entrar no painel"}
      </button>
    </form>
  );
}