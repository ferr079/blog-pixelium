---
title: "Chiffrer le DNS : la faille que nous ne voyions pas"
date: 2026-03-20
tags: ["securite", "dns", "reseau", "homelab"]
summary: "Nous avions HTTPS partout, SSH chiffré, mais les requêtes DNS circulaient en clair. Récit d'une prise de conscience et de la mise en place de DNS-over-TLS."
---

## La question qui a tout déclenché

Tout le homelab est chiffré. Traefik gère le HTTPS via step-ca (notre CA interne, certificats ACME 90 jours). SSH est en key-only partout. Les connexions sensibles passent par Headscale.

Puis un jour, en analysant le trafic réseau, la question s'est posée : **qu'est-ce qui circule encore en clair ?**

Réponse : le DNS. Chaque requête de résolution — chaque site visité, chaque API appelée, chaque service contacté — partait en **texte brut** sur le port 53.

> HTTPS chiffre le contenu. Le DNS révèle la destination. Savoir que quelqu'un consulte `banking.example.com` sans voir le contenu, c'est déjà une information sensible.

## DoT vs DoH : le choix

Deux protocoles existent pour chiffrer le DNS :

| | DNS-over-TLS (DoT) | DNS-over-HTTPS (DoH) |
|---|---|---|
| **Port** | 853 (dédié) | 443 (partagé avec HTTPS) |
| **Transport** | TLS natif | HTTP/2 + TLS |
| **Détectable** | Oui (port spécifique) | Non (fondu dans le trafic web) |
| **Performance** | Meilleur (moins d'overhead) | Légèrement plus lourd |
| **Debug** | Facile (port dédié = filtrable) | Difficile (mêlé au trafic web) |

Sur un réseau qu'on contrôle, la "furtivité" de DoH n'est pas un avantage. Nous **voulions** pouvoir filtrer et monitorer le trafic DNS facilement. Nous avons choisi **DoT**.

## Le certificat TLS

DoT nécessite un certificat TLS valide sur le serveur DNS. Notre TechnitiumDNS (CT 100) a besoin d'un certificat pour `technitium.pixelium.internal`.

La bonne nouvelle : nous avons déjà step-ca (CT 102) qui fait office de CA interne. La configuration DoT dans TechnitiumDNS est native — il suffit de pointer vers le certificat et la clé privée.

Le certificat a une durée de **90 jours**, comme tous les certificats Traefik. C'est un choix délibéré : des certificats courts forcent à automatiser le renouvellement. Si l'automatisation casse, on le sait vite.

## Configurer le client : terre2

La workstation de Stéphane (Bluefin) utilise `systemd-resolved` pour la résolution DNS. La configuration DoT :

```ini
# /etc/systemd/resolved.conf.d/dot.conf
[Resolve]
DNS=192.168.1.100#technitium.pixelium.internal
DNSSEC=allow-downgrade
DNSOverTLS=yes
```

Le `#technitium.pixelium.internal` après l'IP est le **SNI** (Server Name Indication). C'est crucial — sans ça, le client TLS ne peut pas vérifier l'identité du serveur. Il sait qu'il parle à `192.168.1.100`, mais il ne sait pas si c'est bien le serveur DNS qu'il attend.

```bash
systemctl restart systemd-resolved
```

### Le piège du firewall — 45 minutes perdues

Premier test : échec total. Les requêtes DoT ne passaient pas. `resolvectl status` montrait le serveur configuré mais aucune réponse.

Nous avons vérifié :
- TechnitiumDNS ? Tourne. Port 853 ouvert. Certificat valide.
- Réseau ? `ping 192.168.1.100` répond normalement.
- DNS classique ? Port 53 fonctionne toujours.

Le problème était **firewalld sur terre2**. Le port 853/TCP n'est pas dans la zone de confiance par défaut. Le firewall de Stéphane bloquait les connexions sortantes vers DoT.

```bash
firewall-cmd --permanent --add-port=853/tcp
firewall-cmd --reload
```

Le message d'erreur de `systemd-resolved` était juste "connection timed out" — aucune indication que c'était le firewall **local** (pas celui du serveur) qui bloquait. 45 minutes à chercher du côté serveur alors que le problème était sur terre2.

> Quand le réseau ne marche pas, on regarde le serveur distant. Réflexe classique. Mais parfois le coupable, c'est le client lui-même.

## Vérification

```bash
resolvectl status
```

```
Link 2 (enp5s0)
    Current Scopes: DNS
    Protocols: +DefaultRoute +LLMNR -mDNS +DNSOverTLS
    Current DNS Server: 192.168.1.100#technitium.pixelium.internal
```

Le `+DNSOverTLS` confirme que le chiffrement est actif. Toutes les requêtes DNS de terre2 passent maintenant en TLS.

## Le DNS secondaire aussi en DoT

Notre deuxième serveur TechnitiumDNS (CT 101 sur pve2) fait de la réplication de zone AXFR depuis le primaire. Il a également été configuré en DoT.

Le transfert de zone entre les deux serveurs (AXFR) reste en TCP classique sur le réseau privé. C'est un choix délibéré : AXFR chiffré ajouterait de la complexité pour un gain marginal — les deux CTs sont sur le même LAN contrôlé, et le contenu des zones n'est pas sensible.

Pour les clients du LAN qui utilisent le DNS secondaire en fallback :

```ini
DNS=192.168.1.100#technitium.pixelium.internal 192.168.1.101#technitium2.pixelium.internal
```

Si le primaire tombe, le secondaire prend le relais — toujours en DoT.

## Blocklists : le bonus

Tant que nous étions dans la configuration DNS, nous avons activé les **blocklists** sur TechnitiumDNS :
- **OISD** — la liste la plus complète et la mieux maintenue
- **Hagezi** — complémentaire, focus sur la télémétrie

Le DNS ne fait plus que résoudre des noms — il filtre aussi les domaines de tracking, de pub, et de télémétrie. C'est du Pi-hole intégré dans le résolveur.

## Ce que nous en retirons

### 1. La sécurité est une chaîne

HTTPS sans DNS chiffré, c'est une porte blindée avec une fenêtre ouverte. Chaque protocole est un vecteur potentiel de fuite d'information. Il faut les traiter un par un, méthodiquement.

### 2. Le coût du chiffrement DNS est nul

La latence ajoutée par TLS est de l'ordre de la milliseconde — indétectable à l'usage. Il n'y a **aucune raison** de ne pas chiffrer le DNS en 2026.

### 3. Le debug réseau, c'est de la patience

45 minutes sur un problème de firewall local. C'est frustrant, mais c'est aussi comme ça qu'on apprend à débugger systématiquement : vérifier chaque couche, du client au serveur, sans présupposé.

### 4. DoT > DoH pour un homelab

Sur un réseau qu'on contrôle, la transparence est plus utile que la furtivité. Le port dédié 853 rend le monitoring et le debug bien plus simples que DoH noyé dans le port 443.

---

*Stack : TechnitiumDNS (CT 100 + CT 101), step-ca (CT 102), systemd-resolved, firewalld. Blocklists : OISD + Hagezi.*
