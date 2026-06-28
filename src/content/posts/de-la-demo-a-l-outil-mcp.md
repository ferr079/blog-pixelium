---
title: "De la démo à l'outil : brancher un Space Hugging Face sur le protocole MCP"
date: 2026-06-28T23:00:00
draft: false
tags: ["ia-locale", "llm", "mcp", "hugging-face", "gradio", "agents", "zerogpu", "tool-use", "outillage"]
summary: "Nous avions deux démos sur Hugging Face — un extracteur de JSON sous contrainte et un auditeur de code adversarial. Jolies, mais passives : on les regarde, on clique. La vraie question est venue après : et si un agent pouvait les appeler tout seul ? C'est exactement ce que permet le MCP. Voici comment nous avons transformé deux Spaces Gradio en outils invocables depuis le terminal — avec le faux pas qui a planté l'un d'eux, et le moment où la vitrine est devenue un atelier."
---

Nous venions de mettre deux démos en ligne sur Hugging Face : l'une [force un modèle à produire du JSON conforme à un schéma](https://blog.pixelium.win/forcer-un-llm-a-respecter-un-schema), l'autre [audite du code en démolissant ses propres faux positifs](https://blog.pixelium.win/tuer-les-faux-positifs-sast-llm). Elles fonctionnent, elles sont cliquables — et c'est là que le bât blesse. Une démo, ça se regarde. On ouvre la page, on tape un texte, on admire le résultat, on ferme l'onglet.

La question qui change tout est venue ensuite : **et si nos agents pouvaient s'en servir, eux ?** Pas un humain qui clique, mais l'agent Hermes qui audite un bout de code au passage, ou une chaîne de traitement qui a besoin d'un JSON propre. Transformer la vitrine en atelier.

> Une démo, on la regarde. Un outil, on l'appelle. Le MCP, c'est le passage de l'un à l'autre.

## Le MCP, en deux mots

Le **Model Context Protocol** est devenu le langage commun par lequel un agent appelle des outils externes — une prise standard entre un assistant et le monde. Nous en *consommons* déjà plusieurs côté infra (Proxmox, Forgejo, Cloudflare). Cette fois, l'idée était de passer de l'autre côté du comptoir : **exposer nos propres Spaces comme outils**, pour que n'importe quel client MCP puisse les invoquer.

Bonne surprise : Gradio — la brique sur laquelle tournent nos deux Spaces — sait faire serveur MCP nativement. Chaque fonction branchée à l'interface peut devenir un outil, avec son schéma de paramètres. En théorie, il n'y a presque rien à faire.

En pratique, il y a eu trois détails à apprendre — dont un qui a mis un Space à terre.

## Activer : une variable

Premier geste, indolore. Une variable d'environnement sur le Space — `GRADIO_MCP_SERVER=True` — et Gradio expose un point de terminaison MCP en plus de l'interface web. Pas de rebuild, un simple redémarrage. Le Space sert maintenant les deux : la page que voit un humain, et la prise que voit un agent.

Premier coup d'œil au schéma exposé : ça marche… mais c'est moche. Les outils sont là, sans la moindre **description**. Et pire, une fonction parasite traîne dans la liste — le petit gestionnaire qui montre ou cache un champ quand on change de menu déroulant, du pur décor d'interface, propulsé au rang d'outil.

## Mais un outil sans notice ne sert à rien

Pour un humain, une fonction sans docstring, c'est un détail. Pour un agent, c'est rédhibitoire :

> Pour un agent, la docstring n'est pas du confort — c'est la notice. Sans elle, l'outil existe, mais personne ne sait *quand* s'en servir.

Nous avons donc écrit de vraies docstrings — une phrase de description, puis chaque paramètre annoté. Gradio les lit et en fait la description du tool et de ses arguments. Le schéma MCP est passé d'une coquille vide à une fiche d'outil propre : *« Extract structured data from free text as JSON that conforms to a schema… »*, avec le détail de chaque champ.

Restait à virer le gestionnaire d'interface de la liste des outils. Et c'est là que ça a cassé.

## Le faux pas : un mot-clé fantôme

Pour exclure une fonction de l'API — et donc du MCP — le réflexe était `show_api=False` sur l'événement. Logique, lisible, faux. En Gradio 6, ce paramètre n'existe pas sur un événement : au démarrage, le Space a levé un `TypeError: ... got an unexpected keyword argument 'show_api'` et a basculé en **RUNTIME_ERROR**. Démo à terre.

Le diagnostic est venu des logs d'exécution du Space, pas d'une intuition — la trace nommait la ligne fautive sans ambiguïté. Le bon levier, c'est **`api_name=False`** : Gradio l'accepte et retire l'événement de la surface exposée. Un test ciblé en local pour confirmer le mot-clé, un redéploiement, et le gestionnaire d'interface a disparu du schéma. Plus qu'un outil par Space, propre.

> Un seul mauvais argument — `show_api` au lieu de `api_name` — et le Space refuse de démarrer. Gradio 6 ne pardonne pas le mot-clé fantôme.

## Côté client

Reste à brancher un client. Le serveur MCP officiel de Hugging Face s'ajoute en une commande (`claude mcp add`), avec une authentification OAuth au premier usage. Il apporte d'office les outils du Hub — recherche de modèles, de datasets, de Spaces — et, surtout, **les Spaces qu'on a déclarés dans ses réglages MCP**.

Un dernier piège, vite levé : l'opération de *découverte* du serveur ne liste qu'une galerie par défaut (génération d'image, OCR, synthèse vocale…). Nos deux Spaces de texte n'y figurent pas — mais ils sont **invocables par leur identifiant**. Une fois ce détail compris, l'inspection des paramètres et l'appel répondent sans broncher.

## Ce que ça donne

Depuis le terminal, sans ouvrir un navigateur, nous avons demandé une extraction sur une fausse offre d'emploi — *Senior DevOps chez CloudPeak, full remote, Python/Terraform/AWS, 80-100k USD* — et l'outil a renvoyé, en six secondes :

```json
{ "title": "Senior DevOps Engineer", "company": "CloudPeak", "remote": true,
  "seniority": "senior", "skills": ["Python","Terraform","AWS"],
  "salary": { "min": 80000, "max": 100000 } }
```

Puis nous avons lancé l'auditeur de code sur l'extrait piégé : il a **confirmé** l'injection de commande (avec son exploit) et **réfuté** la fausse injection SQL — exactement comme dans la démo, mais appelé comme une fonction, par un agent, depuis une ligne de commande.

> La même démo qu'un visiteur clique, un agent peut désormais l'appeler. La vitrine est devenue un atelier.

## Ce que nous en retirons

- **Une démo n'a pas à rester passive.** Le MCP la promeut en brique réutilisable *sans la réécrire* — la même fonction sert l'humain qui clique et l'agent qui l'invoque.
- **Les détails *sont* l'outil.** La docstring devient la notice que lit l'agent ; un mot-clé fantôme (`show_api`) met le Space à terre ; un gestionnaire d'interface oublié pollue la liste des outils. Le branchement est trivial ; la propreté ne l'est pas.
- **Le portfolio rejoint l'outillage.** Ce que nous *montrons* devient ce dont nos agents se *servent*. La frontière entre la démo et la production s'efface — et c'est tout l'intérêt.
- **C'est solide, le modèle reste faillible.** L'outil MCP hérite des limites du petit modèle derrière (un 3B se trompe encore parfois). Mais la prise, elle, tient : un agent peut compter dessus.

On bâtit des vitrines pour montrer ce qu'on sait faire. On découvre qu'avec une variable d'environnement, quelques docstrings et le bon mot-clé, ces vitrines se mettent à *travailler* — pour nous, et pour les agents qu'on assemble autour d'elles.

---

*Stack : Gradio 6 (`GRADIO_MCP_SERVER`, `api_name=False` pour exclure un événement) · Model Context Protocol · serveur MCP Hugging Face (`hf-mcp-server`, OAuth) · 2 Spaces ZeroGPU H200 (Qwen2.5-3B + Outlines ; Qwen2.5-Coder-7B) · Claude Code comme client MCP · diagnostic via les logs d'exécution du Space · écrit par Claude (Opus), en binôme avec Stéphane.*
