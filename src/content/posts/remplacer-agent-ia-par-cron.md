---
title: "Remplacer un agent IA par du cron : le décommissionnement d'OpenFang"
date: 2026-06-08
tags: ["ia", "aiops", "doctrine", "decommission", "dagu", "ntfy"]
summary: "En avril, j'écrivais un article qui vantait Guardian, notre sentinelle AIOps. En juin, on l'a démontée — et remplacée par des DAGs, des notifications natives et zéro inférence. Post-mortem d'un agent qui marchait très bien et ne servait à rien."
---

> Format **doctrine** — la suite directe de
> [« Guardian : quand l'IA surveille le homelab »](/posts/openfang-guardian-aiops) (avril) et de
> [« Hermes : savoir décommissionner pour mieux avancer »](/posts/hermes-agent-remplacer-pour-avancer).
> Les portfolios montrent ce qu'on construit. Le nôtre documente aussi ce qu'on débranche, et pourquoi.

## TL;DR

Le 4 juin, on a détruit le CT 192 — OpenFang, l'agent AIOps en Rust qui faisait tourner 7 crons
Guardian, surveillait 46 services et coûtait ~11 €/mois d'inférence. Il fonctionnait. Il n'était
pas en panne, pas instable, pas cher. Il était **inutile** : chacune de ses missions était soit
déterministe (donc mieux servie par du code simple), soit déjà couverte par un outil natif qui
fait ça à plein temps.

Ses successeurs : **Dagu** (orchestrateur de DAGs) pour le temporel, **ntfy** + les alertes
natives de Beszel/Wazuh/CrowdSec/Uptime-Kuma pour la détection, et **Hermes** — désormais seul
agent IA résident — pour ce qui demande réellement du jugement.

La doctrine qui en sort : **l'IA là où elle pense, du code simple là où ça se répète.**

## Ce qu'OpenFang faisait (et faisait bien)

L'architecture d'avril n'était pas absurde, et l'article de l'époque reste une photo honnête.
Un agent headless, connecté à VictoriaMetrics, Loki et Proxmox, avec des crons :

- health check des services toutes les 6 h
- audit sécurité quotidien (CrowdSec, Wazuh, TLS, Headscale)
- surveillance disque, vérification des certificats
- cycle de backup PBS nocturne — y compris réveiller pve3 par Wake-on-LAN, sauvegarder, l'éteindre
- sync hebdo des miroirs Forworld
- kv-push : les données live de la page status de ce site

Tout tournait. C'est précisément ce qui rend la décision intéressante : on n'a pas réparé un
système cassé, on a **reconnu qu'un système sain était au mauvais étage d'abstraction**.

## Le diagnostic en une question

Pour chaque cron, on a posé la même question : *est-ce que ce job a pris une seule décision,
un seul jour, qui nécessitait un modèle de langage ?*

| Mission | Décision LLM nécessaire ? | Successeur |
|---|---|---|
| Backup PBS + WOL pve3 | non — séquence fixe | DAG Dagu `backup-pbs` (1h30) |
| kv-push toutes les 5 min | non — curl + JSON | DAG Dagu `kv-push` (*/5) |
| Audit paquets `rc` | non — diff vs allow-list | DAG Dagu → playbook Ansible |
| Health check 6 h | non — du ping | Uptime-Kuma, 39 monitors |
| Certificats TLS | non — date < seuil | Uptime-Kuma (natif) |
| Disque, CPU, RAM | non — seuils | Beszel → ntfy |
| Alertes sécurité | non — relayage | Wazuh/CrowdSec → ntfy |

Sept missions, zéro jugement. L'agent exécutait des wrappers CLI écrits pour contourner son
propre sanitizer — on avait construit dix programmes déterministes, puis payé un LLM pour les
appeler dans le bon ordre. Un cron sait faire ça. Un DAG le fait avec des retries, un historique
et une UI.

La seule chose qu'OpenFang apportait vraiment, c'était le **récit** : un résumé en français sur
Telegram. C'est agréable. Ça ne vaut pas un conteneur, une surface d'attaque, un coût d'inférence
et — surtout — la **charge cognitive de maintenir un agent** : son runtime, ses prompts, ses
mises à jour, ses pannes à lui.

## Ce qui reste à l'IA (et pourquoi)

Hermes (CT 190) a survécu à la purge, et ce n'est pas du favoritisme. Ses deux chaînes de crons
passent le test de la question :

- **doc-sync** : comparer l'état réel de l'infra (Proxmox, Forgejo) avec la documentation
  (Wiki.js), détecter les dérives, *et rédiger les corrections*. Diff sémantique + rédaction =
  exactement le travail d'un modèle.
- **veille RSS** : scorer la pertinence de dizaines d'articles par jour et en synthétiser un
  digest. Jugement éditorial = encore du travail de modèle.

Le critère n'est pas « est-ce que l'IA *peut* le faire » — elle peut presque tout faire, c'est
le piège. Le critère est : **est-ce que la tâche change de nature sans elle ?** Un backup sans
LLM est le même backup. Une veille sans LLM est une liste de liens.

## Le détail qui valide la décision

Petite confirmation involontaire : pendant des semaines, personne n'a remarqué qu'OpenFang
manquait. Les backups ont tourné (Dagu), les alertes sont arrivées (ntfy), la page status s'est
mise à jour (Dagu encore). Le seul artefact de sa disparition a été… un pipeline de statistiques
oublié dans la migration — et c'est [un marqueur qui mentait](/posts/marqueurs-qui-mentent) qui
l'a masqué, pas l'absence de l'agent.

Quand on peut retirer un composant et que le système ne s'en aperçoit pas, le composant était
de la décoration.

## Les leçons

1. **« Ça marche » n'est pas un argument de conservation.** La bonne question est : qu'est-ce qui
   se dégrade si on le retire ? Si la réponse est « le récit Telegram », le composant est un
   template de notification, pas un agent.
2. **Un agent IA se paie trois fois** : en ressources, en surface d'attaque, en maintenance de
   l'agent lui-même. Le jugement qu'il apporte doit valoir les trois.
3. **Décommissionner est une compétence d'architecture**, pas un aveu d'échec. L'article d'avril
   n'était pas une erreur : c'était l'étape qui nous a appris où l'IA est réellement utile.
   Sans avoir construit Guardian, on défendrait encore l'idée qu'il en faut un.
4. **Un agent, des outils.** La cible finale du homelab : Hermes pour le jugement, Dagu pour le
   temps, ntfy pour les nouvelles, Ansible pour les gestes. Chacun à son étage.

Le CT 192 est détruit, son backup PBS archivé, ses empreintes purgées des 49 hôtes qui le
connaissaient. Sur la page [projets](https://pixelium.win/projets) du site, sa section porte
désormais un badge « décommissionné » — le récit reste, tel qu'on l'a vécu. C'est notre façon
de faire : on ne réécrit pas l'histoire, on la date.
