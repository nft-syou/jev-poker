import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { compareHands, evaluate7 } from './evaluate.js';

const ev = (s: string) => evaluate7(parseCards(s));
describe('evaluate7', () => {
  it.each([
    ['As Ks Qs Js Ts 2c 3d', 'straight_flush'],
    ['Ah Ad Ac As Kd 2c 3d', 'four_of_a_kind'],
    ['Ah Ad Ac Ks Kd 2c 3d', 'full_house'],
    ['Ah 9h 7h 4h 2h Ks Kd', 'flush'],
    ['5h 4d 3c 2s Ad Kc Kd', 'straight'],            // wheel
    ['Ah Ad Ac 9s 7d 2c 3d', 'three_of_a_kind'],
    ['Ah Ad Kc Ks 7d 2c 3d', 'two_pair'],
    ['Ah Ad Kc Qs 7d 2c 3d', 'pair'],
    ['Ah Jd 9c 7s 5d 3c 2d', 'high_card'],
  ])('%s is %s', (cards, cat) => expect(ev(cards).category).toBe(cat));

  it('kicker decides', () => {
    expect(compareHands(ev('Ah Kd 2c 3d 5s 8h 9c'), ev('Ah Qd 2c 3d 5s 8h 9c'))).toBeGreaterThan(0);
  });
  it('board plays → tie', () => {
    expect(compareHands(ev('2h 3d Ah Kh Qh Jh Th'), ev('4c 5c Ah Kh Qh Jh Th'))).toBe(0);
  });
  it('higher two pair wins over lower two pair', () => {
    expect(compareHands(ev('Ah Ad 2c 2d 9s 8h 7c'), ev('Kh Kd Qc Qd 9s 8h 7c'))).toBeGreaterThan(0);
  });
  it('straight beats three of a kind; flush beats straight', () => {
    expect(compareHands(ev('5h 4d 3c 2s Ad Kc Qd'), ev('Ah Ad Ac 9s 7d 2c 3d'))).toBeGreaterThan(0);
    expect(compareHands(ev('Ah 9h 7h 4h 2h Ks Kd'), ev('5h 4d 3c 2s Ad Kc Qd'))).toBeGreaterThan(0);
  });
});
