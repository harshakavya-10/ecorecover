import crypto from 'node:crypto';

// Real mode: Amazon Rekognition DetectLabels, labels mapped to our categories.
const MAP = {
  mobile_phone: ['mobile phone', 'phone', 'cell phone', 'iphone', 'smartphone'],
  laptop: ['laptop', 'notebook', 'pc', 'computer'],
  charger: ['adapter', 'plug', 'power adapter', 'charger'],
  cable: ['cable', 'wire', 'cord', 'usb'],
  circuit_board: ['circuit board', 'printed circuit board', 'electronic chip', 'computer hardware'],
  battery: ['battery'],
};
export const MIN_CONFIDENCE = 70;

export function mapLabels(labels) {
  let best = null;
  for (const l of labels) {
    for (const [cat, names] of Object.entries(MAP)) {
      if (names.includes(l.Name.toLowerCase()) && (!best || l.Confidence > best.confidence))
        best = { category: cat, confidence: Math.round(l.Confidence * 10) / 10 };
    }
  }
  const labelsOut = labels.slice(0, 5).map((l) => `${l.Name} (${Math.round(l.Confidence)}%)`);
  if (!best || best.confidence < MIN_CONFIDENCE)
    return { category: 'other', confidence: best?.confidence ?? null, uncertain: true, labels: labelsOut };
  return { ...best, uncertain: false, labels: labelsOut };
}

export async function classifyImage(buffer) {
  if ((process.env.CLASSIFIER || 'demo') === 'rekognition') {
    try {
      const { RekognitionClient, DetectLabelsCommand } = await import('@aws-sdk/client-rekognition');
      const client = new RekognitionClient({ region: process.env.AWS_REGION || 'ap-south-1' });
      const out = await client.send(new DetectLabelsCommand({ Image: { Bytes: buffer }, MaxLabels: 15, MinConfidence: 50 }));
      return { mode: 'rekognition', ...mapLabels(out.Labels || []) };
    } catch (e) {
      console.error('Rekognition failed:', e.name);
      return { mode: 'unavailable', category: null, confidence: null, uncertain: true, labels: [],
        message: 'AI service unavailable. Please choose the category manually.' };
    }
  }
  // DEMO MODE: NOT a real prediction. Picks a sample category from the file hash so it is repeatable.
  const cats = Object.keys(MAP);
  const h = crypto.createHash('sha256').update(buffer).digest()[0];
  return { mode: 'demo', category: cats[h % cats.length], confidence: null, uncertain: true, labels: [],
    message: 'DEMO MODE: this is a sample result, not a real prediction. Set CLASSIFIER=rekognition to use the real model. Please confirm or change the category.' };
}
