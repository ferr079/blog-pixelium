---
title: "809 → 356 shards : remettre Wazuh au régime"
date: 2026-06-08
tags: ["security", "wazuh", "siem", "opensearch", "performance", "homelab"]
summary: "Mon SIEM tombait en panne d'authentification tous les deux jours. Le coupable n'était pas la RAM, ni le disque, ni un bug : c'était 240 minuscules index découpés en 809 shards qui étouffaient la heap Java. Anatomie d'un anti-pattern OpenSearch et de sa cure."
---

> Format **incident → optimisation**. Un cas où le symptôme (login impossible)
> n'avait aucun rapport visible avec la cause (trop de shards minuscules), et où
> la mauvaise intuition — « ajouter de la RAM » — n'aurait rien réglé.

## TL;DR

Wazuh (notre SIEM) refusait périodiquement toute connexion : `Authentication finally failed for
admin`. Le réflexe — donner plus de RAM au conteneur — était une fausse piste. Le vrai problème :
**240 index `wazuh-alerts` découpés en 809 shards** pour à peine 2,4 Go de données. Chaque shard
coûte de la mémoire JVM en métadonnées, indépendamment de sa taille. La heap saturait, le circuit
breaker d'OpenSearch coupait toute requête — y compris l'authentification.

La cure, en trois gestes : une politique de rétention qui supprime les index de plus de 90 jours
(**809 → 356 shards**), un heap aligné sur la doc (2g → 4g), et un peu de RAM en plus pour le
porter (4 → 8 Go). Le tout sans réinstaller quoi que ce soit.

## Le symptôme trompeur

L'interface Wazuh rejetait le login `admin` toutes les 24 à 48 heures. Redémarrer l'indexer
réglait le problème… pour un jour ou deux. Classique fuite, sauf qu'OpenSearch ne *fuit* pas la
mémoire : il la **réserve** en métadonnées, et il en réserve proportionnellement au nombre de
shards qu'il gère.

Le piège mental, c'est que `free -h` montrait de la RAM disponible. On est tenté d'en conclure
qu'il n'y a pas de problème mémoire. Erreur : la **heap JVM** est une limite interne à Java,
totalement décorrélée de la RAM du conteneur. `-Xmx2g` plafonne dur à 2 Go même avec 100 Go
libres autour. Quand cette heap-là sature, le `circuit_breaking_exception` coupe toute requête
avant l'OOM — et l'authentification est une requête comme une autre.

Donner plus de RAM au conteneur sans toucher au heap n'aurait **rien** changé.

## L'anti-pattern : beaucoup de petits shards

La vraie cause se voit en comptant : 240 index `wazuh-alerts` (un par jour, accumulés depuis des
mois), chacun découpé en 3 shards par défaut. 720 shards rien que pour les alertes, ~809 au total.
Pour **2,4 Go de données** — soit des shards de quelques mégaoctets.

C'est l'inverse de ce qu'OpenSearch veut. Un shard a un coût fixe en mémoire (structures Lucene,
métadonnées du cluster) quasi indépendant de ce qu'il contient. Mille shards de 3 Mo coûtent
infiniment plus cher que dix shards de 300 Mo, pour la même donnée. La reco générale tourne autour
de 10-50 Go par shard ; on était à 0,003.

Le SIEM n'avait pas un problème d'espace. Il avait un problème de **comptabilité** : trop d'objets
à suivre pour la mémoire allouée.

## La cure

**1. Rétention automatique (ISM).** Une politique OpenSearch `wazuh-alerts-delete-90d` qui
supprime les index de plus de 90 jours, plus un template qui l'applique aux futurs index. Et un
nettoyage one-shot des 151 vieux index accumulés. Résultat immédiat : **809 → 356 shards**,
régime de croisière autour de 340. La politique est versionnée — elle survit, elle se redéploie.

**2. Heap aligné sur la prod.** De 2g à 4g — mais avec un détail qui a son histoire : le réglage
ne va **pas** dans `/etc/wazuh-indexer/jvm.options`, parce que dpkg réécrit ce fichier à chaque
upgrade (c'est exactement comme ça qu'un précédent réglage avait été silencieusement annulé une
nuit). Il va dans un **dropin** `jvm.options.d/heap.options`, que dpkg ne touche pas. Le pattern
vaut pour toute config qui doit survivre aux mises à jour.

**3. La RAM pour porter le heap.** 4 → 8 Go sur le conteneur, à chaud (`pct set 234 -memory 8192`),
parce qu'un heap de 4g a besoin de marge autour pour le hors-heap et le cache de fichiers.

À noter l'ordre logique : la rétention d'abord (réduire le travail), le heap ensuite (capacité de
traitement), la RAM en dernier (support du heap). Régler la RAM en premier — l'intuition — aurait
masqué le problème quelques jours de plus sans le résoudre.

## Le détail qu'on assume

Le cluster reste en état **yellow**. En temps normal, c'est un drapeau. Ici, c'est inoffensif et
attendu : un index système de configuration ISM a une réplique qui ne peut pas être assignée sur
un cluster **mono-nœud** (une réplique doit vivre sur un *autre* nœud, qui n'existe pas). La
protection des index système empêche de modifier ça proprement. On documente, on assume, on ne
court pas après un green cosmétique. Un yellow compris vaut mieux qu'un green mal acquis.

## Les leçons

1. **Le symptôme ment sur la cause.** « Login impossible » pointait vers l'auth ; la cause était
   la fragmentation des index. Suivre le fil mécanique (auth → requête → circuit breaker → heap →
   shards) plutôt que le symptôme.
2. **Heap JVM ≠ RAM du conteneur.** Deux limites indépendantes. `free -h` ne dit rien de la santé
   du heap. La saturation heap se voit dans les logs de l'indexer (`circuit_breaking_exception`),
   pas dans la RAM système.
3. **Beaucoup de petits shards est un anti-pattern coûteux.** Le coût mémoire d'un shard est quasi
   fixe. Sans politique de rétention, un index-par-jour accumule des shards pour l'éternité et
   finit par étouffer la heap — un problème de *nombre*, jamais de *volume*.
4. **Les dropins survivent aux upgrades, pas les fichiers principaux.** Pour toute config critique
   d'un paquet géré par dpkg, utiliser le répertoire `.d/`. Sinon, une mise à jour nocturne
   réécrit le réglage et la panne revient sans qu'on touche à rien.

Le SIEM tient désormais sans broncher, la rétention se gère seule, et le réglage du heap résistera
au prochain upgrade. 36 agents surveillés, zéro panne d'auth depuis. La vraie victoire n'est pas
les 453 shards supprimés — c'est de ne plus avoir à redémarrer l'indexer tous les deux jours en
se demandant pourquoi.
