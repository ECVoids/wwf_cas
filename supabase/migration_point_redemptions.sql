-- Canje de premios para WWF Juntos por la vida.
-- Ejecutar UNA SOLA VEZ en Supabase > SQL Editor.
-- Los canjes se registran como movimientos independientes; no se borran completions.
-- La función bloquea el perfil del participante durante el canje para evitar dobles descuentos concurrentes.

create table if not exists public.point_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  points_deducted integer not null check (points_deducted > 0),
  reward_description text not null default 'Canje de premio'
    check (char_length(reward_description) between 1 and 120),
  admin_username text not null,
  redeemed_at timestamptz not null default now()
);

create index if not exists point_redemptions_user_idx
  on public.point_redemptions(user_id, redeemed_at desc);

alter table public.point_redemptions enable row level security;
revoke all on public.point_redemptions from anon, authenticated;

create or replace function public.get_user_redemption_total(p_username text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_total bigint;
begin
  select p.id into v_user_id
  from public.profiles p
  where p.username = lower(trim(p_username));

  if v_user_id is null then
    raise exception 'Usuario no encontrado.';
  end if;

  select coalesce(sum(r.points_deducted), 0)::bigint into v_total
  from public.point_redemptions r
  where r.user_id = v_user_id;

  return v_total;
end;
$$;

create or replace function public.admin_get_points_balance(
  p_admin_username text,
  p_username text
)
returns table(
  username text,
  base_points bigint,
  multiplier numeric,
  redeemed_points bigint,
  available_points bigint
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
begin
  if not public.is_admin_name(p_admin_username) then
    raise exception 'Acceso administrativo denegado.';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.username = lower(trim(p_username));

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

  return query select
    v_profile.username,
    v_base,
    v_profile.multiplier,
    v_redeemed,
    v_available;
end;
$$;

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

revoke all on function public.get_user_redemption_total(text) from public;
revoke all on function public.admin_get_points_balance(text, text) from public;
revoke all on function public.admin_redeem_points(text, text, integer, text) from public;

grant execute on function public.get_user_redemption_total(text) to anon, authenticated;
grant execute on function public.admin_get_points_balance(text, text) to anon, authenticated;
grant execute on function public.admin_redeem_points(text, text, integer, text) to anon, authenticated;


-- Habilita eventos en tiempo real para actualizar el saldo del participante si está conectado.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'point_redemptions'
    ) then
      alter publication supabase_realtime add table public.point_redemptions;
    end if;
  end if;
end $$;
