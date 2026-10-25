-- Feria+ — esquema inicial para Supabase (PostgreSQL)
-- IMPORTANTE: este esquema implementa el acceso por nombre solicitado, NO identidad autenticada.
-- Cualquier visitante puede suplantar un username. Antes de usar con premios reales, habilita
-- Supabase Auth para participantes y autenticación administrativa separada; ajusta las funciones
-- para derivar user_id de auth.uid() en lugar de confiar en parámetros enviados por el navegador.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and char_length(username) between 3 and 30),
  multiplier numeric(16,6) not null default 1 check (multiplier >= 1 and multiplier <= 1000000),
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 90),
  description text not null check (char_length(description) between 1 and 500),
  points integer not null check (points between 1 and 100000),
  is_active boolean not null default true,
  is_deleted boolean not null default false,
  image_data text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Contraseñas en tabla separada: no se exponen en el listado público de actividades.
create table if not exists public.activity_secrets (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  password text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  activity_id uuid not null references public.activities(id) on delete restrict,
  points_awarded integer not null check (points_awarded >= 0),
  completed_at timestamptz not null default now(),
  unique (user_id, activity_id)
);

create index if not exists completions_user_idx on public.completions(user_id);
create index if not exists completions_activity_idx on public.completions(activity_id);

-- Historial de factores adicionales aplicados a cada participante.
create table if not exists public.multiplier_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  factor numeric(4,2) not null check (factor >= 1 and factor <= 10),
  applied_at timestamptz not null default now()
);
create index if not exists multiplier_events_user_idx on public.multiplier_events(user_id, applied_at);

alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.activity_secrets enable row level security;
alter table public.completions enable row level security;
alter table public.multiplier_events enable row level security;

-- Catálogo público: jamás incluye la contraseña.
drop policy if exists "Anyone can read active activities" on public.activities;
create policy "Anyone can read active activities" on public.activities for select to anon, authenticated using (true);
drop policy if exists "Public can read profiles" on public.profiles;
create policy "Public can read profiles" on public.profiles for select to anon, authenticated using (true);
-- No se crean políticas de acceso directo a activity_secrets o completions.
-- El acceso de lectura/escritura a estas tablas se realiza por funciones controladas.

grant select on public.activities to anon, authenticated;
grant select on public.profiles to anon, authenticated;
revoke all on public.activity_secrets from anon, authenticated;
revoke all on public.completions from anon, authenticated;
revoke all on public.multiplier_events from anon, authenticated;
revoke insert, update, delete on public.activities from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;

-- Cambia el valor por el nombre reservado para el panel administrativo.
-- Este parámetro es una barrera lógica, NO una prueba de identidad si solo se pide username.
create or replace function public.is_admin_name(p_username text)
returns boolean language sql immutable as $$
  select lower(trim(coalesce(p_username, ''))) = 'admin-feria';
$$;

create or replace function public.register_or_get_profile(p_username text)
returns setof public.profiles
language plpgsql security definer set search_path = public as $$
declare v_username text := lower(trim(normalize(coalesce(p_username, ''), NFKC)));
begin
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then raise exception 'Nombre de usuario inválido.'; end if;
  if public.is_admin_name(v_username) then raise exception 'Ese nombre está reservado.'; end if;
  insert into public.profiles(username) values (v_username) on conflict (username) do nothing;
  return query select * from public.profiles p where p.username = v_username;
end; $$;

create or replace function public.get_user_completions(p_username text)
returns table(activity_id uuid, points_awarded integer, completed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid;
begin
  select id into v_user_id from public.profiles where username = lower(trim(p_username));
  if v_user_id is null then raise exception 'Usuario no encontrado.'; end if;
  return query select c.activity_id, c.points_awarded, c.completed_at from public.completions c where c.user_id = v_user_id order by c.completed_at;
end; $$;

create or replace function public.complete_activity(p_username text, p_activity_id uuid, p_password text)
returns table(activity_id uuid, points_awarded integer, completed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid; v_points integer; v_expected text; v_active boolean;
begin
  select id into v_user_id from public.profiles where username = lower(trim(p_username));
  if v_user_id is null then raise exception 'Usuario no encontrado.'; end if;
  select a.points, a.is_active, s.password into v_points, v_active, v_expected
  from public.activities a join public.activity_secrets s on s.activity_id = a.id where a.id = p_activity_id;
  if v_expected is null then raise exception 'Actividad no encontrada.'; end if;
  if not v_active then raise exception 'Esta actividad está inactiva.'; end if;
  if upper(trim(p_password)) <> upper(v_expected) then raise exception 'La contraseña no es correcta.'; end if;
  insert into public.completions(user_id, activity_id, points_awarded) values (v_user_id, p_activity_id, v_points)
  on conflict (user_id, activity_id) do nothing;
  if not found then raise exception 'Esta actividad ya fue completada.'; end if;
  return query select c.activity_id, c.points_awarded, c.completed_at from public.completions c where c.user_id = v_user_id and c.activity_id = p_activity_id;
end; $$;

create or replace function public.admin_list_activities(p_admin_username text)
returns table(id uuid, name text, description text, points integer, password text, is_active boolean, image_data text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  return query select a.id, a.name, a.description, a.points, s.password, a.is_active, a.image_data, a.created_at
    from public.activities a join public.activity_secrets s on s.activity_id = a.id where a.is_deleted = false order by a.created_at;
end; $$;

create or replace function public.admin_create_activity(p_admin_username text, p_name text, p_description text, p_points integer, p_password text, p_image_data text default null)
returns public.activities
language plpgsql security definer set search_path = public as $$
declare v_activity public.activities;
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  if trim(coalesce(p_name,'')) = '' or trim(coalesce(p_description,'')) = '' then raise exception 'Nombre y descripción son obligatorios.'; end if;
  if p_points < 1 or p_points > 100000 then raise exception 'Puntaje fuera de rango.'; end if;
  insert into public.activities(name, description, points, image_data) values (trim(p_name), trim(p_description), p_points, p_image_data) returning * into v_activity;
  insert into public.activity_secrets(activity_id, password) values (v_activity.id, upper(trim(p_password)));
  return v_activity;
end; $$;

create or replace function public.admin_update_activity(p_admin_username text, p_activity_id uuid, p_name text, p_description text, p_points integer, p_is_active boolean, p_image_data text default null)
returns public.activities
language plpgsql security definer set search_path = public as $$
declare v_activity public.activities;
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  update public.activities set name = trim(p_name), description = trim(p_description), points = p_points, is_active = p_is_active, image_data = p_image_data, updated_at = now()
    where id = p_activity_id returning * into v_activity;
  if v_activity.id is null then raise exception 'Actividad no encontrada.'; end if;
  return v_activity;
end; $$;

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

create or replace function public.admin_set_multiplier(p_admin_username text, p_username text, p_multiplier numeric)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles;
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  if p_multiplier < 1 or p_multiplier > 10 then raise exception 'El multiplicador adicional debe estar entre ×1 y ×10.'; end if;
  select * into v_profile from public.profiles where username = lower(trim(p_username)) for update;
  if v_profile.id is null then raise exception 'Usuario no encontrado.'; end if;
  if v_profile.multiplier * p_multiplier > 1000000 then raise exception 'El multiplicador acumulado supera el límite permitido.'; end if;
  insert into public.multiplier_events(user_id, factor) values (v_profile.id, p_multiplier);
  update public.profiles set multiplier = multiplier * p_multiplier where id = v_profile.id returning * into v_profile;
  return v_profile;
end; $$;

create or replace function public.get_user_multiplier_events(p_username text)
returns table(id uuid, factor numeric, applied_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid;
begin
  select p.id into v_user_id from public.profiles p where p.username = lower(trim(p_username));
  if v_user_id is null then raise exception 'Usuario no encontrado.'; end if;
  return query select me.id, me.factor, me.applied_at from public.multiplier_events me where me.user_id = v_user_id order by me.applied_at, me.id;
end; $$;

create or replace function public.admin_list_profiles(p_admin_username text)
returns table(id uuid, username text, multiplier numeric, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_name(p_admin_username) then raise exception 'Acceso administrativo denegado.'; end if;
  return query select p.id, p.username, p.multiplier, p.created_at from public.profiles p order by p.username;
end; $$;

-- Las funciones security definer se pueden llamar desde el cliente anon; las validaciones
-- anteriores limitan operaciones, pero el esquema username-only no impide suplantación.
grant execute on function public.register_or_get_profile(text) to anon, authenticated;
grant execute on function public.get_user_completions(text) to anon, authenticated;
grant execute on function public.complete_activity(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_list_activities(text) to anon, authenticated;
grant execute on function public.admin_create_activity(text, text, text, integer, text, text) to anon, authenticated;
grant execute on function public.admin_update_activity(text, uuid, text, text, integer, boolean, text) to anon, authenticated;
grant execute on function public.admin_set_multiplier(text, text, numeric) to anon, authenticated;
grant execute on function public.get_user_multiplier_events(text) to anon, authenticated;
grant execute on function public.admin_list_profiles(text) to anon, authenticated;

-- Para el despliegue real, no dejes la autorización administrativa basada solo en un nombre.
-- Añade Supabase Auth y valida auth.uid() contra una tabla de roles; elimina la confianza en p_admin_username.


-- Habilita actualizaciones en tiempo real si aún no están publicadas.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activities') then
      alter publication supabase_realtime add table public.activities;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'completions') then
      alter publication supabase_realtime add table public.completions;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
      alter publication supabase_realtime add table public.profiles;
    end if;
  end if;
end $$;

grant execute on function public.admin_delete_activity(text, uuid) to anon, authenticated;
