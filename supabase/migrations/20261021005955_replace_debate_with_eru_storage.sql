-- Debate project → ERU 전환. 토론 데이터·스키마는 로컬 비공개 백업 후 실행한다.
-- 다른 프로젝트 및 Supabase 관리 스키마를 초기화하지 않는다.
begin;

drop table public.comments;
drop table public.ai_summaries;
drop table public.debates;
drop table public.admin_users;
drop function public.is_admin();
drop function public.set_updated_at();

create table public.eru_game_sessions (
    environment text not null check (environment in ('production', 'preview', 'development')),
    id uuid not null,
    state jsonb not null check (jsonb_typeof(state) = 'object'),
    last_seen double precision not null check (last_seen > 0 and last_seen < 'Infinity'::double precision),
    revision bigint not null default 1 check (revision > 0),
    primary key (environment, id)
);

create table public.eru_market_bundles (
    id text primary key check (id = 'alpha-v1'),
    body_base64 text not null,
    sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
    created_at timestamptz not null default now()
);

alter table public.eru_game_sessions enable row level security;
alter table public.eru_market_bundles enable row level security;
revoke all on public.eru_game_sessions, public.eru_market_bundles from public, anon, authenticated;
grant select, insert, update on public.eru_game_sessions to service_role;
grant select, insert on public.eru_market_bundles to service_role;

comment on table public.eru_game_sessions is 'ERU 서버 전용 세션. 브라우저 접근 금지. revision을 비교한 조건부 갱신만 사용.';
comment on table public.eru_market_bundles is '검증된 실제 일봉의 비공개 빌드 원본. 브라우저 응답에 포함하지 않음.';

commit;
