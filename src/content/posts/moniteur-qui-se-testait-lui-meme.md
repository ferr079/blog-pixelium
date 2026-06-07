---
title: "Le moniteur qui se testait lui-même"
date: 2026-06-08
tags: ["incident", "postmortem", "monitoring", "dns", "proxmox", "dagu"]
summary: "Trois jours de rouge sur la page status, et personne ne l'a vu. Un health-check migré sur le conteneur qu'il surveille, une ligne /etc/hosts injectée par Proxmox, et un dead-man switch qui couvrait l'exécution du job — pas la véracité de ses mesures."
---

> Format **incident** — post-mortem honnête. Celui-ci est petit par ses dégâts
> (zéro service réellement down) mais grand par sa leçon : le point de vue
> du moniteur fait partie du système surveillé.

## TL;DR

Depuis le 4 juin, la page [status](https://pixelium.win/status) de ce site affichait **Dagu en rouge**.
Dagu — l'orchestrateur qui exécute précisément le script de monitoring — était parfaitement
opérationnel. Le check se sabotait lui-même : migré **sur** le CT 246, il testait
`https://dagu.pixelium.internal`, que le `/etc/hosts` injecté par Proxmox résout vers… le CT
lui-même, où rien n'écoute sur le port 443. `curl` → `000` → down. À chaque tick, pendant trois jours.

Personne ne l'a vu, parce que le dead-man switch surveillait **l'exécution** du job — qui
réussissait fièrement à publier une mesure fausse. C'est Stéphane qui a fini par demander :
*« pourquoi Dagu est rouge ? »*

Le fix tient en une option `curl`. Le diagnostic, lui, valait un article.

## Contexte — une migration propre, en apparence

Début juin, on a décommissionné OpenFang (CT 192), l'agent AIOps qui hébergeait depuis des mois
`kv-push.sh` — le script qui ping les 46 services du homelab toutes les 5 minutes et pousse le
résultat vers Cloudflare KV, d'où la page status du site tire ses données.

Le script a déménagé sur **Dagu (CT 246)**, l'orchestrateur de DAGs qui a hérité du temporel du
homelab. Migration soignée : schedule `*/5` conservé, secrets déplacés, dead-man switch
Healthchecks branché (si le job ne ping pas, alerte). Tout vert.

Tout vert, sauf une ligne de la page status. Et cette ligne, c'était Dagu lui-même.

## Ce qui s'est passé vraiment

Le check HTTP de kv-push est générique :

```bash
http_code=$(curl -sk --max-time 5 -o /dev/null -w "%{http_code}" "$url")
# "Dagu|https://dagu.pixelium.internal|monitoring"
```

Dans le homelab, tout `*.pixelium.internal` pointe vers `192.168.1.110` (Traefik), qui route vers
le bon backend. Depuis n'importe quelle machine du LAN, `https://dagu.pixelium.internal` répond 200.

Depuis n'importe quelle machine, **sauf une** : le CT 246. Parce que Proxmox injecte dans chaque
conteneur LXC un bloc `/etc/hosts` :

```
# --- BEGIN PVE ---
192.168.1.246 dagu.pixelium.internal dagu
# --- END PVE ---
```

Le hostname du CT s'appelle `dagu`, son domaine est `pixelium.internal` — Proxmox fabrique donc
un FQDN qui **collisionne exactement** avec l'entrée DNS publique du service. Et `nsswitch`
consulte `files` avant `dns` : le curl du check ne sort jamais vers Traefik. Il frappe son propre
port 443, fermé (Dagu écoute en 8080, le TLS c'est l'affaire de Traefik), et meurt en 0,3 ms.

Tant que kv-push tournait sur CT 192, le nom résolvait normalement et le check était un vrai test
de bout en bout. Le jour où le script a emménagé chez Dagu, le check de Dagu est devenu un
court-circuit. **La mesure dépendait de l'endroit d'où on mesurait.**

## Pourquoi personne ne l'a vu

C'est la partie intéressante. Trois mécanismes de surveillance existaient, et aucun n'a parlé :

1. **Le dead-man switch Healthchecks** couvre le job kv-push : s'il ne s'exécute pas, alerte.
   Mais le job s'exécutait parfaitement — il publiait juste une donnée fausse. *L'exécution
   n'est pas la véracité.*
2. **Uptime-Kuma** surveille Dagu… depuis le CT 224, où la résolution est saine. Vert, à raison.
   Les deux moniteurs étaient d'accord chacun dans son référentiel.
3. **La page status elle-même** affichait l'information exacte — un service down — noyée dans
   un uptime global de 94 % qui restait plausible avec pve3 endormi (les services on-demand
   sont attendus down une partie de la journée).

L'historique D1 du site est formel : `Dagu` apparaît dans `down_services` **chaque jour depuis
le 4 juin**. La donnée de l'anomalie était publiée, archivée, visible publiquement. Il a fallu
un humain qui regarde vraiment la page pour la voir.

## Le faux suspect

Le jour du diagnostic, pve4 (l'hôte de Dagu) avait justement rebooté à 13h pour un upgrade kernel,
et `/etc/hosts` affichait un mtime de 13:00. Corrélation parfaite, coupable idéal — sauf que
Proxmox régénère ce bloc à *chaque* boot, à l'identique. L'historique D1 a innocenté le reboot :
le rouge précédait de trois jours. Sans données historiques, on aurait « fixé » le mauvais problème
et conclu trop vite.

## Le fix

Une seule option curl, dans le check générique :

```bash
curl -sk --max-time 5 --resolve "dagu.pixelium.internal:443:192.168.1.110" ...
```

`--resolve` force ce nom-là — et uniquement lui — vers Traefik, en ignorant `/etc/hosts`.
Les entrées `--resolve` qui ne matchent pas l'URL testée sont ignorées par curl : les 45 autres
checks sont intacts. Et le test reste un **vrai** test de la route HTTPS complète, comme pour
tous les autres services. Pas de `localhost:8080` qui validerait Dagu sans valider Traefik.

Déployé à 21h10. Au tick de 21h15 : vert. Trois jours de faux rouge, cinq minutes de fix.

## Les leçons

- **Le point de vue du moniteur fait partie du système surveillé.** Déplacer un check, c'est
  changer sa physique : résolution DNS, routage, firewall. Une migration de script de monitoring
  mérite une revue de *ce que chaque check voit depuis sa nouvelle position*.
- **Un health-check hébergé sur la machine qu'il teste via son FQDN s'auto-sabote** dès que
  l'hôte injecte son propre nom dans `/etc/hosts` — ce que Proxmox fait pour chaque CT.
- **Surveiller l'exécution ne suffit pas.** Le dead-man switch dit « le job a tourné », jamais
  « le job a dit vrai ». Les mesures elles-mêmes méritent un regard périodique — ou une alerte
  sur les anomalies *persistantes* (un service down 72 h d'affilée n'est plus un incident,
  c'est un état, et un état mérite une question).
- **Les données historiques innocentent les faux suspects.** Sans le D1 qui archive les snapshots
  horaires, le reboot kernel de 13h aurait été un coupable trop confortable.

Le homelab n'a rien perdu — Dagu n'a jamais cessé de fonctionner. Mais la page status, elle,
a menti par construction pendant trois jours. C'est exactement le genre de mensonge qu'on ne
détecte qu'en se demandant, de temps en temps : *et si le rouge disait vrai ? et si le vert
mentait ?*
