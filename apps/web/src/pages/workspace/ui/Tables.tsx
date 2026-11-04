import {
  ArrowUpRight,
  CheckCheck,
  History,
  Layers3,
  Server,
} from "lucide-react";
import type { Resource } from "@/entities/resource";
import { StatusBadge, type Renewal } from "@/entities/renewal";
import { date, money } from "@/shared/lib";

export function ResourceTable({
  resources,
  onHistory,
}: {
  resources: Resource[];
  onHistory: (id: string) => void;
}) {
  if (!resources.length)
    return (
      <div className="empty">
        <Server size={30} />
        <h3>Ресурсов пока нет</h3>
        <p>В этом пространстве еще нет ресурсов.</p>
      </div>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ресурс</th>
            <th>Срок</th>
            <th>Стоимость</th>
            <th>Статус</th>
            <th>
              <span className="sr-only">Действие</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.id}>
              <td data-label="Ресурс">
                <div>
                  <strong>{r.name}</strong>
                  <small>{r.id}</small>
                </div>
              </td>
              <td data-label="Срок">{date(r.expires_on)}</td>
              <td data-label="Стоимость">{money(r.amount_minor)}</td>
              <td data-label="Статус">
                {r.active_status ? (
                  <StatusBadge status={r.active_status} />
                ) : (
                  <span className="resource-ready">
                    <CheckCheck size={15} />
                    Активен
                  </span>
                )}
              </td>
              <td>
                <button
                  className="text-button"
                  onClick={() => onHistory(r.id)}
                  aria-label={`История: ${r.name}`}
                >
                  <History size={16} />
                  <span>История</span>
                  <ArrowUpRight size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function RenewalTable({
  renewals,
  onSelect,
}: {
  renewals: Renewal[];
  onSelect: (id: string) => void;
}) {
  if (!renewals.length)
    return (
      <div className="empty">
        <Layers3 size={30} />
        <h3>Заявок пока нет</h3>
      </div>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ресурс / автор</th>
            <th>Новый срок</th>
            <th>Стоимость</th>
            <th>Статус</th>
            <th>
              <span className="sr-only">Действие</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {renewals.map((r) => (
            <tr key={r.id}>
              <td data-label="Ресурс">
                <div>
                  <strong>{r.resource_name}</strong>
                  <small>{r.creator_name}</small>
                </div>
              </td>
              <td data-label="Новый срок">{date(r.new_expires_on)}</td>
              <td data-label="Стоимость">{money(r.amount_minor)}</td>
              <td data-label="Статус">
                <StatusBadge status={r.status} />
              </td>
              <td>
                <button className="text-button" onClick={() => onSelect(r.id)}>
                  Подробнее
                  <ArrowUpRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
