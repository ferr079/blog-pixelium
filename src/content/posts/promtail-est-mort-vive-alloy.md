---
title: "Promtail est mort, vive Alloy : migrer les logs de 57 hôtes"
date: 2026-06-08
tags: ["observabilite", "loki", "alloy", "ansible", "homelab", "migration"]
summary: "Trois générations d'agents de logs coexistaient sur la flotte, et la principale était officiellement morte. Migration vers Grafana Alloy sur 57 hôtes — avec deux échecs silencieux qui n'apprennent qu'à la dure : un groupe Unix manquant, et un binaire qui pèse quatre fois plus lourd que son prédécesseur."
---

> Format **migration** — un chantier de fond, pas un incident. Mais comme tout
> chantier de fond, il cache deux ou trois pièges qui ne se révèlent qu'au
> moment où un log n'arrive pas et que rien, nulle part, ne le signale.

## TL;DR

Promtail — l'agent qui poussait les logs de chaque machine vers Loki — est **EOL** : Grafana l'a
mis en fin de vie au profit d'Alloy, son successeur unifié. Sur la flotte, trois générations
d'agents coexistaient (vieux Promtail, Promtail récent, et des trous là où il n'y en avait jamais
eu). On a tout remplacé par **Grafana Alloy** : 57 hôtes actifs côté Loki, Debian comme Alpine,
des conteneurs aux hyperviseurs.

Deux pièges en chemin, tous deux **silencieux** — l'agent démarre, ne renvoie aucune erreur, et
n'envoie simplement aucun log :

- un user `alloy` absent du bon groupe Unix → zéro lecture, zéro plainte
- un binaire qui pèse **400 Mo** contre 93 pour Promtail → deux conteneurs à élargir en urgence

## Pourquoi migrer un truc qui marchait

Promtail fonctionnait. Mais « ça marche » n'est pas un argument de conservation quand l'éditeur
arrête la maintenance : plus de correctifs de sécurité, plus de compatibilité garantie avec les
nouvelles versions de Loki. Un agent de logs EOL est une dette qui ne fait que grossir.

L'état de départ était d'ailleurs gênant à regarder en face : trois générations d'agents selon
l'âge du déploiement, et **cinq machines Alpine qui n'avaient jamais eu d'agent du tout** —
nodered, zigbee2mqtt, et le trio grafana/loki/ntfy. Leurs logs n'étaient nulle part. La migration
était autant un nettoyage qu'un remplacement.

## L'architecture cible

Alloy partout, mais deux configs selon l'OS — parce que la source des logs diffère :

- **Debian + Proxmox (43 hôtes)** : paquet du dépôt apt Grafana, donc upgrades gratuits via le
  playbook APT standard. Source `loki.source.journal` — Alloy lit directement le journal systemd,
  avec les labels `job=systemd-journal`, `host=<nom d'inventaire>`, et des relabels qui extraient
  l'unité et le niveau de log.
- **Alpine (5 hôtes)** : paquets apk `alloy` + `alloy-openrc`. Pas de journald ici, donc source
  `loki.source.file` sur `/var/log/messages` et les `*.log`. Labels `job=syslog`.

Trois playbooks Ansible encadrent le tout : un pour déployer Alloy (avec un garde-fou : Promtail
n'est stoppé que si Alloy tourne effectivement), un pour retirer Promtail (qui se saute si Alloy
est inactif), un pour la variante Alpine. Le déploiement de nouveaux conteneurs installe Alloy
d'office. Aucune fenêtre où une machine se retrouve sans agent.

## Piège 1 — Le user qui n'avait pas le droit de lire

Sur Debian, Alloy lit le journal systemd. Sauf que le journal n'est pas lisible par n'importe qui :
il faut appartenir au groupe `systemd-journal`. Le user `alloy` créé par le paquet n'y était pas.

Résultat : le service démarre, le statut est `active (running)`, aucune erreur dans ses propres
logs… et **zéro ligne ne part vers Loki**. L'agent fait consciencieusement son travail — lire un
journal auquel il n'a pas accès, ce qui ne renvoie rien, ce qui n'est pas une erreur.

Même piège, variante Alpine : là, `/var/log/messages` appartient à `root:wheel` en `0640`. Le
user `alloy` devait être dans **wheel** pour le lire. Même symptôme exact : tout vert, rien qui
sort.

C'est la signature des pannes de permission de lecture : il n'y a pas d'échec, il y a une
**absence**. Et une absence ne déclenche aucune alerte tant qu'on ne la cherche pas activement.

## Piège 2 — Le binaire qui pesait quatre fois trop

Alloy est un agent unifié — il sait faire bien plus que Promtail (métriques, traces, pipelines).
Cette polyvalence a un prix sur la balance : **~400 Mo de binaire, contre 93 pour Promtail**.
Et à l'exécution, ~192 Mo de RSS par agent (Promtail tournait autour de 60).

Sur des hyperviseurs avec 16-28 Go, c'est du bruit. Sur des petits conteneurs taillés au plus
juste, c'est un mur : deux d'entre eux — un partage Samba à 2 Go et le conteneur Node-RED à 1 Go —
ont dû être élargis à chaud pendant le rollout, parce qu'Alloy ne tenait simplement pas. Leçon
pour la suite : avant de pousser Alloy sur un petit CT, vérifier qu'il a la marge.

## La validation qui compte

Le piège des déploiements silencieux, c'est qu'on ne peut pas se fier à « le service est up ».
La seule vérification qui prouve quelque chose interroge **Loki lui-même** : quels hôtes ont
envoyé un log dans les dix dernières minutes ?

```bash
curl -G http://loki:3100/loki/api/v1/label/host/values --data-urlencode 'since=10m'
```

C'est le test de bout en bout : si un hôte apparaît dans cette liste, c'est que tout le chemin
fonctionne — permissions, lecture, push, ingestion. **57 hôtes** au compteur, plus netboot dormant
qui s'enregistrera à son prochain réveil. C'est ça, la preuve — pas un `systemctl status` vert.

## Les leçons

1. **EOL est une raison suffisante de migrer.** Un composant en fin de vie est une dette qui
   grossit toute seule. La question n'est pas « est-ce qu'il marche » mais « combien de temps
   avant qu'il devienne un problème ».
2. **Les pannes de permission de lecture sont muettes.** Pas d'erreur, juste une absence de
   données. Tester ce qui arrive *à destination*, jamais l'état de l'émetteur.
3. **Un successeur n'a pas le même gabarit.** 4× le binaire, 3× la RAM : un remplacement
   « équivalent fonctionnel » peut être très inégal sur les ressources. Mesurer avant de déployer
   en masse.
4. **Garder un plan B documenté.** Si Alloy devient trop lourd, Vector (~60 Mo) ou fluent-bit
   (~5 Mo) sont des replis identifiés — au prix de sortir de l'écosystème Grafana et de revenir
   à des upgrades artisanaux. À n'envisager qu'en dernier recours, mais à savoir d'avance.

Toute la flotte parle désormais le même agent, intégré au cycle d'upgrade standard (apt ou apk
selon l'OS). Plus de générations qui divergent, plus de trous Alpine. Et trois playbooks qui
rendent le prochain hôte trivial à équiper — ce qui, sur un homelab d'une seule personne, est
exactement le genre d'investissement qui se rembourse.
