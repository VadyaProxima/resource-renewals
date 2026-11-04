import { Layers3 } from "lucide-react";
import { LoginForm } from "@/features/auth";
export function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-brand">
        <Layers3 size={24} />
        продления.
      </div>
      <LoginForm />
      <p className="muted">
        Изолированные пространства. Прозрачное согласование.
      </p>
    </main>
  );
}
