// Zustand als Text zum Vergleichen (sortiert, ohne Zufallsreihenfolge)
import type { State } from '../../src/types';

export const snapshot = (st: State) => JSON.stringify({
  accounts: [...st.accounts.values()].sort((a, b) => a.id.localeCompare(b.id)),
  categories: [...st.categories.values()].sort((a, b) => a.id.localeCompare(b.id)),
  tx: [...st.tx.values()].sort((a, b) => a.id.localeCompare(b.id)),
  rules: [...st.rules].sort((a, b) => a[0].localeCompare(b[0])),
}, null, 1);
