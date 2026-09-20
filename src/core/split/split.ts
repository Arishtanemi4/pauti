import { ONE } from '../money/fraction';
import { distributeByWeight } from '../money/distribute';
import { SplitMethod, SplitParticipant } from './types';

export function computeSplit(
  totalMinorUnits: number,
  method: SplitMethod,
  participants: readonly SplitParticipant[]
): Record<string, number> {
  switch (method) {
    case 'EQUAL':
      return distributeByWeight(
        totalMinorUnits,
        participants.map((p) => ({ id: p.id, weight: ONE }))
      );

    case 'PERCENT':
    case 'SHARES':
      return distributeByWeight(
        totalMinorUnits,
        participants.map((p) => {
          if (!p.weight) {
            throw new Error(`Participant ${p.id} is missing a weight for a ${method} split`);
          }
          return { id: p.id, weight: p.weight };
        })
      );

    case 'EXACT': {
      const result: Record<string, number> = {};
      let sum = 0;
      for (const p of participants) {
        if (p.amount === undefined) {
          throw new Error(`Participant ${p.id} is missing an amount for an EXACT split`);
        }
        result[p.id] = p.amount;
        sum += p.amount;
      }
      if (sum !== totalMinorUnits) {
        throw new Error(`EXACT split amounts (${sum}) do not sum to the total (${totalMinorUnits})`);
      }
      return result;
    }
  }
}
