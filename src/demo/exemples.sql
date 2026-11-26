-- Données de présentation chargées uniquement dans la base éphémère du navigateur.
select public.acces_professionnel();
do $$
declare
 i uuid:=public.creer_institut('Institut Démo','Premium','Julie');
 equipe uuid[]:=array[auth.uid(),'00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000003'::uuid];
 jour date:=timezone('Indian/Reunion',now())::date;
 ids_soins uuid[]:='{}'; clientes uuid[]:='{}';
 noms text[]:=array['Camille','Sarah','Emma','Lou','Anaïs','Nina','Maya','Alice','Zoé','Jade','Rose','Inès'];
 article record; sid uuid; c uuid; r uuid; soin public.soins; d timestamp; statut text; bon text;
begin
 insert into public.equipe(institut_id,personne,nom,role) values(i,equipe[2],'Inès','responsable'),(i,equipe[3],'Léa','employee');
 update public.instituts set horaires=(select jsonb_object_agg(n::text,'["08:00","12:00","13:00","18:00"]'::jsonb) from generate_series(1,7)n),
 fidelite_seuil=100,fidelite_cadeau='Un soin offert' where id=i;
 for article in select * from (values
 (1,'Fil','Sourcils',15,1000),(2,'Fil','Lèvres',10,800),(3,'Fil','Sourcils + Lèvres',15,1800),
 (4,'Fil','Sourcils + Lèvres + Menton',20,2500),(5,'Fil','Sourcils + Lèvres + Tempes',20,2500),
 (6,'Cire classique','Sourcils',15,1000),(7,'Cire classique','Milieu des sourcils',5,500),
 (8,'Cire classique','Sourcils + Lèvres',15,1800),(9,'Cire classique','Lèvres',10,800),
 (10,'Cire classique','Menton',5,500),(11,'Cire classique','Visage',30,3000),(12,'Cire classique','Aisselles',15,1500),
 (13,'Cire classique','Demi-jambes',15,2000),(14,'Cire classique','Jambes entières',30,3000),
 (15,'Cire classique','Maillot brésilien',15,2000),(16,'Cire classique','Maillot intégral',30,3000),
 (17,'Cire classique','Maillot simple',15,1000),(18,'Cire classique','Fesses',15,1000),
 (19,'Cire classique','Aisselles + Demi-jambes + Maillot intégral',45,5500),(20,'Cire classique','Torse / Dos / Ventre',15,2000)
 ) as liste(num,technique,nom,minutes,centimes) order by num loop
 sid:=gen_random_uuid();
 perform public.enregistrer_fiche_soin(i,sid,article.nom||' · '||article.technique,article.minutes,article.centimes,
 case article.num when 3 then array[ids_soins[1],ids_soins[2]] when 19 then array[ids_soins[12],ids_soins[13],ids_soins[16]] else '{}'::uuid[] end,
 '{}',case when article.technique='Fil' then E'Fil de coton\nCompresses' else E'Cire classique\nSpatules\nCompresses' end,true,true,'Épilations '||case when article.technique='Fil' then 'au fil' else 'à la cire classique' end);
 ids_soins:=array_append(ids_soins,sid);
 end loop;
 update public.soins set composition_libre='Sourcils, lèvres, menton' where id=ids_soins[4];
 update public.soins set composition_libre='Sourcils, lèvres, tempes' where id=ids_soins[5];
 update public.soins set elements=array[ids_soins[6],ids_soins[9]] where id=ids_soins[8];
 for idx in 1..cardinality(noms) loop
 insert into public.clientes(institut_id,nom,email) values(i,noms[idx],format('cliente%s@example.test',idx)) returning id into c;
 clientes:=array_append(clientes,c);
 end loop;
 perform public.enregistrer_profil('Julie','Lagon','Non précisé',null,'','','','','');
 bon:=public.vendre_carte(i,5000);
 update public.cartes set created_at=(jour-60) at time zone 'Indian/Reunion' where institut_id=i;
 update public.mouvements set created_at=(jour-60) at time zone 'Indian/Reunion' where institut_id=i;
 -- Un soin tous les deux jours sur les deux derniers mois. Les quatre derniers
 -- indices construisent les quatre rendez-vous de demain.
 for idx in 0..46 loop
   if idx<30 then d:=(jour-60+2*idx)+time '10:00'; statut:='réalisé';
   elsif idx=30 then d:=(jour-1)+time '14:00'; statut:='annulé';
   elsif idx<=42 then d:=jour+time '08:00'+(idx-31)*interval '20 minutes'; statut:='confirmé';
   else d:=(jour+1)+(array['09:00','10:00','11:00','13:00'])[idx-42]::time; statut:='confirmé'; end if;
   select * into soin from public.soins where id=ids_soins[case when idx=0 then 1 when idx between 31 and 42 then 3 when idx>=43 then (array[3,19,12,1])[idx-42] else 1+(idx%20) end];
   c:=clientes[case when idx=46 then 12 else 1+(idx%10) end];
   insert into public.rendez_vous(institut_id,personne,cliente_id,soin_id,libelle,preparation,minutes,marge,centimes,debut,fin,origine,statut)
   values(i,case when idx<30 then equipe[1+(idx%3)] else equipe[1] end,c,soin.id,soin.nom,soin.preparation,soin.minutes,5,soin.centimes,d,d+make_interval(mins=>soin.minutes+5),
   case when idx%3=0 then 'web' else 'institut' end,'confirmé') returning id into r;
   insert into beauty_private.liens(rdv) values(r);
   if statut='réalisé' then
     perform public.encaisser(r,case when idx=0 then 'carte utilisée' else 'encaissement' end,soin.centimes,bon);
     perform public.statut_rdv(r,'réalisé');
   elsif statut='annulé' then
     perform public.encaisser(r,'encaissement',500,'');perform public.statut_rdv(r,'annulé');
   end if;
   update public.mouvements set created_at=d at time zone 'Indian/Reunion' where rdv=r;
 end loop;
 perform public.bloquer(i,'{}','Formation de l’équipe',jour+time '14:00',jour+time '15:00',false);
end $$;
set role authenticated;
