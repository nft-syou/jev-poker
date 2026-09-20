/**
 * The 169 starting-hand classes, strongest first, ranked by heads-up all-in equity against a
 * random hand (Monte Carlo, 20000 samples per class, generated once). Used to turn a
 * "top X% of hands" range into concrete holdings.
 */
export const PREFLOP_RANKING: readonly string[] = [
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', 'AKs', '77', 'AQs', 'AKo', 'AJs', 'ATs',
  'AQo', '66', 'AJo', 'KQs', 'A9s', 'KJs', 'ATo', 'A8s', 'KTs', 'A7s', 'KJo', 'KQo', 'A9o',
  'A6s', 'A5s', 'QJs', '55', 'A8o', 'KTo', 'QTs', 'K9s', 'A4s', 'A7o', 'QJo', 'K8s', 'K9o',
  'QTo', 'A3s', 'A6o', 'Q9s', '44', 'A2s', 'A5o', 'K7s', 'JTs', 'K6s', 'A4o', 'A3o', 'K8o',
  'K5s', 'J9s', 'A2o', 'Q9o', 'K7o', 'JTo', 'Q8s', 'K4s', 'K6o', 'K2s', 'Q7s', 'J8s', 'K5o',
  'K3s', 'T9s', '33', 'Q8o', 'Q6s', 'Q5s', 'J9o', 'T8s', 'J7s', 'K4o', 'K3o', 'Q4s', 'Q6o',
  'J8o', 'T9o', '22', 'Q7o', 'Q3s', 'T7s', '98s', 'J6s', 'K2o', 'J5s', 'Q5o', 'Q2s', 'J7o',
  '97s', 'T8o', 'Q4o', 'T6s', 'J4s', 'Q3o', 'J6o', '98o', 'T7o', '87s', 'J3s', 'J5o', 'J2s',
  '96s', 'Q2o', 'T5s', '86s', 'T4s', 'J4o', '95s', '97o', 'T6o', 'T3s', '76s', '87o', '96o',
  '94s', 'T2s', 'J2o', 'J3o', 'T5o', '85s', '75s', '84s', '65s', '93s', '76o', '86o', 'T4o',
  'T3o', '74s', '92s', '95o', '85o', 'T2o', '64s', '54s', '94o', '73s', '53s', '83s', '65o',
  '93o', '82s', '75o', '84o', '63s', '92o', '43s', '54o', '74o', '64o', '72s', '62s', '52s',
  '83o', '73o', '42s', '63o', '32s', '82o', '53o', '72o', '52o', '62o', '43o', '42o', '32o',
];
