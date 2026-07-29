export type AppRoute =
  | { type: 'home' }
  | { type: 'flow' }
  | { type: 'leveling' }
  | { type: 'flow-deviation' }
  | { type: 'spirit-level' };

export type AppModule = Exclude<AppRoute['type'], 'home'>;
