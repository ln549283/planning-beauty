begin;
create function public.occupation(i uuid,j date,f date,p uuid default null) returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare resultat jsonb;
begin
 if beauty_private.role(i) is distinct from 'gerante' or not exists(select 1 from public.instituts where id=i and offre='Premium') then raise exception 'Réservé à la gérante Premium'; end if;
 if j is null or f is null or f<j or f-j>366 then raise exception 'Choisissez une période de 367 jours maximum'; end if;
 with jours as (
  select e.personne,j+n jour,beauty_private.plages(i,e.personne,j+n) h
  from public.equipe e cross join generate_series(0,f-j) n where e.institut_id=i and e.actif and (p is null or p=e.personne)
 ), plages as (
  select personne,tsrange(jour+(h->>k)::time,jour+(h->>(k+1))::time,'[)') plage
  from jours cross join lateral generate_series(0,jsonb_array_length(h)-2,2) k
 ), capacite as (
  select personne,unnest(tsmultirange(plage)-coalesce((
    select range_agg(tsrange(b.debut,b.fin,'[)')) from public.blocages b where b.debut<upper(plage) and b.fin>lower(plage)
    and (plages.personne=any(b.personnes) or (cardinality(b.personnes)=0 and exists(select 1 from public.equipe e where e.personne=plages.personne and e.institut_id=b.institut_id and e.actif)))
  ),'{}'::tsmultirange)) libre from plages
 )
 select jsonb_build_object('ouvrables',coalesce(sum(extract(epoch from upper(libre)-lower(libre))/60),0),
 'occupees',coalesce(sum((select sum(extract(epoch from upper(periode)-lower(periode))/60) from unnest((select range_agg(libre * tsrange(v.debut,v.fin,'[)'))
 from public.rendez_vous v where v.institut_id=i and v.personne=c.personne and v.statut in ('réalisé','confirmé','absent')
 and v.debut<upper(libre) and v.fin>lower(libre))) periode)),0))
 into resultat from capacite c;
 return resultat;
end $$;
revoke all on function public.occupation(uuid,date,date,uuid) from public,anon;
grant execute on function public.occupation(uuid,date,date,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
