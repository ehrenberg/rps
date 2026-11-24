# Konzept

## Ziel

Eine Schere-Stein-Papier-Webapp, die sich wie ein kleines, liebevoll gemachtes Spiel anfühlt:
satte Animationen, Sound, Partikel, kurze Wege. Man öffnet einen Link und spielt, ohne Konto.

## Grundsätze

1. **Sofort spielbar.** Kein Login, keine Registrierung. Nur ein Name (wird lokal gemerkt).
2. **Fair.** Im Online-Spiel kann niemand den Zug des Gegners vorher sehen (Commit-Reveal).
3. **Datensparsam.** Keine Cookies, keine externen CDNs/Fonts/Tracker. Räume werden nach 24 h gelöscht.
4. **Läuft auf Shared Hosting.** PHP + SQLite, kurzes Polling statt WebSockets, kein Build-Schritt.
5. **Mobil zuerst.** Bedienbar mit einem Daumen, ab 360 px Breite.
6. **Sprache:** Oberfläche komplett auf Deutsch.

## Spielmodi

### 1. Gegen den Computer
Stufen:

| Stufe | Name | Verhalten |
|---|---|---|
| 1 | Zufall | Gleichverteilt zufällig |
| 2 | Gewohnheitstier | Spielt leicht vorhersehbar (wiederholt gern, „Gewinner bleibt“) – gut zum Üben |
| 3 | Taktiker | Konter auf deinen häufigsten Zug + einfache Muster (Wiederholen/Wechseln nach Sieg/Niederlage) |
| 4 | Gedankenleser | Lernt: Ensemble aus Häufigkeit, Markov-Ketten (1. und 2. Ordnung), Paar-Mustern und Meta-Strategien. Wählt den Prädiktor, der zuletzt am besten lag. Etwas Zufall, damit er selbst nicht ausrechenbar ist. Merkt sich deine Historie lokal über Spiele hinweg |

- Die „Gedankenleser“-Stufe zeigt optional an, welche Strategie sie gerade nutzt („Ich glaube, du wechselst nach einer Niederlage …“).
- Fairness-Gag: Der Computer legt seinen Zug **vor** deiner Wahl fest und zeigt den gekürzten Hash an („🔒 a3f9…“). Nach dem Aufdecken kann man prüfen, dass er nicht geschummelt hat.

### 2. Online-Duell per Einladungslink
1. Spieler A gibt Namen ein, wählt Variante (klassisch / mit Echse & Spock) und „Best of 3/5“.
2. Es entsteht ein Raum mit Link, z. B. `https://rps.bastianswelt.de/#k7f3qa`. Teilen per Kopieren-Button oder `navigator.share`.
3. Spieler B öffnet den Link, sieht „Anna fordert dich heraus“, gibt nur seinen Namen ein.
4. Das Match startet automatisch.
5. Nach Matchende: **Revanche**-Button. Startet, wenn beide drücken. Ein Gesamtstand über alle Revanchen wird angezeigt („Serie 2 : 1“).

### 3. Turnier
- Host erstellt Turnierraum, teilt den Link; bis 16 Leute treten mit Namen bei.
- Host startet (ab 3 Spielern). K.-o.-System, zufällige Setzung, Freilose bei ungerader Zahl.
- Alle Matches einer Runde laufen parallel. Wer gerade nicht spielt oder ausgeschieden ist, sieht den Turnierbaum live und kann Emoji-Reaktionen senden.
- Sieger wird groß gefeiert; Host kann ein neues Turnier mit denselben Leuten starten.

## Spielregeln

- **Klassisch:** Stein schlägt Schere, Schere schlägt Papier, Papier schlägt Stein.
- **Echse & Spock** (Variante, pro Raum wählbar):

| Gewinner | Verb | Verlierer |
|---|---|---|
| Schere | schneidet | Papier |
| Papier | bedeckt | Stein |
| Stein | zerquetscht | Echse |
| Echse | vergiftet | Spock |
| Spock | zertrümmert | Schere |
| Schere | köpft | Echse |
| Echse | frisst | Papier |
| Papier | widerlegt | Spock |
| Spock | verdampft | Stein |
| Stein | schleift | Schere |

- Unentschieden zählt nicht, die Runde wird wiederholt.
- Best of 3 = wer zuerst 2 Runden gewinnt. Best of 5 = zuerst 3.
- Das Ergebnis wird immer als Satz angezeigt: „Spock verdampft Stein“.

## Ablauf einer Runde (online)

1. **Wählen:** Beide wählen in Ruhe. Status beim Gegner: „wählt …“ → „bereit ✓“ (ohne Zug).
2. **Gesperrt:** Sobald beide gewählt haben, startet bei beiden der Countdown:
   zwei Fäuste schütteln im Takt „Schere! – Stein! – Papier!“ (je ~0,5 s, mit Sound).
3. **Aufdecken:** Die Hände springen in ihre Form, Zusammenprall-Effekt, Ergebnissatz.
4. **Wertung:** Punkt-Pips füllen sich, Sieger-Partikel, nächste Runde.

Gegen den Computer genauso, nur startet der Countdown direkt nach deinem Klick.

## Screens

1. **Start:** Logo, große Karten „Gegen Computer“, „Online-Duell“, „Turnier“, „Statistik“. Einstellungen (Ton an/aus, Animationen reduziert).
2. **Computer-Setup:** Stufe, Variante, Best of.
3. **Raum erstellen / Beitreten:** Name, Variante, Best of; Lobby mit Link, QR-Code (selbst erzeugt, keine externe Lib), Warteanimation.
4. **Arena:** Oben Namen + Punkt-Pips, Mitte zwei Hände (links du, rechts Gegner, gespiegelt), unten die Zugbuttons, Reaktionsleiste.
5. **Matchende:** Sieg-/Niederlage-Overlay, Konfetti bzw. „Regenwolke“, Revanche, Menü.
6. **Turnierbaum:** Bracket mit Live-Status, eigenes Match hervorgehoben.
7. **Statistik:** Siege/Niederlagen/Unentschieden je Modus und Stufe, Zugverteilung, längste Siegesserie, Lieblingszug, „Wie vorhersehbar bist du?“ (Entropie). Button „Statistik zurücksetzen“.
8. **Footer:** Links zu Impressum und Datenschutz auf bastianswelt.de.

## Grafik & Atmosphäre

Stil: **hochwertiges 2D** (siehe [ENTSCHEIDUNGEN.md](ENTSCHEIDUNGEN.md)).

- Dunkler Hintergrund mit langsam wabernden Farbverläufen (Aurora), Glas-Karten.
- Hände als eigene SVG-Illustrationen (Faust, flache Hand, Schere, Echse, Spock) mit Verlauf und Schatten, Spieler links / Gegner rechts gespiegelt.
- Animationen mit Web Animations API / CSS: Schütteln im Countdown, Form-Wechsel mit „Pop“, Zusammenprall mit kurzem Screen-Shake und Funken.
- Canvas-Partikel: Konfetti beim Matchsieg, Funken beim Zusammenprall, Regen bei Niederlage.
- Countdown-Wörter riesig, mit Federung.
- Emoji-Reaktionen (👍 😂 😱 🔥 😭 🤝 👏 😈) schweben über der Arena hoch.
- `prefers-reduced-motion` wird respektiert (Effekte reduziert, Spiel bleibt gleich).

## Sound

- Alle Sounds per **Web Audio API synthetisiert** (keine Audiodateien nötig): Schütteln/Takt, Aufprall, Sieg-Jingle, Niederlage, Unentschieden, Klick, Reaktions-Plopp.
- Ton-Schalter im Header, Zustand in `localStorage`. Audio startet erst nach erster Nutzeraktion.

## Statistik (lokal)

In `localStorage` unter `rps.stats.v1`. Nichts davon geht an den Server. Siehe Datenmodell in [ARCHITEKTUR.md](ARCHITEKTUR.md).

## Bewusst nicht enthalten

- Konten, Bestenlisten über alle Spieler, Chat mit Freitext (nur Emoji-Reaktionen → keine Moderation nötig).
- Matchmaking mit Fremden.
