-- Vincular un telefono escaneando un QR.
--
-- El problema: el movil necesita una sesion para leer nada, y escribir un
-- correo y una contrasena en un telefono es justo lo que el QR viene a evitar.
--
-- La solucion: el escritorio deja aqui su sesion bajo un codigo de un solo uso,
-- y el QR ensena **solo el codigo**. Asi la sesion nunca esta en la foto: quien
-- fotografie la pantalla se lleva doce letras que caducan en cinco minutos y
-- que ademas mueren en cuanto el telefono las usa.

create table if not exists public.remote_pairings (
  -- Doce caracteres. No es un secreto largo, es un secreto CORTO Y EFIMERO:
  -- vive cinco minutos y se borra al primer uso.
  code text primary key check (char_length(code) between 8 and 32),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- La sesion, en JSON. Nadie puede leer esta columna desde un cliente: no hay
  -- ninguna regla que permita mirar esta tabla. Solo sale por la funcion de
  -- abajo, que la entrega una vez y borra la fila.
  payload text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists remote_pairings_expira_idx
  on public.remote_pairings (expires_at);

alter table public.remote_pairings enable row level security;

-- El escritorio puede crear y retirar sus propios codigos. Nadie puede LEERLOS,
-- ni siquiera su dueno: para eso esta la funcion, que es de un solo uso.
drop policy if exists remote_pairings_crear on public.remote_pairings;
create policy remote_pairings_crear on public.remote_pairings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists remote_pairings_borrar on public.remote_pairings;
create policy remote_pairings_borrar on public.remote_pairings
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Canjea un codigo: devuelve la sesion y borra la fila.
--
-- La llama el telefono, que todavia no tiene sesion, asi que tiene que poder
-- ejecutarla sin haber entrado. Por eso es `security definer` y por eso hace
-- las comprobaciones aqui dentro: que el codigo existe, que no ha caducado, y
-- que nadie lo use dos veces.
create or replace function public.canjear_vinculacion(codigo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  guardado text;
begin
  -- Borrar y devolver en el mismo paso: no hay hueco entre comprobar y gastar,
  -- asi que dos telefonos no pueden canjear el mismo codigo a la vez.
  delete from public.remote_pairings
  where code = codigo and expires_at > now()
  returning payload into guardado;

  -- De paso se lleva la basura: un codigo que nadie uso no puede quedarse ahi.
  delete from public.remote_pairings where expires_at < now();

  return guardado;
end;
$$;

revoke all on function public.canjear_vinculacion(text) from public;
grant execute on function public.canjear_vinculacion(text) to anon, authenticated;
