/** A CPU player's character: what Jev is told to be, and how much it is allowed to deviate. */
export interface Persona {
  id: string;
  name: { ja: string; en: string };
  /** Sent to Jev as part of the state; the English text is the one the model reads. */
  description: { ja: string; en: string };
  /** 0 = always take the most likely action, 1 = sample straight from the model's probabilities. */
  variance: number;
  isPreset: boolean;
}

export const PRESET_PERSONAS: readonly Persona[] = [
  {
    id: 'rock',
    name: { ja: '岩', en: 'Rock' },
    description: {
      ja: '極端にタイトでパッシブなプレイヤー。プレミアムハンドをひたすら待ち、それ以外はほとんど降りる。ブラフはまずせず、チップを入れるときは強い手のバリューであることが多い。',
      en: 'An extremely tight and passive player. Waits for premium starting hands and folds almost everything else, preferring to call rather than raise. When this player finally commits chips it is almost always for value with a very strong holding, and bluffs are close to nonexistent.',
    },
    variance: 0.1,
    isPreset: true,
  },
  {
    id: 'tag',
    name: { ja: 'TAG', en: 'TAG' },
    description: {
      ja: 'タイト・アグレッシブな常連プレイヤー。強いスターティングハンドに絞って参加し、コールよりレイズを選ぶ。オッズが合わなければ素直に降り、良いスポットでは時折ブラフを打つ。',
      en: 'A tight-aggressive regular. Plays a narrow range of strong starting hands, raises rather than calls, bets for value and folds when the odds are poor. Bluffs occasionally in good spots but never for the sake of it.',
    },
    variance: 0.15,
    isPreset: true,
  },
  {
    id: 'lag',
    name: { ja: 'LAG', en: 'LAG' },
    description: {
      ja: 'ルース・アグレッシブなプレイヤー。広いレンジで多くのポットに参加し、ベットとレイズで絶えず圧力をかける。バリューとブラフを混ぜるためラインが読みにくい。',
      en: 'A loose-aggressive player. Enters many pots with a wide range and applies constant pressure with bets and raises. Mixes strong value hands with frequent bluffs and semi-bluffs, which makes the betting line hard to read.',
    },
    variance: 0.5,
    isPreset: true,
  },
  {
    id: 'maniac',
    name: { ja: 'マニアック', en: 'Maniac' },
    description: {
      ja: '超アグレッシブなマニアック。ほとんどどんな2枚でもレイズとリレイズを繰り返し、小さく張るより大きく張ることを好む。プレイは荒く予測しづらく、フォールドは最後の手段。',
      en: 'A hyper-aggressive maniac. Raises and re-raises with almost any two cards and rarely slows down, preferring large bets to small ones. The play is wild and hard to predict, and folding is treated as a last resort.',
    },
    variance: 0.8,
    isPreset: true,
  },
  {
    id: 'station',
    name: { ja: 'コーリングステーション', en: 'Calling Station' },
    description: {
      ja: 'ルース・パッシブなコーリングステーション。弱いペアやドローでも次のカードを見たくてコールしすぎ、レイズやブラフはほとんどしない。一度ポットに入ると降りるのが苦手。',
      en: 'A loose-passive calling station. Calls far too often with weak pairs and drawing hands, hoping to see the next card, and almost never raises or bluffs. Once this player is in a pot, folding is very difficult.',
    },
    variance: 0.2,
    isPreset: true,
  },
];

const BY_ID = new Map(PRESET_PERSONAS.map((p) => [p.id, p]));

export function getPersona(id: string): Persona {
  const persona = BY_ID.get(id);
  if (!persona) throw new Error(`unknown persona: ${id}`);
  return persona;
}
