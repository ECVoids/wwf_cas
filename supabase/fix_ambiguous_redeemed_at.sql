-- Corrección para la función de canje ya instalada. Ejecutar en Supabase SQL Editor.

create or replace function public.admin_redeem_points(
  p_admin_username text,
  p_username text,
  p_points integer,
  p_reward_description text default 'Canje de premio'
)
returns table(
  username text,
  points_before bigint,
  points_deducted integer,
  points_after bigint,
  redeemed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_base bigint;
  v_redeemed bigint;
  v_available bigint;
  v_description text;
  v_redeemed_at timestamptz;
begin
  if not public.is_admin_name(p_admin_username) then
    raise exception 'Acceso administrativo denegado.';
  end if;

  if p_points is null or p_points <= 0 then
    raise exception 'La cantidad a descontar debe ser un entero mayor que cero.';
  end if;

  v_description := coalesce(nullif(trim(p_reward_description), ''), 'Canje de premio');
  if char_length(v_description) > 120 then
    raise exception 'La descripción del premio no puede superar 120 caracteres.';
  end if;

  -- Serializa canjes concurrentes del mismo participante.
  select p.* into v_profile
  from public.profiles p
  where p.username = lower(trim(p_username))
  for update;

  if v_profile.id is null then
    raise exception 'Usuario no encontrado.';
  end if;

  select coalesce(sum(c.points_awarded), 0)::bigint into v_base
  from public.completions c
  where c.user_id = v_profile.id;

  select coalesce(sum(r.points_deducted), 0)::bigint into v_redeemed
  from public.point_redemptions r
  where r.user_id = v_profile.id;

  v_available := greatest(0, round(v_base * v_profile.multiplier)::bigint - v_redeemed);

  if p_points::bigint > v_available then
    raise exception 'Saldo insuficiente. Puntos disponibles: %.', v_available;
  end if;

  insert into public.point_redemptions as pr(
    user_id, points_deducted, reward_description, admin_username
  )
  values (
    v_profile.id, p_points, v_description, lower(trim(p_admin_username))
  )
  returning pr.redeemed_at into v_redeemed_at;

  return query select
    v_profile.username,
    v_available,
    p_points,
    v_available - p_points::bigint,
    v_redeemed_at;
end;
$$;

