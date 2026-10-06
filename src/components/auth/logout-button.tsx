"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();

    await supabase.auth.signOut();

    router.replace("/login");
    router.refresh();
  }

  // Só é usado no menu lateral.
  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[#6b625b] transition-colors hover:bg-[#f7f2ed] hover:text-[#2b2724]"
    >
      <LogOut className="h-[18px] w-[18px]" />
      Sair
    </button>
  );
}
