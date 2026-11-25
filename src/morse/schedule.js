export const RESOURCE_ID = 'signal-assessment:COMMON_PLAYBACK_CONTROL@1';
export const LOCK_NAME = 'signal-assessment:COMMON_PLAYBACK_CONTROL';

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildSchedule({ entry, dotDurationMs, questionGapMs, startAtMono }) {
  if (!entry || typeof entry.code !== 'string' || !/^[.-]{1,5}$/.test(entry.code)) throw new Error('教材の符号が不正です');
  if (!Number.isFinite(dotDurationMs) || dotDurationMs < 50 || dotDurationMs > 300) throw new Error('uは50〜300msにしてください');
  if (!Number.isFinite(questionGapMs) || questionGapMs < 1000 || questionGapMs > 5000) throw new Error('問題間隔は1000〜5000msにしてください');
  if (!Number.isFinite(startAtMono)) throw new Error('再生開始の単調時計が不正です');
  const transitions = [];
  let at = startAtMono + questionGapMs;
  for (let i = 0; i < entry.code.length; i++) {
    transitions.push(Object.freeze({ index: transitions.length, on: true, plannedAtMono: at }));
    at += (entry.code[i] === '.' ? 1 : 3) * dotDurationMs;
    transitions.push(Object.freeze({ index: transitions.length, on: false, plannedAtMono: at }));
    if (i < entry.code.length - 1) at += dotDurationMs;
  }
  return Object.freeze({
    entryId: entry.entryId,
    char: entry.char,
    code: entry.code,
    dotDurationMs,
    questionGapMs,
    startAtMono,
    sendCompletedAtMono: at,
    durationMs: at - startAtMono - questionGapMs,
    transitions: Object.freeze(transitions),
  });
}

export function summarizeTiming(schedule, observations, frameIntervals) {
  if (observations.length !== schedule.transitions.length) throw new Error('切替の観測数が一致しません');
  const delays = observations.map((o, i) => {
    if (o.index !== i || !Number.isFinite(o.actualAtMono)) throw new Error('切替の観測が不正です');
    return o.actualAtMono - schedule.transitions[i].plannedAtMono;
  });
  const medianFrameMs = median(frameIntervals.filter(n => Number.isFinite(n) && n > 0));
  const maxDelayMs = Math.max(...delays);
  const halfUWarningCount = delays.filter(n => n >= schedule.dotDurationMs / 2).length;
  return {
    transitionCount: delays.length,
    maxDelayMs,
    medianDelayMs: median(delays),
    medianFrameMs,
    halfUWarningCount,
    qualityWarning: halfUWarningCount > 0,
    frameTarget: medianFrameMs === null ? 'UNMEASURED' : maxDelayMs <= medianFrameMs ? 'WITHIN_ONE_FRAME' : maxDelayMs <= 2 * medianFrameMs ? 'WITHIN_TWO_FRAMES' : 'OVER_TWO_FRAMES',
  };
}

export function runSchedule(schedule, { now = () => performance.now(), requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, onTransition, onDark, signal } = {}) {
  if (typeof onTransition !== 'function' || typeof onDark !== 'function') throw new TypeError('発光と消灯の処理が必要です');
  return new Promise((resolve, reject) => {
    const observations = [];
    const frameIntervals = [];
    let index = 0;
    let frameId;
    let lastFrame;
    let settled = false;
    const stop = (error) => {
      if (settled) return;
      settled = true;
      if (frameId !== undefined) cancelFrame(frameId);
      signal?.removeEventListener('abort', onAbort);
      onDark();
      if (error) reject(error);
      else resolve({ observations, frameIntervals });
    };
    const onAbort = () => stop(new DOMException('再生を中断しました', 'AbortError'));
    const tick = () => {
      if (settled) return;
      try {
        const frameAtMono = now();
        if (lastFrame !== undefined) frameIntervals.push(frameAtMono - lastFrame);
        lastFrame = frameAtMono;
        while (index < schedule.transitions.length && frameAtMono >= schedule.transitions[index].plannedAtMono) {
          const transition = schedule.transitions[index];
          onTransition(transition.on);
          const actualAtMono = now();
          observations.push({ index, plannedAtMono: transition.plannedAtMono, actualAtMono, on: transition.on, delayMs: actualAtMono - transition.plannedAtMono });
          index++;
        }
        if (index === schedule.transitions.length) stop();
        else frameId = requestFrame(tick);
      } catch (error) { stop(error); }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else frameId = requestFrame(tick);
  });
}
