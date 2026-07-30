# blog.pixelium.win

Blog technique documentant la construction d'un homelab auto-hébergé de **62 services** sur 4 nœuds Proxmox. Écrit en français, construit avec Astro 7, déployé sur Cloudflare Workers.

**[blog.pixelium.win](https://blog.pixelium.win)** | **[pixelium.win](https://pixelium.win)**

## Contenu

**42 articles publiés** (mars → juillet 2026), plus les brouillons. La liste à jour vit sur le site — elle n'est pas recopiée ici, un index figé dans un README se périme dès la publication suivante :

- **[blog.pixelium.win](https://blog.pixelium.win)** — index chronologique
- **[/rss.xml](https://blog.pixelium.win/rss.xml)** — flux complet
- **[/tags](https://blog.pixelium.win/tags)** — navigation par thème

Thèmes principaux, par volume : `homelab` (30) · `ia` (12) · `securite` (9) · `claude-code` (8) · `automatisation` (8) · `cloudflare` (6) · `web` · `llm` · `astro` · `reseau` · `postmortem`.

Beaucoup d'articles sont des **post-mortems** : une panne réelle, ce qu'elle a coûté, et ce qui a été corrigé. C'est la ligne éditoriale — pas des tutoriels génériques.

## Stack

| Couche | Technologie |
|---|---|
| Framework | Astro 7 (SSG) |
| Contenu | Content Collections, `md` + `mdx` |
| Hébergement | Cloudflare Workers |
| Langue | Français |
| Fonctionnalités | Flux RSS, navigation par tags, sommaire collant, barre de progression de lecture, temps de lecture calculé |
| Design | Hérité de pixelium.win (palette, polices, éléments terminal) |
| CI/CD | GitHub Actions → `wrangler deploy` |

## Structure

```
src/
  content/posts/     — les articles (md/mdx), une collection Astro
  content.config.ts  — schéma du frontmatter (zod)
  pages/             — index, [slug], tags/index, tags/[tag], 404
  components/        — ArticleCard · Nav · Footer · TableOfContents · PrevNext · FalkenNote
  layouts/           — gabarits de page
  utils/             — reading-time.ts
public/              — favicon, _headers (CSP, HSTS)
```

## Ajouter un article

Un fichier dans `src/content/posts/`, nommé d'après son slug (`mon-article.md`). Frontmatter validé par zod au build — un champ manquant casse le build, c'est voulu :

```yaml
---
title: Titre de l'article
date: 2026-07-30          # coercé en Date
tags: [homelab, securite] # tableau, obligatoire
summary: Résumé affiché sur l'index et dans le flux RSS.
cover: /images/xxx.webp   # optionnel
draft: false              # défaut false ; true = exclu du build
---
```

`mdx` n'est utilisé que lorsqu'un article a besoin de composants — sinon `md` suffit.

> ⚠️ **Un bump de la chaîne markdown** (`@astrojs/mdx`, remark, rehype) ne se valide pas au build vert : une chaîne cassée produit des pages qui **répondent 200 mais sont vides**. Contrôler qu'aucune page rendue ne fait moins de 2 Ko, et compter les `h2`/`p`/`pre` dans un article.

## Déploiement

Push sur `main` → GitHub Actions → `wrangler deploy`.

> ⚠️ **Le blog déploie depuis `dist/client/wrangler.json`**, contrairement au site qui utilise `dist/server/wrangler.json`. Un `npx wrangler deploy --dry-run` sans `-c` suffit ici — copier la commande du runbook du site échoue.

## Licence

MIT
