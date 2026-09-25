/**
 * ScamScope engine - a thin wrapper around the QVAC JS SDK (@qvac/sdk).
 *
 * Every inference call here runs on-device through the QVAC worker.
 * The model itself is downloaded once on first run (progress is surfaced
 * through `onProgress`); after that, analysis works fully offline.
 *
 * SDK functions used: loadModel, completion, cancel, unloadModel, close.
 */

// Qwen3 1.7B (Q4) - strong instruction following at a phone-scale footprint.
// Swap for LLAMA_3_2_1B_INST_Q4_0 or QWEN3_600M_INST_Q4 if you prefer.
const CTX_SIZE = 4096;
const MAX_PREDICT = 700;

let sdk = null; // lazily imported @qvac/sdk module namespace
let modelId = null; // handle returned by loadModel
let loadingPromise = null;

async function getSdk() {
  if (sdk) return sdk;
  try {
    sdk = await import('@qvac/sdk');
  } catch {
    throw new Error('QVAC SDK not installed - run "npm install" first.');
  }
  return sdk;
}

/**
 * Load the model once and reuse the handle for every analysis.
 * `onProgressCb` receives download/load progress events (first run only).
 */
export async function ensureModel(onProgressCb) {
  const report = onProgressCb || function noop() {};
  if (modelId) return modelId;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { loadModel, QWEN3_1_7B_INST_Q4 } = await getSdk();
    const id = await loadModel({
      modelSrc: QWEN3_1_7B_INST_Q4,
      modelType: 'llm',
      modelConfig: { ctx_size: CTX_SIZE },
      onProgress: function (p) { report(p); },
    });
    modelId = id;
    return id;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function isModelReady() {
  return modelId !== null;
}

/**
 * Build the conversation for one analysis.
 *
 * Single user turn containing two worked examples (a scam and a normal
 * message) plus the user's real message. Examples calibrate the format and
 * the verdict bar; Qwen3 models emit thinking traces, disabled via the
 * /no_think switch so the verdict card streams cleanly.
 */
export function buildHistory(message) {
  const formatBlock = [
    'You are ScamScope, a scam-message analyst. Reply in EXACTLY this format (plain text, no markdown, no preamble):',
    '',
    'VERDICT: SCAM or SUSPICIOUS or LIKELY LEGIT',
    'CONFIDENCE: HIGH or MEDIUM or LOW',
    'TACTICS:',
    '- one short manipulation tactic found, e.g. urgency deadline, authority impersonation, prize bait, payment via gift cards or crypto or wire, asks for OTP or password, threatening arrest, lookalike domain',
    '- more lines if present',
    'WHY:',
    '- short reason citing something specific from the message',
    'DO NOT:',
    '- one short risky action to avoid',
    'SAFER STEP: one sentence naming the official way to verify, e.g. hang up and call the number on your card, or open the official app. If the message is legitimate, write "No action needed."',
    '',
    'Red flags to weigh: unexpected contact, urgency or countdowns, secrecy, requests for money, OTPs, PINs, card numbers, gift cards, wire transfers or crypto, threats of account closure or arrest, links or numbers that look almost official, prizes you never entered.',
    '',
    'Example 1:',
    '=== MESSAGE START ===',
    'CONGRATULATIONS! You won a 900 dollar Walmart gift card. Claim within 6 hours at walmart-prize-win.com and pay the 1 dollar processing fee with your card details.',
    '=== MESSAGE END ===',
    'VERDICT: SCAM',
    'CONFIDENCE: HIGH',
    'TACTICS:',
    '- Too-good-to-be-true prize offer',
    '- Urgency: 6 hour deadline',
    '- Payment: card details for a processing fee',
    'WHY:',
    '- Real prizes never require paying a fee first',
    '- The link is not an official Walmart domain',
    'DO NOT:',
    '- Do not open the link or enter card details',
    'SAFER STEP: Delete the message. To check a prize, contact the company through its official website or app.',
    '',
    'Example 2:',
    '=== MESSAGE START ===',
    'Hi, this is Ramesh from the apartment committee. Water tank cleaning is on Saturday 10am. Please keep your balcony taps closed from 9 to 12.',
    '=== MESSAGE END ===',
    'VERDICT: LIKELY LEGIT',
    'CONFIDENCE: HIGH',
    'TACTICS:',
    '- none detected',
    'WHY:',
    '- Specific local context, no money involved, no urgency, no links',
    'DO NOT:',
    '- nothing risky',
    'SAFER STEP: No action needed.',
    '',
    'Now analyze the real message between the markers:',
    '=== MESSAGE START ===',
    message,
    '=== MESSAGE END === /no_think',
  ].join('\n');

  return [{ role: 'user', content: formatBlock }];
}

/**
 * Run one analysis against the loaded model. Returns the QVAC CompletionRun
 * (async iterable `events` plus aggregated `final` promise and `requestId`).
 * Temperature 0 keeps verdicts deterministic; captureThinking keeps any
 * residual thinking output out of the content stream.
 */
export async function analyzeStream(message) {
  if (!modelId) throw new Error('Model not loaded - call ensureModel() first.');
  const { completion } = await getSdk();
  return completion({
    modelId,
    history: buildHistory(message),
    generationParams: { temp: 0, predict: MAX_PREDICT },
    captureThinking: true,
    stream: true,
  });
}

/** Best-effort cancellation of an in-flight analysis (client disconnected). */
export async function cancelAnalysis(requestId) {
  if (!requestId) return;
  try {
    const { cancel } = await getSdk();
    await cancel({ requestId });
  } catch {
    /* cancellation is best-effort */
  }
}

/** Free the model's RAM while keeping the downloaded weights on disk. */
export async function releaseModel() {
  if (!modelId) return;
  const { unloadModel } = await getSdk();
  try {
    await unloadModel({ modelId, clearStorage: false });
  } finally {
    modelId = null;
  }
}

/** Unload the model and shut the QVAC worker down cleanly. */
export async function shutdown() {
  try {
    await releaseModel();
  } catch {
    /* ignore */
  }
  try {
    const { close } = await getSdk();
    await close();
  } catch {
    /* ignore */
  }
}
