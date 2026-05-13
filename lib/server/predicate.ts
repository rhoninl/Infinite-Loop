import type { BranchOp } from '../shared/workflow';

export interface Predicate {
  lhs: string;
  op: BranchOp;
  rhs: string;
}

export type PredicateVerdict =
  | { ok: true; result: boolean }
  | { ok: false; error: string };

export function evaluatePredicate(p: Predicate): PredicateVerdict {
  switch (p.op) {
    case '==':
      return { ok: true, result: p.lhs === p.rhs };
    case '!=':
      return { ok: true, result: p.lhs !== p.rhs };
    case 'contains':
      return { ok: true, result: p.lhs.includes(p.rhs) };
    case 'matches':
      try {
        return { ok: true, result: new RegExp(p.rhs).test(p.lhs) };
      } catch (err) {
        return { ok: false, error: `invalid regex: ${(err as Error).message}` };
      }
  }
}
