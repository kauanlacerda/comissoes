-- ============================================================
-- Comissões — tabela na nuvem (projeto Supabase do app)
-- Cole tudo no SQL Editor do Supabase e clique em RUN.
-- Pode rodar mais de uma vez sem problema (é idempotente).
-- Só cria a tabela comissoes_dados e as regras de segurança dela.
-- ============================================================

-- Uma linha por conta, com todos os dados do app em JSON
-- (é o mesmo formato do arquivo local, então a sincronização é direta).
create table if not exists public.comissoes_dados (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  payload       jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  dispositivo   text
);

-- Segurança: cada conta só enxerga e altera a própria linha
alter table public.comissoes_dados enable row level security;

drop policy if exists "comissoes proprios - ler"     on public.comissoes_dados;
drop policy if exists "comissoes proprios - criar"   on public.comissoes_dados;
drop policy if exists "comissoes proprios - alterar" on public.comissoes_dados;
create policy "comissoes proprios - ler"     on public.comissoes_dados for select using (auth.uid() = user_id);
create policy "comissoes proprios - criar"   on public.comissoes_dados for insert with check (auth.uid() = user_id);
create policy "comissoes proprios - alterar" on public.comissoes_dados for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Hora da última alteração marcada pelo servidor (o relógio do PC não manda)
create or replace function public.comissoes_marcar_atualizacao()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists comissoes_dados_atualizados on public.comissoes_dados;
create trigger comissoes_dados_atualizados before insert or update on public.comissoes_dados
  for each row execute function public.comissoes_marcar_atualizacao();
