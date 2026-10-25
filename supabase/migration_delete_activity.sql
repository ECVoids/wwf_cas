-- Feria+: eliminación lógica de actividades.
-- Ejecutar una sola vez en Supabase SQL Editor.
-- Las actividades retiradas desaparecen de los listados, pero permanecen en la base de datos
-- para preservar completions, puntos y trazabilidad.

alter table public.activities
  add column if not exists is_deleted boolean not null default false;

-- Reemplazar el listado administrativo para ocultar actividades eliminadas lógicamente.
create or replace function public.admin_list_activities(p_admin_username text)
returns table(id uuid, name text, description text, points integer, password text, is_active boolean, image_data text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_name(p_admin_username) then
    raise exception 'Acceso administrativo denegado.';
  end if;
  return query
    select a.id, a.name, a.description, a.points, s.password, a.is_active, a.image_data, a.created_at
    from public.activities as a
    join public.activity_secrets as s on s.activity_id = a.id
    where a.is_deleted = false
    order by a.created_at;
end;
$$;

create or replace function public.admin_delete_activity(
  p_admin_username text,
  p_activity_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_name(p_admin_username) then
    raise exception 'Acceso administrativo denegado.';
  end if;

  update public.activities as a
     set is_deleted = true,
         is_active = false,
         updated_at = now()
   where a.id = p_activity_id
     and a.is_deleted = false;

  if not found then
    raise exception 'No se encontró la actividad o ya fue retirada de la feria.';
  end if;

  -- No se borran activities, activity_secrets ni completions: el historial y los puntos quedan intactos.
  return true;
end;
$$;

revoke all on function public.admin_delete_activity(text, uuid) from public;
grant execute on function public.admin_delete_activity(text, uuid) to anon, authenticated;
grant execute on function public.admin_list_activities(text) to anon, authenticated;
