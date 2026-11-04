import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { updateSession } from "@/entities/session";
import { post } from "@/shared/api";
import { ErrorMessage } from "@/shared/ui";
export function LogoutButton() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => post("/auth/logout"),
    onSuccess: () => updateSession(client, null),
  });
  return (
    <>
      <button
        className="icon-button"
        aria-label="Выйти"
        title="Выйти"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <LogOut size={19} />
      </button>
      <ErrorMessage error={mutation.error} />
    </>
  );
}
