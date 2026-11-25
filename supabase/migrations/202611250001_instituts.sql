begin;

create schema if not exists beauty_private;

revoke all on schema beauty_private from public;

create table public.instituts (
 id uuid primary key default gen_random_uuid(), nom text not null check (length(trim(nom)) between 1 and 100),
 offre text not null check(offre in ('Solo','Premium')), couleur text not null default '#125441' check(couleur ~ '^#[0-9a-fA-F]{6}$'),
 marge integer not null default 5 check(marge between 0 and 120), horaires jsonb not null default '{}',
 delai_minutes integer not null default 60 check(delai_minutes between 0 and 43200), horizon_jours integer not null default 180 check(horizon_jours between 1 and 730),
 ouvert boolean not null default false, created_at timestamptz not null default now()
);

create table public.equipe (
 institut_id uuid not null references public.instituts, personne uuid not null references auth.users,
 nom text not null check(length(trim(nom)) between 1 and 100), role text not null check(role in ('gerante','responsable','employee')),
 photo text not null default '', primary key(institut_id,personne)
);

create table public.soins (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 nom text not null check(length(trim(nom)) between 1 and 120), minutes int not null check(minutes between 1 and 1200),
 centimes int not null check(centimes between 0 and 10000000), elements uuid[] not null default '{}',
 habilitations uuid[] not null default '{}', preparation text not null default '', actif boolean not null default true,
 en_ligne boolean not null default true
);

create table public.clientes (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 nom text not null check(length(trim(nom)) between 1 and 120), email text, unique(institut_id,email)
);

create table public.rendez_vous (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 personne uuid not null, cliente_id uuid not null references public.clientes, soin_id uuid not null references public.soins,
 libelle text not null, preparation text not null, minutes int not null, marge int not null, centimes int not null,
 debut timestamp not null, fin timestamp not null, statut text not null default 'confirmé' check(statut in ('confirmé','réalisé','annulé','absent')),
 origine text not null, foreign key(institut_id,personne) references public.equipe,
 check(fin=debut+make_interval(mins=>minutes+marge))
);

create index rdv_personne_date on public.rendez_vous(personne,debut,fin);

create table public.blocages (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 personnes uuid[] not null, motif text not null check(length(trim(motif)) between 1 and 120),
 debut timestamp not null, fin timestamp not null check(fin>debut)
);

create table public.cartes (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 code text not null, valeur int not null check(valeur>0), solde int not null check(solde between 0 and valeur),
 unique(institut_id,code), created_at timestamptz not null default now()
);

create table public.mouvements (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 rdv uuid references public.rendez_vous, cliente uuid references public.clientes, carte uuid references public.cartes,
 type text not null, centimes int not null, created_at timestamptz not null default now()
);

create table beauty_private.invitations (
 token uuid primary key default gen_random_uuid(), institut uuid not null references public.instituts,
 email text not null, role text not null, expire timestamptz not null default now()+interval '7 days'
);

create table beauty_private.liens (token uuid primary key default gen_random_uuid(), rdv uuid unique not null references public.rendez_vous);

alter table public.instituts enable row level security;

alter table public.equipe enable row level security;

alter table public.soins enable row level security;

alter table public.clientes enable row level security;

alter table public.rendez_vous enable row level security;

alter table public.blocages enable row level security;

alter table public.cartes enable row level security;

alter table public.mouvements enable row level security;

revoke all on public.instituts,public.equipe,public.soins,public.clientes,public.rendez_vous,public.blocages,public.cartes,public.mouvements from public,anon,authenticated;

grant select on public.instituts,public.equipe,public.soins,public.clientes,public.rendez_vous,public.blocages,public.cartes,public.mouvements to authenticated;

create table beauty_private.flux (
 token uuid primary key default gen_random_uuid(), institut uuid not null, personne uuid not null,
 unique(institut,personne), foreign key(institut,personne) references public.equipe(institut_id,personne) on delete cascade
);

create table beauty_private.courriers (
 id uuid primary key default gen_random_uuid(), rdv uuid not null references public.rendez_vous,
 type text not null, prevu timestamptz not null, etat text not null default 'en attente', tentatives int not null default 0,
 lease uuid, dernier_essai timestamptz, debut timestamp not null
);

create schema if not exists extensions;

create extension if not exists btree_gist with schema extensions;

set local search_path=public,extensions,pg_catalog;

alter table public.rendez_vous add constraint rdv_sans_chevauchement exclude using gist
(personne with =, tsrange(debut,fin,'[)') with &&) where (statut in ('confirmé','réalisé'));

create table public.exceptions_horaires (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 personne uuid, jour date not null, plages jsonb not null,
 foreign key(institut_id,personne) references public.equipe,
 unique nulls not distinct(institut_id,personne,jour)
);

alter table public.exceptions_horaires enable row level security;

revoke all on public.exceptions_horaires from public,anon,authenticated;

grant select on public.exceptions_horaires to authenticated;

create table public.attente (
 id uuid primary key default gen_random_uuid(), institut_id uuid not null references public.instituts,
 nom text not null check(length(trim(nom)) between 1 and 120), contact text not null check(length(trim(contact)) between 1 and 200),
 soin uuid not null references public.soins, jour date not null, created_at timestamptz not null default now()
);

alter table public.attente enable row level security;

revoke all on public.attente from public,anon,authenticated;

grant select on public.attente to authenticated;

alter table public.soins add column prix_calcule boolean not null default false, add column duree_calculee boolean not null default false;

alter table public.equipe add column actif boolean not null default true, add column horaires jsonb not null default '{}';

create function beauty_private.role(i uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.equipe where institut_id=i and personne=auth.uid() and actif
$$;

create function beauty_private.requis(i uuid,gestion boolean default false) returns void language plpgsql set search_path='' as $$
begin
 if coalesce(beauty_private.role(i),'') not in ('gerante','responsable') and (gestion or beauty_private.role(i) is null) then
 raise exception 'Accès refusé'; end if;
end $$;

create function beauty_private.horaire_valide(h jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(h)='array' and jsonb_array_length(h) in (0,2,4) and not exists(select 1 from jsonb_array_elements_text(h) v where v is null or v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
 and (jsonb_array_length(h)=0 or (h->>0)<(h->>1)) and (jsonb_array_length(h)<>4 or ((h->>1)<=(h->>2) and (h->>2)<(h->>3))),false)
$$;

create function beauty_private.plages(i uuid,p uuid,j date) returns jsonb language sql stable set search_path='' as $$
 with horaires as (
 select coalesce((select plages from public.exceptions_horaires where institut_id=i and personne is null and jour=j),
 a.horaires->(extract(isodow from j)::int::text),'[]'::jsonb) as institut,
 coalesce((select plages from public.exceptions_horaires where institut_id=i and personne=p and jour=j),
 e.horaires->(extract(isodow from j)::int::text),'["00:00","23:59"]'::jsonb) as individuelle
 from public.instituts a join public.equipe e on e.institut_id=a.id where a.id=i and e.personne=p and e.actif
 ), intervalles as (
 select greatest(institut->>n,individuelle->>m) as debut, least(institut->>(n+1),individuelle->>(m+1)) as fin
 from horaires cross join lateral generate_series(0,jsonb_array_length(institut)-2,2) n
 cross join lateral generate_series(0,jsonb_array_length(individuelle)-2,2) m
 )
 select coalesce(jsonb_agg(borne order by debut,borne),'[]'::jsonb) from intervalles cross join lateral unnest(array[debut,fin]) borne where debut<fin
$$;

create function beauty_private.habilitee(s public.soins,p uuid) returns boolean language sql stable set search_path='' as $$
 select (cardinality(s.habilitations)=0 or p=any(s.habilitations)) and not exists(select 1 from public.soins c where c.id=any(s.elements) and cardinality(c.habilitations)>0 and not p=any(c.habilitations))
$$;

create function beauty_private.disponible(i uuid,p uuid,d timestamp,minutes int,ignorer uuid default null) returns boolean language sql stable set search_path='' as $$
 with plage as (select d+make_interval(mins=>minutes) f, beauty_private.plages(i,p,d::date) h from public.instituts where id=i)
 select coalesce((select d::date=f::date and exists(select 1 from generate_series(0,jsonb_array_length(h)-2,2) k where d::time >= (h->>k)::time and f::time <= (h->>(k+1))::time) and
 not exists(select 1 from public.rendez_vous r where r.personne=p and r.id is distinct from ignorer and r.statut in ('confirmé','réalisé') and r.debut<f and r.fin>d) and
 not exists(select 1 from public.blocages b where b.debut<f and b.fin>d and (p=any(b.personnes) or
 (cardinality(b.personnes)=0 and exists(select 1 from public.equipe e where e.personne=p and e.institut_id=b.institut_id and e.actif)))) from plage),false)
$$;

create function public.creer_institut(nom text, offre text, prenom text) returns uuid language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 insert into public.instituts(nom,offre) values(trim(nom),offre) returning id into i;
 insert into public.equipe(institut_id,personne,nom,role,photo) values(i,auth.uid(),trim(prenom),'gerante','');
 return i;
end $$;

create function public.regler_institut(i uuid, n text, couleur text, marge int, horaires jsonb, ouvert boolean, delai int default 60, horizon int default 180) returns void language plpgsql security definer set search_path='' as $$
declare jour record; h jsonb;
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 for jour in select * from jsonb_each(horaires) loop
 h:=jour.value;
 if not beauty_private.horaire_valide(h) or jour.key !~ '^[1-7]$' or jsonb_typeof(h)<>'array' or jsonb_array_length(h) not in (2,4) or not ((h->>0)::time < (h->>1)::time)
 or (jsonb_array_length(h)=4 and not ((h->>1)::time <= (h->>2)::time and (h->>2)::time < (h->>3)::time)) then raise exception 'Horaires invalides'; end if;
 end loop;
 if ouvert and (horaires='{}' or not exists(select 1 from public.soins s where s.institut_id=i and s.actif and s.en_ligne)) then raise exception 'Ajoutez des horaires et une prestation en ligne'; end if;
 update public.instituts t set nom=trim(n),delai_minutes=delai,horizon_jours=horizon,couleur=regler_institut.couleur,marge=regler_institut.marge,horaires=regler_institut.horaires,ouvert=regler_institut.ouvert where t.id=i;
end $$;

create function public.enregistrer_soin(i uuid, sid uuid, n text, duree int, prix int, composants uuid[], habilitees uuid[], prep text, visible boolean, actif boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 if exists(select 1 from unnest(composants) x where not exists(select 1 from public.soins s where s.id=x and s.institut_id=i and cardinality(s.elements)=0 and s.id is distinct from sid))
 or exists(select 1 from unnest(habilitees) x where not exists(select 1 from public.equipe e where e.institut_id=i and e.personne=x)) then raise exception 'Sélection invalide'; end if;
 insert into public.soins as s(id,institut_id,nom,minutes,centimes,elements,habilitations,preparation,en_ligne,actif)
 values(coalesce(sid,gen_random_uuid()),i,trim(n),duree,prix,composants,habilitees,prep,visible,actif)
 on conflict(id) do update set nom=excluded.nom,minutes=excluded.minutes,centimes=excluded.centimes,elements=excluded.elements,habilitations=excluded.habilitations,preparation=excluded.preparation,en_ligne=excluded.en_ligne,actif=excluded.actif where s.institut_id=i;
end $$;

create function public.inviter(i uuid, email text, fonction text) returns uuid language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 if beauty_private.role(i) is distinct from 'gerante' or (select offre from public.instituts where id=i)<>'Premium' or fonction not in ('responsable','employee') then raise exception 'Invitation réservée au compte Premium de la gérante'; end if;
 insert into beauty_private.invitations(institut,email,role) values(i,lower(trim(email)),fonction) returning token into t; return t;
end $$;

create function public.rejoindre(t uuid, n text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv beauty_private.invitations;
begin
 delete from beauty_private.invitations where token=t and expire>now() and email=lower(auth.jwt()->>'email') returning * into inv;
 if inv.token is null then raise exception 'Invitation invalide pour ce compte'; end if;
 perform 1 from public.instituts where id=inv.institut and offre='Premium' for share; if not found then raise exception 'Offre Premium requise'; end if;
 insert into public.equipe(institut_id,personne,nom,role,photo) values(inv.institut,auth.uid(),trim(n),inv.role,'') on conflict do nothing;
 return inv.institut;
end $$;

create function public.catalogue_public(i uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('nom',nom,'couleur',couleur,'equipe',(select jsonb_agg(jsonb_build_object('personne',e.personne,'nom',e.nom,'photo',e.photo)) from public.equipe e where e.institut_id=i and e.actif),'soins',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nom',s.nom,'minutes',s.minutes,'centimes',s.centimes) order by s.nom) from public.soins s where s.institut_id=i and actif and en_ligne),'[]'::jsonb)) from public.instituts where id=i and ouvert
$$;

create function public.creneaux(i uuid,sid uuid,jour date) returns table(personne uuid,nom text,debut timestamp) language sql stable security definer set search_path='' as $$
 select e.personne,e.nom,t.d from public.instituts a join public.soins s on s.institut_id=a.id join public.equipe e on e.institut_id=a.id and e.actif
 cross join generate_series(jour::timestamp,jour::timestamp+interval '23 hours 55 minutes',interval '5 minutes') t(d)
 where a.id=i and a.ouvert and s.id=sid and s.actif and s.en_ligne and beauty_private.habilitee(s,e.personne)
 and t.d between timezone('Indian/Reunion',now())+make_interval(mins=>a.delai_minutes) and timezone('Indian/Reunion',now())+make_interval(days=>a.horizon_jours)
 and beauty_private.disponible(i,e.personne,t.d,s.minutes+a.marge) order by t.d,e.nom
$$;

create function beauty_private.preparation(s public.soins) returns text language sql stable set search_path='' as $$
 select concat_ws(E'\n',nullif(s.preparation,''),(select string_agg(nullif(c.preparation,''),E'\n' order by x.ordre) from unnest(s.elements) with ordinality x(id,ordre) join public.soins c on c.id=x.id))
$$;

create function public.reserver(i uuid,p uuid,sid uuid,d timestamp,n text,email text,web boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.soins; a public.instituts; c uuid; r uuid; jeton uuid; adresse text:=nullif(lower(trim(email)),'');
begin
 if web is null then raise exception 'Origine requise'; end if; if not web then perform beauty_private.requis(i); if beauty_private.role(i)='employee' and p<>auth.uid() then raise exception 'Agenda privé'; end if; end if;
 select * into a from public.instituts where id=i for share;
 select * into s from public.soins where institut_id=i and id=sid and actif;
 if s.id is null or not exists(select 1 from public.equipe where institut_id=i and personne=p and actif)
 or not beauty_private.habilitee(s,p) then raise exception 'Prestation indisponible'; end if;
 if web and (not a.ouvert or not s.en_ligne or adresse is null or adresse !~ '^[^ @]+@[^ @]+\.[^ @]+$' or d not between timezone('Indian/Reunion',now())+make_interval(mins=>a.delai_minutes) and timezone('Indian/Reunion',now())+make_interval(days=>a.horizon_jours)) then raise exception 'Réservation en ligne indisponible'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 if not beauty_private.disponible(i,p,d,s.minutes+a.marge) then raise exception 'Créneau indisponible'; end if;
 insert into public.clientes(institut_id,nom,email) values(i,trim(n),adresse) on conflict on constraint clientes_institut_id_email_key do update set email=excluded.email returning id into c;
 insert into public.rendez_vous(institut_id,personne,cliente_id,soin_id,libelle,preparation,minutes,marge,centimes,debut,fin,origine)
 values(i,p,c,sid,s.nom,beauty_private.preparation(s),s.minutes,a.marge,s.centimes,d,d+make_interval(mins=>s.minutes+a.marge),case when web then 'web' else 'institut' end) returning id into r;
 insert into beauty_private.liens(rdv) values(r) returning token into jeton;
 return case when web then jeton else r end;
end $$;

create function public.deplacer(r uuid,d timestamp) returns void language plpgsql security definer set search_path='' as $$
declare x public.rendez_vous;
begin
 select * into strict x from public.rendez_vous where id=r for update;
 perform beauty_private.requis(x.institut_id);
 if (beauty_private.role(x.institut_id)='employee' and x.personne<>auth.uid()) or x.statut<>'confirmé' then raise exception 'Déplacement interdit'; end if;
 perform pg_advisory_xact_lock(hashtextextended(x.personne::text,42));
 if not beauty_private.disponible(x.institut_id,x.personne,d,x.minutes+x.marge,r) then raise exception 'Créneau indisponible'; end if;
 update public.rendez_vous set debut=d,fin=d+make_interval(mins=>x.minutes+x.marge) where id=r;
end $$;

create function public.bloquer(i uuid, personnes uuid[], motif text, d timestamp, f timestamp, confirmer boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare p uuid; b uuid;
begin
 perform beauty_private.requis(i,true);
 if exists(select 1 from unnest(personnes) x where not exists(select 1 from public.equipe e where e.institut_id=i and e.personne=x)) then raise exception 'Équipe invalide'; end if;
 for p in select e.personne from public.equipe e where e.institut_id=i and (cardinality(personnes)=0 or e.personne=any(personnes)) order by e.personne loop
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 if not confirmer and exists(select 1 from public.rendez_vous where personne=p and statut='confirmé' and debut<f and fin>d) then raise exception 'Des rendez-vous sont déjà confirmés sur cette période'; end if;
 end loop;
 insert into public.blocages(institut_id,personnes,motif,debut,fin) values(i,personnes,motif,d,f) returning id into b; return b;
end $$;

create function public.debloquer(b uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform beauty_private.requis((select institut_id from public.blocages where id=b),true); delete from public.blocages where id=b; end $$;

create function public.vendre_carte(i uuid,montant int,operation uuid default gen_random_uuid()) returns text language plpgsql security definer set search_path='' as $$
declare c public.cartes; prefixe text:=to_char(timezone('Indian/Reunion',now()),'YYYY-MM'); seq int;
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 perform pg_advisory_xact_lock(hashtextextended(i::text,56));
 select * into c from public.cartes where id=operation and institut_id=i;
 if found then
 if c.valeur<>montant then raise exception 'Cette vente a déjà été enregistrée'; end if;
 return c.code; end if;
 select count(*)+1 into seq from public.cartes where institut_id=i and code like prefixe||'%';
 insert into public.cartes(id,institut_id,code,valeur,solde) values(operation,i,prefixe||case when seq<10 then '0' else '' end||seq,montant,montant) returning * into c;
 insert into public.mouvements(institut_id,carte,type,centimes) values(i,c.id,'vente carte',montant);
 return c.code;
end $$;

create function public.encaisser(r uuid,mode text,montant int,bon text default '',operation uuid default gen_random_uuid()) returns void language plpgsql security definer set search_path='' as $$
declare x public.rendez_vous; reste int; credit int; c uuid;
begin
 select * into strict x from public.rendez_vous where id=r for update;
 if beauty_private.role(x.institut_id) is distinct from 'gerante' or x.statut not in ('confirmé','réalisé') then raise exception 'Encaissement impossible'; end if;
 if exists(select 1 from public.mouvements where id=operation and rdv=r and type=mode and centimes=montant) then return; end if;
 select x.centimes-coalesce(sum(centimes),0) into reste from public.mouvements where rdv=r and type in ('encaissement','carte utilisée','crédit utilisé');
 if mode not in ('encaissement','carte utilisée','crédit utilisé') or montant<=0 or montant>reste then raise exception 'Montant invalide'; end if;
 if mode='carte utilisée' then
 update public.cartes set solde=solde-montant where institut_id=x.institut_id and code=bon and solde>=montant returning id into c;
 if c is null then raise exception 'Bon inconnu ou solde insuffisant'; end if;
 elsif mode='crédit utilisé' then
 perform 1 from public.clientes where id=x.cliente_id for update;
 select coalesce(sum(case when type='crédit accordé' then centimes else -centimes end),0) into credit from public.mouvements where cliente=x.cliente_id and type in ('crédit accordé','crédit utilisé');
 if credit<montant then raise exception 'Crédit insuffisant'; end if;
 end if;
 insert into public.mouvements(id,institut_id,rdv,cliente,carte,type,centimes) values(operation,x.institut_id,r,x.cliente_id,c,mode,montant);
end $$;

create function beauty_private.changer_statut(r uuid,s text) returns void language plpgsql set search_path='' as $$
declare x public.rendez_vous; m public.mouvements;
begin
 select * into strict x from public.rendez_vous where id=r for update;
 if x.statut=s then return; end if;
 if x.statut<>'confirmé' or s not in ('absent','réalisé','annulé') then raise exception 'Statut invalide'; end if;
 if s='annulé' then
 for m in select * from public.mouvements where rdv=r and type in ('encaissement','carte utilisée','crédit utilisé') order by carte loop
 if m.type='carte utilisée' then update public.cartes set solde=solde+m.centimes where id=m.carte; end if;
 insert into public.mouvements(institut_id,rdv,cliente,carte,type,centimes) values(x.institut_id,r,x.cliente_id,m.carte,case when m.type='carte utilisée' then 'carte recréditée' else 'crédit accordé' end,m.centimes);
 end loop;
 end if;
 update public.rendez_vous set statut=s where id=r;
end $$;

create function public.statut_rdv(r uuid,s text) returns void language plpgsql security definer set search_path='' as $$
declare x public.rendez_vous;
begin
 select * into strict x from public.rendez_vous where id=r; perform beauty_private.requis(x.institut_id);
 if beauty_private.role(x.institut_id)='employee' and x.personne<>auth.uid() then raise exception 'Agenda privé'; end if;
 perform beauty_private.changer_statut(r,s);
end $$;

create function public.mon_rdv(t uuid,annuler boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 select rdv into strict r from beauty_private.liens where token=t;
 if annuler then
 if exists(select 1 from public.rendez_vous where id=r and statut='confirmé' and debut<=timezone('Indian/Reunion',now())) then raise exception 'Le rendez-vous a commencé. Contactez votre institut.'; end if;
 perform beauty_private.changer_statut(r,'annulé'); end if;
 return (select jsonb_build_object('libelle',libelle,'debut',debut,'statut',statut,'minutes',minutes,'centimes',centimes) from public.rendez_vous where id=r);
end $$;

create function public.portrait(i uuid,image text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform beauty_private.requis(i);
 if length(image)>410000 or (image<>'' and image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then raise exception 'Image invalide'; end if;
 update public.equipe set photo=image where institut_id=i and personne=auth.uid();
end $$;

create function public.mon_calendrier(i uuid,retirer boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare jeton uuid;
begin
 perform beauty_private.requis(i);
 if retirer then delete from beauty_private.flux where institut=i and personne=auth.uid(); return null; end if;
 insert into beauty_private.flux(institut,personne) values(i,auth.uid()) on conflict(institut,personne) do update set personne=excluded.personne returning token into jeton;
 return jeton;
end $$;

create function public.lire_flux(t uuid) returns table(id uuid,debut timestamp,fin timestamp,libelle text) language plpgsql security definer set search_path='' as $$
declare f beauty_private.flux;
begin
 select * into strict f from beauty_private.flux where token=t;
 return query select r.id,r.debut,r.fin,'Rendez-vous institut'::text from public.rendez_vous r where r.institut_id=f.institut and r.personne=f.personne and r.statut in ('confirmé','réalisé') and r.fin>timezone('Indian/Reunion',now())-interval '3 months'
 union all select b.id,b.debut,b.fin,'Indisponible'::text from public.blocages b where b.institut_id=f.institut and (cardinality(b.personnes)=0 or f.personne=any(b.personnes));
end $$;

create function beauty_private.planifier_courrier() returns trigger language plpgsql set search_path='' as $$
declare evenement text; instant timestamptz:=new.debut at time zone 'Indian/Reunion';
begin
 if tg_op='UPDATE' then
 if new.debut=old.debut and new.statut=old.statut and new.libelle=old.libelle and new.personne=old.personne then return new; end if;
 update beauty_private.courriers set etat='abandonné' where rdv=new.id and etat='en attente';
 end if;
 if not exists(select 1 from public.clientes c where c.id=new.cliente_id and c.email is not null) then return new; end if;
 if new.statut='annulé' then evenement:='Annulation';
 elsif new.statut<>'confirmé' then return new;
 elsif tg_op='INSERT' then evenement:='Confirmation';
 else evenement:='Déplacement'; end if;
 insert into beauty_private.courriers(rdv,type,prevu,debut) values(new.id,evenement,now(),new.debut);
 if new.statut='confirmé' and instant>now()+interval '24 hours' then
 insert into beauty_private.courriers(rdv,type,prevu,debut) values(new.id,'Rappel',instant-interval '24 hours',new.debut);
 end if;
 return new;
end $$;

create function public.prendre_courriers() returns table(id uuid,lease uuid,email text,type text,debut timestamp,institut text,lien uuid) language sql security definer set search_path='' as $$
 with jobs as (
 select j.id from beauty_private.courriers j join public.rendez_vous r on r.id=j.rdv
 where j.etat='en attente' and j.prevu<=now() and (j.dernier_essai is null or j.dernier_essai<now()-interval '10 minutes')
 and (j.type<>'Rappel' or (r.statut='confirmé' and r.debut=j.debut and r.debut>timezone('Indian/Reunion',now())))
 order by j.prevu limit 20 for update of j skip locked
 ), claimed as (update beauty_private.courriers j set dernier_essai=now(),tentatives=tentatives+1,lease=gen_random_uuid() from jobs where j.id=jobs.id returning j.*)
 select j.id,j.lease,c.email,j.type,j.debut,i.nom,l.token from claimed j join public.rendez_vous r on r.id=j.rdv join public.instituts i on i.id=r.institut_id join public.clientes c on c.id=r.cliente_id join beauty_private.liens l on l.rdv=r.id
$$;

create function public.resultat_courrier(j uuid,verrou uuid,succes boolean) returns void language sql security definer set search_path='' as $$
 update beauty_private.courriers set etat=case when succes then 'envoyé' when tentatives>=5 then 'échec' else 'en attente' end,lease=null where id=j and lease=verrou and etat='en attente'
$$;

create function public.suivi_courrier(r uuid) returns table(type text,etat text,prevu timestamptz) language sql stable security definer set search_path='' as $$
 select j.type,j.etat,j.prevu from beauty_private.courriers j join public.rendez_vous v on v.id=j.rdv where v.id=r and (beauty_private.role(v.institut_id) in ('gerante','responsable') or (beauty_private.role(v.institut_id) is not null and v.personne=auth.uid())) order by j.prevu desc
$$;

create function public.exception_jour(i uuid,p uuid,j date,h jsonb) returns void language plpgsql security definer set search_path='' as $$
begin perform beauty_private.requis(i,true);
 if h is null then delete from public.exceptions_horaires where institut_id=i and personne is not distinct from p and jour=j;
 else insert into public.exceptions_horaires(institut_id,personne,jour,plages) values(i,p,j,h)
 on conflict(institut_id,personne,jour) do update set plages=excluded.plages; end if;
end $$;

create function public.liste_attente(i uuid,retirer uuid,n text,contact text,sid uuid,j date) returns void language plpgsql security definer set search_path='' as $$
begin perform beauty_private.requis(i,true);
 if (select offre from public.instituts where id=i)<>'Premium' then raise exception 'Liste d’attente réservée à Premium'; end if;
 if retirer is not null then delete from public.attente where institut_id=i and id=retirer; return; end if;
 if not exists(select 1 from public.soins where id=sid and institut_id=i and actif) then raise exception 'Prestation indisponible'; end if;
 insert into public.attente(institut_id,nom,contact,soin,jour) values(i,trim(n),trim(contact),sid,j);
end $$;

create function public.changer_offre(i uuid,offre text) returns void language plpgsql security definer set search_path='' as $$
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 perform 1 from public.instituts where id=i for update;
 if offre='Solo' and (select count(*) from public.equipe where institut_id=i and actif)>1 then raise exception 'Votre institut compte plusieurs professionnelles'; end if;
 update public.instituts set offre=changer_offre.offre where id=i;
 if offre='Solo' then delete from beauty_private.invitations where institut=i; end if;
end $$;

create function beauty_private.calcul_formule() returns trigger language plpgsql set search_path='' as $$
declare prix int; duree int;
begin
 if cardinality(new.elements)>0 then
 select sum(centimes),sum(minutes) into prix,duree from public.soins where id=any(new.elements);
 new.prix_calcule:=(prix=new.centimes); new.duree_calculee:=(duree=new.minutes);
 end if;
 return new;
end $$;

create function beauty_private.maj_formules() returns trigger language plpgsql set search_path='' as $$
begin
 if cardinality(new.elements)=0 and (new.minutes<>old.minutes or new.centimes<>old.centimes) then
 update public.soins f set centimes=case when f.prix_calcule then (select sum(s.centimes) from public.soins s where s.id=any(f.elements)) else f.centimes end,
 minutes=case when f.duree_calculee then (select sum(s.minutes) from public.soins s where s.id=any(f.elements)) else f.minutes end
 where new.id=any(f.elements);
 end if; return new;
end $$;

create function public.modifier_rdv(r uuid,d timestamp,p uuid,sid uuid) returns void language plpgsql security definer set search_path='' as $$
declare x public.rendez_vous; soin public.soins; frais int;
begin
 select * into strict x from public.rendez_vous where id=r for update;
 perform beauty_private.requis(x.institut_id);
 if x.statut<>'confirmé' or (beauty_private.role(x.institut_id)='employee' and (x.personne<>auth.uid() or p<>auth.uid())) then raise exception 'Modification interdite'; end if;
 select * into strict soin from public.soins where id=sid and institut_id=x.institut_id;
 if not exists(select 1 from public.equipe where institut_id=x.institut_id and personne=p and actif) or not beauty_private.habilitee(soin,p) then raise exception 'Professionnelle indisponible'; end if;
 if sid<>x.soin_id then
 if not soin.actif then raise exception 'Prestation archivée'; end if;
 select coalesce(sum(centimes),0) into frais from public.mouvements where rdv=r and type in ('encaissement','crédit utilisé','carte utilisée');
 if frais>soin.centimes then raise exception 'Le montant déjà versé dépasse le prix du nouveau soin'; end if;
 x.libelle:=soin.nom;x.soin_id:=sid;x.minutes:=soin.minutes;x.preparation:=beauty_private.preparation(soin);x.centimes:=soin.centimes;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 if not beauty_private.disponible(x.institut_id,p,d,x.minutes+x.marge,r) then raise exception 'Créneau indisponible'; end if;
 update public.rendez_vous set personne=p,soin_id=x.soin_id,libelle=x.libelle,minutes=x.minutes,preparation=x.preparation,centimes=x.centimes,debut=d,fin=d+make_interval(mins=>x.minutes+x.marge) where id=r;
end $$;

create function public.deplacer_invitee(t uuid,d timestamp) returns void language plpgsql security definer set search_path='' as $$
declare x public.rendez_vous; a public.instituts;
begin
 select v.* into strict x from public.rendez_vous v join beauty_private.liens l on l.rdv=v.id where l.token=t for update of v;
 select * into strict a from public.instituts where id=x.institut_id;
 if x.statut<>'confirmé' or x.debut<=timezone('Indian/Reunion',now()) or not (select ouvert from public.instituts where id=x.institut_id) or d not between timezone('Indian/Reunion',now())+make_interval(mins=>a.delai_minutes) and timezone('Indian/Reunion',now())+make_interval(days=>a.horizon_jours) then raise exception 'Déplacement indisponible'; end if;
 perform pg_advisory_xact_lock(hashtextextended(x.personne::text,42));
 if not beauty_private.disponible(x.institut_id,x.personne,d,x.minutes+x.marge,x.id) then raise exception 'Créneau indisponible'; end if;
 update public.rendez_vous set debut=d,fin=d+make_interval(mins=>x.minutes+x.marge) where id=x.id;
end $$;

create function public.gerer_collegue(i uuid,p uuid,fonction text,active boolean,horaires jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j record;
begin
 if beauty_private.role(i) is distinct from 'gerante' or p=auth.uid() or fonction not in ('employee','responsable') then raise exception 'Modification interdite'; end if;
 perform 1 from public.instituts where id=i and offre='Premium' for update;
 if not found then raise exception 'Offre Premium requise'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p::text,42));
 if not active and exists(select 1 from public.rendez_vous where institut_id=i and personne=p and statut='confirmé' and fin>timezone('Indian/Reunion',now())) then raise exception 'Réaffectez les futurs rendez-vous de cette collègue'; end if;
 for j in select * from jsonb_each(horaires) loop
 if j.key !~ '^[1-7]$' or not beauty_private.horaire_valide(j.value) then raise exception 'Horaires invalides'; end if;
 end loop;
 update public.equipe e set role=fonction,actif=active,horaires=gerer_collegue.horaires where e.institut_id=i and e.personne=p and e.role<>'gerante';
 if not active then delete from beauty_private.flux where institut=i and personne=p; end if;
end $$;

create policy membre on public.instituts for select using (beauty_private.role(id) is not null);



create policy catalogue on public.soins for select using (beauty_private.role(institut_id) is not null);



create policy fiches on public.clientes for select using (beauty_private.role(institut_id) in ('gerante','responsable') or exists(select 1 from public.rendez_vous r where r.cliente_id=clientes.id and r.personne=auth.uid()));

create policy bloc on public.blocages for select using (beauty_private.role(institut_id) in ('gerante','responsable') or (beauty_private.role(institut_id) is not null and (cardinality(personnes)=0 or auth.uid()=any(personnes))));

create policy bons on public.cartes for select using (beauty_private.role(institut_id)='gerante');

create policy finances on public.mouvements for select using (beauty_private.role(institut_id)='gerante');

do $$
declare f record;
begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['creer_institut','regler_institut','enregistrer_soin','inviter','rejoindre','catalogue_public','creneaux','reserver','deplacer','bloquer','debloquer','vendre_carte','encaisser','statut_rdv','mon_rdv']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 if f.proname in ('catalogue_public','creneaux','reserver','mon_rdv') then execute format('grant execute on function %s to anon',f.signature); end if;
 end loop;
end $$;

revoke all on function public.portrait(uuid,text) from public,anon;

grant execute on function public.portrait(uuid,text) to authenticated;

create trigger courriers_rdv after insert or update of debut,statut,libelle,personne on public.rendez_vous for each row execute function beauty_private.planifier_courrier();

revoke all on function public.mon_calendrier(uuid,boolean),public.suivi_courrier(uuid) from public,anon;

grant execute on function public.mon_calendrier(uuid,boolean),public.suivi_courrier(uuid) to authenticated;

revoke all on function public.lire_flux(uuid),public.prendre_courriers(),public.resultat_courrier(uuid,uuid,boolean) from public,anon,authenticated;

grant execute on function public.lire_flux(uuid),public.prendre_courriers(),public.resultat_courrier(uuid,uuid,boolean) to service_role;

create policy exceptions_visibles on public.exceptions_horaires for select using (beauty_private.role(institut_id) in ('gerante','responsable') or (beauty_private.role(institut_id) is not null and (personne is null or personne=auth.uid())));

alter table public.exceptions_horaires add check(beauty_private.horaire_valide(plages));

create policy attente_visible on public.attente for select using(beauty_private.role(institut_id) in ('gerante','responsable'));

revoke all on function public.changer_offre(uuid,text),public.liste_attente(uuid,uuid,text,text,uuid,date),public.exception_jour(uuid,uuid,date,jsonb) from public,anon;

grant execute on function public.changer_offre(uuid,text),public.liste_attente(uuid,uuid,text,text,uuid,date),public.exception_jour(uuid,uuid,date,jsonb) to authenticated;

create trigger formule_auto before insert or update of centimes,minutes,elements on public.soins for each row execute function beauty_private.calcul_formule();

create trigger soin_modifie after update of centimes,minutes on public.soins for each row execute function beauty_private.maj_formules();

revoke all on function public.modifier_rdv(uuid,timestamp,uuid,uuid) from public,anon;

grant execute on function public.modifier_rdv(uuid,timestamp,uuid,uuid) to authenticated;

revoke all on function public.deplacer_invitee(uuid,timestamp) from public;

grant execute on function public.deplacer_invitee(uuid,timestamp) to anon,authenticated;



create policy equipe_visible on public.equipe for select using(beauty_private.role(institut_id) in ('gerante','responsable') or (personne=auth.uid() and actif));



create policy agenda on public.rendez_vous for select using(beauty_private.role(institut_id) in ('gerante','responsable') or (beauty_private.role(institut_id) is not null and personne=auth.uid()));

revoke all on function public.gerer_collegue(uuid,uuid,text,boolean,jsonb) from public,anon;

grant execute on function public.gerer_collegue(uuid,uuid,text,boolean,jsonb) to authenticated;

commit;
