-- Mando a distancia de Oruka: el movil mira y habla, el PC obedece.
--
-- Tres tablas y nada mas. El PC publica lo que pasa (remote_hosts y
-- remote_output) y recoge lo que el movil deja escrito (remote_input). El movil
-- nunca ejecuta nada: solo escribe en una mesa que el PC vigila.
--
-- Ninguna de estas tablas toca projects, ideas ni user_entitlements.

-- ---------------------------------------------------------------------------
-- Un PC que se ofrece como mando a distancia.
-- ---------------------------------------------------------------------------
create table if not exists public.remote_hosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Como se llama este equipo en la lista del movil.
  name text not null check (char_length(name) between 1 and 120),
  -- Lo que hay abierto ahora mismo: proyectos, agentes y su actividad.
  -- Va en jsonb a proposito: la forma del workspace cambia a menudo y no
  -- queremos una migracion cada vez que se anade un campo a un agente.
  state jsonb not null default '{}'::jsonb,
  -- El interruptor. Viene apagado: encenderlo es una decision consciente.
  online boolean not null default false,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists remote_hosts_user_idx on public.remote_hosts (user_id);

-- ---------------------------------------------------------------------------
-- Trozos de salida de una sesion, ya sin escapes ANSI.
-- ---------------------------------------------------------------------------
create table if not exists public.remote_output (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  host_id uuid not null references public.remote_hosts(id) on delete cascade,
  -- El id de sesion del PTY, tal cual lo usa el escritorio.
  session_id text not null check (char_length(session_id) between 1 and 200),
  -- Bytes que la sesion lleva emitidos contando ya este trozo.
  -- Es el mismo contador que usa el escritorio para repintar sin duplicar:
  -- quien se reengancha pide lo que pase de su ultimo seq.
  seq bigint not null,
  text text not null,
  created_at timestamptz not null default now(),
  -- Reenviar el mismo trozo dos veces no crea dos filas.
  unique (host_id, session_id, seq)
);

create index if not exists remote_output_stream_idx
  on public.remote_output (host_id, session_id, seq);

create index if not exists remote_output_created_idx
  on public.remote_output (created_at);

-- ---------------------------------------------------------------------------
-- Lo que el movil quiere teclear en una sesion.
-- ---------------------------------------------------------------------------
create table if not exists public.remote_input (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  host_id uuid not null references public.remote_hosts(id) on delete cascade,
  session_id text not null check (char_length(session_id) between 1 and 200),
  -- 'text' escribe y pulsa enter. 'key' manda una tecla suelta (escape,
  -- interrumpir). Se separan porque una tecla no es una frase y confundirlas
  -- deja al agente esperando para siempre.
  kind text not null default 'text' check (kind in ('text', 'key')),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  -- Cuando el PC lo metio de verdad en el PTY. Null es «todavia no».
  applied_at timestamptz
);

-- Lo que el PC busca al despertar: lo suyo y sin aplicar.
create index if not exists remote_input_pending_idx
  on public.remote_input (host_id, created_at)
  where applied_at is null;

-- ---------------------------------------------------------------------------
-- Candados. Cada fila es de quien la creo, y de nadie mas.
-- ---------------------------------------------------------------------------
alter table public.remote_hosts enable row level security;
alter table public.remote_output enable row level security;
alter table public.remote_input enable row level security;

drop policy if exists remote_hosts_owner on public.remote_hosts;
create policy remote_hosts_owner on public.remote_hosts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists remote_output_owner on public.remote_output;
create policy remote_output_owner on public.remote_output
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists remote_input_owner on public.remote_input;
create policy remote_input_owner on public.remote_input
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Avisar en directo. Sin esto el movil tendria que preguntar en bucle.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.remote_hosts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.remote_output;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.remote_input;
  exception when duplicate_object then null;
  end;
end $$;

-- El movil necesita ver la fila entera al actualizar, no solo la clave, para
-- poder tachar un mensaje ya aplicado sin volver a preguntar.
alter table public.remote_input replica identity full;

-- ---------------------------------------------------------------------------
-- Barrido. La pantalla de un agente puede llevar codigo y rutas: no se guarda
-- mas de lo imprescindible.
-- ---------------------------------------------------------------------------
create or replace function public.purge_remote_traffic()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.remote_output where created_at < now() - interval '24 hours';
  delete from public.remote_input where created_at < now() - interval '24 hours';
$$;

revoke all on function public.purge_remote_traffic() from public;
revoke all on function public.purge_remote_traffic() from anon;
revoke all on function public.purge_remote_traffic() from authenticated;
