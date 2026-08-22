# Free Asset Library — what you can use in auto-dm

This document is a curated, **license-checked** starting point for art, icons,
audio, and fonts you can drop into the app. Every source below is free to use,
but **always re-check the license on the specific asset** before shipping — some
creators change terms per-pack.

## TL;DR — safest choices

- **CC0 = public domain.** Do anything, commercially, no credit. The gold
  standard. Prefer these.
- **CC-BY = free but you must credit the author** (a line in your credits is
  enough). Keep a `CREDITS.md` for anything CC-BY.
- **Avoid CC-BY-SA / CC-BY-NC / GPL** for the art you embed: SA forces you to
  share derivatives under the same license; NC forbids commercial use; GPL can
  pull your whole app open-source.

## Local folders (already scaffolded)

Static assets live under **`public/assets/`** so Vite serves them at
`/assets/…` in dev and Tauri bundles them into the app:

```
public/
  fonts/                  # Cinzel + IM Fell English (already wired)
  assets/
    monsters/             # e.g. public/assets/monsters/goblin.png
    icons/                # UI / item icons
    audio/dice_roll.wav   # bundled dice-roll clatter (generated)
```

In code/UI always reference them **without** the `public/` prefix:
`assets/monsters/zombie_brute.png`, `/assets/audio/dice_roll.wav`.

### Monster portraits auto-load by key

Every preset monster carries a stable `key` (e.g. `goblin`,
`ancient_red_dragon`). If its explicit **Portrait** field is empty, the card
automatically tries `/assets/monsters/<key>.png`. So to give your whole
bestiary art with zero manual entry:

1. Download tokens from the sources below.
2. Rename each file to the monster's key: `goblin.png`, `zombie_brute.png`,
   `ancient_red_dragon.png` … (keys are visible in `src/presets/bestiary.ts`).
3. Drop them into `public/assets/monsters/`.

An explicit portrait set in the Bestiary editor always wins over the
convention. Broken/missing files hide silently (`onError`).

## Art — monsters, tokens & portraits

| Source | License | Notes | URL |
| --- | --- | --- | --- |
| **Kenney** | **CC0** | 40k+ consistent sprites, tiles, UI, 3D, fonts, audio. Start here. | https://kenney.nl/assets |
| **OpenGameArt** | mixed (filter CC0) | Massive community library; filter by CC0/CC-BY. | https://opengameart.org/ |
| CC0 resources list | CC0 | Curated CC0 board on OGA. | https://opengameart.org/content/cc0-resources |
| **itch.io — tokens** | varies (many CC0) | 61+ free token packs; filter by license. | https://itch.io/game-assets/free/tag-tokens |
| **itch.io — TTRPG** | varies | 1,000+ tabletop assets. | https://itch.io/game-assets/free/tag-ttrpg |
| **FrogPotion — Old-School D&D Tokens** | free | Humanoid monster tokens, transparent PNG. | https://frogpotion.itch.io/old-school-dd-monster-tokens-humanoids |
| **NewAITees — Fantasy Monster Tokens** | free/commercial | 20 transparent monster tokens, free to use commercially. | https://newaitees.itch.io/fantasy-monster-token-pack-free-sample |
| **TheBeesKnees13 — Fantasy Dungeon** | free | 18 VTT tokens. | https://thebeesknees13.itch.io/fantasy-dungeon-free |
| **StudioSprite** | commercial/AI | AI-generated original creature art, commercial license on paid plans (10 free credits). Verify terms. | https://studiosprite.com/ |
| **DriveThruRPG Free Fantasy Stock Art** | CC-BY 4.0 | Attribution-friendly stock art for publishing. | https://www.drivethrurpg.com/en/product/181517/free-fantasy-stock-art |
| **ttrpgresources.com** | mixed | Human-made, AI-free art/asset guide with many vetted artists. | https://ttrpgresources.com/ |

### Recommended token packs to grab first
- *Fantasy Monster Token Pack — Free Sample* (NewAITees) — broad bestiary cover.
- *Old-School D&D Monster Tokens — Humanoids* (FrogPotion) — goblins, orcs, etc.
- *Fantasy Dungeon — FREE Pack* (TheBeesKnees13) — environment + foes.
- *Faces for a Dying Land* (zordvil) / *Medieval Fantasy Character Portraits*
  (oicaroh) — NPC portraits.

## Icons & UI

| Source | License | Notes | URL |
| --- | --- | --- | --- |
| **Game-Icons.net** | **CC-BY 3.0** | 4,000+ SVG game icons (swords, potions, spells). Credit required. | https://game-icons.net/ |
| **Kenney UI** | CC0 | Clean UI elements, buttons, frames. | https://kenney.nl/assets |
| **Pixabay Illustrations** | no attribution | UI backgrounds, menu art, vectors. | https://pixabay.com/illustrations/ |
| **Openclipart** | CC0 | 170k+ clipart SVGs. | https://openclipart.org/ |

## Audio — SFX & music

| Source | License | Notes | URL |
| --- | --- | --- | --- |
| **OpenGameArt — CC0 SFX** | CC0 | No-attribution sound effects. | https://opengameart.org/content/cc0-sound-effects |
| **OpenGameArt — CC0 Fantasy Music** | CC0 | High-quality non-chiptune fantasy tracks. | https://opengameart.org/content/cc0-fantasy-music-sounds |
| **itch.io — Sound Effects** | varies | Huge SFX library; filter free. | https://itch.io/game-assets/free/tag-sound-effects |
| **itch.io — Fantasy + SFX** | varies | Spell impacts, RPG music packs. | https://itch.io/game-assets/free/tag-fantasy/tag-sound-effects |
| **Atelier Magicae — Fantasy UI SFX** | free | 113 menu/UI sounds. | https://ateliermagicae.itch.io/fantasy-ui-sound-effects |
| **JDSherbert — Tabletop Games SFX** | free | Dice, cards, tokens. | https://jdsherbert.itch.io/tabletop-games-sfx-pack |
| **Pixabay — Fantasy SFX / RPG** | no attribution | Search "fantasy" / "rpg". | https://pixabay.com/sound-effects/search/fantasy/ |
| **ZapSplat** | free/standard | Medieval/fantasy GUI clicks, coin loot. | https://www.zapsplat.com/ |

## Fonts (fantasy / medieval feel)

All below are **SIL Open Font License (OFL)** — free for commercial use, no
credit required (just don't sell the font file alone).

- **Google Fonts** (canonical free font host): https://fonts.google.com/
  - *Cinzel* / *Cinzel Decorative* — Roman capitals, great for titles.
  - *MedievalSharp* — handwritten blackletter UI accents.
  - *IM Fell English* — period printing press body text.
  - *EB Garamond* / *Spectral* — readable body/serif.
- Download `.woff2` into `assets/fonts/` and `@font-face` it in `App.css`.

## 3D / bonus

- **Quaternius** (CC0): https://quaternius.com/ — low-poly characters,
  animals, props if you ever add a 3D scene.
- **Poly Haven** (CC0): https://polyhaven.com/ — HDRIs, textures, models.
- **awesome-cc0** list: https://github.com/madjin/awesome-cc0 — the master
  index of CC0 assets across the web.

## Wiring it in (current capability)

- **Auto portraits** — `resolvePortrait()` (`src/assets.ts`) resolves
  `portrait ?? assets/monsters/<key>.png`; the Bestiary card and editor preview
  both use it. Just drop key-named PNGs into `public/assets/monsters/`.
- **Dice sound** — `playDiceSound()` (`src/sound.ts`) plays the bundled
  `/assets/audio/dice_roll.wav` on every user roll: Dice Roller, ability
  checks, `/roll` + `/check` commands, death saves. Swap the file to change
  the sound; missing files fail silently.
- **Fonts** — Cinzel & IM Fell English are already under `public/fonts/`.
- Keep a `CREDITS.md` at repo root listing every CC-BY / attribution asset you
  ship (Game-Icons.net, DriveThruRPG stock art, etc.).
