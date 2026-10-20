export const aliases = ['A', 'B', 'C', 'D'] as const;
export type Alias = typeof aliases[number];
export type Allocation = Record<Alias | 'cash', number>;
export const initialWeights: Allocation = { cash: 20, A: 30, B: 20, C: 15, D: 15 };
export const money = (n: number | string) => '₩' + Math.round(Number(n)).toLocaleString('ko-KR');
export const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
export const date = (s: string) => s.slice(0, 10).replaceAll('-', '.');
export const clock = (n: number) => `${String(Math.floor(Math.ceil(n) / 60)).padStart(2, '0')}:${String(Math.ceil(n) % 60).padStart(2, '0')}`;
export function validWeights(w: Allocation) { return Object.values(w).every(n => Number.isFinite(n) && n >= 0 && n <= 100) && Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 1e-8; }
export type Research = {event_id: string; asset_alias: string; published_on: string; document_type: string; public_title: string; public_summary: string};
export type Asset = {alias: string; name: string; category: string; available?: boolean; overview: string; technology?: string; supply?: string; risks?: string[]; document_label?: string};
export type Alert = {id: string; at: string; kind: string; asset: Alias; side?: 'buy'|'sell'; title: string; summary: string; percent?: number; decision: string | null};
export type Trade = {at: string; asset: Alias; side: string; quantity: string; price: string; gross: string; fee: string; reason: string};
export type Game = {mode?: "paper"; fee_rate?: number; id: string; status: 'ready'|'running'|'paused'|'finished'; elapsed: number; now: string; nav: number; cash: number; initial: number; return_pct: number; realized: number; unrealized: number; fees: number; mdd_pct: number; targets: Record<string, string>; guard: string;
  holdings: {average_cost: number; change_pct: number; asset: Alias; quantity: string; price: number; value: number; weight: number; unrealized: number}[];
  chart_asset: string; chart: {time: string; open: number; high: number; low: number; close: number; volume: number}[];
  pending: {kind: string; at: string; asset?: string; side?: string; budget?: string; quantity?: string} | null;
  alerts: Alert[]; choices: {action: string}[]; research: Research[]; trades: Trade[]; history: {time: string; value: number}[];
  identities?: Record<string, string>; baseline_return_pct?: number};
