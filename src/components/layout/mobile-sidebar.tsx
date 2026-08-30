"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

type MobileSidebarProfile = {
  full_name: string;
  role: string;
  email?: string;
  store:
    | {
        id: string;
        name: string;
        code: string | null;
      }
    | null;
};

type MobileSidebarProps = {
  profile: MobileSidebarProfile;
};

export function MobileSidebar({
  profile,
}: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#d8dde4] bg-white text-[#353b44] transition-colors hover:bg-[#f4f5f7] lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-[min(280px,85vw)] max-w-[85vw] overflow-hidden p-0"
        >
          <SheetTitle className="sr-only">
            Menu de navegação
          </SheetTitle>

          <AppSidebar
            mobile
            profile={profile}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}