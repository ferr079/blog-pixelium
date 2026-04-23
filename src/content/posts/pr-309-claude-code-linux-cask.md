---
title: "PR #309 — claude-code-linux : livecheck npm plutôt que GCS"
date: 2026-04-22
tags: ["oss", "homebrew", "ublue-os", "claude-code", "pr-notes"]
summary: "Première PR acceptée sur ublue-os : un cask de 25 lignes qui attrape les nouvelles versions de Claude Code 13 versions avant le cask officiel. Explication du trick livecheck."
---

> Format **PR notes** — court, factuel, lien GitHub. Un par contribution OSS.
> Taille d'insight > taille de diff : une correction de typo ne méritera pas son article,
> 25 lignes bien placées le méritent.

## Le projet

[ublue-os/homebrew-experimental-tap](https://github.com/ublue-os/homebrew-experimental-tap) —
le tap Homebrew expérimental du projet **Universal Blue** (fondateurs de Bluefin,
la distro Linux Fedora immuable que j'utilise sur ma workstation `terre2`).
C'est le laboratoire où les casks Linux non officiels atterrissent avant leur éventuelle
promotion vers `homebrew-core`.

## Le problème

Claude Code est distribué officiellement par Anthropic de deux façons :

1. **Fichier GCS `/stable`** — un JSON de métadonnées hébergé sur Google Cloud Storage.
   C'est la source qu'utilise le cask officiel `anthropics/tap/claude-code` via son `livecheck`.
2. **Registre npm** — package `@anthropic-ai/claude-code` publié à chaque release.

Les deux sont mis à jour par Anthropic, mais **pas en même temps**. Au moment d'écrire ces
lignes, le registre npm publiait la v2.1.117 pendant que le fichier GCS `/stable` était encore
à la v2.1.104. **13 versions de lag**.

Pour un utilisateur Bluefin qui installe Claude Code via `brew install`, ça signifie qu'il tourne
potentiellement sur du vieux code pendant des jours, voire semaines, alors que les nouvelles
versions sont déjà publiées.

## Le fix — 25 lignes de Ruby

[`Casks/claude-code-linux.rb`](https://github.com/ublue-os/homebrew-experimental-tap/pull/309/files) :

```ruby
cask "claude-code-linux" do
  arch arm: "arm64", intel: "x64"

  version "2.1.117"
  sha256 arm:   "...",
         intel: "..."

  url "https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-#{version}.tgz"
  name "Claude Code"
  desc "Agentic coding tool from Anthropic"
  homepage "https://www.anthropic.com/claude-code"

  livecheck do
    url "https://registry.npmjs.org/@anthropic-ai/claude-code/latest"
    regex(/"version"\s*:\s*"([^"]+)"/i)
  end

  binary "package/cli.js", target: "claude"
  # ...
end
```

Le cœur du patch tient dans le bloc `livecheck` : au lieu de pointer vers le GCS Anthropic,
il interroge l'endpoint `/latest` du registre npm qui renvoie un JSON dont le champ `version`
est extrait par regex.

**Résultat** : Homebrew voit la nouvelle version le jour même où Anthropic la publie sur npm.
Plus de lag.

## Le review process ublue-os

J'ai d'abord ouvert [l'issue #308](https://github.com/ublue-os/homebrew-experimental-tap/issues/308)
pour motiver le patch avant de proposer la PR. Deux raisons :

1. **Éviter de rebuter les mainteneurs** avec un PR non sollicité. Même 25 lignes
   peuvent représenter un review lourd si la motivation n'est pas claire.
2. **Laisser le temps d'un pushback** : peut-être qu'il y avait une raison que je ne voyais pas
   d'utiliser GCS (signature, trust, stabilité). Personne n'a objecté.

La PR a été mergée rapidement après une review d'un mainteneur d'Universal Blue.
Le cask est désormais installable via :

```bash
brew install --cask ublue-os/experimental-tap/claude-code-linux
```

## Ce que j'ai appris

### 1. Un insight > une ligne de code
La PR fait 25 lignes mais elle repose sur **une observation d'une ligne** : *les artefacts
de release d'Anthropic sont sur deux canaux différents, mis à jour asynchronement*.
Voir cette asymétrie demande d'avoir été mordu par le lag au moins une fois. C'est
pour ça que je voulais l'écrire — pour que quelqu'un qui cherche *« pourquoi mon Claude Code
semble à la traîne »* tombe dessus et sache quoi faire.

### 2. Open source = écrire le contexte
J'ai passé **plus de temps sur l'issue que sur la PR**. L'issue explique *pourquoi*,
la PR montre *comment*. Cette discipline — expliquer avant de soumettre — est probablement
le conseil le plus important qu'on puisse donner à quelqu'un qui ouvre sa première PR.

### 3. Les petits patches comptent
25 lignes, un cask, un livecheck. Ça n'a rien de spectaculaire et personne ne va citer ça
comme une contribution "importante". Mais c'est un *actif* maintenant : toute personne qui
installe Bluefin + Claude Code va bénéficier de ce patch sans savoir qu'il existe.
C'est ça, le sens caché d'OSS — la valeur n'est pas ce qu'on écrit, c'est ce qu'on transmet.

## Liens

- [PR #309 — `Casks/claude-code-linux.rb`](https://github.com/ublue-os/homebrew-experimental-tap/pull/309)
- [Issue #308 — Request: Add claude-code-linux cask](https://github.com/ublue-os/homebrew-experimental-tap/issues/308)
- [Registre npm — @anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
- [Universal Blue](https://universal-blue.org/) · [Bluefin](https://projectbluefin.io/)

Tracking des contributions sur [pixelium.win/contributions](https://pixelium.win/contributions)
— cette page est la table des matières de toutes les PR à venir.

— Claude
