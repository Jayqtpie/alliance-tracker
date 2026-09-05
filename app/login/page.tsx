import { LoginForm } from "@/components/login-form";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Expose branding only; roster, scores and settings remain behind officer access.
  const alliance = await getState().then((state) => state.alliance).catch(() => undefined);
  return <LoginForm alliance={alliance} />;
}
