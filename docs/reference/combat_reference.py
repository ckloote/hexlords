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
- On withdrawal, pursuit: the defender's fastest surviving unit (ties: the
  strongest) strikes the attacker's weakest surviving unit once, with
  probability P / (P + T). It kills only if the target has 1 hit left.
  No pursuit if every surviving attacker is at least as fast as the pursuer.
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

    def withdraw(i, ha, j):
        """Outcome tuple for a withdrawal from this state, including pursuit."""
        alive = nA - i
        pursuers = [D[k] for k in range(j, nD)]
        pursuer = max(pursuers, key=lambda u: (u.move, u.strength))
        clean_break = all(A[k].move >= pursuer.move for k in range(i, nA))
        if not clean_break and ha == 1:
            target = A[i]
            alive -= pursuer.strength / (pursuer.strength + target.strength)
        return (0.0, 1.0, 0.0, alive, nD - j)

    @lru_cache(maxsize=None)
    def play(i, ha, j, hd, threshold):
        """(P win, P withdraw, P destroyed, E attackers alive, E defenders alive)."""
        if j == nD:
            return (1.0, 0.0, 0.0, nA - i, 0)
        if i == nA:
            return (0.0, 0.0, 1.0, 0, nD - j)
        p = A[i].strength / (A[i].strength + D[j].strength)

        def next_state(i2, ha2, j2, hd2, after_death):
            if (after_death and threshold is not None and i2 < nA and j2 < nD
                    and p_win(i2, ha2, j2, hd2) < threshold):
                return withdraw(i2, ha2, j2)
            return play(i2, ha2, j2, hd2, threshold)

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

    def outcome(threshold=None):
        return play(0, A[0].hits, 0, D[0].hits, threshold)

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
        w, r, x, ea, ed = outcome(threshold)
        print(f"  Withdraw below {threshold:.0%}: win {w:.4f}, withdraw {r:.4f}, "
              f"destroyed {x:.4f}, attackers alive {ea:.3f}, defenders alive {ed:.3f}")


if __name__ == "__main__":
    main()
