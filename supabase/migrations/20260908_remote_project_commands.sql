-- El movil puede pedir "abre esta carpeta" o "cierra esta pestana", ademas de
-- escribir en un agente. Estas dos ordenes nunca lanzan un proceso -solo
-- cambian que pestana esta abierta en el workspace del PC- por eso siguen
-- siendo seguras bajo la misma regla de "el movil nunca ejecuta nada".
alter table public.remote_input drop constraint remote_input_kind_check;
alter table public.remote_input add constraint remote_input_kind_check
  check (kind in ('text', 'key', 'open_project', 'close_project'));
