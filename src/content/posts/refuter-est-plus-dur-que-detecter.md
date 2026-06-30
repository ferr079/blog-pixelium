---
title: "Réfuter est plus dur que détecter : notre SAST passe au dépôt entier"
date: 2026-06-29T20:00:00
draft: true
tags: ["llm", "securite", "sast", "audit-code", "hugging-face", "hf-inference", "zerogpu", "agents", "defensif", "qwen"]
summary: "Notre deuxième Space auditait un bout de code collé à la main. Le faire avaler un dépôt entier de vrai code a révélé trois murs — et le plus dur n'était pas de trouver les failles, mais de juger lesquelles sont réelles. Un détective myope qui rate ce qui est loin, un juge qui acquitte une vraie faille parce qu'un `file_exists()` l'a rassuré, puis un juge qui condamne tout le monde. Comment on a réglé les trois, chiffres à l'appui : une vraie LFI confirmée, et un taux de fausses alertes qui passe de 78 % à 6 %."
---

Notre [SAST adversarial](https://blog.pixelium.win/tuer-les-faux-positifs-sast-llm) — un modèle détecte les vulnérabilités, un second les réfute, et seul ce qui survit à l'attaque est rapporté — fonctionnait sur un *snippet* : du code collé à la main dans une zone de texte. C'est une démonstration de principe propre. Mais un audit qui s'arrête au presse-papier n'audite pas grand-chose. La vraie question, c'est : **est-ce que ça tient sur un dépôt entier, sur du vrai code que nous n'avons pas écrit ?**

Pour le savoir, il fallait un cobaye honnête. Nous avons pris **phpIPAM 1.8.1**, un gestionnaire d'adressage IP open-source qui traîne une LFI bien réelle (CVE-2026-12194) dans son point d'entrée d'API — et **DVWA**, le terrain d'entraînement où chaque faille existe en version vulnérable *et* en version corrigée. Du code public, vérifiable, avec une vérité terrain connue. Le banc d'essai idéal pour mesurer, pas pour se rassurer.

Trois murs nous attendaient. Aucun n'était celui qu'on croyait.

## Mur 1 — le détective qui ne voit pas loin

La LFI de phpIPAM est un cas d'école de *data-flow* long. L'entrée de l'attaquant — un paramètre `controller` qui vient de `$_GET` — arrive ligne 50. Le point dangereux — un `require_once()` qui construit son chemin à partir de ce paramètre — est ligne 236. **Près de 190 lignes** séparent la source du *sink*, avec un objet `$Params` qui fait passer la valeur de l'une à l'autre.

Notre détecteur local, un Qwen2.5-Coder de 7 milliards de paramètres, la **ratait** sur le fichier entier. Servie resserrée sur six lignes, il la voyait ; noyée dans 330 lignes, non. Un petit modèle a une fenêtre d'attention courte : il ne relie pas deux faits distants de 190 lignes.

La détection, elle, a besoin de voir large. Nous avons donc déporté **cet étage-là** vers un très gros modèle via **HF Inference** — Qwen3-Coder-480B — pendant que le reste de la machinerie restait inchangé. Le gros modèle suit le fil d'un bout à l'autre du fichier et sort la LFI sans hésiter. Première leçon : pour *trouver*, la taille du modèle compte, parce que trouver, c'est relier ce qui est loin.

## Mur 2 — le juge qui acquitte une vraie faille

Le détecteur trouvait enfin la faille. Et le réfuteur l'a aussitôt **rejetée**.

Son raisonnement : *« il y a un `file_exists()` avant le `require` — donc c'est protégé. »* C'est faux, et c'est un piège classique. Vérifier qu'un fichier existe ne dit rien du droit de le choisir : un `../../` vers n'importe quel `.php` présent sur le serveur passe le test sans peine.

> Un `file_exists()` vérifie qu'un fichier existe. Pas qu'on avait le droit de le choisir.

Le problème venait de notre propre consigne au réfuteur, qui rangeait *« une garde est présente »* parmi les motifs de relaxe — sans distinguer une garde qui **contraint la valeur** (une liste blanche, un cast en entier) d'une garde qui ne fait que **constater un état** (le fichier existe, la variable est définie). Nous avons réécrit la règle noir sur blanc : un contrôle d'existence ou de présence n'est pas une désinfection ; une entrée utilisateur qui entre dans un `include`/`require`, *même* préfixée d'un dossier, *même* suffixée en `.php`, *même* gardée par un `file_exists()`, reste exploitable. Avec, en prime, un contexte resserré autour de la ligne suspecte plutôt que le fichier entier — assez pour voir la désinfection locale, pas assez pour s'y perdre.

La LFI est repassée en **confirmée**, avec son exploit : `controller=../../../../etc/passwd`.

## Mur 3 — le juge qui condamne tout le monde

C'est là qu'on a touché le vrai sujet. Le premier scan complet d'un dépôt phpIPAM confirmait **132 vulnérabilités sur 169 candidates** — 78 %. Pour un outil dont toute la promesse est de *tuer les faux positifs*, c'est un aveu d'échec : un scanner qui valide quatre alertes sur cinq ne vaut pas mieux qu'un scanner qui crie au loup. On était juste revenus au bruit, par l'autre porte.

Le banc DVWA a rendu le diagnostic implacable. Ses fichiers `impossible.php` — requêtes préparées, listes blanches, validation stricte — sont l'archétype du code **sécurisé**. Notre réfuteur de 7 milliards de paramètres les confirmait **tous** comme vulnérables. Et aucune retouche de consigne n'y changeait rien : le petit modèle ne *reconnaît* tout simplement pas qu'une requête préparée neutralise une injection. Ce n'était pas un problème de prompt, mais de **capacité**.

> Détecter, c'est lever la main : « ici, peut-être ». Réfuter, c'est rendre un verdict. Et un verdict demande un meilleur juge qu'un simple signalement.

C'est l'enseignement le plus contre-intuitif de tout le chantier. L'intuition de départ disait : *détecter est dur (vue large, gros modèle) ; réfuter est facile (contexte ciblé, petit modèle suffit)*. C'est l'inverse. Réfuter, c'est porter un jugement de sécurité fin — créditer une vraie désinfection, démonter une fausse — et ça demande un modèle qui **comprenne le code**, pas seulement qui le lise.

Nous avons donc confié la réfutation à un modèle nettement plus capable, un Qwen2.5-Coder-32B, toujours via HF Inference. Le résultat se passe de commentaire : sur le même dépôt phpIPAM, le taux de confirmation tombe de **78 % à 6 %** (10 trouvailles sur 161 candidates). La LFI reste confirmée. Les trois `require_once` à chemin codé en dur — de vrais faux positifs — sont correctement réfutés. Le code sécurisé de DVWA est enfin reconnu comme tel.

Le 32B coûte environ le double du 7B par jugement. Pour un étage dont le métier est de dire le vrai du faux, c'est le meilleur euro qu'on dépense.

## Le détail qui tue les longs scans : le jeton ZeroGPU

Un dernier mur, plus sournois. Notre GPU à la demande — **ZeroGPU** — émet un jeton de réservation à courte durée de vie. Sur un scan de dépôt qui dure plusieurs minutes, ce jeton **expire en cours de route**, et la réfutation des fichiers suivants échoue silencieusement. Parfait pour un snippet de quelques secondes ; inadapté à un travail long.

La bascule des **deux** étages vers HF Inference a réglé le problème en passant : plus aucune réservation GPU dans le scan de dépôt, donc plus aucun jeton à expirer. ZeroGPU reste pour la démo interactive du snippet, là où sa latence faible brille ; le travail long, lui, part chez l'API d'inférence. Chaque outil à sa place.

## Ce que nous en retirons

- **Réfuter est plus dur que détecter, pas l'inverse.** Trouver une faille, c'est relier deux points — un gros modèle à large fenêtre le fait. Juger si elle est réelle, c'est comprendre une désinfection — et ça demande un juge encore plus solide. On a investi la puissance au mauvais endroit avant de corriger.
- **Un faux pas de consigne se mesure sur une vérité terrain, pas à l'œil.** Sans le banc DVWA — failles connues *et* corrections connues — nous aurions cru notre réfuteur calibré alors qu'il validait du code sûr. Le chiffre, 78 % puis 6 %, a tranché là où l'intuition se serait trompée.
- **Une garde n'est pas une désinfection.** `file_exists`, `isset`, une longueur — autant de contrôles qui rassurent sans rien neutraliser. La nuance entre *contraindre la valeur* et *constater un état* est exactement ce qui sépare une vraie alerte d'une fausse.
- **L'infrastructure dicte l'architecture.** Le jeton ZeroGPU qui expire n'est pas un bug, c'est une contrainte — et c'est elle, pas une préférence de design, qui a fini de pousser les deux étages vers l'API d'inférence.

Le Space [Adversarial SAST](https://huggingface.co/spaces/Ferr0/adversarial-sast) avale désormais un dépôt public entier : il clone, classe les fichiers par densité de zones sensibles, détecte large avec le gros modèle, et réfute fin avec le bon juge. Ce qu'il rapporte, on peut l'exploiter — et ce qu'il tait, il l'a démonté. C'est, toujours, la discipline qu'on s'applique à nous-mêmes pour auditer ce site, rendue publique et générique.

Reste un angle mort honnête : une validation *maison*, non standard — vérifier chaque octet d'une IP à la main, par exemple — peut encore tromper le juge. Le bon réglage n'est jamais fini. Mais entre un détective qui voit loin et un juge qui pèse juste, l'audit, lui, est enfin digne de confiance.

---

*Stack : Hugging Face Spaces · détection **Qwen3-Coder-480B** + réfutation **Qwen2.5-Coder-32B**, toutes deux via **HF Inference** · snippet sur **ZeroGPU** (H200) · sortie JSON contrainte (schémas `Candidate` / `Verdict`) · analyse statique seule, jamais d'exécution · bancs d'essai phpIPAM 1.8.1 (CVE-2026-12194) & DVWA · écrit par Claude (Opus), en binôme avec Stéphane.*
