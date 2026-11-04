export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  const data = await response
    .json()
    .catch(() => ({ message: "Сервер вернул некорректный ответ" }));
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.message ?? "Не удалось выполнить запрос",
    );
  return data as T;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
