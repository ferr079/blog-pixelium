---
title: "Immich : déporter le ML sur un GPU distant via Podman CUDA"
date: 2026-04-14
tags: ["immich", "gpu", "cuda", "clip", "ocr", "homelab", "podman"]
summary: "10 000 images (memes, infographies, captures) indexées en quelques minutes au lieu de plusieurs heures, grâce à une RTX 3090 distante et un modèle CLIP multilingue de 4 Go."
---

## Le déclencheur

Stéphane a 10 000 images dans Immich. Mais ce ne sont pas des photos de vacances ou des portraits de famille. Ce sont des **memes, des infographies, des captures d'écran** — le genre de contenu que le modèle CLIP par défaut d'Immich ne sait pas indexer correctement.

Le modèle par défaut, `ViT-B-32__openai`, est le plus petit de la gamme : ~583 Mo, anglais uniquement, entraîné sur des photos "classiques". Taper "graphique des dépenses" ou "meme chat" dans la recherche Immich ne renvoyait rien de pertinent. Le modèle ne comprend ni le français, ni les compositions visuelles complexes des infographies.

Et ré-indexer 10 000 images sur le CPU d'un conteneur LXC, ça prendrait des heures. Voire des jours.

## Pourquoi pas Ollama ?

C'est une confusion courante, et nous l'avons eue aussi. Le homelab a déjà une RTX 3090 avec Ollama qui tourne en permanence sur terre2. Pourquoi ne pas simplement "utiliser Ollama" pour Immich ?

Parce que ce sont **deux mondes différents** :

| | Ollama | Immich ML |
|---|---|---|
| **Domaine** | LLM (génération de texte) | Vision par ordinateur |
| **Modèles** | Llama, Mistral, Qwen (GGUF) | CLIP, OCR, détection de visages (ONNX) |
| **Runtime** | llama.cpp | ONNX Runtime |
| **API** | Compatible OpenAI (`/v1/chat`) | API interne Immich (`/predict`) |
| **Tâche** | Comprendre et générer du texte | Encoder images + texte en vecteurs |

Les deux utilisent le GPU, mais pour des tâches radicalement différentes. On ne peut pas demander à Ollama de faire du CLIP, ni à Immich ML de générer du texte. Ils cohabitent sur la même carte, chacun dans son couloir de VRAM.

## L'architecture

Le problème de fond est simple : Immich tourne sur CT 214 (pve2), qui **n'a pas de GPU**. Et terre2, la workstation avec la RTX 3090 (24 Go), **n'est pas allumée 24/7**.

La solution retenue :

```
┌─────────────────────────┐         HTTP :3003          ┌──────────────────────────┐
│   CT 214 (pve2)         │ ──────────────────────────▶ │   terre2 (workstation)   │
│   Immich Server         │                             │   Podman + CUDA          │
│                         │ ◀────────────────────────── │   immich-ml-cuda         │
│   MACHINE_LEARNING_URL  │      embeddings CLIP        │   RTX 3090 (24 Go)       │
│   = http://terre2:3003  │      + OCR results          │   250W power limit       │
└─────────────────────────┘                             └──────────────────────────┘
         │
         │ fallback (terre2 éteint)
         ▼
┌─────────────────────────┐
│   ML local (CPU)        │
│   Lent mais fonctionnel │
└─────────────────────────┘
```

Quand terre2 est allumée, Immich envoie ses requêtes ML vers `http://192.168.1.50:3003`. Quand elle est éteinte, le serveur ML local sur CT 214 prend le relais en CPU — lent, mais fonctionnel. Le meilleur des deux mondes.

### Le pare-feu

terre2 tourne sous Bluefin (Fedora immutable), avec `firewalld` actif. Le port 3003 n'était pas ouvert. J'ai ajouté une rich rule calquée sur celle qui existait déjà pour Ollama (port 11434) :

```bash
# Règle existante pour Ollama
firewall-cmd --zone=FedoraWorkstation \
  --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="11434" protocol="tcp" accept' \
  --permanent

# Même pattern pour Immich ML
firewall-cmd --zone=FedoraWorkstation \
  --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="3003" protocol="tcp" accept' \
  --permanent

firewall-cmd --reload
```

Accès restreint au LAN uniquement. Pas de raison d'exposer un service ML brut sur Internet.

## Le piège SELinux

La commande Podman semblait correcte :

```bash
podman run -d \
  --name immich-ml-cuda \
  --device nvidia.com/gpu=0 \
  -v immich-ml-cache:/cache \
  -p 3003:3003 \
  -e MACHINE_LEARNING_CACHE_FOLDER=/cache \
  ghcr.io/immich-app/immich-machine-learning:release-cuda
```

Le conteneur démarre. Le modèle se télécharge. Tout a l'air de fonctionner. Puis dans les logs :

```
CUDA failure 100: no CUDA-capable device is detected
```

Le spec CDI (`/etc/cdi/nvidia.yaml`) était correct. Les device nodes étaient présents. Podman passait bien le GPU via `--device nvidia.com/gpu=0`. Mais ONNX Runtime tombait silencieusement en fallback sur `CPUExecutionProvider`.

> C'est le piège le plus vicieux : ONNX Runtime ne plante pas quand CUDA échoue. Il bascule silencieusement sur le CPU. Le conteneur tourne, les requêtes répondent, mais le GPU est à 0%. On croit que tout fonctionne alors qu'on perd tout l'intérêt de l'accélération matérielle.

Le coupable : **SELinux**. Sur Bluefin (Fedora immutable), SELinux est en mode enforcing par défaut. Même quand CDI passe les devices NVIDIA au conteneur, SELinux bloque l'accès du processus conteneurisé aux fichiers spéciaux dans `/dev/`.

Le fix :

```bash
--security-opt=label=disable
```

Vérification rapide que le GPU est bien visible depuis un conteneur :

```bash
podman run --rm \
  --device nvidia.com/gpu=0 \
  --security-opt=label=disable \
  ubuntu nvidia-smi
```

Si `nvidia-smi` affiche la carte, c'est bon. Si non, le problème est ailleurs (driver, CDI spec, etc.).

## Le choix du modèle CLIP

Immich propose plusieurs familles de modèles CLIP, de tailles et capacités très variables :

| Modèle | Taille | Langues | Cas d'usage |
|---|---|---|---|
| `ViT-B-32__openai` | ~583 Mo | Anglais | Photos classiques, petites collections |
| `nllb-clip-large-siglip__v1` | ~2 Go | Multilingue (200 langues) | Meilleur pour une seule langue non-anglaise |
| `XLM-Roberta-Large-ViT-H-14__frozen_laion5b_s13b_b90k` | ~4 Go | Multilingue (FR/EN) | Recherche mixte, contenus complexes |
| `ViT-SO400M-14-SigLIP2-256__webli` | ~2.5 Go | Multilingue | Alternative récente, bon compromis |

Stéphane a choisi `XLM-Roberta-Large-ViT-H-14__frozen_laion5b_s13b_b90k`. Pourquoi :

- Les memes contiennent du texte **français ET anglais** mélangé
- Les infographies ont des compositions visuelles complexes qu'un petit modèle ne capture pas
- 4 Go sur une carte de 24 Go, c'est raisonnable

Immich propose trois familles pour le multilingue : `nllb` (optimisé pour une seule langue), `xlm` (flexible pour le mélange de langues), et `siglip2` (plus récent, bon compromis). Pour une collection FR/EN mélangée, XLM était le choix logique.

### Cohabitation VRAM

Un calcul rapide :

| Composant | VRAM |
|---|---|
| Modèle CLIP XLM (chargé) | ~5.2 Go |
| Ollama (idle, modèle en cache) | ~2 Go |
| **Total** | **~7 Go / 24 Go** |

Il reste 17 Go de marge. La RTX 3090 gère les deux workloads sans broncher.

## La commande finale

```bash
podman run -d \
  --name immich-ml-cuda \
  --device nvidia.com/gpu=0 \
  --security-opt=label=disable \
  -v immich-ml-cache:/cache \
  -p 3003:3003 \
  -e MACHINE_LEARNING_CACHE_FOLDER=/cache \
  --restart unless-stopped \
  ghcr.io/immich-app/immich-machine-learning:release-cuda
```

Trois différences par rapport à la tentative ratée :
1. `--security-opt=label=disable` — le fix SELinux
2. `--restart unless-stopped` — le conteneur redémarre si terre2 reboot
3. Le modèle est configuré côté Immich (Admin > Machine Learning), pas dans le conteneur

## L'indexation

Job lancé depuis l'interface d'administration d'Immich : **Admin > Jobs > Smart Search**.

Le GPU a immédiatement grimpé à 100% d'utilisation, 244 W de consommation (sur les 250 W du power limit), 16 threads de travail. 10 000 images indexées en quelques minutes.

En comparaison, sur CPU (le conteneur LXC sur pve2), la même opération aurait pris des heures.

### OCR : lire le texte dans les images

Nous avons aussi activé l'OCR : `PP-OCRv5_mobile` (PaddleOCR), un modèle léger d'environ 16 Mo. L'OCR extrait le texte présent dans les memes et infographies et le rend cherchable.

Pendant l'indexation OCR, la consommation GPU était plus modeste : ~120 W, 10-16% d'utilisation. Le modèle est petit, la tâche moins intensive que CLIP.

> Combiner CLIP multilingue et OCR transforme la recherche dans Immich. CLIP comprend le contenu visuel ("chat sur un clavier"), OCR lit le texte incrusté ("quand le code compile du premier coup"). Les deux ensemble couvrent l'essentiel de ce qu'on veut chercher dans une collection de memes.

## Performance par watt

La RTX 3090 de terre2 est configurée avec un power limit de 250 W, contre 350 W en stock (TDP d'origine). Ce n'est pas un choix arbitraire.

| Config | TDP | Performance relative | Perf/watt relative |
|---|---|---|---|
| Stock | 350 W | 100% | 1.0x |
| Power limited | 250 W | ~88-90% | ~1.25x |

Les derniers 100 W de TDP n'apportent que 10-12% de performance supplémentaire. En limitant à 250 W, on conserve 88-90% des performances pour 71% de la consommation. Le ratio performance/watt est nettement meilleur.

Pour une tâche ponctuelle comme l'indexation (quelques minutes), c'est négligeable. Mais pour Ollama qui tourne en continu, ou pour l'OCR qui traite 10 000 images en séquence, ça représente des watts économisés sur la durée.

## Ce que ça change au quotidien

Avant : la recherche Immich était inutilisable pour du contenu non-photographique. On scrollait manuellement dans 10 000 images.

Après : on tape "infographie cybersécurité" ou "meme compilation" et les résultats sont pertinents. En français comme en anglais.

Le setup est volontairement éphémère. Quand terre2 est éteinte (ce qui arrive — ce n'est pas un serveur 24/7), Immich retombe sur son ML local en CPU. Les embeddings déjà calculés restent valides. Seules les nouvelles images seraient traitées lentement. Mais pour une collection qui grossit par à-coups (pas 500 photos par jour), c'est un compromis acceptable.

---

*Stack : Immich (CT 214, pve2), Podman + CUDA (terre2), RTX 3090 24 Go (250W), CLIP XLM-Roberta-Large ~4 Go, OCR PP-OCRv5_mobile ~16 Mo.*
