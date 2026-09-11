import { createContext, useContext } from 'react';
import type { AppConfig, DestCode, Listing } from './api';
import type { DisplayCurrency } from './format';
import type { Route } from './hooks';
import type { Lang, T } from './i18n';

export interface AppCtx {
  t: T;
  lang: Lang;
  dest: DestCode;
  destName: string;
  port: string;
  ccy: DisplayCurrency;
  /** EUR → Anzeigewährung formatieren */
  money: (eur: number) => string;
  config: AppConfig | null;
  pro: boolean;
  now: number;
  saved: string[];
  compare: string[];
  toggleSaved: (id: string) => void;
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  navigate: (r: Route) => void;
  marketLabel: (m: Listing['market']) => string;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext fehlt');
  return ctx;
}
