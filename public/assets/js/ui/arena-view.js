// Arena-Ansicht: reine Darstellung (DOM, Animation, Sound, Partikel).
// Implementiert das ArenaView-Interface aus arena.js; Spielablauf steuert der Controller.

import { h, replaceChildren, wait, animate, centerOf, prefersLessMotion } from './dom.js';
import { icon } from './icons.js';
import { toggleButton } from './components.js';
import { matchEndOverlay } from './match-end.js';
import { reactionBar } from './reaction-bar.js';
import { createHand, handIcon } from '../hands.js';
import * as fx from '../fx.js';
import * as audio from '../audio.js';
import { MOVE_NAMES, VARIANT_NAMES } from '../rules.js';
import { MOVE_LETTERS } from '../move-keys.js';

// ─── Takt & Dauern (ms) ───
export const BEAT_MS = 500;
export const COUNTDOWN_WORDS = Object.freeze(['Schere!', 'Stein!', 'Papier!']);
const CLASH_PAUSE_MS = 380;
const RESULT_HOLD_MS = 650;
const RESULT_IN_MS = 260;
const REDUCED_HOLD_MS = 250;
const HISTORY_MAX = 12;
const HASH_PREVIEW_CHARS = 4;
const NONCE_PREVIEW_CHARS = 8;
const SHAKE_INTENSITY = Object.freeze({ win: 1, lose: 0.7, draw: 0.4 });

const STATUS_TEXT = Object.freeze({ choosing: 'wählt …', ready: 'bereit ✓', offline: 'offline', left: 'hat verlassen' });
const OUTCOME_KEY = Object.freeze({ 1: 'win', 0: 'draw', [-1]: 'lose' });
const OUTCOME_TEXT = Object.freeze({ 1: 'Runde für dich!', 0: 'Unentschieden – zählt nicht.', [-1]: 'Runde für den Gegner.' });
const SPRING_KEYFRAMES = [
  { transform: 'scale(.2) rotate(-8deg)', opacity: 0 },
  { transform: 'scale(1.18) rotate(3deg)', opacity: 1, offset: 0.45 },
  { transform: 'scale(.94) rotate(-1deg)', opacity: 1, offset: 0.7 },
  { transform: 'scale(1) rotate(0)', opacity: 1 },
];
const WORD_OUT_KEYFRAMES = [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.2)', opacity: 0 }];
const WORD_OUT_MS = 220;

const shortHash = (hex) => `${hex.slice(0, HASH_PREVIEW_CHARS)}…`;

const SECOND_MS = 1000;
const END_NOTES = Object.freeze({
  leave: (opp) => `${opp} hat das Spiel verlassen.`,
  claim: (opp, won) => (won ? `${opp} war zu lange weg – Sieg beansprucht.` : 'Du warst zu lange weg.'),
  forfeit: (opp, won) => (won ? `${opp} hat nicht rechtzeitig aufgedeckt.` : 'Du hast nicht rechtzeitig aufgedeckt.'),
});

const FAIR_PROBLEM = Object.freeze({
  hash: 'Der aufgedeckte Zug passt nicht zum Hash – sha256(„Zug:Nonce“) ergibt etwas anderes.',
  shown: 'Der Hash beim Aufdecken ist ein anderer als der, der vorher angezeigt wurde.',
  own: 'Für deinen Zug wurde ein anderer Hash gespeichert, als dein Browser berechnet hat.',
});

const DEADLINE_TEXT = Object.freeze({
  reveal: (opp, s) => `⏳ ${opp} deckt auf … noch ${s} s`,
  commit: (opp, s) => `⏳ Noch ${s} s für deinen Zug …`,
  oppCommit: (opp, s) => `⏳ ${opp} hat noch ${s} s`,
});

/** Kleiner Platzhalter für nicht aufgedeckte Züge (Forfeit). */
const moveIcon = (move) => (move ? handIcon(move) : h('span', { class: 'history__unknown' }, '?'));

/**
 * @param {{ myName:string, announce:(text:string)=>void, onChoose:(move:string)=>void,
 *           onAgain:()=>void, onMenu?:()=>void, onReact:(emoji:string)=>void,
 *           insightOn:boolean, onInsightToggle:(on:boolean)=>void, modeLabel:string,
 *           againLabel?:string, onClaim?:()=>void, onLeave?:()=>void }} opts
 *  againLabel: Beschriftung im Matchende-Overlay („Nochmal“, „Revanche“, „Zum Turnierbaum“)
 */
export function createArenaView(opts) {
  const { myName, announce } = opts;
  let oppName = '';
  let target = 0;
  let overlay = null;
  let insightText = null;
  let insightOn = opts.insightOn;
  let refocusMoves = false; // nach „Nochmal“ Fokus auf die Zug-Buttons
  let series = null;
  let deadlineTimer = null;
  const moveButtons = new Map();

  // ─── Gerüst ───
  const heading = h('h1', { class: 'visually-hidden', tabindex: '-1', id: 'arena-title' }, 'Arena');
  const roundLabel = h('span', { class: 'scoreboard__round' }, 'Runde 1');
  const meName = h('span', { class: 'player__name' }, myName);
  const oppNameEl = h('span', { class: 'player__name' });
  const oppDetail = h('span', { class: 'player__detail' });
  const mePips = h('div', { class: 'pips', role: 'img' });
  const oppPips = h('div', { class: 'pips', role: 'img' });
  const oppStatus = h('span', { class: 'player__status', hidden: true });
  const commitBadge = h('span', { class: 'commit', hidden: true, title: 'Der Computer hat seinen Zug schon festgelegt – das ist sein Fingerabdruck (SHA-256).' });

  const handMe = createHand({ side: 'left' });
  const handOpp = createHand({ side: 'right' });
  const countdownWord = h('div', { class: 'countdown', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'stage' },
    h('div', { class: 'stage__hand stage__hand--me' }, handMe.el),
    h('div', { class: 'stage__vs', 'aria-hidden': 'true' }, 'VS'),
    h('div', { class: 'stage__hand stage__hand--opp' }, handOpp.el),
    countdownWord);

  const result = h('p', { class: 'result', 'aria-hidden': 'true' }, h('span', { class: 'result__hint' }, 'Wähle deinen Zug'));
  const fairness = h('div', { class: 'fair', hidden: true });
  const insightBox = h('p', { class: 'insight__text', hidden: true });
  const insightToggle = toggleButton({
    label: 'Was denkt der Computer?', pressed: insightOn, iconOn: 'brain', className: 'toggle--chip',
    onChange: (on) => { insightOn = on; opts.onInsightToggle(on); renderInsight(); },
  });
  const insight = h('div', { class: 'insight', hidden: true }, insightToggle.el, insightBox);
  const moves = h('div', { class: 'moves', role: 'group', 'aria-label': 'Dein Zug' });
  const history = h('ol', { class: 'history', 'aria-label': 'Rundenverlauf' });
  const reactions = reactionBar({ onReact: opts.onReact, hidden: true }).el;
  const deadline = h('p', { class: 'deadline', hidden: true, role: 'status' });
  const claimBtn = h('button', { type: 'button', class: 'btn btn--danger claim', hidden: true, onclick: () => opts.onClaim?.() }, icon('trophy', { size: 18 }), 'Sieg beanspruchen');
  const leaveBtn = opts.onLeave
    ? h('button', { type: 'button', class: 'btn btn--ghost arena__leave', onclick: () => opts.onLeave() }, icon('door', { size: 18 }), h('span', {}, 'Verlassen'))
    : null;
  const seriesEl = h('span', { class: 'scoreboard__series', hidden: true });

  const main = h('div', { class: 'arena__main' },
    h('div', { class: 'arena__top' },
      h('a', { class: 'btn btn--ghost btn--icon screen__back', href: '#/', 'aria-label': 'Zurück zum Menü', onclick: opts.onMenu }, icon('back'), h('span', { class: 'screen__back-label' }, 'Menü')),
      h('p', { class: 'arena__mode' }, opts.modeLabel),
      leaveBtn),
    h('div', { class: 'scoreboard glass' },
      h('div', { class: 'player player--me' }, meName, mePips),
      h('div', { class: 'scoreboard__mid' }, roundLabel, seriesEl),
      h('div', { class: 'player player--opp' }, oppNameEl, oppPips, oppDetail, oppStatus, commitBadge)),
    stage,
    result,
    h('div', { class: 'arena__info' }, deadline, claimBtn, fairness, insight),
    moves,
    history,
    reactions);
  const el = h('section', { class: 'screen screen--arena', 'aria-labelledby': 'arena-title' }, heading, main);

  // ─── Hilfsfunktionen ───
  function renderPips(container, filled, who) {
    container.setAttribute('aria-label', `${who}: ${filled} von ${target} Siegen`);
    replaceChildren(container, Array.from({ length: target }, (_, i) =>
      h('span', { class: ['pip', i < filled && 'pip--on'] })));
  }

  function renderInsight() {
    insightBox.hidden = !insightOn;
    insightBox.textContent = insightText ?? 'Noch keine Gedanken – spiel ein paar Runden.';
  }

  function setMovesEnabled(enabled) {
    for (const btn of moveButtons.values()) btn.setAttribute('aria-disabled', String(!enabled));
    moves.classList.toggle('moves--locked', !enabled);
  }

  function showCommit(text, label, title) {
    commitBadge.hidden = false;
    commitBadge.textContent = text;
    commitBadge.setAttribute('aria-label', label);
    commitBadge.title = title;
  }

  function setDeadline(seconds, who = 'reveal') {
    clearInterval(deadlineTimer);
    deadline.hidden = seconds === null || seconds === undefined;
    if (deadline.hidden) return;
    let left = seconds;
    const text = DEADLINE_TEXT[who] ?? DEADLINE_TEXT.reveal;
    deadline.classList.toggle('deadline--mine', who === 'commit');
    const render = () => { deadline.textContent = text(oppName, left); };
    render();
    deadlineTimer = setInterval(() => { left = Math.max(0, left - 1); render(); }, SECOND_MS);
  }

  function setClaimAvailable(available) {
    claimBtn.hidden = !available;
  }

  function setRematchStatus({ me, opp, oppLeft }) {
    if (!overlay) return;
    if (oppLeft) overlay.update({ status: `${oppName} ist nicht mehr da – keine Revanche möglich.`, againDisabled: true });
    else if (me && !opp) overlay.update({ status: `Warte auf ${oppName} …`, againDisabled: true });
    else if (opp && !me) overlay.update({ status: `${oppName} will Revanche!`, againDisabled: false, highlight: true });
    else overlay.update({ status: null, againDisabled: false });
  }

  function showWord(text) {
    if (!text) return Promise.resolve();
    countdownWord.textContent = text;
    countdownWord.classList.add('countdown--on');
    return animate(countdownWord, SPRING_KEYFRAMES, { duration: BEAT_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }

  async function hideWord() {
    await animate(countdownWord, WORD_OUT_KEYFRAMES, { duration: WORD_OUT_MS, easing: 'ease-in', fill: 'forwards' });
    for (const a of countdownWord.getAnimations?.() ?? []) a.cancel();
    countdownWord.classList.remove('countdown--on');
    countdownWord.textContent = '';
  }

  // ─── ArenaView-Interface ───
  return {
    el,
    focus: () => heading.focus({ preventScroll: true }),

    setup({ bestOf, variant, target: t, moves: list, oppName: name, oppDetail: detail, features }) {
      target = t;
      oppName = name;
      oppNameEl.textContent = name;
      oppDetail.textContent = detail ?? '';
      renderPips(mePips, 0, myName);
      renderPips(oppPips, 0, name);
      roundLabel.textContent = 'Runde 1';
      oppStatus.hidden = !features.status;
      commitBadge.hidden = true;
      reactions.hidden = !features.reactions;
      insight.hidden = !features.insight;
      insightText = null;
      renderInsight();
      fairness.hidden = true;
      history.replaceChildren();
      result.className = 'result';
      replaceChildren(result, h('span', { class: 'result__hint' }, `Best of ${bestOf} · ${VARIANT_NAMES[variant]} – wähle deinen Zug`));
      handMe.setMove('fist', { pop: false });
      handOpp.setMove('fist', { pop: false });
      handMe.setState('idle');
      handOpp.setState('idle');
      handMe.enter?.();
      handOpp.enter?.();
      moves.classList.toggle('moves--five', list.length > 3);
      moveButtons.clear();
      replaceChildren(moves, list.map((move, i) => {
        const btn = h('button', {
          type: 'button', class: 'move-btn', dataset: { move }, 'aria-disabled': 'true',
          'aria-keyshortcuts': `${i + 1} ${MOVE_LETTERS[move].toUpperCase()}`,
          onclick: () => { if (btn.getAttribute('aria-disabled') !== 'true') opts.onChoose(move); },
        },
        h('span', { class: 'move-btn__icon', 'aria-hidden': 'true' }, handIcon(move)),
        h('span', { class: 'move-btn__name' }, MOVE_NAMES[move]),
        h('kbd', { class: 'move-btn__key', 'aria-hidden': 'true' }, String(i + 1)));
        moveButtons.set(move, btn);
        return btn;
      }));
      if (refocusMoves) moves.firstElementChild?.focus();
      refocusMoves = false;
    },

    setRoundOpen({ round, commit }) {
      roundLabel.textContent = `Runde ${round}`;
      for (const btn of moveButtons.values()) btn.classList.remove('move-btn--chosen');
      setMovesEnabled(true);
      if (commit) {
        showCommit(`🔒 ${shortHash(commit)}`, `Zug des Gegners ist festgelegt, Fingerabdruck ${shortHash(commit)}`,
          'Der Computer hat seinen Zug schon festgelegt – das ist sein Fingerabdruck (SHA-256).');
      } else {
        commitBadge.hidden = true;
      }
    },

    /** Online: Gegner hat gewählt – sein Hash (Fingerabdruck) wird vor dem Aufdecken gezeigt. */
    setOpponentCommit(hash) {
      showCommit(`🔒 ${oppName} hat gewählt: ${shortHash(hash)}`,
        `${oppName} hat gewählt, Fingerabdruck ${shortHash(hash)}`,
        `${oppName} hat seinen Zug festgelegt – das ist der Fingerabdruck (SHA-256). Nach dem Aufdecken wird er geprüft.`);
    },

    /** Zug-Buttons freigeben/sperren (z. B. nach fehlgeschlagener Abgabe wieder frei). */
    setMovesEnabled(enabled) {
      if (enabled) for (const btn of moveButtons.values()) btn.classList.remove('move-btn--chosen');
      setMovesEnabled(enabled);
    },

    setChosen(move) {
      setMovesEnabled(false);
      moveButtons.get(move)?.classList.add('move-btn--chosen');
      audio.play('pop');
    },

    setOpponentStatus(state) {
      oppStatus.textContent = STATUS_TEXT[state] ?? '';
      oppStatus.dataset.state = state;
    },

    async playCountdown() {
      result.className = 'result';
      replaceChildren(result, ' ');
      fairness.hidden = true;
      handMe.setState('idle');
      handOpp.setState('idle');
      handMe.setMove('fist', { pop: false });
      handOpp.setMove('fist', { pop: false });
      stage.classList.add('stage--countdown');
      announce(COUNTDOWN_WORDS.join(' '));
      // Wörter + Sound exakt auf den Aufschlägen der Faust (onBeat); resolved beim letzten = Reveal.
      const onBeat = (i) => {
        audio.play('shake');
        audio.play('tick');
        showWord(COUNTDOWN_WORDS[i]);
      };
      await Promise.all([
        handMe.shake(COUNTDOWN_WORDS.length, BEAT_MS, { onBeat }),
        handOpp.shake(COUNTDOWN_WORDS.length, BEAT_MS),
      ]);
      // Letztes Wort klingt während des Aufdeckens aus
      setTimeout(hideWord, BEAT_MS);
      stage.classList.remove('stage--countdown');
    },

    async reveal(round) {
      const key = OUTCOME_KEY[round.outcome];
      handMe.setMove(round.myMove ?? 'fist');
      handOpp.setMove(round.oppMove ?? 'fist');
      audio.play('clash');
      const c = centerOf(stage);
      fx.sparks(c.x, c.y);
      fx.screenShake(main, SHAKE_INTENSITY[key]);
      stage.classList.add('stage--clash');
      await wait(prefersLessMotion() ? REDUCED_HOLD_MS : CLASH_PAUSE_MS);
      stage.classList.remove('stage--clash');
      handMe.setState(key);
      handOpp.setState(round.outcome === 0 ? 'draw' : round.outcome === 1 ? 'lose' : 'win');
      result.className = `result result--${key}`;
      replaceChildren(result,
        h('span', { class: 'result__sentence' }, round.sentence),
        h('span', { class: 'result__sub' }, round.forfeit ? 'Nicht rechtzeitig aufgedeckt.' : OUTCOME_TEXT[round.outcome]));
      animate(result, [{ transform: 'translateY(10px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: RESULT_IN_MS, easing: 'ease-out' });
      audio.play(key);
      announce(`${round.sentence}. ${OUTCOME_TEXT[round.outcome]}`);
      await wait(prefersLessMotion() ? REDUCED_HOLD_MS : RESULT_HOLD_MS);
    },

    setScore(score, { scorer }) {
      renderPips(mePips, score[0], myName);
      renderPips(oppPips, score[1], oppName);
      if (!scorer) return;
      const pips = scorer === 'me' ? mePips : oppPips;
      const pip = pips.children[score[scorer === 'me' ? 0 : 1] - 1];
      if (!pip) return;
      pip.classList.add('pip--new');
      const c = centerOf(pip);
      fx.burst(c.x, c.y, { color: getComputedStyle(pip).getPropertyValue('--pip-color').trim() || undefined });
    },

    addHistory(round) {
      const key = OUTCOME_KEY[round.outcome];
      const name = (m) => MOVE_NAMES[m] ?? 'nichts';
      const label = `Runde ${round.number}: ${name(round.myMove)} gegen ${name(round.oppMove)} – ${{ win: 'gewonnen', lose: 'verloren', draw: 'unentschieden' }[key]}`;
      history.append(h('li', { class: `history__item history__item--${key}`, 'aria-label': label, title: label },
        h('span', { class: 'history__icon' }, moveIcon(round.myMove)),
        h('span', { class: 'history__icon history__icon--opp' }, moveIcon(round.oppMove))));
      while (history.children.length > HISTORY_MAX) history.firstElementChild.remove();
    },

    setFairness({ ok, proof, reason = null }) {
      fairness.hidden = false;
      replaceChildren(fairness, h('details', { class: ['fair__details', ok ? 'fair--ok' : 'fair--bad'], open: !ok },
        h('summary', { class: 'fair__summary' }, ok ? null : icon('warn', { size: 16 }), ok ? 'fair ✓' : '⚠ Hash passt nicht'),
        h('dl', { class: 'fair__list' },
          h('dt', {}, 'Zug'), h('dd', {}, MOVE_NAMES[proof.move] ?? proof.move),
          h('dt', {}, 'Nonce'), h('dd', {}, h('code', { title: proof.nonce }, `${proof.nonce.slice(0, NONCE_PREVIEW_CHARS)}…`)),
          h('dt', {}, 'Hash'), h('dd', {}, h('code', { class: 'fair__hash' }, proof.hash))),
        h('p', { class: 'fair__note' }, ok ? 'sha256(„Zug:Nonce“) ergibt genau den Hash, der vor dem Aufdecken festgelegt wurde.' : FAIR_PROBLEM[reason] ?? FAIR_PROBLEM.hash)));
    },

    setInsight(text) {
      insightText = text;
      renderInsight();
    },

    showReaction({ emoji, fromMe }) {
      if (fromMe) return; // eigene Reaktion wurde schon beim Klick gezeigt
      const c = centerOf(handOpp.el);
      fx.floatEmoji(emoji, { x: c.x });
      audio.play('pop');
    },

    /** won: true/false, null = kein Sieger (neutral); rematch: letzter Revanche-Status (online). */
    async showMatchOver({ won, score, reason, rematch = null }) {
      setMovesEnabled(false);
      setDeadline(null, null);
      setClaimAvailable(false);
      const note = won === null ? null : END_NOTES[reason]?.(oppName, won) ?? null;
      overlay = matchEndOverlay({
        won, score, myName, oppName, note, series,
        againLabel: opts.againLabel, onAgain: opts.onAgain, onMenu: opts.onMenu,
      });
      main.inert = true;
      el.append(overlay.el);
      if (rematch) setRematchStatus(rematch);
      if (won === null) {
        announce(`Match beendet, ohne Sieger. ${score[0]} zu ${score[1]}.`);
      } else {
        audio.play(won ? 'matchWin' : 'matchLose');
        if (won) fx.confetti({});
        else fx.rain({});
        announce(`${won ? 'Sieg' : 'Niederlage'}! ${score[0]} zu ${score[1]}.`);
      }
      overlay.focus();
    },

    hideMatchOver() {
      if (!overlay) return;
      refocusMoves = overlay.el.contains(document.activeElement);
      overlay.el.remove();
      overlay = null;
      main.inert = false;
    },

    setSeries(value) {
      series = value;
      seriesEl.hidden = !value;
      if (value) seriesEl.textContent = `Serie ${value.me} : ${value.opp}`;
    },

    setDeadline,
    setClaimAvailable,
    setRematchStatus,

    dispose() {
      clearInterval(deadlineTimer);
    },

    showError(message) {
      result.className = 'result result--error';
      replaceChildren(result, h('span', { class: 'result__sub' }, message));
      announce(message);
    },
  };
}
