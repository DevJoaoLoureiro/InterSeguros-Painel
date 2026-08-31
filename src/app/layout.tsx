import { Geist } from "next/font/google";
import "./globals.css";
import { getNotifications } from "@/lib/notifications/get-notifications";
const geist = Geist({
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt">
      <body className={geist.className}>
        {children}
      </body>
    </html>
  );
}