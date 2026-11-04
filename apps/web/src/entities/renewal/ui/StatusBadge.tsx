import type { Status } from "@renewals/contracts";
export const statusLabel: Record<Status, string> = {
  pending: "На согласовании",
  processing: "Выполняется",
  completed: "Завершена",
  rejected: "Отклонена",
  attention: "Требует внимания",
};
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="status-dot" />
      {statusLabel[status]}
    </span>
  );
}
