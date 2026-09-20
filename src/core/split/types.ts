import { Fraction } from '../money/fraction';

export type SplitMethod = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';

export interface SplitParticipant {
  readonly id: string;
  /** EXACT only: the participant's amount in minor units. */
  readonly amount?: number;
  /**
   * PERCENT / SHARES only: the participant's relative weight, as an exact rational — a
   * partial item share ("Alice takes a third of the wine") is `{ num: 1, den: 3 }`, never
   * the float 0.3333 (docs/plan/EXECUTE.md Phase 1.2).
   */
  readonly weight?: Fraction;
}
