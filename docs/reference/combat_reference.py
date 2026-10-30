"""Reference model of Hexlords combat odds, used to produce the numbers in
docs/DESIGN.md and the expected values in CLAUDE.md.

Use it as a test oracle for the TypeScript engine: the engine's exact odds
function must reproduce these values to 4 decimal places.

Run:  python3 docs/reference/combat_reference.py

Rules modelled (see DESIGN.md, Combat and Retreat sections):
- Each side fights weakest first by effective Strength; among equal Strength,
  the unit with more remaining hits fights first.
- Each round the attacker's front unit hits with probability A / (A + D);
  otherwise the defender's front unit hits. A unit at 0 hits dies, and the
  survivor keeps its damage and faces the next enemy.
- Retreat checks happen only between duels (right after any unit dies), and
  only while both sides still have units. The attacker withdraws if the exact
  win probability of fighting on (Hold) from that state is below the threshold.
- A defender with a Fall back threshold (field stacks only; city garrisons and
  Hold stacks never withdraw) gets the mirror-image check at the same moments:
  it withdraws if its own win chance, 1 - P(attacker wins on Hold), is below
  its threshold. The attacker's check runs first, so if both would withdraw,
  the attacker does.
- On withdrawal, pursuit: the other side's fastest surviving unit (ties: the
  strongest, then the first in fight order) strikes the withdrawing side's
  weakest surviving unit once, with probability P / (P + T). It kills only if
  the target has 1 hit left. No pursuit if every surviving unit of the
  withdrawing side is at least as fast as the pursuer.
- Not modelled yet: whether a legal retreat hex exists (with none, that side
  cannot withdraw, so its check is skipped), and units that strike more than
  once when pursuing.
"""

from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Unit:
    name: str
    strength: float  # effective Strength, modifiers already applied
    hits: int        # remaining hits
    move: int = 8


def fight_order(units):
    return tuple(sorted(units, key=lambda u: (u.strength, -u.hits)))


def make_battle(attackers, defenders):
    A = fight_order(attackers)
    D = fight_order(defenders)
    nA, nD = len(A), len(D)

    def a_hits(i):
        return A[i].hits if i < nA else 0

    def d_hits(j):
        return D[j].hits if j < nD else 0

    @lru_cache(maxsize=None)
    def p_win(i, ha, j, hd):
        """Exact P(attacker wins) fighting to the end from this state."""
        if j == nD:
            return 1.0
        if i == nA:
            return 0.0
        p = A[i].strength / (A[i].strength + D[j].strength)
        win = p_win(i, ha, j, hd - 1) if hd > 1 else p_win(i, ha, j + 1, d_hits(j + 1))
        lose = p_win(i, ha - 1, j, hd) if ha > 1 else p_win(i + 1, a_hits(i + 1), j, hd)
        return p * win + (1 - p) * lose

    def pursuit_kill_chance(pursuers, withdrawing, front_hits):
        """Chance the pursuit strike kills the withdrawing side's front unit."""
        pursuer = max(pursuers, key=lambda u: (u.move, u.strength))
        clean_break = all(u.move >= pursuer.move for u in withdrawing)
        if clean_break or front_hits != 1:
            return 0.0
        target = withdrawing[0]
        return pursuer.strength / (pursuer.strength + target.strength)

    def attacker_withdraws(i, ha, j):
        alive = nA - i - pursuit_kill_chance(D[j:], A[i:], ha)
        return (0.0, 1.0, 0.0, 0.0, alive, nD - j)

    def defender_withdraws(i, j, hd):
        alive = nD - j - pursuit_kill_chance(A[i:], D[j:], hd)
        return (0.0, 0.0, 0.0, 1.0, nA - i, alive)

    @lru_cache(maxsize=None)
    def play(i, ha, j, hd, threshold, defender_threshold):
        """(P win, P withdraw, P destroyed, P defender withdraws,
        E attackers alive, E defenders alive)."""
        if j == nD:
            return (1.0, 0.0, 0.0, 0.0, nA - i, 0)
        if i == nA:
            return (0.0, 0.0, 1.0, 0.0, 0, nD - j)
        p = A[i].strength / (A[i].strength + D[j].strength)

        def next_state(i2, ha2, j2, hd2, after_death):
            if after_death and i2 < nA and j2 < nD:
                pw = p_win(i2, ha2, j2, hd2)
                if threshold is not None and pw < threshold:
                    return attacker_withdraws(i2, ha2, j2)
                if defender_threshold is not None and 1 - pw < defender_threshold:
                    return defender_withdraws(i2, j2, hd2)
            return play(i2, ha2, j2, hd2, threshold, defender_threshold)

        if hd > 1:
            win = next_state(i, ha, j, hd - 1, False)
        else:
            win = next_state(i, ha, j + 1, d_hits(j + 1), True)
        if ha > 1:
            lose = next_state(i, ha - 1, j, hd, False)
        else:
            lose = next_state(i + 1, a_hits(i + 1), j, hd, True)
        return tuple(p * w + (1 - p) * l for w, l in zip(win, lose))

    def hold_probability():
        return p_win(0, A[0].hits, 0, D[0].hits)

    def outcome(threshold=None, defender_threshold=None):
        return play(0, A[0].hits, 0, D[0].hits, threshold, defender_threshold)

    return hold_probability, outcome


def same(strength, hits, count, name="unit", move=8):
    return [Unit(name, strength, hits, move) for _ in range(count)]


def main():
    print("Hold (fight to the end) win probabilities")
    cases = [
        ("Duel, Strength 5 vs 4, 2 hits", same(5, 2, 1), same(4, 2, 1)),
        ("Duel, Strength 6 vs 4, 2 hits", same(6, 2, 1), same(4, 2, 1)),
        ("Duel, Strength 9 vs 3, 2 hits", same(9, 2, 1), same(3, 2, 1)),
        ("Duel, Strength 6 vs 4, 1 hit", same(6, 1, 1), same(4, 1, 1)),
        ("Duel, Strength 6 vs 4, 3 hits", same(6, 3, 1), same(4, 3, 1)),
        ("8 Strength-4 vs 4 Strength-8", same(4, 2, 8), same(8, 2, 4)),
        ("8 Strength-3 vs 3 Strength-6", same(3, 2, 8), same(6, 2, 3)),
        ("4 vs 4 Strength-4, defender +25%", same(4, 2, 4), same(5, 2, 4)),
        ("4 vs 4 Strength-4, defender +50%", same(4, 2, 4), same(6, 2, 4)),
        ("Hero 5/3 vs minor guardian 4/2", same(5, 3, 1), same(4, 2, 1)),
        ("Hero 5/3 vs major guardian 6/3", same(5, 3, 1), same(6, 3, 1)),
        ("Hero 5/3 vs dragon 8/3", same(5, 3, 1), same(8, 3, 1)),
        ("Hero 6/4 vs minor guardian 4/2", same(6, 4, 1), same(4, 2, 1)),
        ("Hero 6/4 vs major guardian 6/3", same(6, 4, 1), same(6, 3, 1)),
        ("Hero 6/4 vs dragon 8/3", same(6, 4, 1), same(8, 3, 1)),
    ]
    for name, a, d in cases:
        hold, _ = make_battle(a, d)
        print(f"  {name:<40} {hold():.4f}")

    # The attack on Gravelmaw from the UI mockups. Attackers carry +25% hero
    # leadership; the defenders' +25% city walls are cancelled by the siege engine.
    lead = 1.25
    attackers = [
        Unit("Siege engine", 2 * lead, 2, move=6),
        Unit("Infantry", 4 * lead, 2),
        Unit("Infantry (wounded)", 4 * lead, 1),
        Unit("Ironguard", 5 * lead, 3, move=6),
        Unit("Thane Borin (hero)", 5 * lead, 3, move=10),
    ]
    defenders = [
        Unit("Militia", 2, 2), Unit("Militia", 2, 2),
        Unit("Infantry", 4, 2), Unit("Infantry", 4, 2),
        Unit("Troll", 5, 3),
    ]
    hold, outcome = make_battle(attackers, defenders)
    print("\nGravelmaw attack")
    print(f"  Hold: win {hold():.4f}")
    for threshold in (0.2, 0.25, 0.3, 0.4, 0.5):
        w, r, x, _, ea, ed = outcome(threshold)
        print(f"  Withdraw below {threshold:.0%}: win {w:.4f}, withdraw {r:.4f}, "
              f"destroyed {x:.4f}, attackers alive {ea:.3f}, defenders alive {ed:.3f}")

    # Field battles where the defender is on Fall back (thresholds are win chances).
    print("\nField battles with a defender on Fall back")
    field_cases = [
        ("3 cavalry (M12) + 2 infantry, Hold, vs 5 infantry on hills (+25%), Fall back 30%",
         same(4, 2, 3, move=12) + same(4, 2, 2), same(5, 2, 5), None, 0.3),
        ("4 infantry, Hold, vs 4 cavalry (M12), Fall back 30% (clean break)",
         same(4, 2, 4), same(4, 2, 4, move=12), None, 0.3),
        ("4 vs 4 infantry, attacker withdraws below 30%, defender Fall back 30%",
         same(4, 2, 4), same(4, 2, 4), 0.3, 0.3),
    ]
    for name, a, d, t_att, t_def in field_cases:
        _, outcome = make_battle(a, d)
        w, r, x, dw, ea, ed = outcome(t_att, t_def)
        print(f"  {name}\n    win {w:.4f}, defender withdraws {dw:.4f}, attacker withdraws {r:.4f}, "
              f"destroyed {x:.4f}, attackers alive {ea:.3f}, defenders alive {ed:.3f}")


if __name__ == "__main__":
    main()
