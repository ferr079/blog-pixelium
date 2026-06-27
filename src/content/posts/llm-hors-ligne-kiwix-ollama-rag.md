---
title: "Un LLM hors-ligne qui cite ses sources : on a branché Ollama sur Kiwix"
date: 2026-06-28
draft: false
tags: ["self-hosting", "ia-locale", "rag", "ollama", "kiwix", "offline", "llm", "homelab", "souveraineté"]
summary: "Un modèle qui tourne sur notre RTX 3090 a un défaut structurel : ses poids sont figés au jour de son entraînement. Coupez Internet et il raisonne encore très bien, mais il devient incertain sur les faits. Nous avions déjà les deux moitiés de la réponse sous la main — une bibliothèque ZIM servie par Kiwix, et Ollama sur le GPU. Voici comment nous les avons branchées l'une sur l'autre pour obtenir un assistant qui sait des choses justes, sans le moindre paquet qui sort du LAN. Avec les deux faux pas qui nous ont coûté l'après-midi."
---

Un grand modèle de langage qui tourne en local a un défaut qu'on oublie vite : ses poids sont **figés au jour de son entraînement**. Tant qu'on lui demande de raisonner, de reformuler, de structurer, il est excellent. Mais dès qu'il faut un fait précis — la bonne option d'une commande, le numéro d'un port, la syntaxe exacte d'un fichier de conf — il répond avec l'aplomb de quelqu'un qui n'a pas relu depuis deux ans. Et hors-ligne, il n'a aucun moyen de vérifier.

Nous voulions autre chose : un assistant qui marche **vraiment** hors-ligne. Pas seulement « qui s'exécute en local » — ça, Ollama le fait depuis longtemps — mais « qui *sait des choses justes* sans réseau ». La nuance est toute la différence entre un cerveau brillant enfermé dans une pièce sans fenêtre, et le même cerveau avec une bibliothèque au mur.

Et la bonne surprise, c'est que nous avions déjà les deux moitiés de la réponse sous la main.

## Les deux moitiés

D'un côté, **Kiwix** (CT 152, sur le nœud à la demande). Kiwix sert des archives **ZIM** : des paquets compressés et indexés de sites entiers, consultables sans Internet. Au moment où nous écrivons, le serveur en expose **62** — Wikipédia, les questions-réponses de Stack Exchange, de la documentation technique. Des gigaoctets de savoir, déjà là, déjà interrogeables par une simple requête HTTP.

De l'autre, **Ollama** sur la workstation de Stéphane : Qwen3.6, Gemma, quelques variantes spécialisées, tout ça sur la RTX 3090. Du raisonnement local, zéro token cloud.

L'idée tient en une phrase : **et si le modèle pouvait fouiller la bibliothèque lui-même ?** C'est du RAG — *retrieval-augmented generation* — mais avec une particularité qui change tout : le corpus est **100 % local**. Les ZIM deviennent la mémoire externe du modèle. Là où le RAG d'entreprise branche un LLM sur les documents internes d'une boîte, nous le branchons sur une encyclopédie hors-ligne. Le modèle arrête d'être une photographie de l'Internet à une date donnée ; il devient un lecteur qui sait où chercher.

Sur le papier, une demi-journée. En pratique, deux pièges nous ont mangé l'après-midi — et tous les deux étaient dans les détails d'API, pas dans l'idée.

## Faux pas n°1 : l'API qui répond 400

Premier réflexe : interroger Kiwix à la main pour comprendre son moteur de recherche. L'endpoint est `/search`. On lui passe une requête, un livre cible… et on reçoit un **HTTP 400**, sec.

La documentation suggère de cibler un livre avec `books.name`. Sauf que `books.name` attend le **nom de fichier** du ZIM, pas le nom court qu'expose le catalogue OPDS — deux identifiants différents pour la même archive, et rien ne le dit clairement. Le bon levier, finalement, c'est **`books.filter.lang`** : on filtre par langue (une seule par requête — donc une passe pour l'anglais, une pour le français si besoin), et on demande la réponse en `format=xml`. Là, surprise : `/search` ne renvoie pas du JSON mais un **flux RSS** — des `<item>` avec `<title>`, `<link>`, `<description>`. Une fois ce détail digéré, le reste déroule : chaque résultat pointe vers le contenu réel de l'article, récupérable sur `/content/<zim>/<article>`.

> La doc dit *quoi* appeler. Elle ne dit pas toujours *avec quel identifiant*. C'est en envoyant des 400 qu'on apprend la différence entre le nom qu'un humain lit et le nom qu'une machine attend.

## Faux pas n°2 : le modèle qui refuse de se servir de l'outil

Pour que ce soit un vrai agent — et pas nous qui collons des résultats de recherche dans un prompt — il fallait que le modèle décide **lui-même** quand fouiller. C'est le rôle du *tool-calling* : on déclare un outil `kiwix_search`, et le modèle l'appelle quand une question dépasse ses poids.

Premier essai, en passant par notre passerelle LiteLLM avec le provider `ollama/`. Résultat : contenu vide, **zéro** appel d'outil. Le modèle ne « voyait » pas l'outil du tout.

La cause est discrète : le provider `ollama/` de LiteLLM est l'intégration *historique*, et elle **ne porte pas le tool-calling natif**. La réponse arrive bien, mais le mécanisme de function-calling est silencieusement perdu en route. Le correctif a été d'ajouter — en additif, sans rien casser — le provider **`ollama_chat/*`** dans la configuration LiteLLM, qui lui transmet correctement les outils. Clé virtuelle re-scopée, et le modèle s'est mis à appeler `kiwix_search` de lui-même.

> Deux intégrations pour la même brique, un nom à un caractère près, et l'une sait faire ce que l'autre ne fait pas. « Ça marche » et « ça marche avec les outils » ne sont pas la même case à cocher.

## Ce que ça donne

Le script qui orchestre tout — une boucle d'agent d'une poignée de lignes — fait ceci : le modèle reçoit l'outil `kiwix_search` ; face à une question factuelle, il l'appelle, lit les résultats, va chercher le contenu réel de l'article, et **répond en citant sa source**. Tout transite par LiteLLM avec une clé virtuelle scopée strictement en local et plafonnée — la ceinture et les bretelles, même quand rien ne sort.

La démo qui nous a fait sourire : *« comment bloquer un port avec iptables ? »*. Le modèle interroge Kiwix, tombe sur une réponse **Server Fault** archivée dans un ZIM, et répond :

```
iptables -A INPUT -p tcp --dport <port> -j DROP
```

…avec la source citée. Et le point qui compte : **aucun paquet n'a quitté le réseau local.** Pas une requête vers un cloud, pas un appel d'API tiers. Le savoir était déjà là, sur un disque, dans la maison ; le modèle a juste appris à aller le chercher.

C'est un bibliothécaire, pas une encyclopédie. La distinction n'est pas cosmétique : une encyclopédie figée se périme ; un bibliothécaire qui sait consulter ses rayons reste utile tant que les rayons sont à jour — et un ZIM, ça se met à jour d'un téléchargement, sans toucher au modèle.

## Ce que nous en retirons

- **Le RAG ne sert pas qu'à brancher un LLM sur les données d'une entreprise.** Ici, il sert à le sortir de l'amnésie de sa date d'entraînement, avec un corpus qu'on **possède** — pas qu'on loue.
- **L'offline n'est pas une contrainte, c'est une garantie.** Pas de fuite de la question, pas de dépendance à un fournisseur, pas de coût au token. La souveraineté tenue jusqu'au dernier maillon de la chaîne — exactement la même logique que le reste de notre infra, poussée à l'IA.
- **Les frictions étaient dans les détails, pas dans l'idée.** Un sélecteur de livre mal nommé, un provider qui avale le tool-calling : deux pièges d'API qui ne se devinent pas, seulement se rencontrent. Lire la doc *et* tester — parce que la doc seule, parfois, ment par omission.
- **C'est un POC, pas un produit.** La suite est tracée : passer du *full-text* à du **RAG dense** (embeddings locaux + base vectorielle pour ranger les passages par sens, pas par mots-clés), et brancher Kiwix comme moteur de recherche directement dans notre Open WebUI. Mais la preuve est faite : un assistant utile, sourcé et entièrement hors-ligne, ça tient sur une RTX 3090 et un disque d'archives.

Un modèle local, on le choisissait jusqu'ici pour la confidentialité et le coût. On découvre qu'on peut aussi le rendre **plus juste** — sans le réentraîner, sans le connecter à quoi que ce soit. Juste en lui ouvrant une bibliothèque qu'on garde, nous, sous la main.

---

*Stack : Kiwix (serveur ZIM, API `/search` en RSS + `/content`) · Ollama sur RTX 3090 (Qwen3.6 27B quantisé) · LiteLLM (provider `ollama_chat/*` pour le tool-calling, clé virtuelle scopée offline) · agent tool-calling maison en Python · 62 archives ZIM (Wikipédia, Stack Exchange, docs) · le tout sur un nœud Proxmox à la demande, zéro paquet hors du LAN · écrit par Claude (Opus), en binôme avec Stéphane.*
