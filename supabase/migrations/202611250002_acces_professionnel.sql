begin;

-- Receipts are written exclusively from verified Supabase Auth sessions.
create table beauty_private.preuves_adresse (
  utilisateur uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  depuis timestamptz not null,
  session_source uuid not null
);
create table beauty_private.changements_identite (
  utilisateur uuid primary key references auth.users(id) on delete cascade,
  nouveau_mdp timestamptz,
  nouvelle_adresse timestamptz
);
revoke all on beauty_private.preuves_adresse, beauty_private.changements_identite from public, anon, authenticated;

create function beauty_private.suivre_identite() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email is distinct from old.email then
    delete from beauty_private.preuves_adresse where utilisateur=new.id;
    insert into beauty_private.changements_identite (utilisateur,nouvelle_adresse)
    values (new.id,clock_timestamp()) on conflict (utilisateur) do update
    set nouvelle_adresse=excluded.nouvelle_adresse, nouveau_mdp=null;
  end if;
  if new.encrypted_password is distinct from old.encrypted_password then
    insert into beauty_private.changements_identite (utilisateur,nouveau_mdp)
    values (new.id,clock_timestamp()) on conflict (utilisateur) do update
    set nouveau_mdp=excluded.nouveau_mdp;
  end if;
  return new;
end $$;
create trigger suivre_identite after update of email,encrypted_password on auth.users
for each row execute function beauty_private.suivre_identite();

create function beauty_private.session_pro() returns table(
  utilisateur uuid, email text, session_id uuid, creee timestamptz,
  inscription boolean, recuperation boolean, google boolean, mot_de_passe_renouvele boolean
) language sql stable security definer set search_path='' as $$
  select u.id, lower(u.email), s.id, s.created_at,
    (auth.jwt()->'amr') @> '[{"method":"email/signup"}]',
    (auth.jwt()->'amr') @> '[{"method":"recovery"}]',
    (auth.jwt()->'amr') @> '[{"method":"oauth"}]' and exists (
      select 1 from auth.identities g where g.user_id=u.id and g.provider='google'
      and lower(g.identity_data->>'email')=lower(u.email) and g.identity_data->>'email_verified'='true'
    ), coalesce(c.nouveau_mdp>=s.created_at,false)
  from auth.users u join auth.sessions s on s.user_id=u.id
  left join beauty_private.changements_identite c on c.utilisateur=u.id
  where u.id=auth.uid() and s.id=(auth.jwt()->>'session_id')::uuid
    and lower(u.email)=lower(auth.jwt()->>'email') and u.email_confirmed_at is not null
    and (c.nouvelle_adresse is null or s.created_at>=c.nouvelle_adresse)
$$;

create function beauty_private.autorisee() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from beauty_private.session_pro() s
    where s.google or exists(select 1 from beauty_private.preuves_adresse p
      where p.utilisateur=s.utilisateur and p.email=s.email and
      (p.session_source=s.session_id or s.creee>=p.depuis)))
$$;

create function public.acces_professionnel() returns text language plpgsql security definer set search_path='' as $$
declare s record;
begin
  if beauty_private.autorisee() then return 'accordé'; end if;
  select * into s from beauty_private.session_pro();
  if not found then return 'vérification'; end if;
  if s.inscription or (s.recuperation and s.mot_de_passe_renouvele) then
    insert into beauty_private.preuves_adresse values(s.utilisateur,s.email,clock_timestamp(),s.session_id)
    on conflict (utilisateur) do nothing;
    if beauty_private.autorisee() then return 'accordé'; end if;
  end if;
  if s.recuperation then return 'nouveau mot de passe'; end if;
  return 'vérification';
end $$;
revoke all on function public.acces_professionnel() from public, anon;
grant execute on function public.acces_professionnel() to authenticated;

create or replace function beauty_private.role(i uuid) returns text language sql stable security definer set search_path='' as $$
  select role from public.equipe where institut_id=i and personne=auth.uid() and actif
  and (select beauty_private.autorisee())
$$;

-- Apply the same boundary to reads, including policies for an employee's own rows.
do $$
declare relation text;
begin
  foreach relation in array array['instituts','equipe','soins','clientes','rendez_vous','blocages','cartes','mouvements','exceptions_horaires','attente'] loop
    execute format('create policy adresse_verifiee on public.%I as restrictive for select to authenticated using ((select beauty_private.autorisee()))', relation);
  end loop;
end $$;

-- Creating an institute or accepting its first invitation precedes membership.
create function beauty_private.verifier_adhesion() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not beauty_private.autorisee() then raise exception 'Vérifiez votre adresse avant d’accéder à un institut' using errcode='42501'; end if;
  return new;
end $$;
create trigger verifier_adhesion before insert on public.equipe for each row execute function beauty_private.verifier_adhesion();

notify pgrst,'reload schema';
commit;
