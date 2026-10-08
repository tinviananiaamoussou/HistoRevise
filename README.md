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
- **QCM** : l'étudiant choisit un chapitre et un nombre de questions (5 à 20).
  L'IA génère des QCM niveau concours (5 propositions, plusieurs vraies possibles,
  distracteurs réalistes, couverture complète du chapitre) via deux edge functions
  (`generate-qcm`, `grade-qcm`) ; les bonnes réponses restent côté serveur jusqu'à
  la validation. Correction détaillée par proposition : vrai/faux, justification,
  piège expliqué, rappel du concept. Bouton WhatsApp sur les questions ratées.
- **Suivi** : scores agrégés par chapitre, flashcards de révision espacée
  générées automatiquement à partir des propositions ratées en QCM (intervalle
  qui double à chaque "Je savais", repart à 1 jour sinon), liste des notions à
  travailler par chapitre, et bouton **"QCM sur mes points faibles"** qui relance
  un QCM ciblé sur ces notions précises.
- Navigation à 5 onglets en place ; **Atlas 2D** affiche encore un écran
  "Bientôt disponible" — dernière phase.

### Configurer le numéro WhatsApp de l'assistant du Professeur

Directement dans l'app : icône ⚙️ en haut à droite de l'écran Chat IA →
saisir le numéro (avec l'indicatif pays, ex : `22900000000`) → Enregistrer.
Modifiable à tout moment, par n'importe qui ayant accès à l'app (cohérent
avec l'accès ouvert déjà choisi pour le reste de l'app).

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
Coffre-fort a déjà été validé par toi en conditions réelles. Le **Chat IA** et le **QCM** ont été testés et validés en conditions réelles
(après correctifs : policy d'écriture manquante sur les réglages, l'IA qui
récapitulait au lieu de répondre à la dernière question, et surtout le
modèle `gemini-flash-latest` qui pointait vers une version probablement
saturée — remplacé par `gemini-2.5-flash`, plus stable). **Le Suivi n'a en
revanche jamais été testé en conditions réelles** — seule sa logique
d'interface a été testée contre de fausses données. Fais quelques QCM sur un
même chapitre (pour obtenir un score agrégé et des flashcards), ouvre l'onglet
Suivi, révise une flashcard, puis essaie "QCM sur mes points faibles" — et
dis-moi si quelque chose ne va pas.

## Backend Supabase

- Projet : `histo-revise` (région eu-west-3 / Paris)
- Table `documents` : id, title, chapter, file_type, file_path, extracted_text, created_at
- Table `chat_messages` : id, session_id, role, content, created_at
- Table `app_settings` : key, value (contient `whatsapp_number`)
- Bucket de stockage `documents` (public)
- Table `qcm_attempts` : id, session_id, chapter, total, questions (grille complète
  avec bonnes réponses, côté serveur uniquement), student_answers, score, created_at, completed_at
- Edge function `chat` : reçoit `{session_id, message}`, construit le contexte à
  partir des documents, appelle Gemini Flash, enregistre l'échange, renvoie la réponse
- Table `flashcards` : id, session_id, chapter, concept, question_statement,
  proposition_label/text, justification, interval_days, next_review_at — une par
  proposition ratée en QCM, pour la révision espacée
- Edge function `generate-qcm` : reçoit `{session_id, chapter, num_questions,
  focus_concepts?}`, génère le QCM via Gemini (sortie JSON strict, schéma imposé,
  modèle `gemini-2.5-flash`, 3 tentatives automatiques en cas de surcharge 503),
  stocke la grille complète, renvoie au client uniquement les énoncés (jamais les
  réponses). `focus_concepts` priorise les notions déjà ratées (bouton "QCM sur
  mes points faibles")
- Edge function `grade-qcm` : reçoit `{attempt_id, answers}`, corrige côté serveur,
  renvoie le détail complet (vrai/faux, justification, piège, rappel) + le score,
  et crée/réinitialise une flashcard pour chaque proposition ratée
- Clé API Gemini stockée dans Supabase Vault (secret `gemini_api_key`), lue par
  l'edge function via le rôle de service — jamais exposée côté client

## Prochaine étape

- Phase 5 — Atlas 2D (silhouette SVG cliquable, fiches organes, coupes
  annotées) — en commençant avec 3 organes d'exemple et des images
  provisoires, les vraies coupes du Professeur viendront remplacer les
  provisoires une fois reçues.
- Phase 4 — Suivi et révision (scores, flashcards, révision espacée) — nécessite
  probablement des comptes étudiants
- Phase 5 — Atlas 2D (silhouette SVG, coupes annotées)
