-- ============================================================
-- Comissões — tabela na nuvem (projeto Supabase do app)
-- Cole tudo no SQL Editor do Supabase e clique em RUN.
-- Pode rodar mais de uma vez sem problema (é idempotente).
-- Só cria a tabela comissoes_dados e as regras de segurança dela.
--
-- Também uma vez, no painel: Authentication → Sign In / Providers → Email
-- → desligue "Confirm email". O e-mail grátis do Supabase só chega pra quem
-- é do time do projeto (no máximo 2 por hora): com ele ligado, os amigos não
-- conseguem criar conta. Se quiser confirmação, configure SMTP próprio e o Site URL.
-- No app (nuvem.json) vai só a chave pública (anon / sb_publishable_), nunca a
-- secreta (service_role / sb_secret_): o app recusa e fica só no computador.
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
create policy "comissoes proprios - ler"     on public.comissoes_dados for select to authenticated using (auth.uid() = user_id);
create policy "comissoes proprios - criar"   on public.comissoes_dados for insert to authenticated with check (auth.uid() = user_id);
create policy "comissoes proprios - alterar" on public.comissoes_dados for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Permissões explícitas (o projeto não expõe tabelas novas sozinho):
-- quem não entrou não acessa nada; quem entrou lê, cria e altera (nunca apaga).
revoke all on table public.comissoes_dados from anon;
revoke all on table public.comissoes_dados from authenticated;
grant select, insert, update on table public.comissoes_dados to authenticated;

-- Limite de tamanho por conta (2 MB de dados; imagens não vão pra nuvem)
alter table public.comissoes_dados drop constraint if exists comissoes_tamanho;
alter table public.comissoes_dados add constraint comissoes_tamanho
  check (octet_length(payload::text) <= 2000000 and octet_length(coalesce(dispositivo, '')) <= 100);

-- Hora da última alteração marcada pelo servidor (o relógio do PC não manda)
create or replace function public.comissoes_marcar_atualizacao()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists comissoes_dados_atualizados on public.comissoes_dados;
create trigger comissoes_dados_atualizados before insert or update on public.comissoes_dados
  for each row execute function public.comissoes_marcar_atualizacao();
