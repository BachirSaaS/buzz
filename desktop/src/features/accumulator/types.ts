export type ChiefScope = { relay: string; pubkey: string };
export type ChiefStatus = ChiefScope & {
  connection: string;
  backfill_complete: boolean;
  total_events: number;
};
export type Selection = {
  channels?: string[];
  authors?: string[];
  threads?: string[];
  kinds?: number[];
  tags?: string[][];
  since?: number;
  until_exclusive?: number;
};
export type Fold = {
  name: string;
  spec: {
    selection: Selection;
    model: string;
    instructions: string;
    meta?: { title?: string };
  };
  latest_version: number | null;
  last_error: string | null;
};
export type Coverage = {
  processed: number;
  pending: number;
  complete: boolean;
};
export type Preflight = {
  plan: "ready" | "cached" | "stalled";
  coverage: Coverage;
  shown?: number;
  reason?: string;
  estimate?: { est_input_tokens: number };
  model_input?: string;
};
export type Artifact = {
  fold: string;
  version: number;
  output: string;
  shown_ids: string[];
  channels: string[];
  model: string;
  created_at: number;
  selection: Selection;
};
export type SourceEvent = {
  id: string;
  channel: string | null;
  parent: string | null;
  thread_root: string | null;
  pubkey: string;
  author_name: string | null;
  kind: number;
  created_at: number;
  content: string;
};
export type Model = { id: string; name: string };
export type RunOutcome = {
  status: "folded" | "cached" | "stalled" | "unpublished";
  reason?: string;
  model_output?: string;
};
