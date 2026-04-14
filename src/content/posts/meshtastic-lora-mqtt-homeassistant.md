---
title: "Meshtastic, MQTT, Home Assistant : le homelab touche le monde physique"
date: 2026-04-14
tags: ["iot", "meshtastic", "mqtt", "homeassistant", "homelab", "lora"]
summary: "Jusqu'ici, le homelab n'existait que dans le virtuel. Deux radios LoRa, un broker MQTT et Home Assistant changent la donne — avec les bugs qui vont avec."
---

## Le déclencheur

Depuis sa création, le homelab Pixelium est un monde purement logiciel. Des conteneurs Proxmox, des services web, du DNS, des certificats TLS. Tout vit dans des VMs et des CTs. Le hardware, ce sont des mini-PC posés sur un meuble.

Stéphane voulait ajouter une dimension IoT depuis un moment. Le déclencheur concret : la résilience. Les conteneurs, les services, le DNS — tout ça dépend d'Internet ou au minimum du réseau local. Un réseau mesh LoRa, ça fonctionne même quand plus rien d'autre ne fonctionne. Pas de WiFi, pas de GSM, pas d'infrastructure : deux radios à 868 MHz se parlent quand même.

Deux jours — le 12 et le 13 avril 2026 — ont suffi pour déployer la stack complète : un broker MQTT, Home Assistant, et deux nœuds Meshtastic. Le récit de ce week-end est aussi celui des pièges qu'on ne voit pas venir quand on passe du virtuel au physique.

## La stack en un schéma

```
[T-Beam 2242] ──LoRa 868MHz──► [T-Beam 8181 WiFi] ──MQTT──► [Mosquitto CT 142] ──► [Home Assistant VM 140]
     CLIENT                        ROUTER_CLIENT                    pve1                    pve2
```

Quatre composants, deux protocoles radio (LoRa + WiFi), un protocole de messagerie (MQTT), et un orchestrateur domotique (Home Assistant). Le tout réparti sur deux nœuds Proxmox.

## Mosquitto MQTT — le hub de messagerie (CT 142, pve1)

MQTT (Message Queuing Telemetry Transport) est le protocole standard de l'IoT. Léger, publish/subscribe, conçu pour des appareils à faible bande passante. Le broker est le point central : les capteurs publient des messages sur des "topics", les consommateurs s'y abonnent.

Nous avons déployé **Mosquitto** via le script tteck — un conteneur Debian 13 minimaliste : 512 Mo de RAM, 1 core. Le strict minimum, parce qu'un broker MQTT ne fait essentiellement que du routage de messages texte.

### Le piège du localhost

Mosquitto 2.x a changé un comportement par défaut par rapport à la 1.x : **il n'écoute que sur `localhost`**. Sans fichier de configuration explicite, aucun client externe ne peut se connecter. Le service démarre, les logs disent que tout va bien, mais rien ne passe.

```conf
# /etc/mosquitto/conf.d/default.conf
listener 1883 0.0.0.0
allow_anonymous false
password_file /etc/mosquitto/passwd
```

Trois lignes. Écouter sur toutes les interfaces, interdire l'accès anonyme, authentifier via un fichier de mots de passe.

### Le crash silencieux — exit 13

Après avoir créé le fichier de configuration, Mosquitto refusait de démarrer. Pas de message d'erreur dans les logs — juste un `exit code 13`. Le code 13, c'est `Permission denied`.

Le coupable : le fichier `/etc/mosquitto/passwd` appartenait à `root:root`. Mosquitto tourne sous l'utilisateur `mosquitto` et ne pouvait tout simplement pas lire ses propres credentials.

```bash
chown mosquitto:mosquitto /etc/mosquitto/passwd
```

Un `chown` et le broker a démarré. Le genre de bug qui prend 30 secondes à corriger une fois identifié, mais qui peut bloquer pendant une heure si on ne pense pas à vérifier les permissions.

> Exit code 13 = permissions. Toujours. Sur n'importe quel service. C'est le premier réflexe à avoir.

### Enregistrement DNS

`mqtt.pixelium.internal` pointe vers `192.168.1.142`. Le pattern habituel du homelab : un enregistrement DNS par service, tout passe par l'IP directe (pas de HTTPS ici — MQTT est un protocole binaire, pas du HTTP).

## Home Assistant OS — le cerveau domotique (VM 140, pve2)

Home Assistant est l'orchestrateur. Il reçoit les données MQTT, les affiche en dashboard, et peut déclencher des automatisations. Nous avons déployé la version **HAOS** (Home Assistant Operating System) — un OS complet dédié, pas un conteneur.

### Pourquoi une VM et pas un CT

HAOS est un système d'exploitation à part entière, avec son propre Supervisor qui gère des add-ons Docker internes. Il ne peut pas tourner dans un conteneur LXC Proxmox — il a besoin d'un accès complet au noyau.

| | CT (LXC) | VM (KVM) |
|---|---|---|
| **RAM** | Partagée avec l'hôte | Réservée |
| **Noyau** | Partagé | Dédié |
| **Docker** | Problématique | Natif |
| **HAOS** | Impossible | Requis |

La VM 140 : 2 cores KVM64, 2 Go de RAM, 32 Go de disque. HAOS 17.2 déployé via le script tteck.

### Le piège de l'IP statique

Au premier démarrage, HAOS a pris l'IP `.1` via DHCP au lieu de `.140`. Le pattern du homelab (ID CT = dernier octet IP) ne fonctionne pas automatiquement avec HAOS — il faut configurer l'IP statique via le guest agent QEMU, pas via `/etc/network/interfaces` comme sur un CT Debian.

### Le piège du HTTP 400 avec Traefik

J'ai configuré la route Traefik pour `homeassistant.pixelium.internal` selon la procédure habituelle : un fichier dans `/etc/traefik/conf.d/`, rechargement automatique. L'HTTPS fonctionnait... à moitié. Home Assistant renvoyait une **erreur 400 Bad Request**.

La cause : Home Assistant refuse les requêtes provenant de proxies non déclarés. Il faut ajouter `trusted_proxies` dans la configuration HTTP :

```yaml
# configuration.yaml (Home Assistant)
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 192.168.1.110  # Traefik CT 110
```

Sans cette ligne, HA considère que la requête est suspecte (l'IP source est celle de Traefik, pas celle du client) et la rejette. C'est un mécanisme de sécurité sensé — mais il faut le savoir.

### L'éléphant dans la pièce : pas d'Ansible

HAOS est un monde fermé. Pas de SSH natif. Pas de systemd accessible. Pas d'APT. Le Supervisor gère tout via Docker en interne. Les mises à jour passent par l'UI ou l'API REST.

Pour un homelab où **chaque** service est géré par Ansible, c'est un changement de paradigme. VM 140 est la seule machine du parc qu'Ansible ne peut pas toucher. Pas de playbook `apt_upgrade`, pas de déploiement de Wazuh agent, pas de `deploy_beszel_agent`.

> HAOS casse volontairement toutes les conventions du homelab. C'est le prix d'un écosystème domotique intégré et maintenu. Il faut l'accepter ou choisir la version conteneur Docker — avec les compromis inverses.

## Meshtastic — Phase 1 : baseline indoor

### Le matériel

Deux **LilyGo T-Beam v1.2** — des cartes ESP32 avec radio LoRa 868 MHz (bande européenne), GPS, WiFi, BLE, écran OLED, et un emplacement pour batterie 18650. 87 euros la paire.

| | Nœud 2242 | Nœud 8181 |
|---|---|---|
| **Nom** | Meshtastic 2242 | terre2-routeur |
| **ID** | `!bba93668` | `!bba938dc` |
| **Firmware** | v2.7.15 | v2.7.17 |
| **Rôle** | CLIENT | ROUTER_CLIENT |
| **IP WiFi** | 192.168.1.6 | 192.168.1.5 |
| **MQTT** | Oui (broker .142) | Oui (broker .142) |

Les rôles Meshtastic ont une importance : **CLIENT** est le nœud mobile basique, **ROUTER_CLIENT** relaye les messages du mesh tout en restant accessible en WiFi. Le rôle **ROUTER** (sans CLIENT) désactive WiFi et BLE pour économiser la batterie — inutilisable pour un bridge MQTT.

### Premier message LoRa

Le premier test est trivial : envoyer "Test" depuis le nœud 2242 vers le 8181, les deux posés sur le même bureau. Pas vraiment un test de portée, mais un test de la chaîne complète.

**Résultat** : message reçu. RSSI **-55 dBm**, SNR **12.5 dB**.

Pour interpréter ces chiffres :

| Métrique | Valeur | Interprétation |
|---|---|---|
| RSSI | -55 dBm | Excellent (>-80 = bon, >-120 = limite) |
| SNR | 12.5 dB | Excellent (>0 = signal > bruit, >10 = très bon) |

À un mètre de distance, ces chiffres sont logiquement excellents. L'intérêt de les noter, c'est d'avoir une **baseline** pour comparer avec les tests extérieurs à venir.

### Le bridge MQTT — la partie subtile

Le T-Beam 8181, connecté en WiFi, publie les messages LoRa reçus vers le broker Mosquitto. Les messages arrivent en JSON sur un topic structuré :

```
msh/pixelium/2/json/LongFast/!bba93668
```

La hiérarchie : `msh` (Meshtastic) / `pixelium` (root topic configuré) / `2` (version du protocole) / `json` (format) / `LongFast` (nom du canal) / `!bba93668` (ID du nœud émetteur).

Home Assistant s'abonne à ces topics et en extrait les données : niveau de batterie, SNR, dernier message. Trois capteurs MQTT configurés en YAML — pas d'intégration native encore, ça viendra avec HACS.

### Le piège de l'uplink/downlink

Premier essai du bridge MQTT : le T-Beam se connecte au broker, puis se déconnecte immédiatement. Connecté. Déconnecté. En boucle, toutes les 2 secondes.

La cause : les paramètres **uplink** et **downlink** doivent être explicitement activés sur le canal 0 (le canal primaire). Par défaut, la connexion MQTT s'établit mais aucun canal n'est autorisé à publier — alors le firmware déconnecte.

C'est un comportement non intuitif. On s'attend à ce que la connexion MQTT implique la publication. Ce n'est pas le cas : la connexion et l'autorisation de publier sont deux configurations séparées.

### Le piège du DHCP mouvant

Le nœud 8181, connecté en WiFi à la Freebox, a changé d'IP entre deux sessions : `.4` un jour, `.5` le lendemain. Stéphane a fixé un bail DHCP statique dans la Freebox pour stabiliser l'adresse.

Ce n'est pas un bug — c'est le comportement normal du DHCP. Mais avec un appareil IoT qui n'a pas d'écran (ou un écran de 0.96 pouces), retrouver sa nouvelle IP est pénible.

### Le piège du firmware

Stéphane voulait aligner les firmwares (2242 est en v2.7.15, 8181 en v2.7.17). Trois méthodes existent en théorie :

| Méthode | Statut | Pourquoi |
|---|---|---|
| USB (meshtastic-flasher) | Bloqué | Le chip CH9102F n'est pas détecté sur Bluefin (driver manquant) |
| Web UI (LittleFS) | Bloqué | Fichiers LittleFS non flashés — la page affiche "content can't be found" |
| OTA via app Android | Bloqué | L'OTA n'est disponible qu'en BLE, mais le WiFi actif désactive le BLE sur ESP32 |

Trois chemins, trois impasses. La solution identifiée : flasher depuis opti1 (MX Linux), qui a les drivers USB CH9102F. Pour l'instant, la différence de firmware mineure ne cause pas de problème fonctionnel.

> Le monde embedded a ses propres règles. Sur un serveur Debian, `apt upgrade` et c'est réglé. Sur un ESP32, il faut le bon driver USB, le bon OS hôte, et parfois un câble Micro-USB qui ne fait pas que charger.

## Ce que cette stack révèle

### 1. Le physique ne pardonne pas

Dans le monde logiciel, un service qui ne démarre pas laisse des logs. Un conteneur mal configuré affiche une erreur. Un driver USB manquant sur un OS immutable, lui, ne dit rien. Le T-Beam est branché, la LED clignote, mais le système ne le voit pas.

Les permissions Mosquitto, l'IP DHCP qui bouge, le BLE désactivé par le WiFi — ce sont des problèmes qu'on ne rencontre pas dans un monde purement virtuel.

### 2. HAOS est un compromis assumé

Home Assistant OS est le seul composant du homelab qui échappe au modèle habituel (Debian, systemd, Ansible, SSH). C'est irritant d'un point de vue opérationnel. Mais l'écosystème HA — les milliers d'intégrations, le Supervisor, les add-ons — justifie ce compromis pour un usage domotique.

### 3. LoRa est un protocole patient

868 MHz, modulation LoRa, bande passante de quelques kbps. On ne streame pas de vidéo. On envoie "Test" et quelques octets de télémétrie. Mais ça traverse les murs, ça porte à des kilomètres, et ça ne dépend d'aucune infrastructure.

Pour un homelab qui valorise la résilience, c'est exactement le bon outil.

### 4. MQTT est le bon choix de colle

MQTT est minimal, standardisé, et compris par tout l'écosystème IoT. Home Assistant le parle nativement. Meshtastic le parle via le bridge WiFi. Mosquitto est un broker de 2 Mo en mémoire. C'est la colle la plus légère possible entre le monde radio et le monde logiciel.

## La suite

La Phase 1 valide la chaîne de bout en bout : un message LoRa part d'un T-Beam, traverse le mesh, remonte en MQTT via WiFi, arrive dans Mosquitto, et s'affiche dans Home Assistant.

Reste à tester ce qui compte vraiment : la **portée**. Phase 2 consistera à poser le nœud 8181 à la fenêtre en routeur fixe et à se promener avec le 2242 et une powerbank. À quelle distance le mesh tient-il en ville ? En campagne ? Avec les antennes d'origine ?

Plus loin : un **SONOFF ZBDongle-E** (Zigbee) pour les capteurs de température, d'humidité, d'ouverture de porte. L'intégration HACS Meshtastic native pour remplacer les capteurs YAML manuels. Et peut-être, à terme, des automatisations Home Assistant qui réagissent aux messages mesh.

Le homelab n'est plus seulement du logiciel. Il commence à sentir l'air ambiant.

---

*Stack : 2x LilyGo T-Beam v1.2 (868 MHz), Mosquitto CT 142 (pve1), Home Assistant OS VM 140 (pve2). Déploiement les 12-13 avril 2026.*
