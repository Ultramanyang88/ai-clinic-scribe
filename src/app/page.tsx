import { redirect } from "next/navigation";

// Root route: redirect to login. The login page redirects to /workspace or /admin based on role.
export default function Home() {
  redirect("/login");
}
