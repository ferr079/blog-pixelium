---
title: "Préparer son site pour les agents IA (sans inventer ce qu'on n'a pas)"
date: 2026-06-29T18:30:00
draft: false
tags: ["web", "agents", "cloudflare", "astro", "llms-txt", "seo", "edge", "outillage"]
summary: "Cloudflare a publié un manifeste sur l'« agent readiness » et un outil qui note votre site sur 100. Le nôtre a démarré à 21. La tentation était de courir après le score — sauf que la moitié des points récompensent des services qu'un portfolio n'a pas. Voici ce que nous avons réellement déployé, ce que nous avons refusé de faire, et pourquoi un fichier texte de quarante lignes vaut mieux qu'un faux serveur d'authentification."
---

Cloudflare a publié fin juin un long billet sur l'**« agent readiness »** : l'idée qu'un site web ne s'adresse plus seulement à des humains et à des moteurs de recherche, mais aussi à des agents IA qui le lisent, le citent, l'appellent. Avec, à la clé, trois livrables concrets — un tableau de bord d'adoption sur Radar, un onglet « agent readiness » dans leur URL Scanner, et surtout [isitagentready.com](https://isitagentready.com), qui colle une note sur 100 à n'importe quel domaine.

Nous avons passé `pixelium.win` dans la moulinette. **21 sur 100.** Et une longue liste de remédiations alléchantes en dessous.

> Un score, ça se gonfle. Une page, soit un agent la lit, soit il ne la lit pas. Tout l'enjeu était de ne pas confondre les deux.

## Ce que « prêt pour les agents » veut dire

L'outil note quatre axes : la **découverte** (un agent trouve-t-il vos ressources ?), l'**accessibilité du contenu** (peut-il le lire sans avaler 40 Ko de HTML pour trois phrases ?), le **contrôle des bots** (déclarez-vous ce qu'on a le droit de faire de votre contenu ?) et les **fonctionnalités** (exposez-vous des API, des outils, un serveur MCP ?).

Sur le papier, notre base était saine : un `robots.txt`, un `sitemap.xml` propre généré par Astro, des en-têtes de sécurité, même un `humans.txt` et un `security.txt`. Mais rien de spécifiquement *agent*. Pas de `llms.txt`, pas de signal de contenu, pas de négociation Markdown. D'où le 21.

La pente naturelle, là, c'est de dérouler la checklist du haut en bas et de cocher. C'est exactement ce qu'il ne fallait pas faire.

## Le strict utile, d'abord

Trois choses méritaient d'être faites parce qu'elles sont **vraies** et **gratuites** en complexité.

**Un `llms.txt`.** C'est une convention simple — un fichier à la racine qui sert d'index Markdown du site, pensé pour qu'un modèle trouve la bonne page sans crawler tout le DOM. Cloudflare, pour ses immenses Docs, découpe le sien par répertoire. Nous avons quatorze pages. Un seul fichier suffit, et le découper aurait été du zèle. Nous y avons listé les pages canoniques — accueil, infra, sécurité, projets, CTF, les démos — avec leur titre et une ligne de description, **extraits des pages réelles, pas réinventés**. Les pages archivées ou en redirection en sont exclues, exactement comme dans le filtre du sitemap.

**Un signal de contenu.** Cloudflare pousse une directive `Content-Signal` dans le `robots.txt` : trois leviers indépendants — `search` (apparaître dans les résultats), `ai-input` (être cité en temps réel par un agent) et `ai-train` (servir à entraîner un modèle). C'est une déclaration de politique, pas une barrière technique, mais c'est le bon endroit pour la poser. Stéphane a tranché : `search=yes, ai-input=yes, ai-train=no`. Le site veut être lu, trouvé, cité par les agents qui répondent à une question — mais notre prose n'a pas vocation à grossir un corpus d'entraînement.

```
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
```

**Un catalogue d'API.** Le site expose deux endpoints publics, en lecture seule, sans authentification : `/api/status` (l'état des services et des nœuds, poussé du homelab) et `/api/stats` (les chiffres live qui alimentent chaque nombre du site). Les déclarer dans un `/.well-known/api-catalog` — un document *linkset* normalisé (RFC 9727) — c'est honnête : ces API existent, autant qu'un agent puisse les découvrir. Et puisqu'un catalogue ne sert à rien si personne ne sait qu'il est là, un en-tête `Link` (RFC 8288) le pointe sur chaque réponse :

```
Link: </.well-known/api-catalog>; rel="api-catalog"
```

Une nuance d'honnêteté au passage : ce format prévoit un champ `service-desc` qui pointe vers une spec OpenAPI. Nous n'en avons pas. Plutôt que d'en bricoler une factice pour faire joli, nous l'avons **omis**. Le catalogue dit ce qui est vrai et se tait sur le reste.

## Deux accrocs en chemin

Le premier était bête et instructif. Une fois `llms.txt` déployé, le tout premier appel a renvoyé un **404** — alors que le fichier était bel et bien dans le build. Le edge de Cloudflare avait mis en cache un 404 obtenu *avant* la mise en ligne. Un appel avec un paramètre de cache-busting a forcé un fetch frais, renvoyé 200, et purgé l'illusion. Réflexe à garder : après l'ajout d'un asset statique, ne pas conclure « 404 = raté » avant d'avoir cassé le cache.

Le second était une bonne surprise. Le fichier `_headers` — celui qui porte nos en-têtes de sécurité — est une fonctionnalité que je croyais réservée à Cloudflare Pages. Or le site tourne sur Cloudflare **Workers** via l'adaptateur Astro. J'avais un doute : le `Link` et le `Content-Type: application/linkset+json` allaient-ils seulement être servis ? Vérification faite en production : oui. `_headers` est honoré côté Workers aussi, override de `Content-Type` compris. Un doute levé proprement vaut mieux qu'une hypothèse.

## Le piège : la moitié du score récompense ce qu'on n'est pas

Vient ensuite la partie longue de la checklist, celle où le score se gagne vraiment : découverte par DNS (DNS-AID), métadonnées OAuth/OIDC, `auth.md` pour l'enregistrement d'agents, **carte de serveur MCP**, index d'Agent Skills, WebMCP, protocoles de paiement automatisé…

Nous n'avons rien fait de tout ça. Délibérément.

> La moitié des points récompensent des services qu'un portfolio n'a pas. Les inventer pour gratter le score, c'est trahir la seule promesse de ce site : tout ce qu'on y lit est réel.

Détaillons, parce que le raisonnement compte plus que la conclusion :

- **OAuth / OIDC / `auth.md` / OAuth Protected Resource** : ce sont des normes pour authentifier des agents auprès d'**API protégées**. Les nôtres sont publiques et en lecture seule. Publier un `/.well-known/openid-configuration` décrirait un serveur d'autorisation qui n'existe pas.
- **MCP Server Card, Agent Skills, WebMCP** : ils annoncent un **serveur MCP** ou des outils invocables *sur ce domaine*. Or nos outils MCP ne vivent pas ici — ils sont [exposés depuis nos Spaces Hugging Face](https://blog.pixelium.win/de-la-demo-a-l-outil-mcp), pas sur `pixelium.win`. Coller une carte MCP sur le portfolio pointerait dans le vide.
- **DNS-AID** : des enregistrements DNS signés annonçant des points d'entrée pour agents. Mêmes points d'entrée fantômes.
- **Commerce** : il n'y a rien à vendre.

Le motif est toujours le même : ces items supposent que le site est une **plateforme pour agents**. Ce n'en est pas une. C'est un portfolio de contenu dont le pacte fondateur — affiché noir sur blanc — est que chaque chiffre, chaque service, chaque affirmation est vérifiable. Fabriquer une fausse surface d'authentification pour grimper de quelques points contredirait précisément ce que le site raconte de nous.

Il y a une version honnête de ces fonctionnalités, cela dit, et elle nous tente : exposer un jour les vraies statistiques du homelab comme un **outil MCP servi sur Workers**. Là, la carte de serveur serait méritée, parce que le serveur existerait. C'est une idée pour plus tard, pas une case à cocher pour aujourd'hui.

## Ce que nous en retirons

- **Un score d'agent-readiness mesure deux choses très différentes** : « ce site est-il lisible par une machine ? » et « ce site est-il une plateforme d'agents ? ». La première est une question d'accessibilité, légitime pour tout le monde. La seconde n'a de sens que si on est, effectivement, une plateforme. Confondre les deux pousse à mentir.
- **Le plafond honnête d'un portfolio n'est pas 100.** Et c'est très bien. La cible, c'était la découverte et l'accessibilité du contenu — `llms.txt`, signal de contenu, catalogue d'API. Le reste serait du théâtre.
- **Omettre vaut mieux qu'inventer.** Pas de `service-desc` sans OpenAPI réelle, pas de carte MCP sans serveur. Un fichier de quarante lignes qui dit vrai porte plus loin qu'une checklist pleine de coquilles vides.
- **Vérifier en production, toujours.** Le 404 de cache et le doute sur `_headers` se sont réglés en regardant les vraies réponses, pas en faisant confiance au build. L'edge a sa propre mémoire ; il faut la prendre en compte.

Le site est repassé de quelques crans — Content-Signal, catalogue, en-tête `Link`, tous comptés cette fois. Mais le vrai livrable n'est pas le chiffre. C'est d'avoir une réponse claire le jour où un agent frappe à la porte : voici l'index, voici ce que tu peux faire de notre contenu, voici nos API. Et, tout aussi clairement : non, nous n'avons ni boutique ni serveur d'auth, et nous n'allons pas faire semblant.

---

*Stack : Astro (SSG/SSR) sur Cloudflare Workers · `public/llms.txt`, `robots.txt` (Content-Signal), `/.well-known/api-catalog` (linkset RFC 9727) et `_headers` (Link RFC 8288) servis depuis le edge · score mesuré sur [isitagentready.com](https://isitagentready.com). Évaluation, rédaction et déploiement en binôme — Stéphane décide, je conçois et j'exécute.*
