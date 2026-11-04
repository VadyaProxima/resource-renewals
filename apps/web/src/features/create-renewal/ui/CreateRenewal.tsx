import { useState, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowRight } from "lucide-react";
import { useResources } from "@/entities/resource";
import { post } from "@/shared/api";
import { date, money } from "@/shared/lib";
import { Modal, ErrorMessage, Loading } from "@/shared/ui";
export function CreateRenewal() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button primary" onClick={() => setOpen(true)}>
        <Plus size={18} />
        Создать заявку
      </button>
      {open && <CreateDialog onClose={() => setOpen(false)} />}
    </>
  );
}
function CreateDialog({ onClose }: { onClose: () => void }) {
  const resourceInputId = useId();
  const { data: resources, isPending, error } = useResources();
  const [id, setId] = useState("");
  const client = useQueryClient();
  const available = resources?.filter((r) => !r.active_request_id) ?? [];
  const selected = available.find((r) => r.id === id);
  const mutation = useMutation({
    mutationFn: () => post("/renewals", { resource_id: id }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["resources"] }),
        client.invalidateQueries({ queryKey: ["renewals"] }),
      ]);
      onClose();
    },
  });
  const next = selected
    ? (() => {
        const d = new Date(`${selected.expires_on}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 30);
        return d.toISOString().slice(0, 10);
      })()
    : "";
  return (
    <Modal title="Новая заявка" onClose={onClose}>
      <p className="muted">
        Продление на 30 календарных дней. Срок изменится после согласования и
        подтверждения провайдера.
      </p>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {available.length ? (
            <>
              <label htmlFor={resourceInputId}>Ресурс</label>
              <select
                id={resourceInputId}
                value={id}
                required
                onChange={(e) => setId(e.target.value)}
              >
                <option value="" disabled>
                  Выберите ресурс
                </option>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.id}
                  </option>
                ))}
              </select>
              {selected && (
                <div className="snapshot">
                  <div>
                    <span>Текущий срок</span>
                    <strong>{date(selected.expires_on)}</strong>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <span>Новый срок</span>
                    <strong>{date(next)}</strong>
                  </div>
                  <div className="snapshot-price">
                    <span>Стоимость</span>
                    <strong>{money(selected.amount_minor)}</strong>
                  </div>
                </div>
              )}
              <ErrorMessage error={mutation.error} />
              <button
                className="button primary"
                disabled={!selected || mutation.isPending}
              >
                {mutation.isPending
                  ? "Сохраняем…"
                  : "Отправить на согласование"}
              </button>
            </>
          ) : (
            <p className="empty">
              Нет доступных ресурсов. По всем ресурсам уже есть активные заявки.
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
