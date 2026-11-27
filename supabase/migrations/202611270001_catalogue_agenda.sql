begin;
alter table public.soins
 add sous_categorie text not null default '' check(length(sous_categorie)<=80 and (sous_categorie='' or categorie<>'')),
 add suggestions uuid[] not null default '{}' check(cardinality(suggestions)<=3),
 add remplacements uuid[] not null default '{}' check(remplacements <@ suggestions);

create table public.couleurs_categories (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 categorie text not null, sous_categorie text not null, couleur text not null check(couleur ~ '^#[0-9a-fA-F]{6}$'),
 unique(institut_id,categorie,sous_categorie)
);
alter table public.couleurs_categories enable row level security;
grant select on public.couleurs_categories to authenticated;
revoke insert,update,delete,truncate on public.couleurs_categories from public,authenticated,anon;
create policy lecture_couleurs on public.couleurs_categories for select to authenticated using (beauty_private.role(institut_id) is not null);

create function beauty_private.couleur_catalogue() returns trigger language plpgsql security definer set search_path='' as $$
declare sous text; total int; palette text[]:=array['#20725E','#976415','#705897','#356C95','#A44E65','#797329','#397D84','#985C3A'];
begin
 if new.categorie='' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.institut_id::text,83));
 foreach sous in array array['',new.sous_categorie] loop
   if not exists(select from public.couleurs_categories c where c.institut_id=new.institut_id and c.categorie=new.categorie and c.sous_categorie=sous) then
     select count(*) into total from public.couleurs_categories where institut_id=new.institut_id;
     insert into public.couleurs_categories(institut_id,categorie,sous_categorie,couleur)
     values(new.institut_id,new.categorie,sous,coalesce(palette[total+1],'#'||substr(md5(total::text),1,6)));
   end if;
 end loop;
 return new;
end $$;
create trigger couleurs_catalogue after insert or update of categorie,sous_categorie on public.soins for each row execute function beauty_private.couleur_catalogue();
update public.soins set categorie=categorie where categorie<>'';

create function public.colorer_categorie(i uuid, ref uuid, couleur text) returns void language plpgsql security definer set search_path='' as $$
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 update public.couleurs_categories c set couleur=colorer_categorie.couleur where c.id=ref and c.institut_id=i;
 if not found then raise exception 'Catégorie inconnue'; end if;
end $$;

create function public.configurer_soin(i uuid,sid uuid,n text,duree int,prix int,composants uuid[],habilitees uuid[],prep text,visible boolean,actif boolean,
 categorie text,sous_categorie text,composition_libre text,suggestions uuid[],remplacements uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare ref uuid:=coalesce(sid,gen_random_uuid());
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 if cardinality(composants)>0 and trim(composition_libre)<>'' then raise exception 'Choisissez un seul mode de composition'; end if;
 if (select count(distinct x) from unnest(suggestions) x)<>cardinality(suggestions)
 or exists(select from unnest(suggestions) x where x=ref or not exists(select from public.soins s where s.id=x and s.institut_id=i))
 or exists(select from public.soins s where s.id=any(configurer_soin.remplacements) and cardinality(s.elements)=0 and s.composition_libre='') then raise exception 'Suggestion ou formule invalide'; end if;
 perform public.enregistrer_soin(i,ref,n,duree,prix,composants,habilitees,prep,visible,actif);
 update public.soins s set categorie=trim(configurer_soin.categorie), sous_categorie=trim(configurer_soin.sous_categorie),
 composition_libre=trim(configurer_soin.composition_libre),suggestions=configurer_soin.suggestions,remplacements=configurer_soin.remplacements
 where s.id=ref and s.institut_id=i;
 if not found then raise exception 'Prestation inconnue'; end if;
end $$;

create or replace function public.catalogue_public(i uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('nom',a.nom,'couleur',a.couleur,'vente_bons',(a.offre='Premium' and exists(select from beauty_private.marchands where institut=i and actif and vente_bons)),
 'equipe',(select jsonb_agg(jsonb_build_object('personne',e.personne,'nom',e.nom,'photo',e.photo)) from public.equipe e where e.institut_id=i and e.actif),
 'soins',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nom',s.nom,'minutes',s.minutes,'centimes',s.centimes,'categorie',s.categorie,'sous_categorie',s.sous_categorie,
 'elements',array(select t.id from public.soins t where t.id=any(s.elements) and t.institut_id=i and t.actif and t.en_ligne),
 'suggestions',array(select x from unnest(s.suggestions) with ordinality q(x,k) join public.soins t on t.id=x and t.institut_id=i and t.actif and t.en_ligne order by k),
 'remplacements',array(select t.id from public.soins t where t.institut_id=i and t.actif and t.en_ligne and t.id=any(s.remplacements) and (cardinality(t.elements)>0 or t.composition_libre<>'')),
 'avance',coalesce((select beauty_private.avance(m,s.centimes) from beauty_private.marchands m where m.institut=i),0)) order by s.nom,s.categorie,s.sous_categorie)
 from public.soins s where s.institut_id=i and s.actif and s.en_ligne),'[]'::jsonb)) from public.instituts a where a.id=i and a.ouvert
$$;

-- The staff agenda includes offline services and uses the existing client's identity even without an email.
create function beauty_private.selection_comptoir(i uuid,p uuid,ids uuid[]) returns table(libelle text,duree int,prix int,preparation text)
language sql stable set search_path='' as $$
 select string_agg(s.nom,' + ' order by k),sum(s.minutes)::int,sum(s.centimes)::int,string_agg(beauty_private.preparation(s),E'\n' order by k)
 from unnest(ids) with ordinality x(id,k) join public.soins s on s.id=x.id and s.institut_id=i and s.actif and beauty_private.habilitee(s,p)
 having count(*)=cardinality(ids) and cardinality(ids) between 1 and 20
$$;
create function public.creneaux_comptoir(i uuid,p uuid,ids uuid[],jour date,jours int) returns table(debut timestamp, personne uuid)
language plpgsql stable security definer set search_path='' set jit=off as $$
begin
 perform beauty_private.requis(i);
 if (beauty_private.role(i)='employee' and p<>auth.uid()) or jours not between 1 and 31 then raise exception 'Planning inaccessible'; end if;
 return query with charge as (
 select make_interval(mins=>sel.duree+a.marge*cardinality(ids)) longueur
 from public.instituts a join public.equipe e on e.institut_id=a.id and e.personne=p and e.actif
 cross join beauty_private.selection_comptoir(i,p,ids) sel where a.id=i
 ), plages as materialized (
 select jour+j d,beauty_private.plages(i,p,jour+j) h from generate_series(0,jours-1) j
 ), indispos as (
 select coalesce(range_agg(r), '{}'::tsmultirange) occupe from (
 select tsrange(v.debut,v.fin,'[)') r from public.rendez_vous v where v.personne=p and v.debut<jour+jours and v.fin>jour
 and (v.statut in ('réalisé','confirmé') or (v.statut='en paiement' and v.echeance>now()))
 union all select tsrange(b.debut,b.fin,'[)') from public.blocages b where b.debut<jour+jours and b.fin>jour
 and (p=any(b.personnes) or (cardinality(b.personnes)=0 and exists(select from public.equipe m where m.personne=p and m.institut_id=b.institut_id and m.actif)))) occupation
 )
 select min(t),p from plages cross join charge cross join indispos cross join lateral generate_series(0,jsonb_array_length(h)-2,2) k
 cross join lateral generate_series(d+(h->>k)::time,d+(h->>(k+1))::time-longueur,interval '5 minutes') t
 where t>=timezone('Indian/Reunion',now()) and not (occupe && tsrange(t,t+longueur,'[)')) group by case when jours=1 then t else date_trunc('day',t) end order by min(t);
end $$;

create function public.reserver_comptoir(i uuid,p uuid,ids uuid[],d timestamp,cliente uuid,n text,email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare sel record; a public.instituts; c uuid; r uuid; marge int;
begin
 perform beauty_private.requis(i);
 if (beauty_private.role(i)='employee' and p<>auth.uid()) or not exists(select from public.equipe where institut_id=i and personne=p and actif)
 then raise exception 'Professionnelle indisponible'; end if;
 select * into strict a from public.instituts where id=i for share;
 perform 1 from public.soins where institut_id=i and id=any(ids) order by id for share;
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 select * into strict sel from beauty_private.selection_comptoir(i,p,ids);
 marge:=a.marge*cardinality(ids);
 if not beauty_private.disponible(i,p,d,sel.duree+marge) then raise exception 'Créneau indisponible'; end if;
 if cliente is not null then
   select id into strict c from public.clientes where id=cliente and institut_id=i and (beauty_private.role(i)<>'employee' or exists(select from public.rendez_vous where cliente_id=cliente and personne=auth.uid()));
 else
   insert into public.clientes(institut_id,nom,email) values(i,trim(n),nullif(lower(trim(email)),'')) on conflict on constraint clientes_institut_id_email_key do update set email=excluded.email returning id into c;
 end if;
 insert into public.rendez_vous(institut_id,personne,cliente_id,soin_id,soins_selection,libelle,preparation,minutes,marge,centimes,debut,fin,origine)
 values(i,p,c,ids[1],ids,sel.libelle,sel.preparation,sel.duree,marge,sel.prix,d,d+make_interval(mins=>sel.duree+marge),'institut') returning id into r;
 insert into beauty_private.liens(rdv) values(r);
 return r;
end $$;
revoke all on function public.reserver_comptoir(uuid,uuid,uuid[],timestamp,uuid,text,text),public.creneaux_comptoir(uuid,uuid,uuid[],date,int),public.configurer_soin(uuid,uuid,text,int,int,uuid[],uuid[],text,boolean,boolean,text,text,text,uuid[],uuid[]),public.colorer_categorie(uuid,uuid,text) from public,anon;
grant execute on function public.reserver_comptoir(uuid,uuid,uuid[],timestamp,uuid,text,text),public.creneaux_comptoir(uuid,uuid,uuid[],date,int),public.configurer_soin(uuid,uuid,text,int,int,uuid[],uuid[],text,boolean,boolean,text,text,text,uuid[],uuid[]),public.colorer_categorie(uuid,uuid,text) to authenticated;
create or replace function public.importer_soins(i uuid,operation uuid,lignes jsonb,visible boolean) returns integer language plpgsql security definer set search_path='' as $$
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
   if exists(select 1 from public.soins where institut_id=i and lower(trim(nom))=lower(libelle) and lower(categorie)=lower(trim(coalesce(ligne->>'categorie',''))) and lower(sous_categorie)=lower(trim(coalesce(ligne->>'sous_categorie','')))) then raise exception 'Ligne % : la prestation « % » existe déjà',position,libelle; end if;
   perform public.configurer_soin(i,null,libelle,(ligne->>'minutes')::int,(ligne->>'centimes')::int,'{}','{}','',visible,true,coalesce(ligne->>'categorie',''),coalesce(ligne->>'sous_categorie',''),'','{}','{}');
 end loop;
 insert into beauty_private.imports_soins values(operation,i,lignes,visible);
 return position;
end $$;

create or replace function public.version_planning() returns text language sql immutable set search_path='' as $$select '202611270001'::text$$;
notify pgrst,'reload schema';
commit;
