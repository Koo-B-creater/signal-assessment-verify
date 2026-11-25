function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function analyzeMeasurement(samples, dotDurationMs) {
  const groups = new Map();
  for (const sample of samples) {
    if (!groups.has(sample.entryId)) groups.set(sample.entryId, { entryId: sample.entryId, char: sample.char, code: sample.code, repetitionCount: 0, transitionCount: 0, delays: [], frames: [] });
    const group = groups.get(sample.entryId);
    group.repetitionCount++;
    group.transitionCount += sample.transitions.length;
    group.delays.push(...sample.transitions.map(transition => transition.delayMs));
    group.frames.push(...sample.frameIntervals.filter(value => Number.isFinite(value) && value > 0));
  }
  const conditions = [...groups.values()].map(group => {
    const medianFrameMs = median(group.frames);
    const maxDelayMs = Math.max(...group.delays);
    return {
      entryId: group.entryId,
      char: group.char,
      code: group.code,
      repetitionCount: group.repetitionCount,
      transitionCount: group.transitionCount,
      maxDelayMs,
      medianDelayMs: median(group.delays),
      medianFrameMs,
      halfUWarningCount: group.delays.filter(value => value >= dotDurationMs / 2).length,
      frameTarget: medianFrameMs === null ? 'UNMEASURED' : maxDelayMs <= medianFrameMs ? 'WITHIN_ONE_FRAME' : maxDelayMs <= 2 * medianFrameMs ? 'WITHIN_TWO_FRAMES' : 'OVER_TWO_FRAMES',
    };
  });
  const betweenPlaybacks = [];
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    betweenPlaybacks.push({
      previousEntryId: previous.entryId,
      nextEntryId: current.entryId,
      previousFinalDarkAtMono: previous.transitions.at(-1).actualAtMono,
      nextFirstLightPlannedAtMono: current.transitions[0].plannedAtMono,
      darkToNextLightPlannedMs: current.transitions[0].plannedAtMono - previous.transitions.at(-1).actualAtMono,
    });
  }
  return { conditions, betweenPlaybacks };
}
