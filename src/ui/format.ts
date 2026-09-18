import { type Card, formatCard, type Suit } from "../engine/cards";

const SYMBOLS: Record<Suit, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

export function cardText(card: Card): string {
  return `${formatCard(card).charAt(0)}${SYMBOLS[card.suit]}`;
}

export function isRedSuit(suit: Suit): boolean {
  return suit === "h" || suit === "d";
}
