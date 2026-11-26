begin;
alter table public.soins add categorie text not null default '' check(length(categorie)<=80),
 add composition_libre text not null default '' check(length(composition_libre)<=500);
create function public.enregistrer_fiche_soin(i uuid,sid uuid,n text,duree int,prix int,composants uuid[],habilitees uuid[],prep text,visible boolean,actif boolean,categorie text,composition_libre text default '') returns void language plpgsql security definer set search_path='' as $$
declare ref uuid:=coalesce(sid,gen_random_uuid());
begin
 if cardinality(composants)>0 and trim(composition_libre)<>'' then raise exception 'Choisissez un seul mode de composition'; end if;
 perform public.enregistrer_soin(i,ref,n,duree,prix,composants,habilitees,prep,visible,actif);
 update public.soins s set categorie=trim(enregistrer_fiche_soin.categorie),composition_libre=trim(enregistrer_fiche_soin.composition_libre) where s.id=ref and institut_id=i;
end $$;
revoke all on function public.enregistrer_fiche_soin(uuid,uuid,text,int,int,uuid[],uuid[],text,boolean,boolean,text,text) from public,anon;
grant execute on function public.enregistrer_fiche_soin(uuid,uuid,text,int,int,uuid[],uuid[],text,boolean,boolean,text,text) to authenticated;
create table beauty_private.profils (
 utilisateur uuid primary key references auth.users on delete cascade,
 prenom text not null check(length(trim(prenom)) between 1 and 100),
 nom text not null check(length(trim(nom)) between 1 and 100),
 sexe text not null check(sexe in ('Femme','Homme','Autre','Non précisé')),
 naissance date, rue text not null check(length(rue)<=200), complement text not null check(length(complement)<=200),
 code_postal text not null check(length(code_postal)<=20), ville text not null check(length(ville)<=100), pays text not null check(length(pays)<=100)
);
create function public.mon_profil() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(p)-'utilisateur' from beauty_private.profils p where utilisateur=auth.uid() and beauty_private.autorisee()
$$;
create function public.enregistrer_profil(prenom text,nom text,sexe text,naissance date,rue text,complement text,code_postal text,ville text,pays text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not beauty_private.autorisee() then raise exception 'Vérifiez votre compte'; end if;
 if naissance>timezone('Indian/Reunion',now())::date then raise exception 'La date de naissance est dans le futur'; end if;
 insert into beauty_private.profils values(auth.uid(),trim(prenom),trim(nom),sexe,naissance,trim(rue),trim(complement),trim(code_postal),trim(ville),trim(pays))
 on conflict(utilisateur) do update set prenom=excluded.prenom,nom=excluded.nom,sexe=excluded.sexe,naissance=excluded.naissance,rue=excluded.rue,
 complement=excluded.complement,code_postal=excluded.code_postal,ville=excluded.ville,pays=excluded.pays;
end $$;

create unique index if not exists equipe_une_gerance on public.equipe(institut_id) where role='gerante';
create function public.transferer_gerance(i uuid,destinataire uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.instituts where id=i for update;
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Seule la personne gérante peut transférer la gérance'; end if;
 if destinataire=auth.uid() or not exists(select 1 from public.equipe where institut_id=i and personne=destinataire and actif and role in ('responsable','employee') for update) then raise exception 'Choisissez un membre actif de cet institut'; end if;
 update public.equipe set role='responsable' where institut_id=i and personne=auth.uid();
 update public.equipe set role='gerante' where institut_id=i and personne=destinataire;
end $$;

create table beauty_private.imports_soins (
 operation uuid primary key, institut uuid not null references public.instituts, lignes jsonb not null, visible boolean not null
);
create function public.importer_soins(i uuid,operation uuid,lignes jsonb,visible boolean) returns integer language plpgsql security definer set search_path='' as $$
declare lot beauty_private.imports_soins; ligne jsonb; libelle text; position int:=0;
begin
 perform 1 from public.instituts where id=i for update;
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Import réservé à la gérance'; end if;
 if operation is null or visible is null or jsonb_typeof(lignes) is distinct from 'array' then raise exception 'Lot invalide'; end if;
 if jsonb_array_length(lignes) not between 1 and 200 then raise exception 'Un lot doit contenir entre 1 et 200 prestations'; end if;
 select * into lot from beauty_private.imports_soins imp where imp.operation=importer_soins.operation;
 if found then
   if lot.institut=i and lot.lignes=lignes and lot.visible=visible then return jsonb_array_length(lignes); end if;
   raise exception 'Ce lot a déjà été enregistré';
 end if;
 for ligne in select value from jsonb_array_elements(lignes) loop
   position:=position+1;
   libelle:=trim(ligne->>'nom');
   if coalesce(length(libelle),0) not between 1 and 120 or coalesce(ligne->>'minutes','') !~ '^[0-9]{1,4}$' or coalesce(ligne->>'centimes','') !~ '^[0-9]{1,8}$' then raise exception 'Ligne % : nom, durée ou prix invalide',position; end if;
   if (ligne->>'minutes')::int not between 1 and 1200 or (ligne->>'centimes')::int not between 0 and 10000000 then raise exception 'Ligne % : durée ou prix hors limites',position; end if;
   if exists(select 1 from public.soins where institut_id=i and lower(trim(nom))=lower(libelle)) then raise exception 'Ligne % : la prestation « % » existe déjà',position,libelle; end if;
   perform public.enregistrer_soin(i,null,libelle,(ligne->>'minutes')::int,(ligne->>'centimes')::int,'{}','{}','',visible,true);
 end loop;
 insert into beauty_private.imports_soins values(operation,i,lignes,visible);
 return position;
end $$;
revoke all on beauty_private.profils, beauty_private.imports_soins from public,anon,authenticated;
revoke all on function public.mon_profil(),public.enregistrer_profil(text,text,text,date,text,text,text,text,text),public.transferer_gerance(uuid,uuid),public.importer_soins(uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.mon_profil(),public.enregistrer_profil(text,text,text,date,text,text,text,text,text),public.transferer_gerance(uuid,uuid),public.importer_soins(uuid,uuid,jsonb,boolean) to authenticated;
create or replace function public.version_planning() returns text language sql immutable set search_path='' as $$ select '202611260001'::text $$;
notify pgrst,'reload schema';
commit;
