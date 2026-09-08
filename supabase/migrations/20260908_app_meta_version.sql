-- El movil no puede leer el latest.json de GitHub: ese archivo no trae los
-- encabezados de CORS que un navegador exige para dejarlo leer desde una
-- pagina web (funciona con curl, no con fetch). Se guarda la version aqui en
-- su lugar, que si acepta lecturas desde el navegador.
create table if not exists public.app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_meta enable row level security;

-- De solo lectura para cualquiera con sesion: es un numero de version, no un
-- dato de nadie en concreto. Escribirlo queda fuera del alcance de RLS a
-- proposito -solo se hace con acceso privilegiado al publicar una version.
create policy "app_meta_select" on public.app_meta
  for select
  to authenticated, anon
  using (true);
