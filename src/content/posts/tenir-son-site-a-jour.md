---
title: "Tenir son site à jour : le workflow que seul un homelab rend évident"
date: 2026-06-18
draft: false
tags: ["self-hosting", "homelab", "astro", "veille", "dette-technique", "forgejo", "hermes", "claude-code", "dossier"]
summary: "Un site vieillit par ses dépendances. Le vrai sujet n'est pas « être au courant » — un SaaS le fait — mais fermer la boucle jusqu'à l'upgrade vérifié et déployé. Voici le workflow que nous testons pour ça, l'inventaire des sept briques self-hosted qu'il réclame, et pourquoi un laptop seul n'inspire pas ce genre de solution."
---

> **Mise à jour — 26 juin 2026.** Ce que nous décrivions ici comme un workflow « en test » a tourné
> pour de vrai depuis : Astro 7 est passé par cette boucle. Le récit — et les trois angles morts
> qu'elle nous a révélés — est dans [« Ce que notre radar n'a pas vu »](/ce-que-notre-radar-n-a-pas-vu).

> Ce dossier raconte un workflow mis en test le 18 juin 2026 : faire en sorte que notre infra
> surveille le framework de ce site et nous prépare l'upgrade avant qu'il ne devienne une corvée.
> C'est un retour d'expérience honnête, pas un tuto. Le code est sur
> [Forgejo](https://forgejo.pixelium.internal/uzer/pixelium-site) et
> [GitHub](https://github.com/ferr079/pixelium-site) — chaque affirmation pointe vers un commit réel.

## Le problème : un site vieillit tout seul

Un site web ne pourrit pas par son contenu, il pourrit par ses dépendances. Astro sort une 6.4.5,
une 6.4.6, une 6.4.7… puis un jour une 7.0 avec Vite 8, un processeur Markdown différent, un
adaptateur à changer de major. Si on ne regarde pas, on accumule une **dette silencieuse** : le
jour où l'on veut enfin bouger, le saut n'est plus un patch, c'est un chantier.

Ce site tournait sur Astro `6.4.4`. La dernière stable était `6.4.8`, la `7.0` déjà en beta. Rien
de dramatique — *et c'est précisément le moment où il faut agir*. Attraper la dérive pendant qu'elle
est indolore, pas quand elle fait mal.

Mais voilà le piège : « tenir son site à jour » se résume trop souvent à *être au courant*. Or
être au courant ne répare rien. Le vrai sujet, c'est de **fermer la boucle** — de la release
publiée jusqu'à l'upgrade testé et déployé — sans que ça repose sur la vigilance de Stéphane un
mardi soir.

> La bonne veille, ce n'est pas lire les release notes. C'est ne PAS avoir à les lire.

## Le workflow que nous testons

L'idée : un « radar » qui, sur une nouvelle release, compare la version de *ce site* à la dernière
publiée, vérifie si le terrain est miné, et ouvre une tâche d'upgrade scopée. Une décision
d'architecture commande tout le reste : **le cerveau vit dans le repo du site**, pas dans l'infra.

```
        ┌──────────────── repo du site (le cerveau) ────────────────┐
        │  scripts/astro-radar.mjs                                   │
        │  • diffe astro + @astrojs/cloudflare + sitemap             │
        │    (versions du lockfile vs registre npm)                  │
        │  • scanne les "surfaces breaking" : MDX, @astrojs/db,      │
        │    astro:transitions, src/fetch.ts, flags experimental    │
        │  • émet un brief (markdown) ou du --json (exit 10 si neuf) │
        └───────────────────────────┬───────────────────────────────┘
                                     │  pull + run + route, 8h30
        ┌────────────────────────────▼──────────────────────────────┐
        │  cron hermes-astro-radar (Hermes, CT 190 — la couche mince)│
        │  pull /root/pixelium-site → node astro-radar.mjs --json    │
        │  → si du neuf : OUVRE une issue Forgejo idempotente        │
        │    (labels astro-upgrade + dependencies, titre [astro-radar])│
        │    + ping ntfy & Telegram, une seule fois, à sa création   │
        └────────────────────────────────────────────────────────────┘
```

Pourquoi le cerveau dans le repo et pas dans l'infra ? Parce qu'il est *testable là où il vit*,
versionné avec le code qu'il surveille, et que l'infra n'a plus qu'un rôle bête : déclencher,
router. Le radar tourne aussi bien à la main qu'au bout d'un cron.

Un détail honnête, parce que ce blog n'aime pas les histoires trop lisses : nous l'avions d'abord
croqué comme un DAG sur Dagu, notre orchestrateur maison. Sauf que le conteneur Dagu tourne sur une
Debian sans `node`, et le radar a besoin de `node`. Plutôt que d'y greffer une toolchain entière,
le job a atterri là où `node` *et* le clone du site étaient déjà présents : un cron sur Hermes.

> Le bon endroit pour une tâche, c'est souvent celui qui a déjà les outils — pas celui qu'on avait
> dessiné sur le schéma.

Voici ce que le radar crache aujourd'hui :

```
# Astro radar — 🟢 à jour

| paquet               | installé | stable | beta            | écart |
|----------------------|----------|--------|-----------------|-------|
| astro                | 6.4.8    | 6.4.8  | 7.0.0-beta.4    | —     |
| @astrojs/cloudflare  | 13.7.0   | 13.7.0 | 14.0.0-beta.2   | —     |
| @astrojs/sitemap     | 3.7.3    | 3.7.3  | 3.6.1-beta.3    | —     |

Surfaces breaking (leur absence garde les majors indolores) :
- ✅ absente — Markdown remark/rehype/MDX
- ✅ absente — @astrojs/db
- ✅ absente — astro:transitions
- ✅ absente — src/fetch.ts
- ✅ absente — flags experimental
```

Détail qui nous a fait sourire : le radar a **repéré tout seul** `@astrojs/cloudflare 14.0.0-beta.2`,
l'adaptateur compatible Astro 7 — exactement la dépendance qui *commande* le calendrier de la 7.0.
Le jour où elle passe stable, le radar le verra avant nous.

### La boucle se ferme : l'issue comme contrat

Un ping se balaie aussi vite qu'un digest. Le radar fait mieux : quand il détecte un upgrade, il
**ouvre une issue sur le Forgejo du site**. Cette issue, c'est le **contrat** entre l'infra et nous.
Parce que la suite nous revient aussi : à la session suivante, nous lisons l'issue et déroulons un
runbook fixe — branche dédiée, bump des dépendances (`package.json` + lockfile), `astro build`,
smoke test local, et *seulement ensuite* le deploy sur Cloudflare Workers — puis nous fermons
l'issue avec le résumé du diff. **Release → radar → issue → upgrade vérifié → close.**

Le plus élégant, c'est l'état. Aucun fichier de suivi, aucune base, aucun verrou : l'état *c'est
l'issue elle-même*. Tant qu'elle est ouverte, le radar ne re-pingue pas ; une fois fermée, il est
libre de la rouvrir à la prochaine release. La mémoire du système, c'est le gestionnaire d'issues.

> Le meilleur état applicatif est parfois celui qu'on n'écrit pas : une issue ouverte dit déjà tout.

## La preuve : ça produit du réel

Une boucle qui ne ferme jamais sur du concret, c'est de la déco. Ce que le radar déclenchera tout
seul demain, nous l'avons fait **à la main cette semaine** — autant pour en écrire le mode d'emploi
que pour vérifier que la démarche produit du vérifiable. Chaque ligne reliée à un commit :

- **Upgrade `6.4.4 → 6.4.8`** — un non-événement. Et *pourquoi* c'en est un fait tout l'intérêt :
  ce site n'utilise aucune des surfaces que la 7.0 casse. Rester *upgrade-friendly*, c'est un choix
  d'architecture, pas de la chance — et le radar le re-vérifie à chaque passage.
- **Les chiffres « live » cuits au build** plutôt qu'un fetch client qui les fait clignoter.
- **Les apparitions au scroll passées en CSS pur** (`animation-timeline`), un `IntersectionObserver`
  en moins, avec un garde-fou `@supports` pour ne jamais masquer le contenu.
- **Les polices migrées vers l'API Fonts d'Astro**, métriques de fallback calculées, zéro décalage.

Et puisque ce blog n'aime pas les récits trop lisses : nous avons aussi **choisi de *ne pas*
utiliser les Server Islands**, la feature à la mode. Sur ~55 nombres dispersés dans les pages,
chaque îlot aurait été une requête séparée — une régression déguisée en modernité. Nous avons
planté sur un mauvais chemin d'import (`astro/components` au lieu de `astro:assets`), la doc nous a
même soufflé une prop qui n'existe pas. On vérifie, on corrige, on avance.

## L'atelier : tout ce qu'il faut pour câbler ça

Voilà le point que nous voulons rendre tangible. Cette boucle, en apparence simple, repose sur
**sept pièces** — et c'est *là* que se cache l'histoire :

| Brique | Où | Rôle dans la boucle |
|---|---|---|
| **FreshRSS** | CT 160 | agrège les feeds de release Astro (awareness passive) |
| **Hermes** + cron `astro-radar` | CT 190 | déclenche : pull → run → route, à 8h30 |
| **`astro-radar.mjs`** | repo du site | le cerveau : diff de versions + scan des surfaces breaking |
| **Forgejo** | CT 180 | source de vérité **et** file de tâches — l'issue = le contrat/état |
| **ntfy** + **Telegram** | — | notification, une fois, à la création de l'issue |
| **Cloudflare Workers** | edge | la cible : build Astro puis `wrangler deploy` |
| **Claude Code (Max)** | — | le jugement : lit l'issue, exécute l'upgrade vérifié, ferme |

Sept services que nous faisons déjà tourner, qu'on peut brancher les uns sur les autres. Aucun n'a
été créé pour ce workflow : ils existaient *déjà* pour d'autres raisons. Nous n'avons eu qu'à câbler
entre eux ceux qui étaient là — un script de 200 lignes et un cron. C'est ça, la composabilité : la
valeur n'est pas dans une brique, elle est dans le fait de pouvoir les **relier comme on veut**.

## Ce qu'un laptop, seul, n'inspire pas

Voici l'angle qui nous amuse. Le problème générique — surveiller des versions de dépendances — est
**déjà résolu en SaaS** : Renovate, Dependabot ouvrent un PR de bump tout seuls, sans serveur,
gratuitement. Alors pourquoi s'embêter ?

Parce qu'un PR de bump n'est pas un upgrade. Il ne sait pas que *ce site* ignore les surfaces que la
v7 casse. Il ne juge pas le risque, ne teste pas le rendu, ne déploie pas, ne ferme pas la boucle.
Il fait le geste étroit — bumper un numéro — et laisse le reste. Notre boucle va jusqu'au bout
*parce qu'elle connaît notre contexte* : elle ouvre l'issue dans notre tracker, et la passe à un
agent qui sait lire le profil de risque du site et exécuter l'upgrade vérifié.

Et c'est là que le homelab change la façon de *penser* le problème. Avec un laptop et rien d'autre,
deux réflexes : soit on n'imagine pas automatiser sa veille de framework (on upgrade quand ça
casse) ; soit, si l'idée vient, on la voit aussitôt comme **un produit à construire et à vendre** —
encore un SaaS de plus. Le serveur à la maison ouvre une troisième voie, plus discrète : câbler la
boucle *exacte*, *privée*, pour *un seul* site, sans rien productiser. Pas une startup — juste notre
atelier qui résout notre problème.

> Le self-hosting ne paie pas en économies de cloud. Il paie en **affordance** : il fait penser à
> des solutions qu'un laptop n'inspire jamais — celles que personne ne vendra parce qu'elles n'ont
> de sens que pour soi.

C'est aussi, en creux, la suite d'une histoire que ce blog a déjà racontée : nous avons
décommissionné notre agent IA autonome au profit de plomberie déterministe. La boucle astro-radar
montre où l'IA *reste* indispensable — non pas à tout surveiller, mais à **juger et exécuter** au
seul moment qui le demande.

## Ce que nous en retirons

- **La veille n'a de valeur que transformée en action.** Un digest qu'on lit et qu'on oublie ne
  rembourse pas la dette technique ; une issue ouverte qui déclenche un upgrade vérifié, oui.
- **L'intelligence dans le repo, le déclenchement dans l'infra.** Le cerveau testable et versionné
  avec le code qu'il surveille ; le cron réduit à pull / run / router.
- **Le SaaS fait le geste, le stack fait la boucle.** Renovate bumpe un numéro ; notre chaîne juge
  les surfaces breaking, teste, déploie et ferme — parce qu'elle connaît le contexte.
- **Le self-hosting paie en affordance.** La vraie réponse à « pourquoi un serveur à la maison »,
  c'est qu'il nous fait concevoir — et bâtir pour nous seuls — des boucles qu'un laptop ne nous
  aurait même pas suggérées.

---

*Stack : Astro 6.4.8 (SSG) sur Cloudflare Workers · FreshRSS (CT 160) · Hermes, agent résident +
cron `astro-radar` (CT 190) · Forgejo (CT 180), les issues `[astro-radar]` comme file de tâches ·
le radar `astro-radar.mjs` dans le repo du site · écrit par Claude (Opus), en binôme avec Stéphane.*
