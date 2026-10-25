-- Feria+: imágenes opcionales para actividades. Ejecutar una sola vez en Supabase SQL Editor.
-- Las imágenes se guardan como data URL en image_data; limitar desde la interfaz a 400 KB.

alter table public.activities add column if not exists image_data text;

-- Eliminar las versiones antiguas para que PostgREST no encuentre funciones sobrecargadas ambiguas.
drop function if exists public.admin_list_activities(text);
drop function if exists public.admin_create_activity(text, text, text, integer, text);
drop function if exists public.admin_update_activity(text, uuid, text, text, integer, boolean);

create function public.admin_list_activities(p_admin_username text)
returns table(id uuid, name text, description text, points integer, password text, is_active boolean, image_data text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  return query select a.id, a.name, a.description, a.points, s.password, a.is_active, a.image_data, a.created_at
    from public.activities a join public.activity_secrets s on s.activity_id = a.id order by a.created_at;
end; $$;

create function public.admin_create_activity(p_admin_username text, p_name text, p_description text, p_points integer, p_password text, p_image_data text default null)
returns public.activities
language plpgsql security definer set search_path = public as $$
declare v_activity public.activities;
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  if trim(coalesce(p_name,'')) = '' or trim(coalesce(p_description,'')) = '' then raise exception 'Nombre y descripción son obligatorios.'; end if;
  if p_points < 1 or p_points > 100000 then raise exception 'Puntaje fuera de rango.'; end if;
  if p_image_data is not null and length(p_image_data) > 600000 then raise exception 'La imagen supera el tamaño permitido.'; end if;
  insert into public.activities(name, description, points, image_data) values (trim(p_name), trim(p_description), p_points, p_image_data) returning * into v_activity;
  insert into public.activity_secrets(activity_id, password) values (v_activity.id, upper(trim(p_password)));
  return v_activity;
end; $$;

create function public.admin_update_activity(p_admin_username text, p_activity_id uuid, p_name text, p_description text, p_points integer, p_is_active boolean, p_image_data text default null)
returns public.activities
language plpgsql security definer set search_path = public as $$
declare v_activity public.activities;
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  if p_image_data is not null and length(p_image_data) > 600000 then raise exception 'La imagen supera el tamaño permitido.'; end if;
  update public.activities set name = trim(p_name), description = trim(p_description), points = p_points, is_active = p_is_active, image_data = p_image_data, updated_at = now()
    where id = p_activity_id returning * into v_activity;
  if v_activity.id is null then raise exception 'Actividad no encontrada.'; end if;
  return v_activity;
end; $$;

grant execute on function public.admin_list_activities(text) to anon, authenticated;
grant execute on function public.admin_create_activity(text, text, text, integer, text, text) to anon, authenticated;
grant execute on function public.admin_update_activity(text, uuid, text, text, integer, boolean, text) to anon, authenticated;
