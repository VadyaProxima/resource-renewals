import { useState, type KeyboardEvent } from "react";
import { Layers3 } from "lucide-react";
import type { User } from "@/entities/session";
import { useResources } from "@/entities/resource";
import { useRenewals, type Status } from "@/entities/renewal";
import { CreateRenewal } from "@/features/create-renewal";
import { LogoutButton } from "@/features/auth";
import { Loading, ErrorMessage } from "@/shared/ui";
import { ResourceTable, RenewalTable } from "./Tables";
import { RenewalDetail } from "./RenewalDetail";

type Tab = "resources" | "renewals";
export function WorkspacePage({ user }: { user: User }) {
  const resources = useResources();
  const renewals = useRenewals();
  const [tab, setTab] = useState<Tab>("resources");
  const [selected, setSelected] = useState<string | null>(null);
  const [resourceHistory, setResourceHistory] = useState<string | null>(null);
  const rows = renewals.data ?? [];
  const count = (status: Status) =>
    renewals.data ? rows.filter((r) => r.status === status).length : "—";
  const filtered = rows.filter(
    (r) => !resourceHistory || r.resource_id === resourceHistory,
  );
  function changeTab(value: Tab) {
    setTab(value);
    setResourceHistory(null);
  }
  function tabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Tab =
      event.key === "Home"
        ? "resources"
        : event.key === "End"
          ? "renewals"
          : tab === "resources"
            ? "renewals"
            : "resources";
    changeTab(next);
    document.getElementById(`${next}-tab`)?.focus();
  }
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Продления — главная">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          продления<span className="brand-period">.</span>
        </a>
        <div className="account">
          <div>
            <strong>{user.name}</strong>
            <span>
              {[
                user.can_create && "Инициатор",
                user.can_approve && "Согласующий",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <h1>Заявки на продление</h1>
            <p className="subtitle">
              Рабочее пространство: {user.workspace_name}
            </p>
          </div>
        </div>
        <section className="list-card" aria-label="Ресурсы и заявки">
          <div className="summary-counts" aria-label="Сводка заявок">
            <strong>Всего: {renewals.data ? rows.length : "—"}</strong>
            <strong>Ожидают: {count("pending")}</strong>
            <strong>Выполняется: {count("processing")}</strong>
            {count("attention") !== 0 && count("attention") !== "—" && (
              <strong className="needs-attention">
                Требуют внимания: {count("attention")}
              </strong>
            )}
          </div>
          <div className="list-toolbar">
            <div
              className="tabs"
              role="tablist"
              aria-label="Представление"
              onKeyDown={tabKey}
            >
              {(["resources", "renewals"] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  tabIndex={tab === value ? 0 : -1}
                  aria-selected={tab === value}
                  aria-controls="list-panel"
                  id={`${value}-tab`}
                  className={tab === value ? "active" : ""}
                  onClick={() => changeTab(value)}
                >
                  {value === "resources" ? "Ресурсы" : "Заявки"}
                  <span>
                    {value === "resources"
                      ? (resources.data?.length ?? "—")
                      : rows.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div
            id="list-panel"
            role="tabpanel"
            aria-labelledby={`${tab}-tab`}
            tabIndex={0}
          >
            {tab === "resources" ? (
              resources.isPending ? (
                <Loading />
              ) : resources.error ? (
                <ErrorMessage error={resources.error} />
              ) : (
                <ResourceTable
                  resources={resources.data ?? []}
                  onHistory={(id) => {
                    setResourceHistory(id);
                    setTab("renewals");
                  }}
                />
              )
            ) : (
              <>
                {resourceHistory && (
                  <div className="filter-note">
                    История ресурса {resourceHistory}
                    <button
                      className="text-button"
                      onClick={() => setResourceHistory(null)}
                    >
                      Все заявки
                    </button>
                  </div>
                )}
                {renewals.isPending ? (
                  <Loading />
                ) : renewals.error ? (
                  <ErrorMessage error={renewals.error} />
                ) : (
                  <RenewalTable renewals={filtered} onSelect={setSelected} />
                )}
              </>
            )}
          </div>
          <div className="create-action">
            {user.can_create && <CreateRenewal />}
            <span>Продление на 30 календарных дней</span>
          </div>
          <p className="card-update">
            <span className="live-dot" />
            Данные обновляются автоматически
          </p>
        </section>
        <p className="page-note">
          Изменение срока выполняется после согласования и подтверждения
          провайдера.
        </p>
      </main>
      <footer className="site-footer">
        <span>Продления · Тестовое приложение</span>
        <span>Только вымышленные данные</span>
      </footer>
      {selected && (
        <RenewalDetail
          id={selected}
          user={user}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
