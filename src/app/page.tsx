import { redirect } from "next/navigation";
import {
  getCurrentProfile,
} from "@/lib/auth/get-current-profile";
export default function HomePage() {
  redirect("/dashboard");
}
