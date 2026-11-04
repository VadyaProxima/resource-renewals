import { useEffect, useRef, useId, type ReactNode } from "react";
import { X, AlertCircle, LoaderCircle } from "lucide-react";
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      <AlertCircle size={18} />
      {error instanceof Error ? error.message : "Не удалось загрузить данные"}
    </p>
  ) : null;
}
export function Loading() {
  return (
    <p className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Загружаем данные…
    </p>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const callback = useRef(onClose);
  useEffect(() => {
    callback.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current!;
    const focused = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      focused?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        callback.current();
      }}
      aria-labelledby={titleId}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
