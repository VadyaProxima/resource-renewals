import { useSession } from "@/entities/session";
import { WorkspacePage } from "@/pages/workspace";
import { LoginPage } from "@/pages/login";
import { Loading, ErrorMessage } from "@/shared/ui";
export function App() {
  const session = useSession();
  if (session.isPending)
    return (
      <main className="startup">
        <Loading />
      </main>
    );
  if (session.error)
    return (
      <main className="startup">
        <ErrorMessage error={session.error} />
        <button
          className="button secondary"
          onClick={() => void session.refetch()}
        >
          Повторить загрузку
        </button>
      </main>
    );
  return session.data ? <WorkspacePage user={session.data} /> : <LoginPage />;
}
