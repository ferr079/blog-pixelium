---
title: "Chiffrer le DNS : la faille que je ne voyais pas"
date: 2026-03-20
tags: ["securite", "dns", "reseau", "homelab"]
summary: "J'avais HTTPS partout, SSH chiffre, mais mes requetes DNS circulaient en clair. Recit d'une prise de conscience et de la mise en place de DNS-over-TLS."
---

## La question qui a tout declenche

Tout mon homelab est chiffre. Traefik gere le HTTPS via step-ca (mon CA interne, certificats ACME 90 jours). SSH est en key-only partout. Les connexions sensibles passent par Headscale.

Puis un jour, en analysant le trafic reseau, la question s'est posee : **qu'est-ce qui circule encore en clair ?**

Reponse : le DNS. Chaque requete de resolution — chaque site visite, chaque API appelee, chaque service contacte — partait en **texte brut** sur le port 53.

> HTTPS chiffre le contenu. Le DNS revele la destination. Savoir que quelqu'un consulte `banking.example.com` sans voir le contenu, c'est deja une information sensible.

## DoT vs DoH : le choix

Deux protocoles existent pour chiffrer le DNS :

| | DNS-over-TLS (DoT) | DNS-over-HTTPS (DoH) |
|---|---|---|
| **Port** | 853 (dedie) | 443 (partage avec HTTPS) |
| **Transport** | TLS natif | HTTP/2 + TLS |
| **Detectable** | Oui (port specifique) | Non (fondu dans le trafic web) |
| **Performance** | Meilleur (moins d'overhead) | Legerement plus lourd |
| **Debug** | Facile (port dedie = filtrable) | Difficile (mele au trafic web) |

Sur un reseau que je controle, la "furtivite" de DoH n'est pas un avantage. Je **veux** pouvoir filtrer et monitorer le trafic DNS facilement. J'ai choisi **DoT**.

## Le certificat TLS

DoT necessite un certificat TLS valide sur le serveur DNS. Mon TechnitiumDNS (CT 100) a besoin d'un certificat pour `technitium.pixelium.internal`.

La bonne nouvelle : j'ai deja step-ca (CT 102) qui fait office de CA interne. La configuration DoT dans TechnitiumDNS est native — il suffit de pointer vers le certificat et la cle privee.

Le certificat a une duree de **90 jours**, comme tous mes certificats Traefik. C'est un choix delibere : des certificats courts forcent a automatiser le renouvellement. Si l'automatisation casse, on le sait vite.

## Configurer le client : terre2

Ma workstation Bluefin utilise `systemd-resolved` pour la resolution DNS. La configuration DoT :

```ini
# /etc/systemd/resolved.conf.d/dot.conf
[Resolve]
DNS=192.168.1.100#technitium.pixelium.internal
DNSSEC=allow-downgrade
DNSOverTLS=yes
```

Le `#technitium.pixelium.internal` apres l'IP est le **SNI** (Server Name Indication). C'est crucial — sans ca, le client TLS ne peut pas verifier l'identite du serveur. Il sait qu'il parle a `192.168.1.100`, mais il ne sait pas si c'est bien le serveur DNS qu'il attend.

```bash
systemctl restart systemd-resolved
```

### Le piege du firewall — 45 minutes perdues

Premier test : echec total. Les requetes DoT ne passaient pas. `resolvectl status` montrait le serveur configure mais aucune reponse.

J'ai verifie :
- TechnitiumDNS ? Tourne. Port 853 ouvert. Certificat valide.
- Reseau ? `ping 192.168.1.100` repond normalement.
- DNS classique ? Port 53 fonctionne toujours.

Le probleme etait **firewalld sur terre2**. Le port 853/TCP n'est pas dans la zone de confiance par defaut. Mon propre firewall bloquait les connexions sortantes vers DoT.

```bash
firewall-cmd --permanent --add-port=853/tcp
firewall-cmd --reload
```

Le message d'erreur de `systemd-resolved` etait juste "connection timed out" — aucune indication que c'etait le firewall **local** (pas celui du serveur) qui bloquait. 45 minutes a chercher du cote serveur alors que le probleme etait sous mes yeux.

> Quand le reseau ne marche pas, on regarde le serveur distant. Reflexe classique. Mais parfois le coupable, c'est le client lui-meme.

## Verification

```bash
resolvectl status
```

```
Link 2 (enp5s0)
    Current Scopes: DNS
    Protocols: +DefaultRoute +LLMNR -mDNS +DNSOverTLS
    Current DNS Server: 192.168.1.100#technitium.pixelium.internal
```

Le `+DNSOverTLS` confirme que le chiffrement est actif. Toutes les requetes DNS de terre2 passent maintenant en TLS.

## Le DNS secondaire

Mon deuxieme serveur TechnitiumDNS (CT 101 sur pve2) fait de la replication de zone AXFR depuis le primaire. Il a egalement ete configure en DoT.

Par contre, le transfert de zone entre les deux serveurs (AXFR) reste en TCP classique sur le reseau prive. C'est un choix delibere : AXFR chiffre ajouterait de la complexite pour un gain marginal — les deux CTs sont sur le meme LAN controle, et le contenu des zones n'est pas sensible.

## Le DNS secondaire aussi en DoT

Pour les clients du LAN qui utilisent le DNS secondaire (en fallback), j'ai configure CT 101 avec son propre certificat DoT. Le resolver de terre2 a les deux :

```ini
DNS=192.168.1.100#technitium.pixelium.internal 192.168.1.101#technitium2.pixelium.internal
```

Si le primaire tombe, le secondaire prend le relais — toujours en DoT.

## Blocklists : le bonus

Tant que j'etais dans la configuration DNS, j'ai active les **blocklists** sur TechnitiumDNS :
- **OISD** — la liste la plus complete et la mieux maintenue
- **Hagezi** — complementaire, focus sur la telemetrie

Le DNS ne fait plus que resoudre des noms — il filtre aussi les domaines de tracking, de pub, et de telemetrie. C'est du Pi-hole integre dans le resolver.

## Ce que j'ai appris

### 1. La securite est une chaine

HTTPS sans DNS chiffre, c'est une porte blindee avec une fenetre ouverte. Chaque protocole est un vecteur potentiel de fuite d'information. Il faut les traiter un par un, methodiquement.

### 2. Le cout du chiffrement DNS est nul

La latence ajoutee par TLS est de l'ordre de la milliseconde — indectectable a l'usage. Il n'y a **aucune raison** de ne pas chiffrer le DNS en 2026.

### 3. Le debug reseau, c'est de la patience

45 minutes sur un probleme de firewall local. C'est frustrant, mais c'est aussi comme ca qu'on apprend a debugger systematiquement : verifier chaque couche, du client au serveur, sans presuppose.

### 4. DoT > DoH pour un homelab

Sur un reseau qu'on controle, la transparence est plus utile que la furtivite. Le port dedie 853 rend le monitoring et le debug bien plus simples que DoH noye dans le port 443.

---

*Stack : TechnitiumDNS (CT 100 + CT 101), step-ca (CT 102), systemd-resolved, firewalld. Blocklists : OISD + Hagezi.*
