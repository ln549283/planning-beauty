begin;
set local search_path=public,extensions,pg_catalog;
create table beauty_private.marchands (
  institut uuid primary key references public.instituts,
  compte text unique not null, actif boolean not null default false,
  mode text not null default 'aucun' check(mode in ('aucun','fixe','pourcentage','intégral')),
  valeur integer not null default 0 check(valeur>=0), vente_bons boolean not null default false
);
create table beauty_private.commandes (
  id uuid primary key default gen_random_uuid(), institut uuid not null references public.instituts,
  rdv uuid unique references public.rendez_vous, carte uuid unique references public.cartes,
  compte text not null, montant integer not null check(montant>0),
  limite timestamptz not null, session_stripe text, paiement text unique, paye boolean not null default false
);
revoke all on beauty_private.marchands,beauty_private.commandes from public,anon,authenticated;
alter table public.rendez_vous add column avance integer not null default 0 check(avance between 0 and centimes);
alter table public.rendez_vous add column echeance timestamptz;
alter table public.rendez_vous drop constraint rendez_vous_statut_check;
alter table public.rendez_vous add check(statut in ('confirmé','réalisé','annulé','absent','en paiement','expiré'));
alter table public.rendez_vous drop constraint rdv_sans_chevauchement;
alter table public.rendez_vous add constraint rdv_sans_chevauchement exclude using gist
(personne with =, tsrange(debut,fin,'[)') with &&) where (statut in ('confirmé','réalisé','en paiement'));

create function beauty_private.avance(m beauty_private.marchands,prix int) returns int language sql immutable set search_path='' as $$
 select case when not coalesce(m.actif,false) then 0 when m.mode='intégral' then prix when m.mode='fixe' then least(prix,m.valeur)
 when m.mode='pourcentage' then round(prix::numeric*m.valeur/100)::integer else 0 end
$$;
create function public.mon_marchand(i uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 return coalesce((select to_jsonb(m)-'institut' from beauty_private.marchands m where institut=i),'{}');
end $$;
create function public.synchroniser_marchand(i uuid,c text,a boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into beauty_private.marchands(institut,compte,actif) values(i,c,a)
 on conflict(institut) do update set actif=excluded.actif where beauty_private.marchands.compte=excluded.compte;
 if not found then raise exception 'Un autre compte de paiement est déjà associé'; end if;
end $$;
create function public.regler_paiement(i uuid,politique text,v int,bons boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 if (politique='pourcentage' and v not between 1 and 100) or (politique='fixe' and v<50) then raise exception 'Valeur de l’avance invalide'; end if;
 update beauty_private.marchands set mode=politique,valeur=v,vente_bons=bons where institut=i and (actif or (politique='aucun' and not bons));
 if not found then raise exception 'Activez le compte marchand Stripe'; end if;
end $$;

create function beauty_private.garder_creneau() returns trigger language plpgsql set search_path='' as $$
declare m beauty_private.marchands;
begin
 if new.statut not in ('confirmé','réalisé','en paiement') then return new; end if;
 update public.rendez_vous set statut='expiré' where personne=new.personne and id<>new.id and statut='en paiement' and echeance<=clock_timestamp() and debut<new.fin and fin>new.debut;
 if tg_op='INSERT' and new.origine='web' then
   select * into m from beauty_private.marchands where institut=new.institut_id for share;
   if found and m.mode<>'aucun' and not m.actif then raise exception 'Les paiements sont temporairement indisponibles'; end if;
   new.avance:=beauty_private.avance(m,new.centimes);
   if new.avance>0 then
     if new.avance<50 then raise exception 'Le montant est inférieur au minimum de paiement en ligne (0,50 €)'; end if;
     new.statut:='en paiement'; new.echeance:=clock_timestamp()+interval '35 minutes';
   end if;
 end if;
 return new;
end $$;
create trigger garder_creneau before insert or update of debut,fin,statut on public.rendez_vous for each row execute function beauty_private.garder_creneau();
create function beauty_private.preparer_commande() returns trigger language plpgsql set search_path='' as $$
begin
 if new.statut='en paiement' then
 insert into beauty_private.commandes(institut,rdv,compte,montant,limite)
 select new.institut_id,new.id,compte,new.avance,new.echeance from beauty_private.marchands where institut=new.institut_id;
 end if;
 return new;
end $$;
create trigger preparer_commande after insert on public.rendez_vous for each row execute function beauty_private.preparer_commande();

create function public.acheter_bon(i uuid,montant int) returns uuid language plpgsql security definer set search_path='' as $$
declare commande uuid;
begin
 if montant not between 50 and 100000 then raise exception 'Choisissez un montant entre 0,50 € et 1 000 €'; end if;
 insert into beauty_private.commandes(institut,compte,montant,limite)
 select i,m.compte,montant,now()+interval '1 hour' from beauty_private.marchands m join public.instituts a on a.id=m.institut
 where m.institut=i and m.actif and m.vente_bons and a.offre='Premium' and a.ouvert returning id into commande;
 if commande is null then raise exception 'Vente de bons en ligne fermée'; end if;
 return commande;
end $$;
create function public.etat_achat(t uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('montant',c.montant,'nom',i.nom,'code',b.code,'solde',b.solde,'paye',c.paye,'expire',c.limite<=now())
 from beauty_private.commandes c join public.instituts i on i.id=c.institut left join public.cartes b on b.id=c.carte where c.id=t and c.rdv is null
$$;
create function public.checkout_prive(t uuid,bon boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'session_stripe',c.session_stripe,'compte',c.compte,'montant',c.montant,'limite',c.limite,'libelle',coalesce(r.libelle,'Carte cadeau · '||i.nom))
 from beauty_private.commandes c join public.instituts i on i.id=c.institut left join public.rendez_vous r on r.id=c.rdv left join beauty_private.liens l on l.rdv=r.id
 where not c.paye and c.limite>now() and ((bon and c.rdv is null and c.id=t) or (not bon and l.token=t and r.statut='en paiement'))
$$;
create function public.associer_checkout(o uuid,session_id text) returns void language plpgsql security definer set search_path='' as $$
begin
 update beauty_private.commandes set session_stripe=session_id where id=o and (session_stripe is null or session_stripe=session_id);
 if not found then raise exception 'Session de paiement incohérente'; end if;
end $$;
revoke all on function public.associer_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.associer_checkout(uuid,text) to service_role;
create function public.finaliser_checkout(o uuid,c text,pi text,total int,devise text) returns text language plpgsql security definer set search_path='' as $$
declare cmd beauty_private.commandes; x public.rendez_vous; b public.cartes; prefixe text; seq integer;
begin
 select * into strict cmd from beauty_private.commandes where id=o for update;
 if c is distinct from cmd.compte or total is distinct from cmd.montant or devise is distinct from 'eur' or nullif(pi,'') is null then raise exception 'Paiement incohérent'; end if;
 if cmd.paye then return case when cmd.paiement=pi then 'traité' else 'rembourser' end; end if;
 if cmd.limite<=clock_timestamp() then return 'rembourser'; end if;
 if cmd.rdv is not null then
   select * into strict x from public.rendez_vous where id=cmd.rdv for update;
   if x.statut<>'en paiement' or x.echeance<=clock_timestamp() then return 'rembourser'; end if;
   update public.rendez_vous set statut='confirmé' where id=x.id;
   insert into public.mouvements(id,institut_id,rdv,cliente,type,centimes) values(o,x.institut_id,x.id,x.cliente_id,'encaissement',total);
 else
   perform pg_advisory_xact_lock(hashtextextended(cmd.institut::text,56));
   prefixe:=to_char(timezone('Indian/Reunion',now()),'YYYY-MM');
   select count(*)+1 into seq from public.cartes where institut_id=cmd.institut and code like prefixe||'%';
   insert into public.cartes(institut_id,code,valeur,solde) values(cmd.institut,prefixe||case when seq<10 then '0' else '' end||seq,total,total) returning * into b;
   insert into public.mouvements(id,institut_id,carte,type,centimes) values(o,cmd.institut,b.id,'vente carte',total);
 end if;
 update beauty_private.commandes set paye=true,paiement=pi,carte=b.id where id=o;
 return 'traité';
end $$;
create or replace function beauty_private.disponible(i uuid,p uuid,d timestamp,minutes int,ignorer uuid default null) returns boolean language sql stable set search_path='' as $$
 with plage as (select d+make_interval(mins=>minutes) f, beauty_private.plages(i,p,d::date) h from public.instituts where id=i)
 select coalesce((select d::date=f::date and exists(select 1 from generate_series(0,jsonb_array_length(h)-2,2) k where d::time >= (h->>k)::time and f::time <= (h->>(k+1))::time) and
 not exists(select 1 from public.rendez_vous r where r.personne=p and r.id is distinct from ignorer and (r.statut in ('confirmé','réalisé') or (r.statut='en paiement' and r.echeance>now())) and r.debut<f and r.fin>d) and
 not exists(select 1 from public.blocages b where b.debut<f and b.fin>d and (p=any(b.personnes) or
 (cardinality(b.personnes)=0 and exists(select 1 from public.equipe e where e.personne=p and e.institut_id=b.institut_id and e.actif)))) from plage),false)
$$;

create or replace function public.catalogue_public(i uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('nom',nom,'couleur',couleur,'vente_bons',(offre='Premium' and exists(select 1 from beauty_private.marchands where institut=i and actif and vente_bons)),'equipe',(select jsonb_agg(jsonb_build_object('personne',e.personne,'nom',e.nom,'photo',e.photo)) from public.equipe e where e.institut_id=i and e.actif),'soins',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nom',s.nom,'minutes',s.minutes,'centimes',s.centimes,'avance',coalesce((select beauty_private.avance(m,s.centimes) from beauty_private.marchands m where m.institut=i),0)) order by s.nom) from public.soins s where s.institut_id=i and actif and en_ligne),'[]'::jsonb)) from public.instituts where id=i and ouvert
$$;

create or replace function beauty_private.planifier_courrier() returns trigger language plpgsql set search_path='' as $$
declare evenement text; instant timestamptz:=new.debut at time zone 'Indian/Reunion';
begin
 if new.statut in ('en paiement','expiré') or (tg_op='UPDATE' and old.statut='en paiement' and new.statut='annulé') then return new; end if;
 if tg_op='UPDATE' then
 if new.debut=old.debut and new.statut=old.statut and new.libelle=old.libelle and new.personne=old.personne then return new; end if;
 update beauty_private.courriers set etat='abandonné' where rdv=new.id and etat='en attente';
 end if;
 if not exists(select 1 from public.clientes c where c.id=new.cliente_id and c.email is not null) then return new; end if;
 if new.statut='annulé' then evenement:='Annulation';
 elsif new.statut<>'confirmé' then return new;
 elsif tg_op='INSERT' or old.statut='en paiement' then evenement:='Confirmation';
 else evenement:='Déplacement'; end if;
 insert into beauty_private.courriers(rdv,type,prevu,debut) values(new.id,evenement,now(),new.debut);
 if new.statut='confirmé' and instant>now()+interval '24 hours' then
 insert into beauty_private.courriers(rdv,type,prevu,debut) values(new.id,'Rappel',instant-interval '24 hours',new.debut);
 end if;
 return new;
end $$;

create or replace function public.mon_rdv(t uuid,annuler boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 select rdv into strict r from beauty_private.liens where token=t;
 update public.rendez_vous set statut='expiré' where id=r and statut='en paiement' and echeance<=now();
 if annuler and exists(select 1 from public.rendez_vous where id=r and statut='en paiement') then update public.rendez_vous set statut='annulé' where id=r;
 elsif annuler then
 if exists(select 1 from public.rendez_vous where id=r and statut='confirmé' and debut<=timezone('Indian/Reunion',now())) then raise exception 'Le rendez-vous a commencé. Contactez votre institut.'; end if;
 perform beauty_private.changer_statut(r,'annulé'); end if;
 return (select jsonb_build_object('libelle',libelle,'debut',debut,'statut',statut,'minutes',minutes,'centimes',centimes,'avance',avance,'echeance',echeance) from public.rendez_vous where id=r);
end $$;
revoke all on function public.synchroniser_marchand(uuid,text,boolean),public.checkout_prive(uuid,boolean),public.finaliser_checkout(uuid,text,text,int,text) from public,anon,authenticated;
grant execute on function public.synchroniser_marchand(uuid,text,boolean),public.checkout_prive(uuid,boolean),public.finaliser_checkout(uuid,text,text,int,text) to service_role;
revoke all on function public.mon_marchand(uuid),public.regler_paiement(uuid,text,int,boolean) from public,anon;
grant execute on function public.mon_marchand(uuid),public.regler_paiement(uuid,text,int,boolean) to authenticated;
grant execute on function public.acheter_bon(uuid,int),public.etat_achat(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
