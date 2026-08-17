import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { DashboardHeader } from "@/components/layout/dashboard-header";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return (
    <div className="min-h-dvh w-full overflow-x-clip bg-[#f7f8fc]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[270px] lg:block">
        <AppSidebar profile={profile} />
      </aside>

      <div className="min-w-0 max-w-full lg:pl-[270px]">
        <DashboardHeader profile={profile} />

        <main className="min-w-0 max-w-full overflow-x-clip p-3 sm:p-5 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}