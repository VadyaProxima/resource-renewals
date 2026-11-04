import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { updateSession, type User } from "@/entities/session";
import { post } from "@/shared/api";
import { ErrorMessage } from "@/shared/ui";
export function LoginForm() {
  const [login, setLogin] = useState("initiator.alpha");
  const [password, setPassword] = useState("");
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => post<User>("/auth/login", { login, password }),
    onSuccess: (user) => updateSession(client, user),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate();
  }
  return (
    <section className="login-card">
      <div className="login-symbol">
        <LockKeyhole size={26} />
      </div>
      <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
      <h1>Вход в приложение</h1>
      <p className="muted">
        Войдите, чтобы работать с ресурсами
        <br />и заявками вашего пространства.
      </p>
      <form onSubmit={submit}>
        <label>
          Учетная запись
          <select value={login} onChange={(e) => setLogin(e.target.value)}>
            <option value="initiator.alpha">Инициатор Alpha</option>
            <option value="approver.alpha">Согласующий Alpha</option>
            <option value="universal.alpha">Универсальный Alpha</option>
            <option value="initiator.beta">Инициатор Beta</option>
          </select>
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorMessage error={mutation.error} />
        <button className="button primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Входим…" : "Войти в пространство"}
          <ArrowRight size={18} />
        </button>
      </form>
      <p className="demo-note">
        Демонстрационные аккаунты · пароль <code>Demo-2026!</code>
      </p>
    </section>
  );
}
