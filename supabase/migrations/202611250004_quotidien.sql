begin;
alter table public.clientes add telephone text not null default '', add preferences text not null default '', add notes text not null default '';
create function public.modifier_fiche(c uuid,tel text,pref text,note text) returns void language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 select institut_id into strict i from public.clientes where id=c;
 perform beauty_private.requis(i);
 if beauty_private.role(i)='employee' and not exists(select 1 from public.rendez_vous where cliente_id=c and personne=auth.uid()) then raise exception 'Fiche inaccessible'; end if;
 if length(tel)>30 or length(pref)>1000 or length(note)>2000 then raise exception 'Texte trop long'; end if;
 update public.clientes set telephone=trim(tel),preferences=trim(pref),notes=trim(note) where id=c;
end $$;

create table beauty_private.materiel (
 institut uuid not null, personne uuid not null, jour date not null, article text not null check(length(article) between 1 and 2000),
 primary key(institut,personne,jour,article), foreign key(institut,personne) references public.equipe(institut_id,personne)
);
create function public.materiel_prepare(i uuid,j date) returns setof text language sql stable security definer set search_path='' as $$
 select article from beauty_private.materiel where institut=i and jour=j and personne=auth.uid() and beauty_private.role(i) is not null
$$;
create function public.cocher_materiel(i uuid,j date,article text,fait boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform beauty_private.requis(i);
 if fait then insert into beauty_private.materiel values(i,auth.uid(),j,article) on conflict do nothing;
 else delete from beauty_private.materiel m where m.institut=i and m.personne=auth.uid() and m.jour=j and m.article=cocher_materiel.article; end if;
end $$;

alter table public.instituts add fidelite_seuil int not null default 0 check(fidelite_seuil between 0 and 100000),
 add fidelite_cadeau text not null default '' check(length(fidelite_cadeau)<=120);
create table beauty_private.points (
 rdv uuid primary key references public.rendez_vous, cliente uuid not null references public.clientes,
 centimes int not null check(centimes>0)
);
create table beauty_private.recompenses (
 id uuid primary key, cliente uuid not null references public.clientes, seuil int not null,
 cadeau text not null, remis_par uuid not null references auth.users, date_remise timestamptz default now()
);
create index on beauty_private.points(cliente);
create index on beauty_private.recompenses(cliente);
create function public.regler_fidelite(i uuid,seuil int,cadeau text) returns void language plpgsql security definer set search_path='' as $$
begin
 if beauty_private.role(i) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 if seuil>0 and nullif(trim(cadeau),'') is null then raise exception 'Précisez la récompense'; end if;
 update public.instituts set fidelite_seuil=seuil,fidelite_cadeau=trim(cadeau) where id=i and offre='Premium';
 if not found then raise exception 'Programme réservé à Premium'; end if;
end $$;
create function beauty_private.points_rdv() returns trigger language plpgsql set search_path='' as $$
declare v public.rendez_vous; regle int;
begin
 if tg_table_name='mouvements' then
   if new.rdv is null or new.type not in ('encaissement','crédit utilisé','carte utilisée') then return new; end if;
   select * into v from public.rendez_vous where id=new.rdv;
 else v:=new; end if;
 if v.statut<>'réalisé' or v.centimes=0 then return new; end if;
 if not exists(select 1 from public.instituts where id=v.institut_id and offre='Premium' and fidelite_seuil>0) then return new; end if;
 select coalesce(sum(centimes),0) into regle from public.mouvements where rdv=v.id and type in ('encaissement','carte utilisée','crédit utilisé');
 if regle>=v.centimes then insert into beauty_private.points values(v.id,v.cliente_id,v.centimes) on conflict do nothing; end if;
 return new;
end $$;
create trigger points_prestation after update of statut on public.rendez_vous for each row execute function beauty_private.points_rdv();
create trigger points_encaissement after insert on public.mouvements for each row execute function beauty_private.points_rdv();
create function public.ma_fidelite(c uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.instituts; solde bigint;
begin
 select i.* into strict a from public.instituts i join public.clientes p on p.institut_id=i.id where p.id=c;
 if beauty_private.role(a.id) is distinct from 'gerante' then raise exception 'Réservé à la gérante'; end if;
 select coalesce((select sum(centimes)/100 from beauty_private.points where cliente=c),0)-coalesce((select sum(seuil) from beauty_private.recompenses where cliente=c),0) into solde;
 return jsonb_build_object('points',solde,'cadeau',a.fidelite_cadeau,'seuil',a.fidelite_seuil,'historique',coalesce((select jsonb_agg(jsonb_build_object('date',date_remise,'cadeau',cadeau,'points',seuil) order by date_remise desc) from beauty_private.recompenses where cliente=c),'[]'::jsonb));
end $$;
create function public.remettre_cadeau(c uuid,operation uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.instituts; f jsonb;
begin
 perform 1 from public.clientes where id=c for update;
 select i.* into strict a from public.instituts i join public.clientes p on p.institut_id=i.id where p.id=c for share of i;
 f:=public.ma_fidelite(c);
 if exists(select 1 from beauty_private.recompenses where id=operation and cliente=c) then return; end if;
 if a.offre<>'Premium' or a.fidelite_seuil=0 or (f->>'points')::bigint<a.fidelite_seuil then raise exception 'Récompense indisponible'; end if;
 insert into beauty_private.recompenses(id,cliente,seuil,cadeau,remis_par) values(operation,c,a.fidelite_seuil,a.fidelite_cadeau,auth.uid());
end $$;

create function beauty_private.verifier_statut() returns trigger language plpgsql set search_path='' as $$
begin
 if new.statut in ('réalisé','absent') and new.debut>timezone('Indian/Reunion',now()) then raise exception 'Le rendez-vous n’a pas encore commencé'; end if;
 return new;
end $$;
create trigger verifier_statut before update of statut on public.rendez_vous for each row execute function beauty_private.verifier_statut();
revoke all on all tables in schema beauty_private from public,anon,authenticated;
revoke all on function public.modifier_fiche(uuid,text,text,text),public.materiel_prepare(uuid,date),public.cocher_materiel(uuid,date,text,boolean),public.regler_fidelite(uuid,int,text),public.ma_fidelite(uuid),public.remettre_cadeau(uuid,uuid) from public,anon;
grant execute on function public.modifier_fiche(uuid,text,text,text),public.materiel_prepare(uuid,date),public.cocher_materiel(uuid,date,text,boolean),public.regler_fidelite(uuid,int,text),public.ma_fidelite(uuid),public.remettre_cadeau(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
