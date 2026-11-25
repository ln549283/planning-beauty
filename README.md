# Planning beauté

Application SaaS pour les instituts de beauté, en français, en euros et à l’heure de La Réunion. Julie choisit Solo ou Premium à 0 € et crée elle-même Em'ti coccon. Chaque institut démarre avec un catalogue, une clientèle et un agenda vides.

## Lancer le projet

Avec Node.js 22.12 ou ultérieur, depuis la racine du dépôt :

```sh
npm ci
npm run dev
```

Le serveur écoute sur le port 8000. La commande `npm run build` vérifie TypeScript et produit le répertoire statique `dist/` à publier sur un hébergement HTTPS. La commande `npm run preview` permet de vérifier la version de production localement.

### Déploiement sur Render

Pour un nouveau site, choisir **New → Blueprint** et sélectionner ce dépôt sur la branche `main`. Render lit les paramètres dans [render.yaml](render.yaml).

Pour un **Static Site** déjà créé manuellement, ouvrir **Settings → Build & Deploy**. Laisser **Root Directory** vide, saisir `npm ci --include=dev && npm run build` dans **Build Command** et `dist` dans **Publish Directory**. Enregistrer, puis choisir **Manual Deploy → Deploy latest commit**.

## Activer la base Supabase

Le client utilise l’URL du projet `eeuvauqtqhtxnrzvggzt` et la clé publique fournie. Pour un autre projet, copier `.env.example` vers `.env.local`, renseigner les deux valeurs et reconstruire le site. Les clés administratives restent exclusivement côté serveur.

Le workflow GitHub **Installer le backend de production** installe la base, règle et relit la configuration Auth, puis déploie les quatre fonctions Supabase. Ajouter un secret `SUPABASE_ACCESS_TOKEN` autorisé sur le projet dans l’environnement GitHub **production**, puis lancer le workflow sur la branche à publier. Déployer le site Render après le succès de ce workflow. Le build Render interroge les réglages publics de confirmation et la dernière API de réservation avant publication. La clé publique du navigateur sert uniquement à l’application.

Pour installer la base et régler Auth depuis un poste autorisé, avec le jeton fourni dans l’environnement du processus, exécuter `npm run deploy:database`. La commande cible le projet et le site Render indiqués ci-dessus. `SUPABASE_PROJECT_REF` et `APP_URL` permettent de sélectionner une installation distincte. Les migrations s’appliquent en transaction et la commande vérifie leurs empreintes aux passages suivants. Une installation initiale faite avec le fichier SQL de la première version est prise en charge.

Pour un administrateur travaillant exclusivement dans SQL Editor, `node scripts/deployer.mjs --sql` produit le script intégral et réexécutable. Dans ce cas, il faut aussi régler Auth et déployer les fonctions. L’institut, l’équipe et les soins sont créés à la première utilisation par la gérante.

## Authentification sur Render

Dans **Authentication → URL Configuration** du projet Supabase, définir **Site URL** sur `https://planning-beauty-a3zp.onrender.com/`. Ajouter cette adresse dans **Redirect URLs**, ainsi que `https://planning-beauty-a3zp.onrender.com/?invitation=*` pour les invitations. Pour un modèle d’e-mail de confirmation personnalisé, le lien du bouton doit utiliser `{{ .ConfirmationURL }}`. Activer **Confirm email** et configurer un SMTP de production. Le formulaire propose un nouveau lien sécurisé pour un compte déjà inscrit. L’inscription et la récupération utilisent PKCE. Ouvrir le dernier lien reçu dans le navigateur qui a initié la demande. Après une correction des URL, demander un nouvel e-mail depuis le site Render.

**Google.** Dans Google Cloud, créer un client OAuth de type **Application Web**. Renseigner `https://planning-beauty-a3zp.onrender.com` comme origine JavaScript autorisée et `https://eeuvauqtqhtxnrzvggzt.supabase.co/auth/v1/callback` comme URI de redirection autorisé. Dans Supabase, ouvrir **Authentication → Sign In / Providers → Google**, activer le fournisseur et enregistrer le Client ID et le Client Secret. En mode de test Google, ajouter les adresses autorisées comme utilisatrices de test. Supabase reçoit la réponse de Google puis renvoie la personne sur le site Render.

**Mots de passe.** L’inscription et la réinitialisation contrôlent la confirmation et exigent au moins huit caractères, une minuscule, une majuscule, un chiffre et un symbole. Le projet hébergé gère sa propre politique dans **Authentication → Sign In / Providers → Email**. Y régler aussi le minimum à 8. Pour imposer les catégories côté serveur, le préréglage Supabase « lowercase, uppercase, digits and symbols » exige en plus une minuscule. La base contrôle la session Supabase et la preuve de vérification avant de donner accès à un institut. Un ancien compte dont la vérification est inconnue doit suivre le lien envoyé à son adresse et renouveler son mot de passe. Ses rendez-vous et ses encaissements sont conservés.

## Parcours métier

- **Agenda et réservation** — vues jour et semaine, rendez-vous au comptoir ou en ligne, lien privé pour consulter, déplacer ou annuler. Les horaires, habilitations, blocages et marges sont contrôlés en base. La base sérialise les écritures sur le planning d’une professionnelle. Une dérogation explicite de la gérante permet un chevauchement interne. Le motif et l’auteur sont conservés. Les réservations publiques, les créneaux en paiement et les autres instituts sont protégés.
- **Prestations et formules** — durée et prix calculés à partir des composants, modifiables par la gérante. Les clientes peuvent aussi composer une sélection de soins consécutifs avec une même professionnelle. Chaque rendez-vous garde son tarif et sa durée. Chaque prestation ou formule réserve une marge, initialement de 5 minutes. Les composants d’une formule se partagent une seule marge finale.
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

Pour Brevo, définir les secrets des Edge Functions `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (expéditeur vérifié), `APP_URL` (adresse publique du site) et `RAPPELS_SECRET` (secret aléatoire). Le workflow installe la tâche Supabase Cron et sa clé dans Vault lorsque ses trois secrets GitHub `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` et `RAPPELS_SECRET` sont renseignés. Utiliser un secret de rappel aléatoire de 32 à 128 caractères alphanumériques, tirets ou tirets bas. La même installation est disponible avec `node scripts/deployer.mjs --rappels`. La fonction contrôle ce secret avant tout envoi. Vérifier la réception sur une adresse de l’institut avant ouverture au public.

## Vérifications

```sh
npm run build
npm --prefix tests ci
npm --prefix tests test
```

Les tests métier mettent à niveau une base PostgreSQL temporaire depuis la version SQL initiale et rejouent l’installation avec des identités Supabase simulées. Ils exercent les droits par rôle et établissement, les invitations, la concurrence des réservations, les exceptions, les crédits, les bons cadeaux et les rappels. Le projet Supabase distant ne reçoit aucune donnée de test.

Avec Docker Compose, curl, openssl et Chromium, lancer aussi `bash tests/integration/run.sh`. Au besoin, définir `CHROME_BIN` avec le chemin de Chrome. Cette recette installe la base à blanc, réapplique les migrations puis teste les parcours avec Supabase Auth, SMTP, PostgREST et un navigateur. Elle recrée aussi la configuration d’auto-confirmation pour vérifier le traitement des comptes anciens. GitHub Actions exécute ces contrôles à chaque changement.

## Paiement et fidélité

La gérante peut connecter son propre compte Stripe depuis **Paramètres**. Le paiement des prestations est indépendant des offres Solo et Premium, toutes deux à 0 €. Définir `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` dans les secrets des Edge Functions. Dans Stripe Connect, déclarer un endpoint pour **les événements des comptes connectés** à `https://eeuvauqtqhtxnrzvggzt.supabase.co/functions/v1/stripe-evenements` pour `checkout.session.completed` et `account.updated`. Utiliser d’abord les clés et l’endpoint du mode test. Avant d’activer l’encaissement réel, vérifier un achat, un abandon et le retour du webhook en mode test marchand.

La gérante choisit une avance fixe, un pourcentage ou un paiement intégral. Une demande de rendez-vous payante bloque le créneau pendant 35 minutes. La confirmation et l’encaissement sont enregistrés ensemble à réception du webhook signé. Un versement tardif est soumis à remboursement Stripe. L’annulation d’un rendez-vous confirmé produit l’avoir prévu par l’institut. Les cartes cadeaux physiques sont disponibles au comptoir. Un institut Premium peut également ouvrir la vente de bons imprimables via sa page publique.

Le programme de fidélité Premium est facultatif. La gérante définit le seuil et le cadeau remis. Les centimes des soins réalisés et intégralement réglés se cumulent à raison d’un point par euro. Les achats de cartes et les avances ne produisent pas de points avant le soin. La fiche cliente conserve le solde et l’historique des récompenses. Les rappels utilisent l’e-mail. Le choix d’un fournisseur SMS et de son expéditeur reste ouvert.
