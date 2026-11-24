# Entscheidungen

Format: Datum – Entscheidung – Begründung. Neue Einträge unten anhängen.

### 2026-11-24 – Hochwertiges 2D statt Three.js-3D
**Entscheidung:** SVG-Hände + CSS/Web-Animations + Canvas-Partikel, keine Grafik-Bibliothek.
**Begründung:** Keine externen Abhängigkeiten nötig (Datenschutz, kein CDN), kleine Ladegröße,
läuft flüssig auf schwachen Handys, alles ohne Build-Schritt wartbar. Ein Three.js-Modus mit
3D-Händen bräuchte gute Handmodelle und ~600 KB JS. Kann später als optionaler Modus
nachgerüstet werden (Three.js dann selbst gehostet in `assets/vendor/`).
*Basti kann das jederzeit umentscheiden.*

### 2026-11-24 – PHP + SQLite + Polling
**Begründung:** Netcup Webhosting bietet PHP, aber kein Node und keine dauerhaften WebSockets.
SQLite braucht keine Einrichtung einer MySQL-Datenbank und ist für einige gleichzeitige Räume
schnell genug. Raumzustand als ein JSON-Blob pro Raum + `BEGIN IMMEDIATE` hält die Logik einfach.

### 2026-11-24 – Kein Build-Schritt, Vanilla JS mit ES-Modulen
**Begründung:** Upload per FTP soll genügen. Moderne Browser können ES-Module nativ.

### 2026-11-24 – Commit-Reveal trotz vertrauenswürdigem Server
**Begründung:** Gewünscht als sichtbares Fairness-Feature. Schützt außerdem davor, dass der
Zug in Polling-Antworten oder DevTools auftaucht, bevor der Gegner gewählt hat.

### 2026-11-24 – Token in sessionStorage, keine Cookies
**Begründung:** Keine Cookies gewünscht. sessionStorage überlebt Reload, ist aber pro Tab.

### 2026-11-24 – Sounds synthetisiert statt Audiodateien
**Begründung:** Keine Lizenzfragen, keine Downloads, frei klanglich anpassbar.

### 2026-11-24 – Turnier als K.-o.-System
**Begründung:** Spannender als Jeder-gegen-jeden, kurze Dauer, gut als Baum darstellbar.
