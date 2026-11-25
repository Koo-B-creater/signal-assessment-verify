import { loadApprovedMaterial } from '../src/morse/material.js';
import { LOCK_NAME, RESOURCE_ID, buildSchedule, runSchedule, summarizeTiming } from '../src/morse/schedule.js';
import { analyzeMeasurement } from './analysis.js';

const MEASUREMENT_VERSION = 'MORSE-MEASURE-0.2.3';
const BASE_COMMIT = 'fcca94809cb68a1608d64ff015295ccb0588c3fe';
const $ = id => document.getElementById(id);
const buttons = ['single', 'representatives', 'five-elements'];
const state = { material: null, running: false, abortController: null, report: null };

function topLevel() { return window.top === window.self; }
function hasLocks() { return typeof navigator.locks?.request === 'function'; }
function showEnvironment() {
  $('environment').textContent = `配信オリジン: ${location.origin} ／ 最上位文書: ${topLevel() ? 'はい' : 'いいえ'} ／ 安全なコンテキスト: ${window.isSecureContext ? 'はい' : 'いいえ'} ／ 計測道具: ${MEASUREMENT_VERSION}`;
}
function setDark() { $('lamp').classList.remove('on'); $('lamp').setAttribute('aria-label', '消灯'); }
function setLamp(on) { $('lamp').classList.toggle('on', on); $('lamp').setAttribute('aria-label', on ? '点灯' : '消灯'); }
function setStatus(message) { $('status').textContent = message; }
function updateButtons() {
  const ready = Boolean(state.material) && topLevel() && window.isSecureContext && hasLocks() && $('ack').checked && !state.running;
  for (const id of buttons) $(id).disabled = !ready;
  $('stop').disabled = !state.running;
  $('download').disabled = !state.report;
}
function stop() { setDark(); state.abortController?.abort(); }

document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stop(); });
window.addEventListener('pagehide', stop);
$('stop').addEventListener('click', stop);
$('ack').addEventListener('change', updateButtons);
showEnvironment();

async function startBatch(entries, repeatCount) {
  if (state.running || !state.material) return;
  if (!topLevel()) return setStatus('iframe内では計測しません。自分のオリジンの最上位文書で開いてください。');
  if (!window.isSecureContext || !hasLocks()) return setStatus('安全なオリジンとWeb Locksが必要です。');
  if (document.visibilityState !== 'visible') return setStatus('画面を表示してから開始してください。');
  const u = Number($('u').value);
  const questionGapMs = Number($('gap').value);
  if (!Number.isFinite(u) || u < 50 || u > 300 || !Number.isFinite(questionGapMs) || questionGapMs < 1000 || questionGapMs > 5000) return setStatus('uは50〜300ms、前置きは1000〜5000msにしてください。');
  state.running = true;
  state.report = null;
  state.abortController = new AbortController();
  updateButtons();
  const report = {
    measurementVersion: MEASUREMENT_VERSION,
    sourceCommit: $('source-commit').value.trim() || 'UNCOMMITTED',
    deviceLabel: $('device-label').value.trim() || 'UNRECORDED',
    judgedBy: $('judge').value.trim() || 'UNRECORDED',
    specificationBaseCommit: BASE_COMMIT,
    materialSetId: state.material.setId,
    materialRev: state.material.rev,
    materialSha256: state.material.sha256,
    resourceId: RESOURCE_ID,
    origin: location.origin,
    topLevelDocument: topLevel(),
    userAgent: navigator.userAgent,
    clockSources: { playback: 'performance.now', wall: 'Date.now', transitionObservation: 'DOM切替直後のperformance.now', paintObservation: '未測定。通常の描画ではDOM切替後に約1フレーム遅れる場合がある。表示停止等ではさらに遅れうる' },
    navigatorOnlineAtStart: navigator.onLine,
    startedAtWall: new Date().toISOString(),
    conditions: { dotDurationMs: u, questionGapMs, requestedEntries: entries.map(e => e.entryId), repeatCount },
    samples: [],
    completed: false,
  };
  try {
    await navigator.locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('別のタブ・ウィンドウで再生制御資源を使用中です。');
      for (const entry of entries) {
        for (let repetition = 1; repetition <= repeatCount; repetition++) {
          if (state.abortController.signal.aborted || document.visibilityState !== 'visible') throw new DOMException('計測を中断しました', 'AbortError');
          setStatus(`${entry.char}（${entry.code}） ${repetition}/${repeatCount}、全体 ${report.samples.length + 1}/${entries.length * repeatCount}`);
          const startAtMono = performance.now();
          const startedAtWall = new Date().toISOString();
          const schedule = buildSchedule({ entry, dotDurationMs: u, questionGapMs, startAtMono });
          const result = await runSchedule(schedule, { onTransition: setLamp, onDark: setDark, signal: state.abortController.signal });
          report.samples.push({ entryId: entry.entryId, char: entry.char, code: entry.code, repetition, startedAtWall, startAtMono, sendCompletedAtMono: schedule.sendCompletedAtMono, transitions: result.observations, frameIntervals: result.frameIntervals, timing: summarizeTiming(schedule, result.observations, result.frameIntervals) });
        }
      }
      setDark();
      report.completed = true;
    });
    setStatus(`計測終了。${report.samples.length}回分を記録しました。`);
  } catch (error) {
    report.interruption = { atWall: new Date().toISOString(), reason: error?.message ?? String(error) };
    setStatus(`計測を終了しました。完了済み ${report.samples.length}回。理由：${report.interruption.reason}`);
  } finally {
    setDark();
    report.endedAtWall = new Date().toISOString();
    report.analysis = analyzeMeasurement(report.samples, u);
    state.running = false;
    state.abortController = null;
    state.report = report;
    const timings = report.samples.map(s => s.timing);
    $('summary').textContent = JSON.stringify({ completed: report.completed, samples: report.samples.length, maxDelayMs: timings.length ? Math.max(...timings.map(t => t.maxDelayMs)) : null, halfUWarningCount: timings.reduce((n, t) => n + t.halfUWarningCount, 0), conditions: report.analysis.conditions, betweenPlaybacks: report.analysis.betweenPlaybacks, materialSha256: report.materialSha256, measurementVersion: MEASUREMENT_VERSION }, null, 2);
    updateButtons();
  }
}

$('single').addEventListener('click', () => startBatch([state.material.entries.find(e => e.entryId === $('character').value)], 1));
$('representatives').addEventListener('click', () => startBatch(['5', 'ル', 'ー', '0'].map(char => state.material.entries.find(e => e.char === char)), 20));
$('five-elements').addEventListener('click', () => startBatch(state.material.entries.filter(e => e.code.length === 5), 1));
$('download').addEventListener('click', () => {
  if (!state.report) return;
  state.report.sourceCommit = $('source-commit').value.trim() || 'UNCOMMITTED';
  state.report.deviceLabel = $('device-label').value.trim() || 'UNRECORDED';
  state.report.judgedBy = $('judge').value.trim() || 'UNRECORDED';
  state.report.requiredMetadataPresent = /^[0-9a-f]{40}$/.test(state.report.sourceCommit) && state.report.deviceLabel !== 'UNRECORDED' && state.report.judgedBy !== 'UNRECORDED' && state.report.completed;
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `morse-measurement-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  if (!topLevel()) throw new Error('iframe内では計測しません。自分のオリジンの最上位文書で開いてください。');
  if (!window.isSecureContext || !hasLocks()) throw new Error('安全なオリジンとWeb Locksが必要です。');
  state.material = await loadApprovedMaterial();
  for (const entry of state.material.entries) {
    const option = document.createElement('option');
    option.value = entry.entryId;
    option.textContent = `${entry.char} ${entry.code}`;
    $('character').append(option);
  }
  $('character').value = state.material.entries.find(e => e.char === '5').entryId;
  setStatus('教材の版とSHA-256を確認しました。点滅の注意を確認して計測を開始できます。');
} catch (error) { setStatus(error?.message ?? String(error)); }
updateButtons();
