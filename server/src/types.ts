// Core domain types. Semantics intentionally mirror Anki so imports round-trip.

export const CardType = { New: 0, Learn: 1, Review: 2, Relearn: 3 } as const;
export const Queue = {
  UserBuried: -3,
  SchedBuried: -2,
  Suspended: -1,
  New: 0,
  Learn: 1, // intraday learning; due = epoch seconds
  Review: 2, // due = day number
  DayLearn: 3, // interday learning; due = day number
  Preview: 4,
} as const;

export const RevlogType = { Learn: 0, Review: 1, Relearn: 2, Filtered: 3, Manual: 4, Rescheduled: 5 } as const;

export interface CardRow {
  id: number;
  nid: number;
  did: number;
  ord: number;
  mtime: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number; // remaining learning steps
  odue: number;
  odid: number;
  flags: number;
  stability: number | null;
  difficulty: number | null;
  last_review: number | null; // epoch secs
  custom_data: string | null;
}

export interface NoteRow {
  id: number;
  guid: string;
  ntid: number;
  mtime: number;
  tags: string;
  flds: string;
  sfld: string;
  csum: number;
  /** Place in the deck's original order ("#") when it isn't the creation order; null = by id. */
  sort_pos?: number | null;
}

export interface FieldDef {
  name: string;
  ord: number;
  sticky?: boolean;
  rtl?: boolean;
  font?: string;
  size?: number;
  description?: string;
  plainText?: boolean;
  collapsed?: boolean;
  excludeFromSearch?: boolean;
}

export interface TemplateDef {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  bqfmt?: string;
  bafmt?: string;
  targetDeckId?: number;
}

export interface Notetype {
  id: number;
  name: string;
  kind: 0 | 1; // 0 normal, 1 cloze
  css: string;
  sortIdx: number;
  fields: FieldDef[];
  templates: TemplateDef[];
  latexPre: string;
  latexPost: string;
  mtime: number;
  originalId?: number | null;
}

export interface FilteredTerm {
  search: string;
  limit: number;
  order: number; // Deck.Filtered.SearchTerm.Order
}

export interface FilteredConfig {
  terms: FilteredTerm[];
  reschedule: boolean;
  previewAgainSecs: number;
  previewHardSecs: number;
  previewGoodSecs: number;
}

export interface Deck {
  id: number;
  name: string;
  kind: 0 | 1;
  configId: number;
  description: string;
  filtered: FilteredConfig | null;
  collapsed: boolean;
  mtime: number;
  reviewLimit?: number | null; // deck-level override
  newLimit?: number | null;
  desiredRetention?: number | null;
}

export interface DeckConfig {
  id: number;
  name: string;
  mtime: number;
  // daily limits
  newPerDay: number;
  reviewsPerDay: number;
  newIgnoreReviewLimit: boolean;
  // new cards
  learnSteps: number[]; // minutes
  graduatingIvl: number;
  easyIvl: number;
  initialEase: number; // e.g. 2.5
  newInsertOrder: number; // 0 due, 1 random
  newGatherPriority: number;
  newSortOrder: number;
  newMix: number; // ReviewMix
  interdayLearningMix: number;
  reviewOrder: number;
  // lapses
  relearnSteps: number[];
  minLapseIvl: number;
  lapseMult: number; // "new interval"
  leechThreshold: number;
  leechAction: number; // 0 suspend, 1 tag only
  // advanced
  maxIvl: number;
  easyMult: number; // easy bonus
  hardMult: number;
  ivlMult: number; // interval modifier
  // burying
  buryNew: boolean;
  buryReviews: boolean;
  buryInterday: boolean;
  // display / timer
  showTimer: boolean;
  capAnswerSecs: number;
  disableAutoplay: boolean;
  skipQuestionWhenReplayingAnswer: boolean;
  autoAdvanceQuestionSecs: number;
  autoAdvanceAnswerSecs: number;
  autoAdvanceAnswerAction: number; // AnswerAction
  // fsrs
  desiredRetention: number;
  fsrsParams: number[];
  historicalRetention: number;
  ignoreRevlogsBefore: string;
  // load balancing / easy days (improvements)
  easyDays: number[]; // 7 values (Mon..Sun) 0..1 relative workload
}

export interface CollectionConfig {
  rolloverHour: number;
  learnAheadMins: number;
  timeboxMins: number;
  fsrs: boolean;
  loadBalancer: boolean;
  currentDeckId: number;
  addingDefaultsToCurrentDeck: boolean;
  lastNotetypeId: number;
  lastDeckId: number;
  newSpread: number;
  dayLearnFirst: boolean;
  collectionCreated: number;
  showIntervalsOnButtons: boolean;
  showRemainingCount: boolean;
  backupKeep: number;
}
