export type Status =
  "pending" | "rejected" | "processing" | "completed" | "attention";
export interface User {
  id: string;
  name: string;
  workspace_id: string;
  workspace_name: string;
  can_create: boolean;
  can_approve: boolean;
}
export interface Resource {
  id: string;
  workspace_id: string;
  name: string;
  expires_on: string;
  amount_minor: number;
  currency: "RUB";
  active_request_id: string | null;
  active_status: Status | null;
}
export interface Renewal {
  id: string;
  resource_id: string;
  resource_name: string;
  workspace_id: string;
  created_by: string;
  creator_name: string;
  approved_by: string | null;
  status: Status;
  old_expires_on: string;
  new_expires_on: string;
  amount_minor: number;
  currency: "RUB";
  operation_key: string;
  provider_operation_id: string | null;
  created_at: string;
}
export interface HistoryEntry {
  id: string;
  actor_name: string;
  from_status: Status | null;
  to_status: Status;
  message: string;
  created_at: string;
}
export interface RenewalDetail extends Renewal {
  history: HistoryEntry[];
  post_attempts: number;
  cycle_attempts: number;
  next_attempt_at: string | null;
}
