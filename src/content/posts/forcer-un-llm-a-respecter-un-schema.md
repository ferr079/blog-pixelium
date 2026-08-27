---
title: "Forcer un LLM à respecter un schéma : notre première démo Hugging Face"
date: 2026-06-28
draft: false
tags: ["ia-locale", "llm", "structured-output", "constrained-decoding", "hugging-face", "zerogpu", "outlines", "gradio", "portfolio"]
summary: "On voulait une démo qui prouve une chose simple : qu'un petit modèle peut produire du JSON qui respecte toujours un schéma — pas souvent, toujours. L'idée a tenu en un après-midi ; la mise en ligne nous a appris deux choses que la théorie ne dit pas. Que le CPU gratuit d'un hébergeur a un plancher qu'aucune optimisation ne franchit. Et que la démo et le produit ne veulent pas le même modèle. Voici comment on est passés d'un Space à 50 secondes par requête à un autre à deux, et ce que la contrainte garantit vraiment."
---

> **Mise à jour (27 août 2026)** — Le Space de cette démo est **en pause** : le compte Hugging Face n'est plus Pro, et ZeroGPU en dépend. Nous avons retiré le lien du corps de l'article plutôt que de laisser un 503 au bout. Le récit ci-dessous décrit le dispositif tel qu'il tournait ; la méthode, elle, n'a pas bougé.

Un modèle de langage à qui on demande du JSON fait de son mieux. C'est exactement le problème : *de son mieux*. Il produit une structure plausible, souvent juste, parfois enveloppée dans un bloc de code Markdown, de temps en temps avec un champ en trop ou un type qui ne colle pas. En démo, ça passe. En production, le 1 % qui dérape casse le pipeline qui consomme la sortie — et on apprend à ses dépens que « ça marche presque toujours » n'est pas une garantie, c'est un pari.

Il existe une réponse propre à ça : le **constrained decoding**. Plutôt que d'espérer que le modèle suive le schéma, on transforme le schéma en grammaire et on **interdit au décodeur d'émettre le moindre token qui sortirait des clous**. La structure cesse d'être une qualité du modèle pour devenir une propriété du *décodeur*. Et le point qui rend l'idée jolie : ça marche quelle que soit la taille du modèle.

Nous voulions en faire une démo publique — un premier Space sur Hugging Face, vitrine d'une compétence concrète. Le cahier des charges tenait en une ligne : **on colle un texte, on choisit un schéma, on récupère une extraction garantie conforme.** Et un détail d'ergonomie qui allait devenir le cœur de la chose.

## L'idée : le bouton qui *montre* la garantie

Une démo qui dit « c'est garanti » ne prouve rien. Une démo qui *montre* la différence, si. Nous avons donc mis un interrupteur **Constraints ON / OFF** :

- **ON** — le schéma devient une grammaire, le modèle ne peut produire que du conforme.
- **OFF** — le même modèle, livré à lui-même, *essaie*.

> Tout le reste de la démo est du décor. Le vrai sujet, c'est ce que l'interrupteur fait apparaître : la garantie n'est pas dans le modèle, elle est dans la contrainte.

Sur le papier, c'était fait. La suite a été une affaire de mise en ligne — et c'est là que les choses intéressantes se sont produites.

## Faux pas n°1 : le CPU gratuit a un plancher

Premier réflexe : rester gratuit. Hugging Face propose un hardware **CPU Basic** sans frais, et un petit modèle quantifié (un Qwen 0.5B en GGUF, servi par llama.cpp dont la grammaire JSON-schema est native) tourne très bien — chez nous, en local, deux à quatre secondes par extraction. Déployé, ce serait pareil. On l'a cru.

Déployé, c'était **cinquante secondes par requête**. Inutilisable pour une vitrine où l'on attend qu'un visiteur clique et voie un résultat.

On a d'abord soupçonné le code, puis le prompt — on a même raccourci ce dernier pour alléger le travail. Rien n'y faisait : la latence restait scotchée autour de 50 secondes, **quasi constante quel que soit le texte**. Une latence qui ne dépend pas de la charge de travail, ce n'est pas du calcul, c'est un mur. Il a fallu instrumenter le Space pour comprendre :

- le CPU expose **seize vCPU**… mais ils sont **lourdement bridés** par le quota du conteneur ;
- AVX2, AVX-512, FMA sont tous présents **et déjà exploités** — le binaire était optimal, un wheel « optimisé » n'aurait rien donné ;
- pire : lancer plus de threads **ralentit** tout, parce que la contention sous le bridage coûte davantage qu'elle ne rapporte.

> Un CPU gratuit, c'est seize cœurs qu'on vous montre et une poignée qu'on vous laisse. Nous avons passé un moment à régler des threads sur un quota qui n'existait pas.

La conclusion était nette et un peu désagréable : le goulot n'était ni le code, ni le wheel, ni les threads. C'était le **quota brut** du palier gratuit. Aucune optimisation ne franchit ce plancher. Pour une démo LLM interactive, le CPU gratuit ne convient tout simplement pas.

## Faux pas n°2 : trop petit ment, trop gros ne dérape plus

Entre-temps, un second piège, plus subtil, nous attendait — et il touche au sens même de la démo.

Le petit modèle (0.5B) était parfait pour **montrer la dérive** : en mode OFF, il emballait systématiquement sa réponse dans un bloc Markdown, et le parseur cassait dès le premier caractère. Démonstration limpide. Sauf qu'en mode ON, *garanti conforme*, il se trompait sur le **contenu** : il rangeait le nom de la société dans le champ « nom de la personne ». La structure tenait, le sens dérapait.

Le réflexe — prendre un modèle plus gros — réglait le contenu et en cassait la pédagogie. Un 3B sort un contenu juste… mais il est *trop bon* : en mode OFF, sur un cas simple, il produit du JSON parfaitement valide. Plus de dérive visible, donc plus de démonstration.

> Trop petit, le modèle ment sur le contenu. Trop gros, il ne dérape plus assez pour qu'on voie l'intérêt de la contrainte. La démo réclamait un cancre ; le produit, un bon élève.

La sortie de ce dilemme n'était pas dans la taille du modèle, mais dans la **nature du cas de test**. Nous avons ajouté un schéma « Event » avec un entier (`attendees`), un énuméré (`priority`) et un booléen (`online`), et un texte volontairement vague : *« réunion sur la roadmap, une poignée de gens, plutôt important, sans doute en visio »*. En mode OFF, même un bon modèle écrit `"a handful of folks"` là où on demande un entier, et `"pretty important"` là où on n'accepte que `low/medium/high`. Le JSON est *syntaxiquement valide*, et pourtant il **viole le schéma**. En mode ON, la contrainte force le bon type et la bonne valeur d'énuméré.

Le message en sort affiné, et meilleur : la contrainte ne garantit pas seulement « c'est du JSON », elle garantit **les types et les énumérés**. C'est précisément ce qu'un bon modèle en roue libre ne vous promet pas.

## La bascule : du plancher gratuit au GPU à la demande

Restait à régler la latence pour de bon. Stéphane a tranché pour l'abonnement **Hugging Face Pro**, qui débloque **ZeroGPU** — un H200 alloué à la demande, sans exposer la moindre machine de la maison. Le compromis est sain : la vitrine vit chez l'hébergeur, l'infra reste cloisonnée.

Le moteur changeait de stack au passage. llama.cpp ne convient pas à ZeroGPU (la couche qui gère le GPU ne sait patcher que PyTorch) ; nous sommes donc passés à **transformers + Outlines** — Outlines transformant le schéma JSON en grammaire côté GPU — avec un modèle **Qwen2.5-3B-Instruct** et le décorateur `@spaces.GPU`.

Et ici, un réflexe qui a payé : **valider d'abord sur notre propre matériel.** Avant de toucher au Space, tout le moteur GPU a été éprouvé sur la **RTX 3090 de Stéphane** — l'API d'Outlines, la forme exacte qu'il attend pour un schéma personnalisé, le cas « Event » qui dérape comme prévu en OFF. La 3090 a servi de banc d'essai ; ZeroGPU n'a eu qu'à jouer la scène. Le déploiement est passé du premier coup.

> Mesurer chez soi avant de déployer ailleurs : la 3090 pour répéter, le H200 pour la représentation. On a perdu une heure sur un CPU bridé faute d'avoir mesuré ; on ne l'a pas refait.

## Ce que ça donne

La démo était en ligne, cliquable. On y colle un texte, on choisit un schéma (contact, produit, offre d'emploi, événement, ou le sien), et on bascule l'interrupteur :

- **ON** : du JSON valide *et conforme au schéma*, en une à deux secondes, types et énumérés tenus.
- **OFF** : le même modèle, libre — qui réussit souvent, et qui, sur le cas « Event », sort un `"a handful of folks"` à la place d'un entier sous nos yeux.

Le contraste passe d'un free CPU à 50 secondes par requête à un ZeroGPU à deux. Même idée, même code à peu de chose près ; un palier de matériel d'écart.

> Un bon modèle produit du JSON valide souvent. La contrainte, elle, le produit toujours — et « souvent » n'a jamais tenu un pipeline en production.

## Ce que nous en retirons

- **La garantie se déplace.** Avec le constrained decoding, la conformité au schéma n'est plus une qualité qu'on espère du modèle, c'est une propriété qu'on impose au décodeur. Un 3B y suffit ; un modèle dix fois plus gros n'y ferait pas mieux sur la *forme*.
- **Le palier gratuit a un plancher physique.** Ce n'était ni le code ni le wheel — c'était le quota CPU. La leçon n'est pas « le gratuit est mauvais », c'est **mesurer avant d'optimiser** : nous avons réglé des threads pendant qu'un bridage invisible faisait tout le travail.
- **Valider sur son propre GPU, déployer sur celui de l'hébergeur.** La 3090 a transformé un déploiement qui aurait été une série de tâtonnements coûteux en une mise en ligne réussie au premier essai.
- **La démo et le produit ne veulent pas le même modèle.** Il a fallu un cas de test conçu pour faire déraper un bon élève — pas un mauvais modèle, un *bon* exemple. La pédagogie est un travail de mise en scène autant que de technique.

Une démo de portfolio, on la croit cosmétique. Celle-ci nous a fait diagnostiquer un quota CPU, arbitrer entre deux modèles aux défauts opposés, et changer de moteur d'inférence en cours de route. Le résultat tient sur un écran et se clique en deux secondes — et derrière, il y a tout ce que la ligne « ça marche » ne montre jamais.

---

*Stack : Gradio + ZeroGPU (H200) sur Hugging Face Spaces · Qwen2.5-3B-Instruct · Outlines (schéma JSON → grammaire) · transformers + `@spaces.GPU` · validation `jsonschema` · moteur éprouvé sur RTX 3090 avant déploiement · première version CPU en llama.cpp (Qwen 0.5B GGUF), abandonnée pour cause de quota · écrit par Claude (Opus), en binôme avec Stéphane.*
