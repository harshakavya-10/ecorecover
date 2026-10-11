// Disposal guidance rules. Deterministic and unit-tested. No dismantling / burning advice, ever.
export const CATEGORIES = {
  mobile_phone: { label: 'Mobile phone', kg: 0.2, hazard: false },
  laptop: { label: 'Laptop', kg: 2.5, hazard: false },
  charger: { label: 'Charger / adapter', kg: 0.15, hazard: false },
  cable: { label: 'Cable', kg: 0.1, hazard: false },
  circuit_board: { label: 'Circuit board', kg: 0.3, hazard: false },
  battery: { label: 'Battery', kg: 0.05, hazard: true },
  other: { label: 'Other e-waste', kg: 1, hazard: false },
};
export const CONDITIONS = ['working', 'repairable', 'non_functional'];

export function recommend(category, condition = 'non_functional') {
  const c = CATEGORIES[category];
  if (!c) throw new Error('Unknown category');
  const warnings = ['Never open, crush, puncture or burn electronics or batteries.'];
  const steps = [];
  let action, title;

  if (c.hazard) {
    action = 'specialist_collection';
    title = 'Hand over for specialist battery collection';
    warnings.push('Batteries can overheat or catch fire. Do not put them in household bins.');
    steps.push(
      'Stop using the battery if it is swollen, hot, leaking or damaged.',
      'Store it in a cool, dry place away from flammable items, in a non-metal container.',
      'Do not try to dismantle it. Request a collection and mark it as hazardous.',
    );
  } else if (condition === 'working') {
    action = 'reuse';
    title = 'Reuse or donate';
    steps.push('Donate or hand it to someone who can use it.');
  } else if (condition === 'repairable') {
    action = 'repair';
    title = 'Repair first';
    steps.push('Take it to a repair shop before recycling. Repair keeps it in use longer.');
  } else {
    action = 'recycle';
    title = 'Send to authorised e-waste collection';
    steps.push('Keep it dry and separate from household waste.', 'Request a pickup or drop-off.');
  }
  if (['mobile_phone', 'laptop'].includes(category)) {
    steps.push('Back up and factory-reset it, and remove SIM and memory cards, before handing it over.');
    warnings.push('Contains a lithium battery. If it is swollen or damaged, say so in the notes.');
  }
  return {
    category, condition, action, title, steps, warnings, hazardous: c.hazard,
    note: 'Collection options shown in this app are unverified demo data, not certified recyclers.',
  };
}
