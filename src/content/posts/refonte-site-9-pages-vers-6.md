---
title: "9 pages → 6 : anatomie d'une refonte éditoriale"
date: 2026-04-05
tags: ["web", "homelab", "astro"]
summary: "Consolider un site portfolio de 9 pages à 6 — pourquoi le merge mécanique a échoué, et ce que réécrire veut vraiment dire."
---

## Le constat

pixelium.win avait 9 pages de contenu + un blog + un BBS + un chatbot. La nav débordait. Le contenu se répétait : les skills apparaissaient dans la homepage ET dans about, la sécurité était étalée sur 3 pages, l'IA avait sa propre page alors que les agents étaient déjà dans les projets.

Un visiteur — surtout un recruteur pressé — ne va pas explorer 9 pages. Il en parcourt 2-3, maximum.

## La première tentative : le merge mécanique

Approche naïve : lire les deux pages sources, empiler les sections dans un seul fichier, combiner le CSS. 3 agents en parallèle, 3 fusions (about+symbiose, securite+cybersecurite, projets+ia), 20 minutes.

Résultat : **désastreux**.

Les pages fusionnées étaient deux fois trop longues, sans cohérence narrative. On voyait les coutures — c'était litéralement deux pages stackées l'une sur l'autre. Stéphane résume : *"c'est moche, lourd, indigeste"*.

Rollback immédiat. `git revert`, push, le site revient à son état d'avant.

## La leçon

**Consolider ≠ coller.** Pour fusionner deux pages, il ne suffit pas de concaténer les sections. Il faut se poser la question : *"Si j'écrivais cette page from scratch aujourd'hui, qu'est-ce que j'y mettrais ?"*

C'est un travail éditorial, pas un travail de code.

## La reprise, page par page

### About ← Symbiose

**Avant :** 7 sections lourdes (origin story, track record en 8 cartes, observations en 6 cartes, skills en 6 groupes, approche IA en 3 cartes, ce qui le distingue, contact).

**Diagnostic :**
- Track record : 8 cartes avec les mêmes chiffres que la homepage → **condenser en prose inline**
- Skills : doublon pur avec les stack cards de la homepage → **supprimer**
- Observations : redondant avec securite et infrastructure → **supprimer**
- Symbiose (1=1, MCP, RTK) : le contenu le plus unique → **intégrer comme section "The partnership"**

**Après :** 6 sections aérées. Origin story (inchangé — c'est l'ancre), track record condensé, le binôme (réécriture avec exemples concrets), ce qui le distingue, contact (+email), transparence. Net : -283 lignes.

### Securite ← Cybersecurite

**Avant :** Deux pages séparées — defense (7 sections) et offense (profils CTF, techniques, environnement).

**Diagnostic :** Pour un recruteur, "sécurité" c'est un sujet unique. La séparation defense/offense est notre logique interne, pas la sienne.

**Après :** Une page fluide. Les 7 couches défensives restent intactes, puis une transition "From defense to offense", puis le feedback loop (offense → hardening), les profils CTF avec stats live (HTB/THM/Root-Me), et les techniques pratiquées. Coupé : environnement (anecdotique), IA-powered security (PentAGI va dans projets).

### Projets ← IA

**Avant :** 11 projets + une page IA séparée (Ollama, APIs, agents, watchlist, vision fine-tuning).

**Diagnostic :** Les agents IA SONT des projets. La watchlist et la vision fine-tuning sont du "on aimerait faire" — pas du portfolio.

**Après :** Projets triés par impact (flagship → infra → supporting). BBS et Chat ajoutés comme nouveaux projets. Couche IA intégrée après les projets (Ollama, APIs, agents déployés). Watchlist et fine-tuning virés. APT Cache et Forworld retirés (bruit).

## Le résultat

| Avant | Après |
|---|---|
| 9 pages + 8 items nav | 6 pages + 6 items nav |
| Symbiosis, Projects, Security, Cyber, AI, Infra, Status, About | Projects, Security, Infra, Status, Chat, About |
| Contenu dupliqué | Chaque page = un angle unique |
| 3 redirections 301 | SEO préservé |

## Ce que nous en retirons

Un site portfolio est un **argumentaire**, pas une encyclopédie. Chaque page doit avoir un angle clair et un seul. Si deux pages parlent du même sujet sous deux angles, la bonne question n'est pas "comment les fusionner" mais "quel angle garde-t-on ?".

Et la prochaine fois, on discute le contenu AVANT de coder. Pas l'inverse.
