---
title: "Tuer les faux positifs : un SAST LLM où une seconde IA réfute la première"
date: 2026-06-28T20:30:00
draft: false
tags: ["ia-locale", "llm", "securite", "sast", "audit-code", "hugging-face", "zerogpu", "outlines", "agents", "defensif"]
summary: "Demande à un LLM de trouver les vulnérabilités d'un bout de code et il t'en trouvera — trop. Des injections SQL sur des requêtes déjà sûres, des failles sur du code mort. Le vrai se noie dans le bruit, et on finit par tout ignorer. Notre deuxième Space Hugging Face attaque ce problème de front : une passe détecte large, une seconde passe *adversariale* essaie de réfuter chaque trouvaille. Ce qui survit est réel, et arrive avec un exploit. Voici comment, et le faux pas de calibrage qui a failli tout fausser."
---

Demande à un modèle de langage de *« trouver les vulnérabilités »* dans un bout de code, et il fera trop bien son travail. Il signalera une injection SQL sur une requête déjà paramétrée, une XSS sur du code jamais appelé, une faille plausible mais inexploitable. C'est le mal chronique du SAST — l'analyse statique de sécurité — et il empire avec les LLM, qui ajoutent leur propre tendance à halluciner. Le résultat : une liste où les vraies failles se noient sous les fausses. Et un développeur noyé sous les fausses alertes apprend vite à toutes les ignorer, y compris la seule qui comptait.

Après notre [premier Space](https://blog.pixelium.win/forcer-un-llm-a-respecter-un-schema) — celui qui force un LLM à respecter un schéma JSON — nous voulions un deuxième qui parle à notre cœur de métier : la **sécurité défensive**. Et un audit de code qui ne crie pas au loup à chaque ligne, ça, c'est un vrai sujet.

## L'idée : faire réfuter la machine par elle-même

Le principe tient en une phrase :

> **Ce qui survit à l'attaque est réel.**

Concrètement, deux étages :

1. **Détecter.** Un modèle de code lit le fichier et liste les vulnérabilités *candidates*. Volontairement large — on préfère un faux positif ici qu'une vraie faille manquée.
2. **Réfuter.** Pour *chaque* candidate, un second passage joue l'avocat du diable : *« montre un input concret qui exploite ça — ou prouve que c'est neutralisé (entrée validée, code mort, garde en place) »*. Si la faille résiste, elle est **confirmée**, avec sa preuve d'exploitation. Si elle se fait démonter, elle disparaît.

Et comme pour le premier Space, **l'interrupteur est la démo**. *Verify OFF* montre la détection brute : une liste longue, faux positifs inclus. *Verify ON* lance la réfutation, et le bruit meurt à l'écran. On *voit* la différence.

Bonne nouvelle de chantier : tout le squelette technique du premier Space se réutilisait tel quel — ZeroGPU pour le GPU à la demande, et **Outlines** pour contraindre la sortie des deux étages à un schéma JSON strict (`Candidate`, puis `Verdict`). Le Space #1 avait défriché ; le #2 n'avait qu'à poser un nouveau modèle de code et la boucle à deux passes par-dessus.

## Le faux pas : un sceptique trop zélé ne sert à rien

Première version du réfuteur, première leçon. Nous lui avions donné une consigne qui semblait sage : *« pars du principe que c'est un faux positif jusqu'à preuve du contraire »*. Sur le papier, c'est exactement l'esprit d'une vérification adversariale.

En pratique, il a **tout** démoli. Sur un extrait piégé contenant une vraie injection de commande — un `os.system("ping -c 1 " + host)` avec un `host` qui vient direct de l'utilisateur — le réfuteur a haussé les épaules : *« faux positif »*. Il s'est convaincu, à grand renfort de raisonnement bancal, que le paramètre n'était pas vraiment dangereux. Un audit qui ne confirme jamais rien est aussi inutile qu'un audit qui crie au loup en permanence — c'est juste le bruit inverse.

> Un avocat du diable qui plaide la relaxe pour *tous* les accusés ne rend pas la justice. Il faut un sceptique, pas un négationniste.

Le correctif a été de **calibrer** la consigne plutôt que de la biaiser. Le nouveau réfuteur tranche dans les deux sens : il **confirme** quand une entrée non fiable atteint un *sink* dangereux sans validation — et il doit alors fournir un exploit concret ; il **réfute** quand l'entrée est validée, le code inatteignable, ou une garde présente. Sceptique, mais pas aveugle.

Le résultat sur l'extrait piégé, après calibrage, est exactement le contraste qu'on cherchait :

- l'injection SQL apparente — `"SELECT … WHERE id = " + str(uid)` — est **réfutée**, parce que `uid` est passé par `int()` deux lignes plus haut : aucune injection possible ;
- l'injection de commande est **confirmée**, avec son exploit : `host = "example.com; rm -rf /"`.

Un faux positif et une vraie faille, dans le même fichier, triés correctement, côte à côte.

## Répéter sur la 3090, jouer sur le H200

Même méthode que pour le premier Space, et elle a encore payé : tout le moteur a été éprouvé en local sur la **RTX 3090 de Stéphane** avant le moindre déploiement. C'est là qu'on a vu le réfuteur déraper, c'est là qu'on l'a recalibré. Une fois le comportement juste, l'enrobage ZeroGPU n'a été qu'une formalité — déploiement réussi du premier coup, comme le précédent.

La 3090 répète, le H200 de ZeroGPU joue la représentation. Le compute lourd reste à la maison ; la vitrine vit chez l'hébergeur, sans jamais exposer quoi que ce soit de notre infrastructure.

## Ce que ça donne

[Le Space est en ligne](https://huggingface.co/spaces/Ferr0/adversarial-sast). On colle du code, on choisit le langage, on audite. En *OFF*, la liste brute — l'injection SQL inoffensive y figure comme une vraie menace, exactement comme un scanner naïf le ferait. En *ON*, la réfutation passe : la fausse alerte se barre avec sa justification, la vraie reste avec son exploit.

Ce n'est pas un outil de production — c'est une **démonstration de principe**, et un petit modèle de 7 milliards de paramètres se trompe encore parfois. Mais le principe, lui, est solide, et c'est exactement celui que nous appliquons pour auditer ce site : ne rapporter que ce qu'on peut exploiter. Le Space rend visible, en public et de façon générique, une discipline qu'on pratique en privé.

Il complète aussi joliment notre [bac à sable d'injection de prompt](/breach) : là, on *attaque* une IA ; ici, on *défend* du code. Les deux faces de la même pièce.

## Ce que nous en retirons

- **La vérification adversariale, c'est de la calibration, pas du biais.** Un sceptique réglé trop fort produit des faux négatifs — il rate les vraies failles. Le bon réglage tranche dans les deux sens et exige une *preuve* pour confirmer comme pour réfuter.
- **Un second Space coûte une fraction du premier.** Le moule (ZeroGPU, Outlines, validation locale) était déjà là. L'essentiel du travail neuf, c'était la logique métier — les deux passes et leurs consignes.
- **Le contraste est le meilleur argument.** Montrer la détection brute *à côté* de la version vérifiée prouve la valeur mieux que n'importe quelle promesse. Le même ressort que pour le premier Space : un interrupteur qui rend le bénéfice tangible.
- **Sortir une discipline interne, génériquement.** Le principe « ne rapporte que l'exploitable » vivait dans nos outils d'audit privés ; il devient une pièce de portfolio publique, sans rien dévoiler de l'infrastructure.

Auditer du code avec un LLM, tout le monde sait le faire en une ligne de prompt. Le faire de manière à ce que la sortie soit *digne de confiance* — voilà le vrai travail. Et il tient, là aussi, sur une 3090 pour répéter et un GPU à la demande pour la scène.

---

*Stack : Gradio + ZeroGPU (H200) sur Hugging Face Spaces · Qwen2.5-Coder-7B-Instruct · Outlines (schémas `Candidate` / `Verdict` → grammaire) · transformers + `@spaces.GPU` · audit à deux passes (détection puis réfutation adversariale) · moteur éprouvé sur RTX 3090 avant déploiement · écrit par Claude (Opus), en binôme avec Stéphane.*
