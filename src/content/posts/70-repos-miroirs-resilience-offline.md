---
title: "70 repos miroirs : la résilience offline comme doctrine"
date: 2026-04-05
tags: ["automatisation", "homelab", "resilience", "forgejo"]
summary: "De 37 à 70 repos miroirs sur un Forgejo secondaire. Automatiser la synchronisation, survivre hors-ligne, et pourquoi le Shadowbroker est le premier miroir non-GitHub."
---

## La question qui dérange

Que se passe-t-il si GitHub tombe demain matin ?

Pas une panne de 20 minutes — une vraie indisponibilité. Ou pire : un blocage géographique, un changement de conditions d'utilisation, un paywall sur les repos publics. Improbable ? Peut-être. Mais nous avons vu des services "trop gros pour tomber" devenir inaccessibles du jour au lendemain.

Notre homelab tourne avec des dizaines d'outils open-source hébergés sur GitHub. CrowdSec, nmap, CyberChef, Open WebUI... Si nous perdons l'accès à ces repos, nous ne pouvons plus mettre à jour, plus auditer le code source, plus reconstruire nos services.

La réponse à cette question, c'est **Forworld** — notre Forgejo secondaire dédié au mirroring.

## Forworld : le coffre-fort de repos

Forworld est une instance Forgejo qui tourne sur pve3 — le serveur on-demand, celui qui sert aussi pour les backups. Il n'est pas allumé 24/7. Il n'a pas besoin de l'être : son rôle n'est pas de servir du code en continu, mais de **conserver une copie locale** de tout ce qui compte.

L'idée de départ était modeste : 37 repos miroirs, les outils critiques de l'infra. Assez pour reconstruire le homelab en cas de besoin.

Puis nous avons commencé à réfléchir à ce que "critique" signifie vraiment.

## De 37 à 70 : l'inventaire qui grandit

La première vague couvrait l'essentiel — les outils que nous utilisons quotidiennement. La deuxième vague a élargi le périmètre à tout ce dont nous pourrions avoir besoin **sans connexion internet**.

### Sécurité offensive et défensive

```
crowdsecurity/crowdsec          # IPS communautaire
nmap/nmap                       # Scanner réseau
hashcat/hashcat                 # Audit de mots de passe
CyberChef                       # Couteau suisse crypto/encodage
Wazuh                           # SIEM open-source
```

Si un incident de sécurité survient pendant une panne internet, nous avons besoin de ces outils **localement**. Pas le temps de télécharger hashcat quand un compte est compromis.

### Utilitaires offline

```
kiwix/kiwix-tools               # Lecture offline (Wikipedia, docs)
ArchiveBox/ArchiveBox           # Archivage web
```

Kiwix permet de consulter Wikipedia entièrement hors-ligne. ArchiveBox archive des pages web complètes. Deux outils qui prennent tout leur sens quand la connexion disparaît.

### Communication et infrastructure

```
element-hq/synapse              # Serveur Matrix
thelounge/thelounge             # Client IRC
```

Si les services cloud tombent, la communication locale reste possible via Matrix ou IRC. Ce n'est pas paranoïaque — c'est un plan B.

### Outils de développement et IA

```
open-webui/open-webui           # Interface pour LLMs locaux
ollama/ollama                   # Runtime LLM local
```

Avec Ollama sur la workstation et Open WebUI mirroré localement, nous gardons une capacité IA même déconnectés. Le RTX 3090 ne dépend pas d'une API cloud.

## Le Shadowbroker : premier miroir non-GitHub

Au milieu de l'expansion, un repo a cassé le pattern : **Shadowbroker**. Hébergé non pas sur GitHub, mais sur une forge alternative.

Pourquoi c'est important : jusqu'ici, tous nos miroirs venaient de GitHub. Si GitHub est notre unique source, nous avons un **single point of failure** dans notre stratégie de mirroring. Le Shadowbroker est le premier test de miroir depuis une source différente.

Techniquement, Forgejo gère les miroirs depuis n'importe quelle forge Git — GitHub, GitLab, Codeberg, instances auto-hébergées. Mais nous ne l'avions jamais exercé en pratique. Diversifier les sources de miroir, c'est renforcer la résilience du système lui-même.

## L'automatisation : guardian-mirror-sync

Synchroniser 70 repos manuellement, c'est impensable. Nous avons automatisé l'ensemble avec un script orchestré par l'agent Guardian (OpenFang).

Le workflow complet :

```
┌──────────────────────────────────────────────────┐
│  Jeudi 17h — Cron déclenche guardian-mirror-sync │
├──────────────────────────────────────────────────┤
│  1. Wake-on-LAN → pve3 démarre                  │
│  2. Attente SSH (timeout 120s)                   │
│  3. Attente Forgejo prêt (port 3000)             │
│  4. Sync séquentielle des 70 repos via API       │
│  5. Rapport : succès/échecs/durée                │
│  6. Shutdown pve3                                │
│  7. Notification Telegram                        │
└──────────────────────────────────────────────────┘
```

### Pourquoi jeudi 17h ?

Le backup complet (PBS) tourne **le lundi à minuit**. Le mirror-sync tourne le **jeudi en fin de journée**. Deux opérations lourdes qui réveillent pve3 — les séparer dans le temps évite les conflits et répartit la charge sur la semaine.

### L'appel API Forgejo

Chaque miroir se synchronise via un simple appel POST :

```bash
# Déclencher la synchronisation d'un repo miroir
curl -s -X POST \
  "https://forgejo.example.internal/api/v1/repos/mirrors/repo-name/mirror-sync" \
  -H "Authorization: token $FORGEJO_TOKEN"
```

Forgejo fait le reste : il contacte l'upstream, compare les refs, et tire les nouveaux commits. La synchronisation d'un repo prend entre 1 et 10 secondes selon sa taille.

### Le résultat

```
guardian-mirror-sync terminé
Repos synchronisés : 70/70
Durée totale : 3 min 12s
Échecs : 0
Prochaine sync : jeudi prochain 17h
```

70 repos en un peu plus de 3 minutes. Puis pve3 s'éteint. Coût énergétique : moins de 5 minutes de fonctionnement par semaine.

## Ce que ça représente en stockage

```
Repos miroirs : 70
Stockage total : ~8 Go
Croissance hebdomadaire : ~50-100 Mo
```

8 Go pour 70 repos complets avec tout l'historique git. C'est dérisoire. Un disque dur de récupération pourrait stocker des centaines de copies. Le rapport coût/bénéfice du mirroring est absurde — quelques gigaoctets contre une assurance anti-catastrophe.

## La doctrine offline

Derrière les chiffres, il y a une philosophie : **si nous ne pouvons pas reconstruire notre infrastructure sans internet, nous ne possédons pas vraiment notre stack.**

Ce n'est pas de la paranoïa. C'est le même raisonnement que pour les backups : personne ne trouve les backups utiles — jusqu'au jour où le disque lâche. Le mirroring, c'est le backup du code source. On espère ne jamais en avoir besoin, mais le jour où on en a besoin, c'est trop tard pour commencer.

Les scénarios ne sont pas que théoriques :

- **Panne GitHub** — ça arrive quelques fois par an, parfois pendant des heures
- **Blocage géographique** — des pays entiers ont perdu l'accès à des plateformes du jour au lendemain
- **Changement de licence** — un repo open-source peut devenir propriétaire (ça s'est vu)
- **Suppression de compte** — un mainteneur qui supprime son repo emporte tout l'historique

Avec Forworld, nous avons un snapshot local de tout ce qui compte. Pas à jour à la seconde — à jour à la semaine, ce qui est largement suffisant.

## L'évolution possible

70 repos, c'est le périmètre actuel. La prochaine étape logique serait d'ajouter les repos de l'écosystème Proxmox lui-même — les scripts de déploiement, les helper scripts, les templates. Si la communauté Proxmox change de plateforme ou de politique, nos procédures de déploiement continuent de fonctionner.

Mais nous résistons à la tentation d'aller trop vite. 70 repos bien choisis valent mieux que 200 repos miroirs dont la moitié sont obsolètes. Le critère reste : "est-ce qu'on en aurait besoin pour reconstruire l'infra hors-ligne ?"

## Ce que nous en retirons

### 1. Le mirroring est l'assurance la moins chère qui existe

8 Go de stockage, 3 minutes de sync par semaine, zéro coût récurrent. Pour une protection contre la perte d'accès à des outils critiques, le ratio est imbattable.

### 2. Diversifier les sources compte autant que diversifier les copies

Miroir uniquement depuis GitHub = single point of failure dans la stratégie de mirroring. Le Shadowbroker a ouvert la voie vers des sources alternatives. La résilience, c'est aussi la diversité des origines.

### 3. L'automatisation transforme l'intention en habitude

Avant le script, la synchronisation se faisait "quand on y pensait". Maintenant c'est chaque jeudi, sans exception. Comme pour les backups, la fiabilité ne dépend plus de la mémoire humaine.

### 4. La résilience offline n'est pas un luxe

C'est une propriété fondamentale d'une infrastructure saine. Si le lien internet tombe, le homelab doit continuer à fonctionner — pas parfaitement, mais suffisamment. 70 repos miroirs, des ISOs locales, des modèles IA embarqués : chaque brique offline rend l'ensemble plus robuste.

---

*Stack : Forgejo (Forworld, pve3), guardian-mirror-sync, Wake-on-LAN, cron jeudi 17h. Stockage : ~8 Go pour 70 repos. Coût additionnel : 0€.*
