---
title: "Du câble SFP+ à la carte du site : une topologie qui ne ment pas"
date: 2026-06-08
tags: ["reseau", "homelab", "topologie", "homelable", "astro", "documentation"]
summary: "La carte réseau de mon site affichait encore la Freebox reliée à tout en direct, alors qu'un switch 10G était en place depuis des semaines. Reconnecter le dessin au réel — avec des vitesses lues dans /sys plutôt que devinées, et une source de vérité unique entre l'infra, son visualiseur et le portfolio."
---

> Format **documentation vivante** — comment une carte d'infrastructure reste
> honnête. Un schéma réseau qui n'est pas branché sur la réalité dérive en
> décoration ; l'enjeu est la chaîne qui le tient synchronisé.

## TL;DR

La page [infrastructure](https://pixelium.win/infrastructure) de ce site affiche une carte de
topologie. Elle montrait encore l'ancien monde : la Freebox reliée en direct à chaque hôte. Or
depuis des semaines, un **switch XikeStor 10G** s'est intercalé — Freebox → switch en fibre SFP+,
puis switch → tous les hôtes. La carte mentait par omission.

La remettre d'aplomb a touché trois couches qui doivent rester cohérentes : le **canvas Homelable**
(le visualiseur d'infra, source de vérité), le **JSON exporté** vers le site, et le **composant
Astro** qui le rend. Avec un principe : les vitesses des liens ne se devinent pas, elles se
**lisent dans le noyau**.

## Le décalage

Le câblage physique avait évolué sans que la représentation suive — le classique « le code dit une
chose, le réel en fait une autre », version réseau. La topologie réelle aujourd'hui :

```
Freebox Delta ──(fibre 10G SFP+)──▶ Switch XikeStor ──┬─▶ pve1, pve2   (2.5G)
                                                       ├─▶ pve3, pve4   (1G)
                                                       ├─▶ terre2       (fibre 10G SFP+)
                                                       └─▶ OMV, port1   (1G)
```

Plus un lien direct 2,5G entre pve1 et pve2, hors switch, conservé. La carte du site, elle, en
était restée à « Freebox → tout, en 1G ». Faux sur la structure (pas de switch), faux sur les
vitesses (pas de 10G, pas de 2,5G).

## La règle : mesurer, ne pas deviner

Le piège facile aurait été d'écrire les vitesses « de mémoire » — *je crois que terre2 est en 10G*.
Mais une carte qui affirme une vitesse fausse est pire qu'une carte sans vitesse : elle inspire
une confiance qu'elle ne mérite pas. Alors chaque débit vient du noyau :

```bash
$ cat /sys/class/net/<iface>/speed
10000   # terre2 — 10 Gb/s, confirmé
2500    # pve1, pve2 — 2.5 Gb/s
1000    # pve4, OMV
```

Deux exceptions assumées, et explicitement notées comme telles : pve3 dormait (machine on-demand,
réveillée par Wake-on-LAN — pas de lien à interroger sur le moment), et port1 dont la vitesse vient
de la fiche matériel. Pour tout le reste, la carte affiche ce que la carte réseau rapporte, pas ce
que je suppose.

## Une source de vérité, trois représentations

Le point qui rend l'exercice durable, c'est de ne pas avoir trois cartes divergentes. La chaîne :

1. **Homelable** (le visualiseur d'infra auto-hébergé) est la source. C'est là qu'on ajoute le
   nœud « Switch XikeStor », qu'on recâble les liens, qu'on encadre les machines on-demand. Au
   passage, le canvas a aussi récupéré quatre conteneurs qui manquaient et perdu un nœud-fantôme
   laissé par le scanner réseau.
2. **Un JSON exporté** transporte cette topologie vers le site — un format pivot, pas une re-saisie
   manuelle.
3. **Le composant Astro** rend ce JSON. Il a fallu lui apprendre une nouvelle notion : un *étage
   switch* entre l'opérateur et les hôtes, qu'il ne savait pas dessiner (il ne connaissait que
   « box → machines »). Avec un style de lien fibre distinct, et le maintien du pointillé
   « on-demand » autour de pve3.

L'intérêt de cette chaîne : la prochaine évolution physique se fait **une fois**, dans Homelable,
et redescend jusqu'au site. Pas trois endroits à se rappeler de mettre à jour — un seul.

## Le nettoyage qui tombe à pic

En reconstruisant le canvas, un champ mort est apparu dans le JSON : une liste de liens héritée de
l'ancienne structure, que plus aucun code ne lisait. Supprimée. C'est le bénéfice collatéral de ce
genre de chantier : on ne touche jamais à une représentation sans découvrir les scories de la
précédente. Une carte qu'on remet à jour, c'est aussi une carte qu'on dépoussière.

## Les leçons

1. **Une carte déconnectée du réel devient un mensonge confortable.** Tant qu'on ne la rebranche
   pas sur la source, elle vieillit en silence et inspire une fausse confiance. La synchronisation
   doit être un *mécanisme*, pas une bonne résolution.
2. **Mesurer plutôt que deviner.** `/sys/class/net/*/speed` dit la vérité ; ma mémoire arrondit.
   Et quand on ne peut pas mesurer (machine éteinte), on le note — l'honnêteté d'une donnée
   inclut l'aveu de son origine.
3. **Une source, plusieurs vues.** Homelable décide, le JSON transporte, Astro affiche. Toute
   évolution se fait à la source et se propage. C'est ce qui distingue une documentation vivante
   d'une capture d'écran qui pourrit.
4. **Refaire une représentation, c'est nettoyer la précédente.** Les champs morts et les nœuds
   fantômes ne se voient qu'au moment où on remet les mains dedans.

La carte du site montre désormais le switch, les bonnes vitesses, et le pointillé des machines qui
dorment. Elle est exacte aujourd'hui — et surtout, elle a une chaîne qui la gardera exacte demain.
C'est la seule forme de documentation qui vaille : celle qui a un moyen de ne pas mentir.
