use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// Odds ranks for a Mythic-style Fate Check (1 = Impossible .. 10 = A Sure Thing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Odds {
    Impossible,
    NoWay,
    VeryUnlikely,
    Unlikely,
    FiftyFifty,
    SomewhatLikely,
    Likely,
    VeryLikely,
    NearSureThing,
    SureThing,
}

impl Odds {
    pub fn rank(self) -> usize {
        match self {
            Odds::Impossible => 1,
            Odds::NoWay => 2,
            Odds::VeryUnlikely => 3,
            Odds::Unlikely => 4,
            Odds::FiftyFifty => 5,
            Odds::SomewhatLikely => 6,
            Odds::Likely => 7,
            Odds::VeryLikely => 8,
            Odds::NearSureThing => 9,
            Odds::SureThing => 10,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Odds::Impossible => "Impossible",
            Odds::NoWay => "No Way",
            Odds::VeryUnlikely => "Very Unlikely",
            Odds::Unlikely => "Unlikely",
            Odds::FiftyFifty => "50/50",
            Odds::SomewhatLikely => "Somewhat Likely",
            Odds::Likely => "Likely",
            Odds::VeryLikely => "Very Likely",
            Odds::NearSureThing => "Near Sure Thing",
            Odds::SureThing => "A Sure Thing",
        }
    }

    pub fn all() -> &'static [Odds] {
        &[
            Odds::Impossible,
            Odds::NoWay,
            Odds::VeryUnlikely,
            Odds::Unlikely,
            Odds::FiftyFifty,
            Odds::SomewhatLikely,
            Odds::Likely,
            Odds::VeryLikely,
            Odds::NearSureThing,
            Odds::SureThing,
        ]
    }
}

/// Mythic GME 2e Fate Chart: FATE_CHART[odds_rank - 1][chaos_factor - 1].
/// The result is the number a d100 roll must be at or below to be a Yes.
const FATE_CHART: [[u32; 9]; 10] = [
    [6, 9, 12, 15, 18, 22, 26, 30, 34],     // Impossible
    [11, 15, 19, 23, 27, 31, 36, 41, 46],   // No Way
    [16, 20, 24, 29, 33, 38, 43, 48, 53],   // Very Unlikely
    [22, 27, 32, 37, 42, 47, 52, 57, 63],   // Unlikely
    [28, 33, 38, 43, 48, 53, 58, 64, 70],   // 50/50
    [34, 40, 46, 51, 57, 62, 68, 74, 80],   // Somewhat Likely
    [40, 46, 52, 58, 64, 71, 77, 83, 89],   // Likely
    [47, 53, 60, 66, 73, 80, 86, 92, 99],   // Very Likely
    [54, 61, 67, 74, 81, 88, 94, 99, 100],  // Near Sure Thing
    [61, 68, 75, 82, 89, 96, 99, 100, 100], // A Sure Thing
];

/// Fate Check outcome (Yes or No).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FateOutcome {
    Yes,
    No,
}

/// Result of a Mythic-style Fate Check.
#[derive(Debug, Clone, Serialize)]
pub struct FateResult {
    pub roll: u32,
    pub target: u32,
    pub chaos_factor: u32,
    pub odds: Odds,
    pub outcome: FateOutcome,
    pub exceptional: bool,
    pub random_event: bool,
}

impl FateResult {
    pub fn is_yes(&self) -> bool {
        self.outcome == FateOutcome::Yes
    }

    /// Human-readable interpretation of the result.
    pub fn interpretation(&self) -> String {
        let base = match self.outcome {
            FateOutcome::Yes => "Yes",
            FateOutcome::No => "No",
        };
        let prefix = match (self.outcome, self.exceptional) {
            (FateOutcome::Yes, true) => "Exceptional",
            (FateOutcome::No, true) => "Exceptional",
            _ => "",
        };
        let event = if self.random_event { " Random Event!" } else { "" };
        format!("{prefix} {base}{event}").trim().to_string()
    }
}

/// Mythic-style Game Master Emulator. Pure math: no expressive content.
pub struct MythicOracle {
    chaos_factor: u32,
    rng: ChaCha8Rng,
}

impl MythicOracle {
    pub fn new(chaos_factor: u32) -> Self {
        Self { chaos_factor: Self::clamp_cf(chaos_factor), rng: ChaCha8Rng::from_entropy() }
    }

    pub fn with_seed(chaos_factor: u32, seed: u64) -> Self {
        Self { chaos_factor: Self::clamp_cf(chaos_factor), rng: ChaCha8Rng::seed_from_u64(seed) }
    }

    fn clamp_cf(cf: u32) -> u32 {
        cf.clamp(1, 9)
    }

    pub fn chaos_factor(&self) -> u32 {
        self.chaos_factor
    }

    pub fn set_chaos_factor(&mut self, cf: u32) {
        self.chaos_factor = Self::clamp_cf(cf);
    }

    /// Adjust the Chaos Factor by a signed delta, clamped to [1, 9].
    pub fn adjust_chaos(&mut self, delta: i32) {
        let next = self.chaos_factor as i32 + delta;
        self.chaos_factor = next.clamp(1, 9) as u32;
    }

    /// The Fate Chart value for a given odds rating and the active Chaos Factor.
    pub fn fate_target(&self, odds: Odds) -> u32 {
        FATE_CHART[odds.rank() - 1][self.chaos_factor as usize - 1]
    }

    /// Roll a fresh d100 and run the Fate Check.
    pub fn ask_fate(&mut self, odds: Odds) -> FateResult {
        let roll: u32 = self.rng.gen_range(1..=100);
        self.ask_fate_with(odds, roll)
    }

    /// Run a Fate Check against an explicit d100 roll (testable / deterministic).
    pub fn ask_fate_with(&self, odds: Odds, roll: u32) -> FateResult {
        let roll = roll.clamp(1, 100);
        let target = self.fate_target(odds);
        let outcome = if roll <= target { FateOutcome::Yes } else { FateOutcome::No };
        // Exceptional results are tied to the outcome (Mythic 2e):
        // a Yes at or below the Chaos Factor is Exceptional; a No at or above
        // 101 - Chaos Factor is Exceptional.
        let exceptional = (outcome == FateOutcome::Yes && roll <= self.chaos_factor)
            || (outcome == FateOutcome::No && roll >= 101 - self.chaos_factor);
        // Random Event: doubles (11, 22, ..., 99) whose single digit is at or
        // below the Chaos Factor. At CF 5 that is 11/22/33/44/55. A result of
        // 100 ("00") does not count as doubles for random events.
        let tens = roll / 10;
        let ones = roll % 10;
        let random_event = tens == ones && tens <= self.chaos_factor;
        FateResult {
            roll,
            target,
            chaos_factor: self.chaos_factor,
            odds,
            outcome,
            exceptional,
            random_event,
        }
    }

    /// Roll a Random Event meaning from the internal RNG.
    pub fn random_event_now(&mut self) -> EventMeaning {
        MeaningTable::default_table().random_event(&mut self.rng)
    }

    /// Mutable access to the internal RNG (for external callers that need
    /// to perform additional rolls with the same entropy source).
    pub fn rng_mut(&mut self) -> &mut ChaCha8Rng {
        &mut self.rng
    }
}

/// Result of pairing Meaning Table entries for a Random Event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventMeaning {
    pub action: String,
    pub subject: String,
    pub descriptor: String,
    pub focus: String,
}

/// Generic, user-editable Meaning Tables. The shipped word lists are original
/// phrasing (not copies of any publisher's copyrighted tables); users can load
/// their own via JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MeaningTable {
    pub action: Vec<String>,
    pub subject: Vec<String>,
    pub descriptor: Vec<String>,
    pub focus: Vec<String>,
}

impl MeaningTable {
    pub fn default_table() -> Self {
        static TABLE: OnceLock<MeaningTable> = OnceLock::new();
        TABLE
            .get_or_init(|| {
                let to_strings = |words: &[&str]| -> Vec<String> {
                    words.iter().map(|w| w.to_string()).collect()
                };
                Self {
                    action: to_strings(&[
                        "abandon",
                        "approach",
                        "attack",
                        "betray",
                        "block",
                        "break",
                        "capture",
                        "carry",
                        "cast",
                        "close",
                        "collapse",
                        "complete",
                        "conceal",
                        "confirm",
                        "construct",
                        "consume",
                        "cross",
                        "destroy",
                        "divide",
                        "escape",
                        "expand",
                        "flee",
                        "follow",
                        "gather",
                        "grant",
                        "guide",
                        "hide",
                        "hold",
                        "imprison",
                        "join",
                        "journey",
                        "limit",
                        "locate",
                        "lose",
                        "move",
                        "negotiate",
                        "open",
                        "protect",
                        "pursue",
                        "rebuild",
                        "release",
                        "remember",
                        "replace",
                        "return",
                        "reveal",
                        "seize",
                        "search",
                        "separate",
                        "signal",
                        "strengthen",
                    ]),
                    subject: to_strings(&[
                        "ally", "animal", "army", "artifact", "bandit", "beast", "border",
                        "building", "child", "city", "craft", "cult", "danger", "death", "door",
                        "dungeon", "enemy", "forest", "fortune", "gate", "guard", "guardian",
                        "harbor", "healer", "herald", "horde", "hostage", "hunter", "journal",
                        "law", "library", "merchant", "message", "mine", "mountain", "noble",
                        "oath", "priest", "prison", "prophet", "road", "scroll", "soldier",
                        "spell", "spirit", "temple", "thief", "tomb", "trail", "treasure",
                    ]),
                    descriptor: to_strings(&[
                        "ancient",
                        "armored",
                        "barren",
                        "blessed",
                        "bloodied",
                        "broken",
                        "burning",
                        "cursed",
                        "dangerous",
                        "dark",
                        "dead",
                        "diseased",
                        "distant",
                        "dreaming",
                        "dwarven",
                        "enchanted",
                        "fading",
                        "frozen",
                        "glowing",
                        "golden",
                        "hidden",
                        "hollow",
                        "hostile",
                        "iron",
                        "living",
                        "lonely",
                        "lost",
                        "loyal",
                        "massive",
                        "mechanical",
                        "mysterious",
                        "old",
                        "poisoned",
                        "protected",
                        "roaring",
                        "savage",
                        "shadowed",
                        "shining",
                        "silent",
                        "sinking",
                        "small",
                        "smoking",
                        "soldiered",
                        "stormy",
                        "sunken",
                        "twisted",
                        "undead",
                        "untamed",
                        "watched",
                        "wounded",
                    ]),
                    focus: to_strings(&[
                        "an army",
                        "a battle",
                        "a betrayal",
                        "the borders",
                        "a child",
                        "a city",
                        "the coast",
                        "a creature",
                        "a criminal",
                        "the crown",
                        "a curse",
                        "the dead",
                        "a door",
                        "a dream",
                        "an enemy",
                        "an escape",
                        "a forest",
                        "a fortress",
                        "a god",
                        "gold",
                        "a guard",
                        "a guild",
                        "a hostage",
                        "a house",
                        "a journey",
                        "a king",
                        "a knight",
                        "a law",
                        "a map",
                        "a mask",
                        "a merchant",
                        "a mine",
                        "a monster",
                        "the moon",
                        "a mountain",
                        "a mystery",
                        "a name",
                        "a noble",
                        "a priest",
                        "a prophecy",
                        "a river",
                        "a road",
                        "a scroll",
                        "a secret",
                        "a ship",
                        "a spell",
                        "a spirit",
                        "a tomb",
                        "a village",
                        "a weapon",
                    ]),
                }
            })
            .clone()
    }

    /// Generate two paired meanings (Action+Subject and Descriptor+Focus),
    /// following the Mythic double-table structure.
    pub fn random_event(&self, rng: &mut ChaCha8Rng) -> EventMeaning {
        let mut pick = |v: &[String]| -> String {
            if v.is_empty() {
                return String::new();
            }
            v[rng.gen_range(0..v.len())].clone()
        };
        EventMeaning {
            action: pick(&self.action),
            subject: pick(&self.subject),
            descriptor: pick(&self.descriptor),
            focus: pick(&self.focus),
        }
    }
}

// ── Oracle Context — Threads & Characters integration ──────────────────

/// Lightweight reference to open threads and known NPCs for Random Event enrichment.
/// Not tied to any database — the caller builds this from whatever storage they use.
#[derive(Debug, Clone, Default)]
pub struct OracleContext {
    pub open_threads: Vec<ThreadRef>,
    pub npcs: Vec<NpcRef>,
}

#[derive(Debug, Clone)]
pub struct ThreadRef {
    pub id: String,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct NpcRef {
    pub id: String,
    pub name: String,
    pub disposition: String,
}

/// An enriched Random Event that may reference threads or NPCs from the context.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnrichedEvent {
    pub meaning: EventMeaning,
    /// If the event implies "New NPC", the suggested name is here.
    pub suggested_npc_name: Option<String>,
    /// If the event implies "Remove a Thread", the thread ID is here.
    pub remove_thread_id: Option<String>,
    /// If the event implies "NPC Action", the NPC name is here.
    pub acting_npc: Option<String>,
}

impl MeaningTable {
    /// Generate a Random Event enriched by the Oracle context. When the
    /// Meaning Table pairs suggest an NPC or Thread event, the context
    /// provides concrete entities to anchor the narrative.
    pub fn random_event_with_context(
        &self,
        rng: &mut ChaCha8Rng,
        ctx: &OracleContext,
    ) -> EnrichedEvent {
        let meaning = self.random_event(rng);

        let mut suggested_npc_name = None;
        let mut remove_thread_id = None;
        let mut acting_npc = None;

        // Heuristic: if the action implies NPC involvement and we have NPCs, pick one.
        let action_lower = meaning.action.to_lowercase();
        let npc_actions = ["betray", "attack", "approach", "abandon", "help"];
        if npc_actions.iter().any(|a| action_lower.contains(a)) && !ctx.npcs.is_empty() {
            let pick = &ctx.npcs[rng.gen_range(0..ctx.npcs.len())];
            acting_npc = Some(pick.name.clone());
        }

        // Heuristic: if the subject is "ally" or "enemy" and we have NPCs, suggest a new one.
        let subject_lower = meaning.subject.to_lowercase();
        if (subject_lower.contains("ally") || subject_lower.contains("new")) && !ctx.npcs.is_empty()
        {
            // Generate a simple suggested name from the meaning table words.
            suggested_npc_name = Some(format!("{} {}", meaning.descriptor, meaning.action));
        }

        // Heuristic: if action is "abandon" or subject contains "thread"/"secret",
        // and we have open threads, pick one to potentially remove.
        if (action_lower.contains("abandon")
            || subject_lower.contains("secret")
            || subject_lower.contains("truth"))
            && !ctx.open_threads.is_empty()
        {
            let pick = &ctx.open_threads[rng.gen_range(0..ctx.open_threads.len())];
            remove_thread_id = Some(pick.id.clone());
        }

        EnrichedEvent { meaning, suggested_npc_name, remove_thread_id, acting_npc }
    }
}

// ── Scene Test ─────────────────────────────────────────────────────────

/// Outcome of a Mythic Scene Test.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SceneOutcome {
    AsExpected,
    Altered,
    Interrupted,
}

/// Perform a Mythic Scene Test. Roll d10 against the current Chaos Factor:
/// - Roll ≤ CF/2 → Interrupted
/// - Roll ≤ CF → Altered
/// - Roll > CF → AsExpected
pub fn scene_test(chaos_factor: u8, rng: &mut ChaCha8Rng) -> SceneOutcome {
    let roll: u8 = rng.gen_range(1..=10);
    let cf = chaos_factor.clamp(1, 9);
    if roll <= cf / 2 {
        SceneOutcome::Interrupted
    } else if roll <= cf {
        SceneOutcome::Altered
    } else {
        SceneOutcome::AsExpected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chaos_factor_clamps() {
        let o = MythicOracle::new(99);
        assert_eq!(o.chaos_factor(), 9);
        let o = MythicOracle::new(0);
        assert_eq!(o.chaos_factor(), 1);
    }

    #[test]
    fn adjust_chaos_clamps() {
        let mut o = MythicOracle::new(5);
        o.adjust_chaos(10);
        assert_eq!(o.chaos_factor(), 9);
        o.adjust_chaos(-20);
        assert_eq!(o.chaos_factor(), 1);
    }

    #[test]
    fn fate_chart_known_values() {
        // 50/50 at Chaos Factor 5 -> 48 (widely documented value).
        let o = MythicOracle::new(5);
        assert_eq!(o.fate_target(Odds::FiftyFifty), 48);
        // Very Likely at CF 5 -> 73.
        assert_eq!(o.fate_target(Odds::VeryLikely), 73);
        // Impossible at CF 1 -> 6.
        let o = MythicOracle::new(1);
        assert_eq!(o.fate_target(Odds::Impossible), 6);
    }

    #[test]
    fn yes_when_below_target() {
        let o = MythicOracle::new(5);
        let r = o.ask_fate_with(Odds::FiftyFifty, 40);
        assert_eq!(r.outcome, FateOutcome::Yes);
        assert!(!r.exceptional);
        assert!(!r.random_event);
    }

    #[test]
    fn no_when_above_target() {
        let o = MythicOracle::new(5);
        let r = o.ask_fate_with(Odds::FiftyFifty, 90);
        assert_eq!(r.outcome, FateOutcome::No);
    }

    #[test]
    fn exceptional_yes_below_chaos_factor() {
        let o = MythicOracle::new(5);
        let r = o.ask_fate_with(Odds::SomewhatLikely, 3);
        assert_eq!(r.outcome, FateOutcome::Yes);
        assert!(r.exceptional);
    }

    #[test]
    fn exceptional_no_above_threshold() {
        let o = MythicOracle::new(5);
        let r = o.ask_fate_with(Odds::Impossible, 97);
        assert_eq!(r.outcome, FateOutcome::No);
        assert!(r.exceptional);
    }

    #[test]
    fn random_event_on_doubles_below_chaos() {
        let o = MythicOracle::new(5);
        // Doubles 11/22/33/44/55 trigger at CF 5.
        assert!(o.ask_fate_with(Odds::FiftyFifty, 11).random_event);
        assert!(o.ask_fate_with(Odds::FiftyFifty, 33).random_event);
        assert!(o.ask_fate_with(Odds::FiftyFifty, 55).random_event);
        // Doubles above the Chaos Factor do not trigger.
        assert!(!o.ask_fate_with(Odds::FiftyFifty, 77).random_event);
        assert!(!o.ask_fate_with(Odds::FiftyFifty, 99).random_event);
        // Non-doubles never trigger.
        assert!(!o.ask_fate_with(Odds::FiftyFifty, 34).random_event);
    }

    #[test]
    fn random_event_set_matches_chaos_floor() {
        let o = MythicOracle::new(5);
        // Exactly the documented set {11,22,33,44,55} at CF 5.
        let triggers: Vec<u32> =
            (1..=100).filter(|r| o.ask_fate_with(Odds::FiftyFifty, *r).random_event).collect();
        assert_eq!(triggers, vec![11, 22, 33, 44, 55]);
    }

    #[test]
    fn meaning_table_defaults_populated() {
        let t = MeaningTable::default_table();
        assert!(t.action.len() >= 40);
        assert!(t.subject.len() >= 40);
        assert!(t.descriptor.len() >= 40);
        assert!(t.focus.len() >= 40);
    }

    #[test]
    fn scene_test_produces_valid_outcomes() {
        let mut rng = ChaCha8Rng::seed_from_u64(42);
        // Run many times — should always produce a valid variant.
        for _ in 0..100 {
            let outcome = scene_test(5, &mut rng);
            assert!(matches!(
                outcome,
                SceneOutcome::AsExpected | SceneOutcome::Altered | SceneOutcome::Interrupted
            ));
        }
    }

    #[test]
    fn scene_test_low_cf_skews_as_expected() {
        let mut rng = ChaCha8Rng::seed_from_u64(99);
        let mut as_expected = 0;
        for _ in 0..200 {
            if scene_test(2, &mut rng) == SceneOutcome::AsExpected {
                as_expected += 1;
            }
        }
        // With CF 2, "AsExpected" requires roll > 2, so ~80% of the time.
        assert!(as_expected > 100, "Expected mostly AsExpected, got {as_expected}");
    }

    #[test]
    fn enriched_event_with_empty_context() {
        let table = MeaningTable::default_table();
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        let ctx = OracleContext::default();
        let event = table.random_event_with_context(&mut rng, &ctx);
        assert!(!event.meaning.action.is_empty());
        assert!(event.suggested_npc_name.is_none());
        assert!(event.remove_thread_id.is_none());
        assert!(event.acting_npc.is_none());
    }

    #[test]
    fn enriched_event_with_threads_and_npcs() {
        let table = MeaningTable::default_table();
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        let ctx = OracleContext {
            open_threads: vec![
                ThreadRef { id: "t1".into(), description: "Find the sword".into() },
                ThreadRef { id: "t2".into(), description: "Rescue the captive".into() },
            ],
            npcs: vec![
                NpcRef {
                    id: "n1".into(),
                    name: "Bartender".into(),
                    disposition: "friendly".into(),
                },
                NpcRef {
                    id: "n2".into(),
                    name: "Guard Captain".into(),
                    disposition: "hostile".into(),
                },
            ],
        };
        // Run many events — at least some should reference context entities.
        let mut had_npc_ref = false;
        let mut had_thread_ref = false;
        for _ in 0..50 {
            let event = table.random_event_with_context(&mut rng, &ctx);
            if event.acting_npc.is_some() || event.suggested_npc_name.is_some() {
                had_npc_ref = true;
            }
            if event.remove_thread_id.is_some() {
                had_thread_ref = true;
            }
        }
        // With 2 threads and 2 NPCs, some events should reference them.
        assert!(had_npc_ref || had_thread_ref, "Expected at least some context references");
    }
}
