import { ChevronRight } from "lucide-react";
import type { User } from "@/entities/session";
import { useRenewal, StatusBadge, statusLabel } from "@/entities/renewal";
import { ReviewActions } from "@/features/review-renewal";
import { date, dateTime, money } from "@/shared/lib";
import { Modal, Loading, ErrorMessage } from "@/shared/ui";
export function RenewalDetail({
  id,
  user,
  onClose,
}: {
  id: string;
  user: User;
  onClose: () => void;
}) {
  const { data: r, isPending, error } = useRenewal(id);
  return (
    <Modal title="Заявка на продление" onClose={onClose}>
      {isPending ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} />
      ) : (
        r && (
          <>
            <div className="detail-title">
              <h3>{r.resource_name}</h3>
              <StatusBadge status={r.status} />
            </div>
            <p className="muted">
              {r.creator_name} · {dateTime(r.created_at)}
            </p>
            <div className="snapshot">
              <div>
                <span>Прежний срок</span>
                <strong>{date(r.old_expires_on)}</strong>
              </div>
              <ChevronRight size={18} />
              <div>
                <span>Новый срок</span>
                <strong>{date(r.new_expires_on)}</strong>
              </div>
              <div className="snapshot-price">
                <span>Стоимость</span>
                <strong>{money(r.amount_minor)}</strong>
              </div>
            </div>
            {r.status === "attention" && (
              <p className="attention-note" role="status">
                Результат отправок пока неизвестен. Новая заявка заблокирована
                до разрешения текущей операции.
              </p>
            )}
            <ReviewActions renewal={r} user={user} />
            <h3 className="history-title">История заявки</h3>
            <ol className="timeline">
              {r.history.map((h) => (
                <li key={h.id}>
                  <div>
                    <strong>{h.actor_name}</strong>
                    <time dateTime={h.created_at}>
                      {dateTime(h.created_at)}
                    </time>
                  </div>
                  <p>{h.message}</p>
                  <small>
                    {h.from_status && `${statusLabel[h.from_status]} → `}
                    {statusLabel[h.to_status]}
                  </small>
                </li>
              ))}
            </ol>
            <details className="technical">
              <summary>Данные операции</summary>
              <p>
                ID заявки: <code>{r.id}</code>
              </p>
              <p>
                Ключ операции: <code>{r.operation_key}</code>
              </p>
              <p>
                Отправок POST: {r.post_attempts} · в текущем цикле:{" "}
                {r.cycle_attempts}/3
              </p>
              {r.provider_operation_id && (
                <p>
                  ID провайдера: <code>{r.provider_operation_id}</code>
                </p>
              )}
            </details>
          </>
        )
      )}
    </Modal>
  );
}
