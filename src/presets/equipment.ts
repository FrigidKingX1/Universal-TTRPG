/**
 * Equipment catalog for quick inventory stocking. Purely descriptive —
 * weight autofills new inventory items; tags hint at future mechanics.
 */
export interface EquipmentEntry {
  name: string;
  category: "weapon" | "armor" | "gear" | "tool" | "potion" | "magic";
  weight: number;
  /** Typical quantity when added. */
  qty?: number;
  notes?: string;
  tags?: string[];
}

export const EQUIPMENT_CATALOG: EquipmentEntry[] = [
  // ── Weapons ────────────────────────────────────────────────────────────
  { name: "Dagger", category: "weapon", weight: 1, notes: "1d4 piercing, finesse, thrown 20/60" },
  { name: "Shortsword", category: "weapon", weight: 2, notes: "1d6 piercing, finesse" },
  { name: "Rapier", category: "weapon", weight: 2, notes: "1d8 piercing, finesse" },
  { name: "Scimitar", category: "weapon", weight: 3, notes: "1d6 slashing, finesse" },
  { name: "Longsword", category: "weapon", weight: 3, notes: "1d8 slashing (1d10 two-handed)" },
  { name: "Battleaxe", category: "weapon", weight: 4, notes: "1d8 slashing (1d10 two-handed)" },
  { name: "Greataxe", category: "weapon", weight: 7, notes: "1d12 slashing, heavy" },
  { name: "Greatsword", category: "weapon", weight: 6, notes: "2d6 slashing, heavy" },
  { name: "Warhammer", category: "weapon", weight: 3, notes: "1d8 bludgeoning (1d10 two-handed)" },
  { name: "Mace", category: "weapon", weight: 4, notes: "1d6 bludgeoning" },
  { name: "Club", category: "weapon", weight: 2, notes: "1d4 bludgeoning" },
  { name: "Morningstar", category: "weapon", weight: 4, notes: "1d8 piercing" },
  { name: "Spear", category: "weapon", weight: 3, qty: 1, notes: "1d6 piercing, thrown 20/60" },
  { name: "Halberd", category: "weapon", weight: 6, notes: "1d10 slashing, reach" },
  { name: "Whip", category: "weapon", weight: 3, notes: "1d4 slashing, finesse, reach" },
  { name: "Quarterstaff", category: "weapon", weight: 4, notes: "1d6 bludgeoning" },
  { name: "Handaxe", category: "weapon", weight: 2, qty: 1, notes: "1d4 slashing, thrown 20/60" },
  { name: "Javelin", category: "weapon", weight: 2, qty: 1, notes: "1d6 piercing, thrown 30/120" },
  { name: "Shortbow", category: "weapon", weight: 2, notes: "1d6 piercing, range 80/320" },
  { name: "Longbow", category: "weapon", weight: 2, notes: "1d8 piercing, range 150/600" },
  { name: "Light Crossbow", category: "weapon", weight: 5, notes: "1d8 piercing, range 80/320" },
  { name: "Heavy Crossbow", category: "weapon", weight: 18, notes: "1d10 piercing, range 100/400" },
  { name: "Sling", category: "weapon", weight: 0, notes: "1d4 bludgeoning, range 30/120" },
  { name: "Arrow", category: "weapon", weight: 0.05, qty: 20 },
  { name: "Crossbow Bolt", category: "weapon", weight: 0.075, qty: 20 },

  // ── Armor ──────────────────────────────────────────────────────────────
  { name: "Padded Armor", category: "armor", weight: 8, notes: "AC 11 + DEX; stealth disadvantage" },
  { name: "Leather Armor", category: "armor", weight: 10, notes: "AC 11 + DEX" },
  { name: "Studded Leather", category: "armor", weight: 13, notes: "AC 12 + DEX" },
  { name: "Hide Armor", category: "armor", weight: 12, notes: "AC 12 + DEX (max 2)" },
  { name: "Chain Shirt", category: "armor", weight: 20, notes: "AC 13 + DEX (max 2)" },
  { name: "Scale Mail", category: "armor", weight: 45, notes: "AC 14 + DEX (max 2); stealth disadvantage" },
  { name: "Breastplate", category: "armor", weight: 20, notes: "AC 14 + DEX (max 2)" },
  { name: "Half Plate", category: "armor", weight: 40, notes: "AC 15 + DEX (max 2); stealth disadvantage" },
  { name: "Ring Mail", category: "armor", weight: 40, notes: "AC 14; stealth disadvantage" },
  { name: "Chain Mail", category: "armor", weight: 55, notes: "AC 16, STR 13; stealth disadvantage" },
  { name: "Splint Armor", category: "armor", weight: 60, notes: "AC 17, STR 15; stealth disadvantage" },
  { name: "Plate Armor", category: "armor", weight: 65, notes: "AC 18, STR 15; stealth disadvantage" },
  { name: "Shield", category: "armor", weight: 6, notes: "+2 AC while equipped" },

  // ── Adventuring gear ───────────────────────────────────────────────────
  { name: "Rope (50 ft)", category: "gear", weight: 10 },
  { name: "Torch", category: "gear", weight: 1, qty: 5 },
  { name: "Hooded Lantern", category: "gear", weight: 2 },
  { name: "Flask of Oil", category: "gear", weight: 1, qty: 3 },
  { name: "Rations (1 day)", category: "gear", weight: 2, qty: 10 },
  { name: "Waterskin", category: "gear", weight: 5 },
  { name: "Bedroll", category: "gear", weight: 7 },
  { name: "Tent (two-person)", category: "gear", weight: 20 },
  { name: "Crowbar", category: "gear", weight: 5 },
  { name: "Grappling Hook", category: "gear", weight: 4 },
  { name: "Hammer", category: "gear", weight: 3 },
  { name: "Piton", category: "gear", weight: 0.25, qty: 10 },
  { name: "Caltrops", category: "gear", weight: 2, qty: 1 },
  { name: "Tinderbox", category: "gear", weight: 1 },
  { name: "Steel Mirror", category: "gear", weight: 0.5 },
  { name: "Signal Whistle", category: "gear", weight: 0 },
  { name: "Manacles", category: "gear", weight: 6 },
  { name: "Ink & Quill", category: "gear", weight: 0.1 },
  { name: "Scroll Case", category: "gear", weight: 1 },
  { name: "Backpack", category: "gear", weight: 5 },
  { name: "Belt Pouch", category: "gear", weight: 1 },
  { name: "Gold Coins", category: "gear", weight: 0.02, qty: 50 },

  // ── Tools & kits ───────────────────────────────────────────────────────
  { name: "Thieves' Tools", category: "tool", weight: 1, notes: "Pick locks and disarm traps" },
  { name: "Healer's Kit", category: "tool", weight: 3, notes: "Stabilize the dying; 10 uses" },
  { name: "Cartographer's Tools", category: "tool", weight: 6 },
  { name: "Disguise Kit", category: "tool", weight: 3 },
  { name: "Forgery Kit", category: "tool", weight: 5 },
  { name: "Herbalism Kit", category: "tool", weight: 3 },
  { name: "Navigator's Tools", category: "tool", weight: 2 },
  { name: "Poisoner's Kit", category: "tool", weight: 2 },
  { name: "Smith's Tools", category: "tool", weight: 8 },
  { name: "Alchemist's Supplies", category: "tool", weight: 8 },
  { name: "Cook's Utensils", category: "tool", weight: 8 },
  { name: "Musical Instrument (lute)", category: "tool", weight: 2 },

  // ── Potions & alchemy ──────────────────────────────────────────────────
  { name: "Potion of Healing", category: "potion", weight: 0.5, notes: "Restore 2d4+2 HP" },
  { name: "Potion of Greater Healing", category: "potion", weight: 0.5, notes: "Restore 4d4+4 HP" },
  { name: "Potion of Superior Healing", category: "potion", weight: 0.5, notes: "Restore 8d4+8 HP" },
  { name: "Antitoxin", category: "potion", weight: 0.5, notes: "Advantage vs poison for 1 hour" },
  { name: "Holy Water", category: "potion", weight: 0.5, notes: "2d6 radiant to fiends/undead" },
  { name: "Alchemist's Fire", category: "potion", weight: 1, notes: "1d4 fire, burns each turn" },
  { name: "Vial of Acid", category: "potion", weight: 1, notes: "2d6 acid on a direct hit" },

  // ── Magic items (flavor — mechanics pending) ───────────────────────────
  { name: "Cloak of Elvenkind", category: "magic", weight: 1, tags: ["magic"], notes: "Advantage on Stealth; observers have disadvantage to see you" },
  { name: "Boots of Stealth", category: "magic", weight: 1, tags: ["magic"], notes: "Silent footfalls" },
  { name: "Ring of Protection", category: "magic", weight: 0, tags: ["magic", "ac:+1"], notes: "+1 AC and saving throws" },
  { name: "Amulet of Health", category: "magic", weight: 0.05, tags: ["magic"], notes: "CON becomes 19" },
  { name: "Bag of Holding", category: "magic", weight: 15, tags: ["magic"], notes: "500 lb / 64 cu ft interior" },
  { name: "+1 Weapon (any)", category: "magic", weight: 3, tags: ["magic", "attack:+1"], notes: "Attacks with this weapon gain +1 to hit and damage" },
];

export function findEquipment(name: string): EquipmentEntry | undefined {
  const needle = name.trim().toLowerCase();
  return EQUIPMENT_CATALOG.find((e) => e.name.toLowerCase() === needle);
}
