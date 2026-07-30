export type AppRoute =
  | { type: 'home' }
  | { type: 'flow' }
  | { type: 'leveling' }
  | { type: 'flow-deviation' }
  | { type: 'spirit-level' }
  | { type: 'governance' }
  | { type: 'app-info' };

export type AppModule = Exclude<AppRoute['type'], 'home'>;
