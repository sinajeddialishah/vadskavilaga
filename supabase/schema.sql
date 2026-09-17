-- Run once in your own Supabase SQL Editor. See README.md for the owner allowlist.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.allowed_emails (email text primary key check (email = lower(email)));
revoke all on private.allowed_emails from public, anon, authenticated;

-- Run separately after this script, with YOUR Google email:
-- insert into private.allowed_emails (email) values (lower('your-google-email@example.com'));

create function public.is_app_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->'app_metadata'->'providers') ? 'google', false)
    and exists (select 1 from private.allowed_emails e where e.email = lower(auth.jwt()->>'email'));
$$;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tags text[] not null default array['Snabbt','Billigt','Matlådevänligt','Frysvänligt','Få ingredienser','Lättlagat','Allt i en gryta','Storkok','Helgmat','Bjudmat'],
  created_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  protein text not null check (protein in ('Kyckling','Rött kött','Köttfärs','Övrigt')),
  carb text not null check (carb in ('Ris','Pasta','Potatis','Couscous','Bröd','Övrigt')),
  minutes integer not null check (minutes between 1 and 1440),
  ingredients jsonb not null check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) between 1 and 100),
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 100),
  tags text[] not null default '{}',
  notes text not null default '' check (char_length(notes) <= 10000),
  favorite boolean not null default false,
  image_path text,
  starter_image boolean not null default false,
  source_url text,
  source_label text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_user_id_idx on public.recipes(user_id);

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
revoke all on public.profiles, public.recipes from anon;
grant select, insert, update, delete on public.profiles, public.recipes to authenticated;

create policy "Owner profile" on public.profiles for all to authenticated
using ((select public.is_app_owner()) and user_id = (select auth.uid()))
with check ((select public.is_app_owner()) and user_id = (select auth.uid()));
create policy "Owner recipes" on public.recipes for all to authenticated
using ((select public.is_app_owner()) and user_id = (select auth.uid()))
with check ((select public.is_app_owner()) and user_id = (select auth.uid())
  and (image_path is null or starts_with(image_path, (select auth.uid())::text || '/')));

create function public.touch_recipe() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger recipe_updated before update on public.recipes for each row execute function public.touch_recipe();

-- Transactional initialization: seed exactly once, even across two simultaneous logins.
-- Deleting the starter recipe does not make it reappear next time.
create function public.initialize_library() returns void
language plpgsql security invoker set search_path = '' as $$
declare inserted integer;
begin
  if not public.is_app_owner() then raise exception 'Endast ägaren har tillgång till receptboken' using errcode = '42501'; end if;
  insert into public.profiles(user_id) values (auth.uid()) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then
    insert into public.recipes(user_id,title,protein,carb,minutes,ingredients,steps,tags,starter_image,source_url,source_label)
    values (
      auth.uid(), 'Fläskpannkaka', 'Övrigt', 'Övrigt', 45,
      '[{"amount":1,"unit":"paket","name":"färdigtärnat bacon"},{"amount":4,"unit":"dl","name":"vetemjöl"},{"amount":8,"unit":"dl","name":"mjölk"},{"amount":4,"unit":"st","name":"ägg"},{"amount":null,"unit":"","name":"rårörda lingon till servering"}]'::jsonb,
      '["Sätt ugnen på 200 °C.","Fördela baconet på en plåt med höga kanter. Ställ in i ugnen och låt baconet stekas knaprigt.","Vispa ner 4 dl vetemjöl i 8 dl mjölk till en slät smet. Vispa sedan ner äggen.","Häll ägg-, mjölk- och mjölblandningen över baconet på plåten.","Grädda i cirka 30 minuter, tills pannkakan har stannat i mitten och fått fin färg. Tiden kan variera mellan ugnar.","Servera med rårörda lingon."]'::jsonb,
      array['Få ingredienser','Lättlagat','Matlådevänligt'], true,
      'https://www.hemkop.se/recept/flaskpannkaka', 'Egen variant av Hemköps grundrecept'
    );
  end if;
end;
$$;
revoke all on function public.initialize_library() from public, anon;
grant execute on function public.initialize_library() to authenticated;

create function public.add_recipe_tag(new_tag text) returns text[]
language plpgsql security invoker set search_path = '' as $$
declare cleaned text := trim(new_tag); current_tags text[];
begin
  if not public.is_app_owner() then raise exception 'Endast ägaren har tillgång till receptboken' using errcode = '42501'; end if;
  if char_length(cleaned) not between 1 and 30 then raise exception 'Taggen måste vara 1–30 tecken'; end if;
  select tags into current_tags from public.profiles where user_id = auth.uid() for update;
  if current_tags is null then raise exception 'Receptboken behöver öppnas först'; end if;
  if exists(select 1 from unnest(current_tags) as t where lower(t) = lower(cleaned)) then return current_tags; end if;
  update public.profiles set tags = array_append(tags, cleaned) where user_id = auth.uid() returning tags into current_tags;
  return current_tags;
end;
$$;
revoke all on function public.add_recipe_tag(text) from public, anon;
grant execute on function public.add_recipe_tag(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('recipe-photos','recipe-photos',false,2097152,array['image/jpeg']);

create policy "Owner photo read" on storage.objects for select to authenticated
using (bucket_id = 'recipe-photos' and (select public.is_app_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owner photo insert" on storage.objects for insert to authenticated
with check (bucket_id = 'recipe-photos' and (select public.is_app_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owner photo delete" on storage.objects for delete to authenticated
using (bucket_id = 'recipe-photos' and (select public.is_app_owner()) and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
