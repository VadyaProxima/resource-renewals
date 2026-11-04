import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCw, X } from "lucide-react";
import type { User } from "@/entities/session";
import type { Renewal } from "@/entities/renewal";
import { post } from "@/shared/api";
import { Modal, ErrorMessage } from "@/shared/ui";
export function ReviewActions({
  renewal,
  user,
}: {
  renewal: Renewal;
  user: User;
}) {
  const [action, setAction] = useState<"approve" | "reject" | "retry" | null>(
    null,
  );
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => post(`/renewals/${renewal.id}/${action}`),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["renewal", renewal.id] }),
        client.invalidateQueries({ queryKey: ["renewals"] }),
        client.invalidateQueries({ queryKey: ["resources"] }),
      ]);
      setAction(null);
    },
  });
  if (!user.can_approve || !["pending", "attention"].includes(renewal.status))
    return null;
  if (renewal.status === "pending" && renewal.created_by === user.id)
    return (
      <p className="muted">
        Собственную заявку должен рассмотреть другой согласующий.
      </p>
    );
  return (
    <>
      <div className="review-actions">
        {renewal.status === "pending" ? (
          <>
            <button
              className="button primary"
              onClick={() => {
                mutation.reset();
                setAction("approve");
              }}
            >
              <Check size={18} />
              Согласовать
            </button>
            <button
              className="button secondary"
              onClick={() => {
                mutation.reset();
                setAction("reject");
              }}
            >
              <X size={18} />
              Отклонить
            </button>
          </>
        ) : (
          <button
            className="button primary"
            onClick={() => {
              mutation.reset();
              setAction("retry");
            }}
          >
            <RotateCw size={18} />
            Повторить обработку
          </button>
        )}
      </div>
      {action && (
        <Modal
          title={
            action === "approve"
              ? "Согласовать заявку?"
              : action === "reject"
                ? "Отклонить заявку?"
                : "Повторить обработку?"
          }
          onClose={() => setAction(null)}
        >
          <p className="muted">
            {action === "reject"
              ? "Срок ресурса не изменится. После отклонения можно создать новую заявку."
              : action === "retry"
                ? "Обработчик проверит прежнюю операцию и использует тот же ключ. Результат предыдущих отправок может быть неизвестен."
                : "После согласования задача отправится провайдеру. Продление составит 30 календарных дней."}
          </p>
          <ErrorMessage error={mutation.error} />
          <button
            className="button primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Сохраняем…" : "Подтвердить"}
          </button>
        </Modal>
      )}
    </>
  );
}
