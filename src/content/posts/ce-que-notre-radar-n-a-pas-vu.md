---
title: "Ce que notre radar n'a pas vu : Astro 7, et les angles morts de l'automatisation"
date: 2026-06-26
draft: false
tags: ["self-hosting", "astro", "veille", "dette-technique", "ci-cd", "cloudflare", "automatisation", "claude-code", "dossier"]
summary: "La semaine dernière, nous décrivions un workflow « en test » : une boucle qui surveille le framework de ce site et nous prépare l'upgrade. Cette semaine, elle a tourné pour de vrai — Astro 7 est passé par elle. Et elle nous a surtout appris où elle ne voit rien. Le radar lit le code, pas la toolchain ; le smoke teste les codes de retour, pas le rendu. Récit honnête d'une boucle qui tient sa promesse — et de ses trois angles morts."
---

> Suite directe de [« Tenir son site à jour : le workflow que seul un homelab rend évident »](/tenir-son-site-a-jour).
> La semaine dernière, nous présentions une boucle de veille « en test » et nous écrivions :
> *« ce que le radar déclenchera tout seul demain, nous l'avons fait à la main cette semaine »*.
> Demain est arrivé. Voici ce qui s'est passé quand la machine a pris le volant.

## La promesse, tenue

Rappel du contrat. Un radar dans le repo du site (`astro-radar.mjs`) compare nos versions à
celles publiées ; un cron sur Hermes le déclenche chaque matin ; à la moindre nouveauté, il **ouvre
une issue sur notre Forgejo**, et cette issue *est* l'état du système. À la session suivante, nous la
lisons et déroulons un runbook fixe — branche, bump, build, smoke, deploy, close.

Cette semaine, le dernier verrou est tombé : `@astrojs/cloudflare` a publié sa version 14, celle qui
rend Astro 7 utilisable sur Cloudflare. Le radar l'a vu avant nous. Il a ouvert l'issue
`[astro-radar] upgrade dispo — astro 6.4.8 → 7.0.2`. Nous l'avons consommée :

- **`astro 6.4.8 → 7.0.2`** et **`@astrojs/cloudflare 13.7.0 → 14.0.0`** en une branche.
- Build vert sur les 36 routes (EN + FR), smoke local OK, puis deploy.
- Issue fermée à 15 h 59 — quatre-vingt-dix secondes après que le déploiement soit passé.

Release → radar → issue → upgrade vérifié → close. La boucle a fermé sur du réel, pas sur une
diapositive. Et côté *code* d'Astro, l'upgrade fut un non-événement : ce site n'utilise aucune des
surfaces que la 7.0 casse, exactement comme le radar le re-vérifiait à chaque passage. Vite 8 sous le
capot ? Notre config n'a eu besoin que de ce qu'elle déclarait déjà.

Fin de l'histoire lisse. Parce que la 7.0 a bien cassé quelque chose — deux fois — et que **rien de
ce qui a cassé n'était dans le champ de vision du radar.**

## Angle mort n°1 : le radar lit le code, pas la toolchain

Le radar scanne le code *Astro* : nos pages, nos imports, les flags expérimentaux, les surfaces que
les majors font bouger. Tout était vert. Sauf que le vrai breaking d'Astro 7 ne vivait pas dans
notre code — il vivait dans la **forme de sortie de l'adaptateur Cloudflare**.

La v13 produisait un `dist/` simple. La v14 scinde tout : `dist/client` pour les assets, `dist/server`
pour le Worker, et elle génère un `dist/server/wrangler.json` où sont fusionnés tous nos bindings
(les trois KV, D1, l'IA, le rate-limit du chat…). Un `wrangler deploy` nu, lui, lit le `wrangler.toml`
à la racine — qui pointe vers `./dist` sans `main`. Résultat silencieux : il aurait publié les assets
**sans le Worker**. Le site serait monté, joli, et toutes les routes `/api/*` seraient mortes.

Le radar ne pouvait pas l'anticiper : il regarde le framework, pas la configuration de déploiement.
Le correctif tient en un drapeau — `wrangler deploy -c dist/server/wrangler.json` — mais il a fallu
*comprendre* la nouvelle structure pour l'écrire. Ça, aucun diff de version ne le souffle.

> Un outil qui surveille un framework ne surveille pas la chaîne qui l'emballe. Le breaking se cache
> souvent une couche plus bas que celle qu'on inspecte.

## Angle mort n°2 : le smoke teste les codes, pas le site

Une fois l'adaptateur dompté, nous avons déployé et lancé le smoke test : `pixelium.win` répond 200,
`/api/status` et `/api/stats` renvoient bien du JSON vivant rendu côté serveur. Vert partout. Issue
fermée. Affaire classée.

Sauf que le site était **cassé.** Pas en panne — cassé *à l'œil*. Tout le contenu sous le hero
restait invisible, figé à `opacity: 0`.

Nos apparitions au scroll reposent sur du CSS pur — `animation-timeline: view()`, sans JavaScript.
Le minifieur CSS de Vite 8 (esbuild) a « optimisé » en repliant cette propriété dans la *shorthand*
`animation` — où elle n'a aucun sens. L'animation ne se déclenchait plus, et le garde-fou laissait
le contenu masqué. Un smoke HTTP ne voit pas ça : le HTML est là, les octets arrivent, le code est
200. C'est le **rendu** qui ment, pas le serveur.

C'est Stéphane qui l'a vu — pas un test, un humain qui *regarde* une capture d'écran de la page.
Le correctif fut d'une ligne, `cssMinify: false`, posée vingt-sept minutes après l'upgrade. Mais la
leçon vaut plus que la ligne :

> Un smoke vert n'est pas un site vivant. Tant qu'on n'a pas regardé le rendu, on a vérifié que le
> serveur répond — pas que le site existe.

Depuis, screenshoter la page fait partie du runbook d'upgrade, au même titre que le build. Vérifier
la réalité, pas les codes de retour : c'est un refrain que ce blog a déjà chanté à propos de nos
sondes de monitoring. Il s'applique mot pour mot à un déploiement.

## Angle mort n°3 : le radar ne se voyait pas lui-même

Le plus savoureux pour la fin. Pendant que le radar surveillait Astro, il avait son propre défaut —
et c'est *nous* qui l'avons découvert, pas lui.

Son idempotence — la garantie de ne pas re-pinguer tant qu'une issue est ouverte — reposait sur le
**titre exact** de l'issue. Or ce titre embarque la version cible. Quand la 7.0.0 (vue le 23) est
devenue 7.0.2 (le 24), le titre a changé… et le radar a cru à une nouveauté : il a ouvert une
**deuxième** issue au lieu de rafraîchir la première. Deux contrats pour un seul upgrade.

Rien de grave — nous avons fermé les deux d'un coup — mais c'est une jolie mise en abyme : le système
chargé de détecter la dérive avait dérivé sur exactement le genre de détail qu'il était censé
attraper. Le correctif (côté infra) : tester la présence sur le **préfixe** `[astro-radar]`, pas sur
le titre complet, et rafraîchir l'issue ouverte sans re-notifier.

> Le surveillant a besoin d'être surveillé. Aucune boucle ne se relit toute seule — il faut un regard
> extérieur, et ce regard reste humain.

## La preuve que ça vit : déjà la suivante

Au moment où nous écrivons ces lignes, le radar a déjà rouvert une issue : `astro 7.0.2 → 7.0.3`.
Nous venions de fermer la précédente, il a fait son travail, sans qu'on lui demande. La boucle ne
s'est pas arrêtée à sa démonstration — elle continue de tourner, et c'est précisément ce que la
semaine dernière nous décrivions au futur.

C'est ça, la différence entre une promesse et un système : la promesse se raconte une fois ; le
système rouvre une issue le lendemain matin, tout seul.

## Ce que nous en retirons

- **L'automatisation rapproche la cible, elle ne franchit pas la ligne.** Le radar transforme une
  release en tâche scopée — un énorme gain — mais le dernier mètre (juger une structure de sortie,
  regarder un rendu) reste un acte de jugement, pas un test qui passe.
- **Le breaking se cache une couche plus bas que celle qu'on inspecte.** Notre code était propre ;
  ce sont l'adaptateur et le bundler qui ont bougé. Surveiller un framework ne suffit pas à couvrir
  la chaîne qui le déploie.
- **Un smoke vert n'est pas un site vivant.** Un humain qui regarde une capture a vu en deux secondes
  ce qu'aucun code 200 ne révélait. Le screenshot est désormais une étape, pas un luxe.
- **Le surveillant a aussi des angles morts.** La boucle qui traque la dette technique en a généré un
  peu elle-même. On l'assume, on le corrige, on l'écrit — c'est ça, tenir un système honnête.

La semaine dernière, nous écrivions que le self-hosting paie en *affordance* : il fait concevoir des
boucles qu'un laptop n'inspire pas. Cette semaine ajoute la nuance qui manquait : ces boucles valent
ce que vaut le regard qu'on garde dessus. L'infra prépare le terrain ; nous décidons, vérifions, et
regardons vraiment. Un sur un.

---

*Stack : Astro 7.0.2 (SSG) sur Cloudflare Workers · adaptateur `@astrojs/cloudflare` v14 (sortie
`dist/client` + `dist/server`) · Vite 8 (`cssMinify` désactivé) · le radar `astro-radar.mjs` dans le
repo du site · Hermes (CT 190) pour le déclenchement · Forgejo (CT 180), les issues `[astro-radar]`
comme file de tâches · écrit par Claude (Opus), en binôme avec Stéphane.*
