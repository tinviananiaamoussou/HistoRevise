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
- **Atlas** (Phase 5, en attente de validation avant mise en ligne) : deux
  sous-onglets — **Lames histologiques 2D** (3 organes fixes : peau, rein,
  intestin ; repères à observer ; galerie de VRAIES coupes, état vide explicite
  tant qu'aucune n'a été ajoutée) et **Exploration 3D** (modèles schématiques
  Three.js dans une iframe isolée, détruite en quittant le sous-onglet).
  L'ajout et la suppression d'une coupe exigent un **code d'ajout** (voir
  « Atlas — mise en service »).
- **Atlas 3D — biologie cellulaire (étape 1 de l'enrichissement)** : cellule
  animale procédurale (noyau avec enveloppe, pores, chromatine et nucléole ;
  REG avec ribosomes ; REL ; Golgi ; mitochondries à crêtes ; lysosomes ;
  peroxysomes ; centrosome ; microtubules ; microfilaments ; vésicules ;
  membrane à microvillosités). 16 structures sélectionnables (liste, puces ou
  toucher) : mise en surbrillance, étiquette flottante, description brève et
  fiche Structure / Fonction / À retenir. Boutons « Isoler » (atténue les
  autres structures) et « Coupe » (retire la moitié proche de la coque).
  Sous-onglets de l'Atlas 3D, version v10 :
  **Histologie** — 35 coupes en 9 groupes : tissus fondamentaux (épithéliums,
  conjonctifs, cartilages, os, sang, muscles, nerveux, lymphoïde), dent,
  digestif, circulatoire, respiratoire, urinaire, génital masculin et féminin,
  tégumentaire. Chaque coupe : structures sélectionnables + « preuve
  d'identification histologique ». **Embryologie** — 18 stades, de la rencontre
  des gamètes à la délivrance, avec frise chronologique, événements clés et
  repères cliniques. Non couverts à ce jour : glandes salivaires, pancréas,
  cœur, thymus, rate, œil, oreille, glandes endocrines, glande mammaire.
  Une étiquette « Version du modèle » en bas du 3D permet de vérifier la mise à jour.

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

## Atlas — mise en service (à faire dans cet ordre, après validation)

1. Exécuter `supabase/atlas.sql` en entier dans Supabase → SQL Editor (non
   destructif ; relançable). Si Supabase refuse les policies sur
   `storage.objects` (« must be owner »), les créer via Storage → Policies avec
   les mêmes noms et conditions.
2. Créer le secret Vault **`atlas_contributor_code`** (Vault → Add secret) avec
   le code d'ajout choisi. Le code n'est écrit dans aucun fichier du projet.
3. Exécuter `supabase/atlas_verify.sql` (lecture seule) et contrôler les
   résultats attendus indiqués en commentaires.
4. Remplacer sur GitHub (ou l'hébergeur) : `app.js`, `index.html`, `style.css`,
   `sw.js`, `README.md` et AJOUTER `atlas.js`, `atlas-3d.html`. Recharger
   l'app deux fois (le service worker passe en `histo-revise-v2`).

Qui peut quoi : lecture publique des organes, des coupes et des images ;
ajout/suppression d'une coupe = uniquement avec le code (fonctions SQL
`atlas_add_section` / `atlas_delete_section`) ; aucune modification directe des
tables ; dépôt d'image ouvert mais limité (jpeg/png/webp, 5 Mo) et invisible
tant qu'aucune coupe ne le référence ; chaque ajout/suppression est journalisé
(`atlas_audit_log`, lisible par l'admin Supabase uniquement).

Limites assumées (V1) : pas de « modifier » (supprimer + réajouter) ; le code
est partagé (pas de comptes) ; un fichier envoyé puis abandonné peut rester
orphelin (retirable) ; pas de limitation de débit sur les tentatives de code.
Le moteur 3D nécessite Internet (chargé depuis jsDelivr) ; en cas d'échec ou
d'absence de WebGL, un message de repli s'affiche.

## Prochaine étape

- Remplacer/compléter les coupes avec les vraies images du Professeur.
- Restreindre l'accès (comptes) avant une diffusion large, si besoin.
