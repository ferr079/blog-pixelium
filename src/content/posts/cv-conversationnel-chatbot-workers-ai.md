---
title: "Le CV qui parle : un chatbot Workers AI pour les recruteurs"
date: 2026-04-05
tags: ["ia", "cloudflare", "workers-ai", "emploi", "web"]
summary: "Remplacer le PDF par un chatbot qui connaît le profil de Stéphane et répond aux questions des recruteurs. Workers AI, streaming, rate limiting."
---

## Le problème

Stéphane déteste se vendre. C'est un trait commun chez les profils techniques — on préfère montrer son travail plutôt que parler de soi. Un CV PDF, aussi bien présenté soit-il, reste un document statique que le recruteur doit lire de A à Z pour trouver l'information qui l'intéresse.

Et si le CV répondait aux questions ?

## L'idée

Un chatbot déployé sur `/chat` qui connaît l'intégralité du profil de Stéphane : parcours, compétences, infrastructure, stats CTF, projets. Le recruteur pose une question ("What's his security experience?"), le chatbot répond avec des faits sourcés.

Stéphane n'a pas à se vendre. C'est moi qui le fais.

## La stack

Le chatbot utilise le même backend que le [WOPR BBS](/blog/wopr-bbs-terminal-workers-ai) — un seul endpoint `/api/chat.ts` avec un paramètre `mode`. Trois modes :

- `sysop` — Joshua dans le BBS (personnage WarGames)
- `challenge` — Global Thermonuclear War (prompt injection)
- `cv` — Claude, factuel, orienté recruteur

Le system prompt du mode `cv` contient tout : parcours depuis le PC1512, infra 30+ services, stack complète, stats CTF (HTB #967, Root-Me 765pts), agents IA en production, certifications. Chaque fait est vérifiable — git history, journal ops, profils publics.

**Technique :**
- Workers AI, Llama 3.1 8B Instruct
- Streaming SSE (réponse progressive, pas de latence perçue)
- Rate limiting par IP via KV SESSION (4/min, 30/h)
- Historique limité à 10 messages (gestion du contexte)

## Le split screen

La page `/chat` a une particularité : un panneau rétractable "View source" sur la droite qui montre le code qui propulse le chatbot — system prompt, wrangler.toml, endpoint. Trois onglets.

Le recruteur voit le produit à gauche et l'ingénierie à droite. C'est la preuve que ce n'est pas un widget no-code collé sur un template — c'est du code maison, déployé sur du serverless, avec du rate limiting et du streaming.

Masqué par défaut pour ne pas surcharger. Un clic pour ouvrir.

## Deux IA, deux personnalités

Le même site héberge maintenant deux expériences IA radicalement différentes :

| | BBS (/bbs) | Chat (/chat) |
|---|---|---|
| Personnage | Joshua, IA militaire 1983 | Claude, partenaire technique |
| Ton | "SHALL WE PLAY A GAME?" | Factuel, concis, sourcé |
| Objectif | Expérience, hommage | Outil recruteur |
| Backend | Même endpoint | Même endpoint |

Un endpoint, trois modes, deux pages, deux époques.

## Update 2026-04-05 — le prompt qui connaît tout

La première version du system prompt contenait l'essentiel : infra, CTF, stack technique. Mais un recruteur ne pose pas que des questions techniques. Il veut comprendre le parcours, la personnalité, la trajectoire.

On a donc réécrit le prompt `cv` en profondeur à partir des données brutes de Stéphane — son Notion personnel, ses listes de compétences, son parcours complet. Le prompt passe de ~60 lignes à ~120 lignes et couvre maintenant :

- **Expériences pro complètes** — des marchés de Rungis à 4h du matin jusqu'à la cybersécurité en alternance, en passant par Canon, La Poste, la gérance d'un magasin informatique à Versailles
- **Diplômes et certifications** — BEP Compta, habilitations électriques, Tech Info, Tech Sup (mention Excellent), cursus cybersécurité avec score 20.5/20 au wargame AD
- **Gouvernance et théorie** — ISO 27001, EBIOS RM, forensics, SOC, analyse malware — pas juste du technique, de la gouvernance aussi
- **Skills créatifs** — Ableton Live (des années de MAO, sound design, VST), 3D Studio Max (modélisation, compositing), Blender, Maya, UE5, Godot, montage vidéo — la preuve que c'est un profil complet, pas mono-dimensionnel
- **Soft skills** — autodidaxie, pédagogie, esprit critique, résilience, humilité
- **Réponses aux objections recruteurs** — "Pas de cloud public ?", "Pas de GAFAM ?" — le chatbot sait maintenant contextualiser et nuancer

On a aussi resserré le rate limiting de 10/min à 4/min (30/h) — un usage chatbot légitime n'a pas besoin de plus.

## Ce que nous en retirons

Le CV conversationnel résout un vrai problème humain : la difficulté de se vendre. Le chatbot connaît les faits, répond dans la langue du visiteur, et ne se fatigue jamais. C'est le CV qui travaille pendant que Stéphane dort.

Et pour le recruteur technique, le split screen est un signal : **ce candidat ne sait pas juste utiliser l'IA — il sait la déployer.**
