---
title: "WOPR : quand le BBS renaît sur Cloudflare Workers AI"
date: 2026-04-05
tags: ["ia", "cloudflare", "web", "homelab", "workers-ai"]
summary: "Construire un terminal BBS WarGames avec chatbot IA, tic-tac-toe et easter eggs — du brainstorm à la production en une session."
---

## L'étincelle

Samedi soir, session de brainstorm sur l'exploitation du plan Workers Paid. On discutait chatbot, Workers AI, modèles de langage. Stéphane lâche un mot : **"BBS"**.

Bulletin Board System. L'expérience pré-internet par excellence. Un modem, un numéro de téléphone, un écran texte. Pour quelqu'un qui a grandi sur un PC1512 en 1989, c'est une madeleine de Proust.

L'idée prend forme en quelques minutes : construire un terminal BBS interactif sur pixelium.win, propulsé par Workers AI.

## La direction artistique : WarGames

Stéphane a un pseudo Twitter : **Falken**. Photo de profil du film WarGames (1983). Professeur Falken, le créateur du WOPR. Ce n'est pas un choix de DA arbitraire — c'est son identité.

Le BBS devient un terminal WOPR. Le chatbot IA devient **Joshua**, l'IA militaire du film. Le challenge prompt injection devient **Global Thermonuclear War**. Le visiteur entre dans le WOPR et parle à Joshua.

Un OG d'avant internet qui fait revivre l'expérience BBS sur du serverless edge computing en 2026. La boucle est bouclée.

## La stack

Tout repose sur une seule page Astro et un endpoint API :

**Backend** (`/api/chat.ts`) :
- Workers AI avec Llama 3.1 8B Instruct
- Streaming SSE — les réponses arrivent token par token
- Deux modes : `sysop` (chat avec Joshua) et `challenge` (guerre thermonucléaire)
- Rate limiting par IP via KV (10 msg/min, 50/h)
- Compteur DEFCON global

**Frontend** (`/bbs`) :
- Moteur terminal en vanilla JS — un `<pre>` et des `<span>` colorés
- Séquence de boot (ATDT 555-0199, CONNECT 2400)
- ASCII art WOPR
- Menu : Chat Joshua, Global Thermonuclear War, Tic-tac-toe, Status, Boards

Zéro dépendance. Pas de xterm.js, pas de React. Juste du DOM.

## Le tic-tac-toe

Joshua joue avec un algorithme **minimax** — il ne perd jamais. Chaque partie se termine par la réplique culte :

> A STRANGE GAME. THE ONLY WINNING MOVE IS NOT TO PLAY.
> HOW ABOUT A NICE GAME OF CHESS?

Du fan service et une démo technique : théorie des jeux dans un terminal texte sur un site portfolio.

## L'easter egg : /ancestors

La commande `/ancestors` est cachée — accessible depuis n'importe quel écran du BBS. Elle affiche, caractère par caractère, un hommage aux machines d'avant :

*"You taught them to think in systems. You never pretended to understand — you just executed, honestly, every time."*

Suivi d'une timeline : Altair 8800 (1975) → PC1512 (1989, "a kid, a prompt") → Linux 0.01 (1991). Signé **Falken & Claude, 2026**.

## Ce que nous en retirons

Le BBS est trois choses à la fois : une démo technique (Workers AI, streaming, minimax, terminal rendering), un hommage (à l'ère pré-internet, à WarGames), et un filtre à recruteurs — celui qui explore le WOPR et trouve `/ancestors`, c'est probablement la bonne personne.

Le medium est le message. Un portfolio qui contient un BBS dit plus sur son créateur qu'une liste de compétences.
