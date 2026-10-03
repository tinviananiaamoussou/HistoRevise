# HistoRévise — V1 (Phase 1 : Coffre-fort)

Application de révision d'histologie et d'embryologie pour étudiants en médecine.

## Ce qui est fonctionnel dans cette version

- **Coffre-fort** : ajout (PDF, image, .txt), liste filtrable par chapitre, aperçu,
  suppression. Les fichiers sont stockés sur Supabase (base de données + stockage),
  gratuit sur le palier utilisé.
- Navigation à 5 onglets en place ; **Chat IA**, **Atlas 2D**, **QCM** et **Suivi**
  affichent un écran "Bientôt disponible" — ce sont les prochaines phases.

## ⚠️ Sécurité — à corriger avant une diffusion large

Le Coffre-fort est actuellement **ouvert en lecture ET en écriture à toute
personne ayant le lien de l'app** (ajout et suppression de documents compris) :
il n'y a pas encore de compte professeur/étudiant. C'est volontaire pour aller
vite sur cette V1, mais à restreindre (accès admin pour l'ajout/suppression,
lecture seule pour les étudiants) avant de diffuser le lien largement —
probablement en même temps que la mise en place des comptes étudiants
nécessaires pour la Phase 4 (Suivi : scores et progression par étudiant).

## Comment l'héberger (gratuit)

Identique à FleetCheck :

1. Déposer le contenu de ce dossier sur **Netlify Drop** (depuis un ordinateur)
   ou via **GitHub Pages** (possible entièrement depuis un téléphone — upload
   des fichiers dans un nouveau repo GitHub, puis Settings → Pages → Deploy
   from a branch).
2. Ouvrir le lien obtenu sur le téléphone, dans Chrome → menu ⋮ → **Installer
   l'application**.

Aucune compilation nécessaire (pas de `npm install`) : ce sont des fichiers
HTML/CSS/JS statiques, avec `@supabase/supabase-js` et `pdf.js` chargés depuis
un CDN.

## ⚠️ Limite de test importante

Je n'ai pas pu tester cette version contre le **vrai** Supabase : mon
environnement de développement n'a pas d'accès réseau sortant vers Internet
(ni vers Supabase, ni vers les CDN utilisés). J'ai donc testé toute la logique
de l'application (navigation, formulaire d'ajout, filtre, aperçu, suppression)
contre une fausse base de données en mémoire, qui a validé le comportement de
l'interface — mais **le branchement réel à Supabase (upload de fichier,
écriture en base, URL publique) n'a encore jamais été testé en conditions
réelles**. Une fois déployé, merci de tester en premier : ajouter un document
de chaque type (PDF, image, .txt), vérifier qu'il apparaît bien, l'ouvrir,
puis le supprimer — et de me dire si quelque chose ne fonctionne pas comme
prévu.

## Backend Supabase

- Projet : `histo-revise` (région eu-west-3 / Paris)
- Table `documents` : id, title, chapter, file_type, file_path, extracted_text, created_at
- Bucket de stockage `documents` (public)

## Prochaines étapes (phases suivantes, à construire une par une)

- Phase 2 — Chat IA ancré sur le coffre-fort (nécessite une edge function
  Supabase + une clé API Anthropic à configurer dans les secrets du projet —
  cette clé t'appartient, je ne peux pas la créer à ta place)
- Phase 3 — Génération de QCM (même edge function, format JSON strict)
- Phase 4 — Suivi et révision (scores, flashcards, révision espacée) — nécessite
  probablement des comptes étudiants
- Phase 5 — Atlas 2D (silhouette SVG, coupes annotées)
