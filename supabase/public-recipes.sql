-- Kör detta en gång i Supabase SQL Editor.
alter table public.recipes add column if not exists is_public boolean not null default false;

create or replace function public.is_google_user() returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt()->>'provider'), '') = 'google'
    and nullif((select auth.jwt()->>'email'), '') is not null;
$$;
revoke all on function public.is_google_user() from public, anon;
grant execute on function public.is_google_user() to authenticated;

drop policy if exists "Owner recipes" on public.recipes;
create policy "Owner recipes" on public.recipes for all to authenticated
using ((select public.is_google_user()) and user_id = (select auth.uid()))
with check ((select public.is_google_user()) and user_id = (select auth.uid()));

drop policy if exists "Read public recipes" on public.recipes;
create policy "Read public recipes" on public.recipes for select to authenticated
using ((select public.is_google_user()) and is_public = true);

create or replace function public.list_public_recipes()
returns table (
  id uuid, title text, protein text, carb text, minutes integer,
  ingredients jsonb, steps jsonb, tags text[], image_path text,
  starter_image boolean, source_url text, source_label text,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.title, r.protein, r.carb, r.minutes, r.ingredients, r.steps,
    r.tags, r.image_path, r.starter_image, r.source_url, r.source_label,
    r.created_at, r.updated_at
  from public.recipes r
  where r.is_public = true and (select public.is_google_user())
  order by r.created_at desc;
$$;
revoke all on function public.list_public_recipes() from public, anon;
grant execute on function public.list_public_recipes() to authenticated;

drop policy if exists "Owner profile" on public.profiles;
create policy "Owner profile" on public.profiles for all to authenticated
using ((select public.is_google_user()) and user_id = (select auth.uid()))
with check ((select public.is_google_user()) and user_id = (select auth.uid()));

create or replace function public.initialize_library() returns void
language plpgsql security invoker set search_path = '' as $$
declare inserted integer;
begin
  if not public.is_google_user() then raise exception 'Google-inloggning krävs' using errcode = '42501'; end if;
  insert into public.profiles(user_id) values (auth.uid()) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then
    insert into public.recipes(user_id,title,protein,carb,minutes,ingredients,steps,tags,starter_image,source_url,source_label,is_public)
    values (auth.uid(), 'Fläskpannkaka', 'Övrigt', 'Övrigt', 45,
      '[{"amount":1,"unit":"paket","name":"färdigtärnat bacon"},{"amount":4,"unit":"dl","name":"vetemjöl"},{"amount":8,"unit":"dl","name":"mjölk"},{"amount":4,"unit":"st","name":"ägg"},{"amount":null,"unit":"","name":"rårörda lingon till servering"}]'::jsonb,
      '["Sätt ugnen på 200 °C.","Fördela baconet på en plåt med höga kanter. Ställ in i ugnen och låt baconet stekas knaprigt.","Vispa ner 4 dl vetemjöl i 8 dl mjölk till en slät smet. Vispa sedan ner äggen.","Häll ägg-, mjölk- och mjölblandningen över baconet på plåten.","Grädda i cirka 30 minuter, tills pannkakan har stannat i mitten och fått fin färg.","Servera med rårörda lingon."]'::jsonb,
      array['Få ingredienser','Lättlagat','Matlådevänligt'], true, 'https://www.hemkop.se/recept/flaskpannkaka', 'Egen variant av Hemköps grundrecept', true);
  end if;
end;
$$;
revoke all on function public.initialize_library() from public, anon;
grant execute on function public.initialize_library() to authenticated;

drop policy if exists "Read published photos" on storage.objects;
create policy "Read published photos" on storage.objects for select to authenticated
using (
  bucket_id = 'recipe-photos'
  and (select public.is_google_user())
  and exists (
    select 1 from public.recipes r
    where r.is_public = true and r.image_path = storage.objects.name
  )
);

update public.recipes set is_public = true where title = 'Fläskpannkaka';
