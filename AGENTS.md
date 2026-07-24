# AGENTS.md — blog-pixelium : audit sécurité en lecture seule

Cadre les **agents d'audit externes** (Codex CLI et assimilés) invoqués depuis **ce repo**.

```bash
cd ~/Claude/web/blog-pixelium && codex --profile web-audit
```

## Périmètre — ce repo, rien au-dessus

Le dossier parent `~/Claude/web/` est un **repo parapluie privé** (autres sous-repos +
`projets/`, jamais publié). **Ne remonte pas** au-dessus de la racine de ce repo. Le site
principal (`pixelium.win`) est un repo et un Worker séparés : il s'audite depuis son propre
dossier, pas d'ici.

## Conduite

Lecture seule — le sandbox `read-only` l'impose, ne cherche pas à le contourner. Décris les
correctifs, ne les applique pas. Aucun secret ne vit dans ce working tree ; si tu en trouves
un, c'est un P0 — signale-le sans recopier la valeur.

## Surface réelle : petite, et c'est le point

Contrairement au site, ce Worker ne sert **que des assets statiques** :
`[assets] directory = "dist"`, **aucun KV, aucune D1, aucun binding AI, aucun secret, aucun
endpoint API**. L'audit doit être proportionné — il n'y a pas de logique applicative à
attaquer. Concentre-toi sur :

1. **Les headers** (`public/_headers`) — créés le 24/07 en réponse au finding P1 de l'audit
   `pixelium/web#18` (le blog n'en avait aucun). Ils n'ont **jamais été audités depuis leur
   création**. La CSP porte `script-src 'self' 'unsafe-inline'` et `style-src` idem : ce
   `'unsafe-inline'` est-il réellement nécessaire pour un blog statique, ou est-ce un copier-
   coller du site (où il est un trade-off Astro assumé) ? Vérifie aussi la cohérence avec les
   origines réellement utilisées (`fonts.bunny.net`, `cdn.simpleicons.org`).
2. **Les dépendances** — `astro`, `@astrojs/{mdx,rss,sitemap,cloudflare}`, `wrangler` en dev.
   Le site a reçu un bump de vulnérabilités transitives (`b7add53`) que **ce repo n'a pas eu** ;
   son `wrangler` est en retard sur celui du site. Écart à qualifier : exploitable ou tooling
   sans impact runtime ?
3. **MDX et RSS** — les posts sont en `.md`/`.mdx`. MDX autorise du HTML brut et du JSX
   évalué au build : quelle est la surface si un post contient du markup hostile ? Le flux RSS
   échappe-t-il correctement le contenu (`@astrojs/rss`) ?
4. **`nodejs_compat`** — le flag est activé dans `wrangler.toml` pour un site purement
   statique. Justifié, ou surface de compatibilité élargie sans usage ?

**3 commits** sont passés depuis l'audit du 24/07 (headers, puis `ci.yml` et `deploy.yml` en
parité avec le site) — la chaîne CI mérite le même regard que le contenu.

## Ce qu'on n'attend pas

Ne redemande pas de fusionner ce repo dans `pixelium-site` : la fusion applicative a été
évaluée et **écartée le 2026-07-23** (`pixelium/web#5`) — coût des redirections 301 sur 43
URLs indexées, re-émission du flux RSS, absorption du pipeline, pour un bénéfice résiduel.
La cohérence « un seul produit » est portée au niveau de l'org Forgejo.

## Format

**Problème · Pourquoi ça compte · Correctif suggéré**, avec `fichier:ligne`, priorisé par
gravité. Un axe couvert sans finding : dis-le explicitement plutôt que de meubler.
