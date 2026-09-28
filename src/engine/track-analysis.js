import { analyzePresence } from './presence.js';
import { onsetEnvelopeAsync, findBeats } from './beats.js';
import { toAnalysisSamples, ANALYSIS_RATE } from './keydetect.js';

/**
 * Stems in the order they are trusted to carry the beat: a drum stem is pure
 * rhythm, and an instrumental is the song without its voice.
 */
const RHYTHM_ORDER = ['drums', 'instrumental', 'other', 'bass', 'vocals'];

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Everything the feedback layer needs to know about a loaded stem set: where
 * each stem has content, and where the song's beats fall.
 *
 * This runs once playback has started and yields between steps. Nothing in it
 * is on the path from a keystroke to sound.
 *
 * @param buffers Map of stem role to decoded AudioBuffer.
 * @returns {Promise<{ lanes: Record<string, { values: Float32Array, frameRate: number,
 *   phrases: { start: number, end: number }[] }>, beats: import('./beats.js').BeatGrid | null,
 *   rhythmRole: string | undefined }>}
 */
export async function analyzeStems(buffers, { OfflineCtx = globalThis.OfflineAudioContext } = {}) {
  const lanes = {};
  for (const [role, buffer] of buffers) {
    lanes[role] = analyzePresence(buffer);
    await breathe();
  }

  const rhythmRole = RHYTHM_ORDER.find((role) => buffers.has(role)) ?? buffers.keys().next().value;
  let beats = null;
  try {
    const samples = await toAnalysisSamples(buffers.get(rhythmRole), OfflineCtx, { seconds: Infinity });
    beats = await findBeats(await onsetEnvelopeAsync(samples, ANALYSIS_RATE));
  } catch (error) {
    // The presence lanes stand on their own; only beat feedback is lost.
    console.warn('[analysis] Beat tracking unavailable:', error?.message ?? error);
  }
  return { lanes, beats, rhythmRole };
}
