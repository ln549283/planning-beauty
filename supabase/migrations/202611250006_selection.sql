begin;
create or replace function beauty_private.calcul_formule() returns trigger language plpgsql set search_path='' as $$
declare prix int; duree int;
begin
 if cardinality(new.elements)>0 then
   select sum(centimes),sum(minutes) into prix,duree from public.soins where institut_id=new.institut_id and id=any(new.elements);
   new.centimes:=coalesce(new.centimes,prix);new.minutes:=coalesce(new.minutes,duree);
   new.prix_calcule:=(prix=new.centimes);new.duree_calculee:=(duree=new.minutes);
 end if;
 return new;
end $$;
alter table public.rendez_vous add soins_selection uuid[] not null default '{}';
create table beauty_private.demandes_web (
 operation uuid primary key, institut uuid not null references public.instituts, donnees jsonb not null, lien uuid not null references beauty_private.liens(token)
);
revoke all on beauty_private.demandes_web from public,anon,authenticated;

create function beauty_private.selection(i uuid,p uuid,ids uuid[]) returns table(libelle text,duree int,prix int,preparation text)
language sql stable set search_path='' as $$
 select string_agg(s.nom,' + ' order by n),sum(s.minutes)::int,sum(s.centimes)::int,string_agg(beauty_private.preparation(s),E'\n' order by n)
 from unnest(ids) with ordinality x(id,n) join public.soins s on s.id=x.id and s.institut_id=i and s.actif and s.en_ligne and beauty_private.habilitee(s,p)
 having count(*)=cardinality(ids) and cardinality(ids) between 1 and 20
$$;

create function public.creneaux_selection(i uuid,ids uuid[],jour date) returns table(personne uuid,nom text,debut timestamp)
language sql stable security definer set search_path='' set jit=off as $$
 with disponibles as materialized (
 select e.personne,e.nom,beauty_private.plages(i,e.personne,jour) h,
 make_interval(mins=>sel.duree+a.marge*cardinality(ids)) longueur,
 timezone('Indian/Reunion',now())+make_interval(mins=>a.delai_minutes) limite_basse,
 timezone('Indian/Reunion',now())+make_interval(days=>a.horizon_jours) limite_haute,
 coalesce((select range_agg(tsrange(r.debut,r.fin,'[)')) from public.rendez_vous r where r.personne=e.personne and r.debut<jour+1 and r.fin>jour
 and (r.statut in ('réalisé','confirmé') or (r.statut='en paiement' and r.echeance>now()))),'{}'::tsmultirange)
 +coalesce((select range_agg(tsrange(b.debut,b.fin,'[)')) from public.blocages b where b.debut<jour+1 and b.fin>jour
 and (e.personne=any(b.personnes) or (cardinality(b.personnes)=0 and exists(select 1 from public.equipe m where m.personne=e.personne and m.institut_id=b.institut_id and m.actif)))),'{}'::tsmultirange) occupe
 from public.instituts a join public.equipe e on e.institut_id=a.id and e.actif cross join lateral beauty_private.selection(i,e.personne,ids) sel
 where a.id=i and a.ouvert
 )
 select m.personne,m.nom,t.d from disponibles m cross join lateral generate_series(0,jsonb_array_length(m.h)-2,2) k
 cross join generate_series(jour::timestamp,jour::timestamp+interval '23 hours 55 minutes',interval '5 minutes') t(d)
 where t.d>=jour+(m.h->>k)::time and t.d+m.longueur<=jour+(m.h->>(k+1))::time and t.d between m.limite_basse and m.limite_haute
 and not (m.occupe && tsrange(t.d,t.d+m.longueur,'[)')) order by t.d,m.nom
$$;
create or replace function public.creneaux(i uuid,sid uuid,jour date) returns table(personne uuid,nom text,debut timestamp)
language sql stable security definer set search_path='' as $$select * from public.creneaux_selection(i,array[sid],jour)$$;
create function public.reserver_selection(i uuid,p uuid,ids uuid[],d timestamp,n text,email text,prix int,duree int,operation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.instituts; selection record; demande beauty_private.demandes_web; infos jsonb;
 c uuid; r uuid; t uuid; adresse text:=lower(trim(email)); marge int;
begin
 if operation is null or cardinality(ids) not between 1 and 20 then raise exception 'Sélection invalide'; end if;
 infos:=jsonb_build_array(p,ids,d,trim(n),adresse,prix,duree);
 perform pg_advisory_xact_lock(hashtextextended(operation::text,78));
 select * into demande from beauty_private.demandes_web where demandes_web.operation=reserver_selection.operation;
 if found then
   if demande.institut=i and demande.donnees=infos then return demande.lien; end if;
   raise exception 'Choix de réservation modifiés. Actualisez la page.';
 end if;
 select * into strict a from public.instituts where id=i for share;
 if not a.ouvert or adresse is null or length(adresse)>320 or adresse !~ '^[^ @]+@[^ @]+\.[^ @]+$' or d is null or
 d not between timezone('Indian/Reunion',now())+make_interval(mins=>a.delai_minutes) and timezone('Indian/Reunion',now())+make_interval(days=>a.horizon_jours)
 then raise exception 'Réservation en ligne indisponible'; end if;
 perform 1 from public.soins where id=any(ids) and institut_id=i order by id for share;
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 select * into selection from beauty_private.selection(i,p,ids);
 if not found or not exists(select 1 from public.equipe where institut_id=i and personne=p and actif) then raise exception 'Prestation indisponible'; end if;
 if selection.prix is distinct from prix or selection.duree is distinct from duree then raise exception 'Les tarifs ou durées ont changé. Actualisez la page.'; end if;
 marge:=a.marge*cardinality(ids);
 if not beauty_private.disponible(i,p,d,duree+marge) then raise exception 'Créneau indisponible'; end if;
 insert into public.clientes(institut_id,nom,email) values(i,trim(n),adresse) on conflict on constraint clientes_institut_id_email_key do update set email=excluded.email returning id into c;
 insert into public.rendez_vous(institut_id,personne,cliente_id,soin_id,soins_selection,libelle,preparation,minutes,marge,centimes,debut,fin,origine)
 values(i,p,c,ids[1],ids,selection.libelle,selection.preparation,duree,marge,prix,d,d+make_interval(mins=>duree+marge),'web') returning id into r;
 insert into beauty_private.liens(rdv) values(r) returning token into t;
 insert into beauty_private.demandes_web values(operation,i,infos,t);
 return t;
end $$;
create function beauty_private.modifier_selection() returns trigger language plpgsql set search_path='' as $$
begin
 if cardinality(old.soins_selection)>1 then
   if new.soin_id<>old.soin_id then
    new.soins_selection:=array[new.soin_id];
    new.marge:=old.marge/cardinality(old.soins_selection);
    new.fin:=new.debut+make_interval(mins=>new.marge+new.minutes);
   elsif new.personne<>old.personne and exists(select 1 from public.soins where id=any(old.soins_selection) and not beauty_private.habilitee(soins,new.personne)) then
    raise exception 'Cette professionnelle ne réalise pas tous les soins du rendez-vous';
   end if;
 end if;
 return new;
end $$;
create trigger adapter_selection before update of soin_id,personne on public.rendez_vous for each row execute function beauty_private.modifier_selection();

create function public.politique_publique(i uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('mode',coalesce(m.mode,'aucun'),'valeur',coalesce(m.valeur,0),'disponible',coalesce(m.actif or m.mode='aucun',true)) from public.instituts a left join beauty_private.marchands m on m.institut=a.id where a.id=i and a.ouvert
$$;
create function public.actualiser_compte(c text,a boolean) returns void language sql security definer set search_path='' as $$
 update beauty_private.marchands set actif=a where compte=c
$$;
revoke all on function public.actualiser_compte(text,boolean) from public,anon,authenticated;
grant execute on function public.actualiser_compte(text,boolean) to service_role;
grant execute on function public.creneaux_selection(uuid,uuid[],date),public.reserver_selection(uuid,uuid,uuid[],timestamp,text,text,int,int,uuid),public.politique_publique(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
