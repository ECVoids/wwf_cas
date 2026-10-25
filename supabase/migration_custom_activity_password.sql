-- WWF Juntos por la vida: permitir que el administrador defina y edite la contraseña de cada actividad.
-- Ejecutar una sola vez en Supabase SQL Editor.

create or replace function public.admin_update_activity(
  p_admin_username text,
  p_activity_id uuid,
  p_name text,
  p_description text,
  p_points integer,
  p_is_active boolean,
  p_image_data text,
  p_password text
)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity public.activities;
  v_password text := upper(trim(coalesce(p_password, '')));
begin
  if not public.is_admin_name(p_admin_username) then
    raise exception 'Acceso administrativo denegado.';
  end if;
  if trim(coalesce(p_name, '')) = '' or trim(coalesce(p_description, '')) = '' then
    raise exception 'Nombre y descripción son obligatorios.';
  end if;
  if p_points < 1 or p_points > 100000 then
    raise exception 'Puntaje fuera de rango.';
  end if;
  if v_password = '' then
    raise exception 'La contraseña personalizada es obligatoria.';
  end if;

  update public.activities as a
  set name = trim(p_name), description = trim(p_description), points = p_points,
      is_active = p_is_active, image_data = p_image_data, updated_at = now()
  where a.id = p_activity_id and a.is_deleted = false
  returning a.* into v_activity;

  if v_activity.id is null then
    raise exception 'Actividad no encontrada o retirada de la feria.';
  end if;

  update public.activity_secrets as s
  set password = v_password
  where s.activity_id = p_activity_id;

  if not found then
    insert into public.activity_secrets(activity_id, password)
    values (p_activity_id, v_password);
  end if;

  return v_activity;
exception
  when unique_violation then
    raise exception 'Esta contraseña ya está asignada a otra actividad. Elige una contraseña diferente.';
end;
$$;

grant execute on function public.admin_update_activity(text, uuid, text, text, integer, boolean, text, text) to anon, authenticated;
