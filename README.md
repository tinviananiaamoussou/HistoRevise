# HistoRévise — V1 (Phase 1 : Coffre-fort)

Application de révision d'histologie et d'embryologie pour étudiants en médecine.

## Ce qui est fonctionnel dans cette version

- **Coffre-fort** : ajout (PDF, image, .txt), liste filtrable par chapitre, aperçu,
  suppression. Les fichiers sont stockés sur Supabase (base de données + stockage),
  gratuit sur le palier utilisé. ✅ Testé en conditions réelles.
- **Chat IA** : répond uniquement à partir des documents du coffre-fort (citation du
  document et du passage, refus d'inventer si l'info n'y est pas). Historique par
  appareil (identifiant local, pas de vrai compte). Bouton "Pas clair" → bouton
  WhatsApp vers l'assistant du Professeur (une fois le numéro configuré, voir
  ci-dessous). Fonctionne via une edge function Supabase (`chat`) qui appelle
  l'API Gemini (modèle Flash, gratuit) avec la clé stockée de façon chiffrée
  (Supabase Vault), jamais exposée dans le code de l'app.
- Navigation à 5 onglets en place ; **Atlas 2D**, **QCM** et **Suivi**
  affichent encore un écran "Bientôt disponible" — prochaines phases.

### Configurer le numéro WhatsApp de l'assistant du Professeur

Pas encore fait — le bouton WhatsApp affichera "non configuré" tant que ce
n'est pas renseigné. Donne-moi le numéro (avec l'indicatif pays, ex :
`22900000000`) et je le configure directement dans la base de données.

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

Mon environnement de développement n'a pas d'accès réseau sortant vers
Internet (ni vers Supabase, ni vers les CDN, ni vers l'API Gemini). Le
Coffre-fort a déjà été validé par toi en conditions réelles. **Le Chat IA n'a
en revanche encore jamais été testé en conditions réelles** — seule sa
logique d'interface a été testée contre une fausse réponse. Merci de tester
en premier : pose une question dont la réponse est dans un de tes documents
(vérifie la citation), puis une question hors-sujet (elle doit répondre
qu'elle ne trouve pas l'information, jamais inventer) — et dis-moi si
quelque chose ne va pas.

## Backend Supabase

- Projet : `histo-revise` (région eu-west-3 / Paris)
- Table `documents` : id, title, chapter, file_type, file_path, extracted_text, created_at
- Table `chat_messages` : id, session_id, role, content, created_at
- Table `app_settings` : key, value (contient `whatsapp_number`)
- Bucket de stockage `documents` (public)
- Edge function `chat` : reçoit `{session_id, message}`, construit le contexte à
  partir des documents, appelle Gemini Flash, enregistre l'échange, renvoie la réponse
- Clé API Gemini stockée dans Supabase Vault (secret `gemini_api_key`), lue par
  l'edge function via le rôle de service — jamais exposée côté client

## Prochaines étapes (phases suivantes, à construire une par une)

- Phase 3 — Génération de QCM (même principe d'edge function, format JSON strict)
- Phase 4 — Suivi et révision (scores, flashcards, révision espacée) — nécessite
  probablement des comptes étudiants
- Phase 5 — Atlas 2D (silhouette SVG, coupes annotées)
