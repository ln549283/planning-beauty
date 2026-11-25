begin;
set local search_path=public,extensions,pg_catalog;
alter table public.rendez_vous add rang integer not null default 0 check(rang>=0), add derogation text, add autorisee_par uuid references auth.users;
alter table public.rendez_vous add check(rang=0 or (derogation is not null and length(trim(derogation)) between 1 and 200 and autorisee_par is not null and origine='institut'));
alter table public.rendez_vous drop constraint rdv_sans_chevauchement;
alter table public.rendez_vous add constraint rdv_sans_chevauchement exclude using gist
(personne with =,rang with =,tsrange(debut,fin,'[)') with &&) where(statut in ('confirmé','réalisé','en paiement'));

create function public.reserver_exception(i uuid,p uuid,sid uuid,d timestamp,n text,email text,motif text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.instituts; s public.soins; f timestamp; rang_libre int; c uuid; r uuid;
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 if nullif(trim(motif),'') is null or length(trim(motif))>200 then raise exception 'Précisez le motif de la dérogation'; end if;
 select * into strict a from public.instituts where id=i for share;
 select * into strict s from public.soins where id=sid and institut_id=i and actif for share;
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 if not beauty_private.habilitee(s,p) or not exists(select 1 from public.equipe where institut_id=i and personne=p and actif) then raise exception 'Professionnelle indisponible'; end if;
 f:=d+make_interval(mins=>s.minutes+a.marge);
 if f::date<>d::date then raise exception 'Le rendez-vous doit se terminer le même jour'; end if;
 if exists(select 1 from public.rendez_vous v where v.personne=p and v.debut<f and v.fin>d and
 ((v.statut='en paiement' and v.echeance>now()) or (v.institut_id<>i and v.statut in ('confirmé','réalisé'))))
 or exists(select 1 from public.blocages b where b.institut_id<>i and b.debut<f and b.fin>d and (p=any(b.personnes) or (cardinality(b.personnes)=0 and exists(select 1 from public.equipe e where e.institut_id=b.institut_id and e.personne=p and e.actif))))
 then raise exception 'Une indisponibilité protégée empêche cette dérogation'; end if;
 select coalesce(max(rang),0)+1 into rang_libre from public.rendez_vous where personne=p and debut<f and fin>d and statut in ('confirmé','réalisé','en paiement');
 insert into public.clientes(institut_id,nom,email) values(i,trim(n),nullif(lower(trim(email)),'')) on conflict on constraint clientes_institut_id_email_key do update set email=excluded.email returning id into c;
 insert into public.rendez_vous(institut_id,personne,cliente_id,soin_id,libelle,preparation,minutes,marge,centimes,debut,fin,origine,rang,derogation,autorisee_par)
 values(i,p,c,s.id,s.nom,beauty_private.preparation(s),s.minutes,a.marge,s.centimes,d,f,'institut',rang_libre,trim(motif),auth.uid()) returning id into r;
 insert into beauty_private.liens(rdv) values(r);
 return r;
end $$;
revoke all on function public.reserver_exception(uuid,uuid,uuid,timestamp,text,text,text) from public,anon;
grant execute on function public.reserver_exception(uuid,uuid,uuid,timestamp,text,text,text) to authenticated;
create function public.version_planning() returns text language sql immutable set search_path='' as $$ select '202611250007'::text $$;
grant execute on function public.version_planning() to anon,authenticated;
notify pgrst,'reload schema';
commit;
