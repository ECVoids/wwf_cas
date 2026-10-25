-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor para actualizar una base de datos existente.
-- Guarda cada factor aplicado y acumula el producto en profiles.multiplier.

create table if not exists public.multiplier_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  factor numeric(4,2) not null check (factor >= 1 and factor <= 10),
  applied_at timestamptz not null default now()
);
create index if not exists multiplier_events_user_idx
  on public.multiplier_events(user_id, applied_at);

alter table public.multiplier_events enable row level security;
revoke all on public.multiplier_events from anon, authenticated;

-- Amplía el rango del multiplicador acumulado, que ahora es un producto de factores.
alter table public.profiles drop constraint if exists profiles_multiplier_check;
alter table public.profiles alter column multiplier type numeric(16,6)
  using multiplier::numeric(16,6);
alter table public.profiles add constraint profiles_multiplier_check
  check (multiplier >= 1 and multiplier <= 1000000);

-- Migra el multiplicador actual como un factor histórico inicial si aún no hay historial.
-- Los factores reemplazados antes de esta actualización no pueden reconstruirse retroactivamente.
insert into public.multiplier_events(user_id, factor)
select p.id, p.multiplier::numeric(4,2)
from public.profiles p
where p.multiplier > 1
  and not exists (
    select 1 from public.multiplier_events me where me.user_id = p.id
  );

create or replace function public.admin_set_multiplier(
  p_admin_username text,
  p_username text,
  p_multiplier numeric
)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin_name(p_admin_username) then
    raise exception 'Acceso administrativo denegado.';
  end if;
  if p_multiplier < 1 or p_multiplier > 10 then
    raise exception 'El multiplicador adicional debe estar entre ×1 y ×10.';
  end if;

  select * into v_profile
  from public.profiles
  where username = lower(trim(p_username))
  for update;

  if v_profile.id is null then
    raise exception 'Usuario no encontrado.';
  end if;
  if v_profile.multiplier * p_multiplier > 1000000 then
    raise exception 'El multiplicador acumulado supera el límite permitido.';
  end if;

  insert into public.multiplier_events(user_id, factor)
  values (v_profile.id, p_multiplier);

  update public.profiles
  set multiplier = multiplier * p_multiplier
  where id = v_profile.id
  returning * into v_profile;

  return v_profile;
end;
$$;

create or replace function public.get_user_multiplier_events(p_username text)
returns table(id uuid, factor numeric, applied_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid;
begin
  select p.id into v_user_id
  from public.profiles p
  where p.username = lower(trim(p_username));

  if v_user_id is null then
    raise exception 'Usuario no encontrado.';
  end if;

  return query
  select me.id, me.factor, me.applied_at
  from public.multiplier_events me
  where me.user_id = v_user_id
  order by me.applied_at, me.id;
end;
$$;

grant execute on function public.admin_set_multiplier(text, text, numeric) to anon, authenticated;
grant execute on function public.get_user_multiplier_events(text) to anon, authenticated;
