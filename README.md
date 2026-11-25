# Planning beauté

Application SaaS pour les instituts de beauté, en français, en euros et à l’heure de La Réunion. Julie choisit Solo ou Premium à 0 € et crée elle-même Em'ti coccon. Chaque institut démarre avec un catalogue, une clientèle et un agenda vides.

## Lancer le projet

Avec Node.js 22.12 ou ultérieur, depuis la racine du dépôt :

```sh
npm ci
npm run dev
```

Le serveur écoute sur le port 8000. La commande `npm run build` vérifie TypeScript et produit le répertoire statique `dist/` à publier sur un hébergement HTTPS. La commande `npm run preview` permet de vérifier la version de production localement.

## Activer la base Supabase

Le client utilise l’URL du projet `eeuvauqtqhtxnrzvggzt` et la clé publique fournie. Pour un autre projet, copier `.env.example` vers `.env.local`, renseigner les deux valeurs et reconstruire le site. Les clés administratives restent exclusivement côté serveur.

1. Dans **SQL Editor**, exécuter une fois [la migration complète](supabase/migrations/202611250001_instituts.sql). Elle crée en une transaction les tables, les fonctions, les droits et les contraintes de réservation. Elle nécessite PostgreSQL 15 ou ultérieur avec l’extension btree_gist. Elle ne crée aucune donnée métier.
2. Dans **Authentication**, activer la connexion par e-mail et mot de passe, renseigner l’URL publique du site et autoriser les redirections de confirmation et de récupération de compte. Pour les invitations, autoriser les liens du site contenant le paramètre `invitation`. Configurer un SMTP pour envoyer les messages d’authentification aux utilisatrices de l’institut.
3. Dans l’application, choisir **Inscription**, confirmer l’adresse si demandé, puis créer l’institut. Dans **Prestations**, ajouter le premier soin. Dans **Paramètres**, définir les horaires et ouvrir la réservation en ligne lorsque l’agenda est à jour.

Il est aussi possible d’appliquer la migration depuis une CLI Supabase authentifiée avec `supabase link --project-ref eeuvauqtqhtxnrzvggzt`, puis `supabase db push`, en alternative au SQL Editor.

## Parcours métier

- **Agenda et réservation** — vues jour et semaine, rendez-vous au comptoir ou en ligne, lien privé pour consulter, déplacer ou annuler. Les horaires, habilitations, blocages et marges sont contrôlés en base. Une contrainte PostgreSQL exclut les réservations simultanées sur une même professionnelle.
- **Prestations et formules** — durée et prix calculés à partir des composants, modifiables par la gérante. Chaque rendez-vous garde son tarif et sa durée. Une seule marge, initialement de 5 minutes, est ajoutée à la fin.
- **Équipe et instituts** — gérante, responsable et employée avec droits par institut. Invitations Premium liées à une adresse e-mail, portraits des professionnelles, horaires individuels et révocation des accès. La responsable gère tous les plannings de son établissement.
- **Gestion quotidienne** — préparation de la journée, matériel, fiches clientes, historique, liste d’attente Premium, tableau de bord par offre, export JSON, couleur de l’institut et installation sur l’écran d’accueil.
- **Finances au comptoir** — encaissements manuels, paiement partiel, crédit cliente et cartes cadeaux. Julie recopie le numéro et la valeur offerte sur le bon physique. Une annulation restitue la part payée par bon sur celui-ci, et les autres sommes sur la fiche cliente. Les sommes d’un rendez-vous déclaré absent sont conservées.
- **Données du prototype précédent** — sa clé locale `planning-beauty.appointments` reste intacte dans le navigateur. Le SaaS commence vide.

## E-mails et flux iCal

La base programme confirmations, changements, annulations et rappels 24 heures avant le soin. Le suivi est accessible dans le détail du rendez-vous. Pour envoyer les e-mails ou servir les abonnements calendrier, déployer les fonctions depuis un compte Supabase autorisé :

```sh
supabase functions deploy calendrier --project-ref eeuvauqtqhtxnrzvggzt --no-verify-jwt
supabase functions deploy rappels --project-ref eeuvauqtqhtxnrzvggzt --no-verify-jwt
```

Le flux iCal utilise un jeton privé, révocable dans **Équipe → Mon calendrier externe**. Il expose les périodes occupées, sans coordonnées des clientes. L’utilisateur colle le lien dans la fonction d’abonnement de Google Agenda ou de Calendrier sur iPhone.

Pour Brevo, définir les secrets des Edge Functions `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (expéditeur vérifié), `APP_URL` (adresse publique du site) et `RAPPELS_SECRET` (secret aléatoire). Planifier dans Supabase Cron un POST chaque minute vers l’URL de la fonction `rappels`, avec l’en-tête `Authorization: Bearer <RAPPELS_SECRET>` conservé de façon sécurisée. La fonction contrôle ce secret avant tout envoi. Vérifier la réception sur une adresse de l’institut avant ouverture au public.

## Vérifications

```sh
npm run build
npm --prefix tests ci
npm --prefix tests test
```

Les tests démarrent une base PostgreSQL temporaire avec des identités Supabase simulées. Ils exercent les droits par rôle et établissement, les invitations, la concurrence des réservations, les exceptions, les crédits, les bons cadeaux et les rappels. Le projet Supabase distant ne reçoit aucune donnée de test.

Les paiements en ligne, les SMS, la boutique de cartes cadeaux en ligne et le programme de fidélité sont des extensions ultérieures. La version actuelle couvre les encaissements au comptoir et les deux abonnements à 0 €.
