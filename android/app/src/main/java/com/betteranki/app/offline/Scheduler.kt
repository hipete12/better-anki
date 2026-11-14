package com.betteranki.app.offline

// Port of the server scheduler (server/src/sched/scheduler.ts and fsrs.ts) for offline study.
// Offline it only drives button labels and when learning cards come back: on sync the server replays every
// review through its own scheduler, so small numeric differences here never reach your collection.
// Not ported: filtered decks (never offline) and the load balancer (needs the whole collection).
// Kept in step with the server by SchedulerVectorsTest (vectors from server/scripts/sched-vectors.ts).

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

object CardType { const val NEW = 0; const val LEARN = 1; const val REVIEW = 2; const val RELEARN = 3 }
object Queue { const val SUSPENDED = -1; const val SCHED_BURIED = -2; const val USER_BURIED = -3; const val NEW = 0; const val LEARN = 1; const val REVIEW = 2; const val DAY_LEARN = 3; const val PREVIEW = 4 }
object RevlogType { const val LEARN = 0; const val REVIEW = 1; const val RELEARN = 2 }

/** Deck options the scheduler and study queue use (the server sends the full preset; unknown keys are ignored). */
@Serializable
data class DeckConf(
    val id: Long = 1,
    val name: String = "",
    val newPerDay: Int = 20,
    val reviewsPerDay: Int = 200,
    val newIgnoreReviewLimit: Boolean = false,
    val learnSteps: List<Double> = listOf(1.0, 10.0),
    val graduatingIvl: Int = 1,
    val easyIvl: Int = 4,
    val initialEase: Double = 2.5,
    val newGatherPriority: Int = 0,
    val newSortOrder: Int = 0,
    val newMix: Int = 0,
    val interdayLearningMix: Int = 0,
    val reviewOrder: Int = 0,
    val relearnSteps: List<Double> = listOf(10.0),
    val minLapseIvl: Int = 1,
    val lapseMult: Double = 0.0,
    val leechThreshold: Int = 8,
    val leechAction: Int = 1,
    val maxIvl: Int = 36500,
    val easyMult: Double = 1.3,
    val hardMult: Double = 1.2,
    val ivlMult: Double = 1.0,
    val buryNew: Boolean = false,
    val buryReviews: Boolean = false,
    val buryInterday: Boolean = false,
    val showTimer: Boolean = false,
    val capAnswerSecs: Int = 60,
    val disableAutoplay: Boolean = false,
    val autoAdvanceQuestionSecs: Double = 0.0,
    val autoAdvanceAnswerSecs: Double = 0.0,
    val autoAdvanceAnswerAction: Int = 0,
    val desiredRetention: Double = 0.9,
    val fsrsParams: List<Double> = emptyList(),
)

/** A card's scheduling state (the server's card row minus content). */
@Serializable
data class SchedCard(
    val id: Long,
    val did: Long = 0,
    val odid: Long = 0,
    val type: Int = 0,
    val queue: Int = 0,
    val due: Long = 0,
    val odue: Long = 0,
    val ivl: Int = 0,
    val factor: Int = 0,
    val reps: Int = 0,
    val lapses: Int = 0,
    val left: Int = 0,
    val flags: Int = 0,
    val stability: Double? = null,
    val difficulty: Double? = null,
    @SerialName("last_review") val lastReview: Long? = null,
)

data class Outcome(val card: SchedCard, val dueInSecs: Long, val leech: Boolean, val revlogIvl: Int, val revlogType: Int)

/** Everything besides the card that scheduling depends on. Day numbers use the server's timezone offset. */
data class SchedContext(
    val conf: DeckConf,
    val fsrsEnabled: Boolean,
    val desiredRetention: Double,
    val now: Long,
    val rolloverHour: Int,
    val tzOffsetSecs: Long,
) {
    fun dayOf(ts: Long): Long = Math.floorDiv(ts + tzOffsetSecs - rolloverHour * 3600L, 86400L)
    val today: Long get() = dayOf(now)
}

// ---------------------------------------------------------------- JS-compatible helpers

/** JavaScript's Math.round (half up), not Kotlin's half-even round. */
internal fun jsRound(x: Double): Long = floor(x + 0.5).toLong()
private fun r8(x: Double): Double = floor(x * 1e8 + 0.5) / 1e8
private fun clampD(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))
private fun clampL(v: Long, lo: Long, hi: Long) = min(hi, max(lo, v))

/** String(n) in JavaScript for the numbers seeds use (integers print without ".0"). */
internal fun jsNumber(d: Double): String = if (d == floor(d) && kotlin.math.abs(d) < 1e21) d.toLong().toString() else d.toString()

/** Port of util.ts seededRandom: deterministic pseudo-random in [0,1) from numbers. */
fun seededRandom(vararg seeds: Number): Double {
    var h = 2166136261L.toInt()
    for (s in seeds) {
        val str = jsNumber(s.toDouble())
        for (ch in str) {
            h = h xor ch.code
            h *= 16777619
        }
        h = h xor 0x9e3779b9L.toInt()
    }
    h = h xor (h shl 13)
    h = h xor (h ushr 17)
    h = h xor (h shl 5)
    return (h.toLong() and 0xffffffffL) / 4294967296.0
}

/** Port of util.ts intervalLabel. */
fun intervalLabel(secs: Long): String {
    val s = secs.toDouble()
    val m = s / 60
    if (s < 60) return "${max(1, jsRound(s))}s"
    if (m < 60) return "${jsRound(m)}m"
    val h = m / 60
    if (h < 24) return "${fixed(h, if (h < 10) 1 else 0)}h"
    val d = h / 24
    if (d < 30) return "${jsRound(d)}d"
    val mo = d / 30.4375
    if (mo < 12) return "${fixed(mo, 1)}mo"
    return "${fixed(d / 365.25, 1)}y"
}
private fun fixed(v: Double, digits: Int): String {
    val str = java.math.BigDecimal(v).setScale(digits, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
    return if (str == "-0") "0" else str
}

// ---------------------------------------------------------------- FSRS-6

data class MemoryState(val stability: Double, val difficulty: Double)

val FSRS6_DEFAULT_PARAMS = listOf(
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
    0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
)
private const val S_MIN = 0.001
private const val S_MAX = 36500.0

private fun migrateParams(p: List<Double>?): List<Double> {
    if (p.isNullOrEmpty()) return FSRS6_DEFAULT_PARAMS
    if (p.size == 21) return p
    if (p.size == 19) return p + listOf(0.0, 0.5)
    if (p.size == 17) {
        val w = p.toMutableList()
        w[4] = w[5] * 2 + w[4]
        w[5] = ln(w[5] * 3 + 1) / 3
        w[6] = w[6] + 0.5
        return w + listOf(0.0, 0.0, 0.0, 0.5)
    }
    return FSRS6_DEFAULT_PARAMS
}

class Fsrs(params: List<Double>?) {
    val w = migrateParams(params)
    private val decay = -w[20]
    private val factor = r8(exp(ln(0.9) / decay) - 1)

    fun retrievability(elapsedDays: Double, stability: Double): Double =
        if (stability <= 0) 0.0 else r8((1 + factor * max(0.0, elapsedDays) / stability).pow(decay))
    fun rawInterval(stability: Double, desiredRetention: Double): Double = stability / factor * (desiredRetention.pow(1 / decay) - 1)
    fun nextInterval(stability: Double, desiredRetention: Double, maxIvl: Int = 36500): Long =
        clampL(jsRound(rawInterval(stability, desiredRetention)), 1, maxIvl.toLong())
    private fun initStability(g: Int) = clampD(w[g - 1], S_MIN, S_MAX)
    private fun initDifficulty(g: Int) = r8(w[4] - exp((g - 1) * w[5]) + 1)
    private fun nextDifficulty(d: Double, g: Int): Double {
        val deltaD = -w[6] * (g - 3)
        val nextD = d + r8(deltaD * (10 - d) / 9)
        val reverted = r8(w[7] * initDifficulty(4) + (1 - w[7]) * nextD)
        return clampD(reverted, 1.0, 10.0)
    }
    private fun nextRecallStability(d: Double, s: Double, r: Double, g: Int): Double {
        val hardPenalty = if (g == 2) w[15] else 1.0
        val easyBonus = if (g == 4) w[16] else 1.0
        return r8(clampD(s * (1 + exp(w[8]) * (11 - d) * s.pow(-w[9]) * (exp((1 - r) * w[10]) - 1) * hardPenalty * easyBonus), S_MIN, S_MAX))
    }
    private fun nextForgetStability(d: Double, s: Double, r: Double): Double =
        r8(clampD(w[11] * d.pow(-w[12]) * ((s + 1).pow(w[13]) - 1) * exp((1 - r) * w[14]), S_MIN, S_MAX))
    private fun nextShortTermStability(s: Double, g: Int): Double {
        val sinc = s.pow(-w[19]) * exp(w[17] * (g - 3 + w[18]))
        val masked = if (g >= 2) max(sinc, 1.0) else sinc
        return r8(clampD(s * masked, S_MIN, S_MAX))
    }
    fun nextState(mem: MemoryState?, elapsedDays: Double, g: Int): MemoryState {
        if (mem == null || (mem.stability == 0.0 && mem.difficulty == 0.0)) return MemoryState(initStability(g), clampD(initDifficulty(g), 1.0, 10.0))
        val d = clampD(mem.difficulty, 1.0, 10.0)
        val s = max(mem.stability, S_MIN)
        val t = max(0.0, elapsedDays)
        val r = retrievability(t, s)
        val newS = when {
            t == 0.0 -> nextShortTermStability(s, g)
            g == 1 -> clampD(r8(s / exp(w[17] * w[18])), S_MIN, nextForgetStability(d, s, r))
            else -> nextRecallStability(d, s, r, g)
        }
        return MemoryState(newS, nextDifficulty(d, g))
    }
    fun memoryFromSm2(ivl: Int, factor: Int, desiredRetention: Double): MemoryState {
        val s = max(S_MIN, ivl / max(0.01, rawInterval(1.0, desiredRetention)))
        val ease = if (factor > 0) factor / 1000.0 else 2.5
        return MemoryState(s, clampD(11 - (ease - 1.3) * 5, 1.0, 10.0))
    }
}

// ---------------------------------------------------------------- outcomes

private val FUZZ_RANGES = listOf(Triple(2.5, 7.0, 0.15), Triple(7.0, 20.0, 0.1), Triple(20.0, Double.POSITIVE_INFINITY, 0.05))

fun fuzzBounds(ivl: Double, minimum: Long, maximum: Long): Pair<Long, Long> {
    if (ivl < 2.5) {
        val v = clampL(jsRound(ivl), minimum, maximum)
        return v to v
    }
    var delta = 1.0
    for ((start, end, f) in FUZZ_RANGES) delta += f * max(0.0, min(ivl, end) - start)
    var lo = clampL(jsRound(ivl - delta), minimum, maximum)
    val hi = clampL(jsRound(ivl + delta), minimum, maximum)
    if (lo > hi) lo = hi
    return lo to hi
}

private class Ctx(val card: SchedCard, val sc: SchedContext) {
    val conf = sc.conf
    val now = sc.now
    val today = sc.today
    val fsrs: Fsrs? = if (sc.fsrsEnabled) Fsrs(conf.fsrsParams) else null
    val dr = sc.desiredRetention
    val elapsedDays: Long
    val prevMem: MemoryState?

    init {
        val due = if (card.odid != 0L && card.odue != 0L) card.odue else card.due
        elapsedDays = when {
            card.lastReview != null -> max(0L, today - sc.dayOf(card.lastReview))
            card.type == CardType.REVIEW -> max(0L, card.ivl - (due - today))
            else -> 0L
        }
        prevMem = when {
            fsrs == null -> null
            card.stability != null && card.difficulty != null && card.stability > 0 -> MemoryState(card.stability, card.difficulty)
            (card.type == CardType.REVIEW || card.type == CardType.RELEARN) && card.ivl > 0 -> fsrs.memoryFromSm2(card.ivl, card.factor, dr)
            else -> null
        }
    }

    fun fuzzedInterval(ivl: Double, minimumIn: Long, rating: Int): Long {
        val maximum = max(minimumIn, conf.maxIvl.toLong())
        val minimum = min(max(1L, minimumIn), maximum)
        val (lo, hi) = fuzzBounds(ivl, minimum, maximum)
        if (lo == hi) return lo
        val rnd = seededRandom(card.id, card.reps, rating)
        return lo + floor(rnd * (hi - lo + 1)).toLong()
    }
}

private class Draft(var card: SchedCard, var dueInSecs: Long = 0, var leech: Boolean = false, var revlogIvl: Int = 0, val revlogType: Int) {
    fun done() = Outcome(card, dueInSecs, leech, revlogIvl, revlogType)
}

private fun learnHardDelayMins(steps: List<Double>, idx: Int): Double =
    if (idx == 0) { if (steps.size > 1) (steps[0] + steps[1]) / 2 else min(steps[0] * 1.5, steps[0] + 1440) } else steps[idx]

private fun toLearning(ctx: Ctx, o: Draft, delayMins: Double, left: Int, type: Int): Draft {
    val secs = jsRound(delayMins * 60)
    var c = o.card.copy(type = type, left = left)
    if (delayMins >= 1440) {
        val days = max(1L, jsRound(delayMins / 1440))
        c = c.copy(queue = Queue.DAY_LEARN, due = ctx.today + days)
        o.dueInSecs = days * 86400
    } else {
        val fuzz = floor(seededRandom(c.id, c.reps, delayMins) * min(secs * 0.25, 300.0)).toLong()
        c = c.copy(queue = Queue.LEARN, due = ctx.now + secs + (if (secs >= 60) fuzz else 0))
        o.dueInSecs = secs
    }
    o.card = c
    o.revlogIvl = (-secs).toInt()
    return o
}

private fun toReview(ctx: Ctx, o: Draft, ivlIn: Double): Draft {
    val ivl = clampL(jsRound(ivlIn), 1, max(1, ctx.conf.maxIvl).toLong()).toInt()
    var c = o.card.copy(type = CardType.REVIEW, queue = Queue.REVIEW, ivl = ivl, due = ctx.today + ivl, left = 0)
    if (c.factor == 0) c = c.copy(factor = jsRound(ctx.conf.initialEase * 1000).toInt())
    o.card = c
    o.revlogIvl = ivl
    o.dueInSecs = ivl * 86400L
    return o
}

/** The four possible outcomes for a card (port of computeOutcomes). */
fun computeOutcomes(card: SchedCard, sc: SchedContext): Map<Int, Outcome> {
    val ctx = Ctx(card, sc)
    val conf = ctx.conf
    val mems = HashMap<Int, MemoryState>()
    ctx.fsrs?.let { f -> for (r in 1..4) mems[r] = f.nextState(ctx.prevMem, ctx.elapsedDays.toDouble(), r) }
    val revlogType = when (card.type) {
        CardType.NEW, CardType.LEARN -> RevlogType.LEARN
        CardType.RELEARN -> RevlogType.RELEARN
        else -> RevlogType.REVIEW
    }
    fun base(r: Int) = Draft(
        card.copy(reps = card.reps + 1, lastReview = ctx.now, stability = mems[r]?.stability ?: card.stability, difficulty = mems[r]?.difficulty ?: card.difficulty),
        revlogType = revlogType,
    )
    fun raw(r: Int) = ctx.fsrs!!.rawInterval(mems[r]!!.stability, ctx.dr)
    val out = HashMap<Int, Outcome>()

    when (card.type) {
        CardType.NEW, CardType.LEARN -> {
            val steps = conf.learnSteps.filter { it > 0 }
            val idx = if (card.type == CardType.NEW) 0 else (steps.size - card.left).coerceIn(0, max(0, steps.size - 1))
            val goodIvl: Long
            val easyIvl: Long
            if (ctx.fsrs != null) {
                goodIvl = ctx.fuzzedInterval(raw(3) * conf.ivlMult, 1, 3)
                easyIvl = ctx.fuzzedInterval(raw(4) * conf.ivlMult, goodIvl + 1, 4)
            } else {
                goodIvl = max(1, conf.graduatingIvl).toLong()
                easyIvl = max(goodIvl + 1, conf.easyIvl.toLong())
            }
            fun graduate(r: Int, ivl: Long) = toReview(ctx, base(r), ivl.toDouble()).done()
            if (steps.isEmpty()) {
                out[1] = graduate(1, if (ctx.fsrs != null) ctx.fuzzedInterval(raw(1), 1, 1) else 1)
                out[2] = graduate(2, goodIvl)
                out[3] = graduate(3, goodIvl)
                out[4] = graduate(4, easyIvl)
            } else {
                out[1] = toLearning(ctx, base(1), steps[0], steps.size, CardType.LEARN).done()
                out[2] = toLearning(ctx, base(2), learnHardDelayMins(steps, idx), steps.size - idx, CardType.LEARN).done()
                out[3] = if (idx + 1 < steps.size) toLearning(ctx, base(3), steps[idx + 1], steps.size - idx - 1, CardType.LEARN).done() else graduate(3, goodIvl)
                out[4] = graduate(4, easyIvl)
            }
        }
        CardType.REVIEW -> {
            val due = if (card.odid != 0L && card.odue != 0L) card.odue else card.due
            val daysLate = due - ctx.today
            val late = max(0L, -daysLate).toDouble()
            val ease = (if (card.factor != 0) card.factor.toDouble() else conf.initialEase * 1000) / 1000
            val hard: Long
            val good: Long
            val easy: Long
            if (ctx.fsrs != null) {
                hard = ctx.fuzzedInterval(raw(2) * conf.ivlMult, 1, 2)
                good = ctx.fuzzedInterval(raw(3) * conf.ivlMult, hard + 1, 3)
                easy = ctx.fuzzedInterval(raw(4) * conf.ivlMult, good + 1, 4)
            } else if (daysLate > 0) {
                val elapsed = max(0L, card.ivl - daysLate).toDouble()
                val factorHard = max(conf.hardMult, 1.0) * conf.ivlMult
                hard = ctx.fuzzedInterval(max(elapsed * factorHard, card.ivl * factorHard / 2), 1, 2)
                good = ctx.fuzzedInterval(max(elapsed * ease, card.ivl.toDouble()) * conf.ivlMult, hard + 1, 3)
                easy = ctx.fuzzedInterval(max(elapsed * ease * conf.easyMult, card.ivl.toDouble()) * conf.ivlMult, good + 1, 4)
            } else {
                val hardMin = if (conf.hardMult > 1) card.ivl + 1L else 1L
                hard = ctx.fuzzedInterval(card.ivl * conf.hardMult * conf.ivlMult, hardMin, 2)
                val goodMin = if (conf.hardMult > 1) hard + 1 else card.ivl + 1L
                good = ctx.fuzzedInterval((card.ivl + late / 2) * ease * conf.ivlMult, goodMin, 3)
                easy = ctx.fuzzedInterval((card.ivl + late) * ease * conf.easyMult * conf.ivlMult, good + 1, 4)
            }
            // Again (lapse)
            run {
                val o = base(1)
                val lapses = card.lapses + 1
                var lapseIvl = if (ctx.fsrs != null) max(conf.minLapseIvl.toLong(), min(card.ivl.toLong(), ctx.fsrs.nextInterval(mems[1]!!.stability, ctx.dr, conf.maxIvl)))
                else max(conf.minLapseIvl.toLong(), jsRound(card.ivl * conf.lapseMult))
                lapseIvl = max(1L, lapseIvl)
                var c = o.card.copy(lapses = lapses)
                if (ctx.fsrs == null) c = c.copy(factor = max(1300, (if (card.factor != 0) card.factor else 2500) - 200))
                val t = conf.leechThreshold
                if (t > 0 && lapses >= t && (lapses - t) % max(1, ceil(t / 2.0).toInt()) == 0) o.leech = true
                val steps = conf.relearnSteps.filter { it > 0 }
                o.card = c.copy(ivl = lapseIvl.toInt())
                out[1] = (if (steps.isNotEmpty()) toLearning(ctx, o, steps[0], steps.size, CardType.RELEARN) else toReview(ctx, o, lapseIvl.toDouble())).done()
            }
            fun rev(r: Int, ivl: Long, factorDelta: Int): Outcome {
                val o = base(r)
                if (ctx.fsrs == null) o.card = o.card.copy(factor = max(1300, (if (card.factor != 0) card.factor else 2500) + factorDelta))
                return toReview(ctx, o, ivl.toDouble()).done()
            }
            out[2] = rev(2, hard, -150)
            out[3] = rev(3, good, 0)
            out[4] = rev(4, easy, 150)
        }
        else -> { // relearning
            val steps = conf.relearnSteps.filter { it > 0 }
            val idx = (steps.size - card.left).coerceIn(0, max(0, steps.size - 1))
            var goodIvl = max(1, card.ivl).toLong()
            var easyIvl = goodIvl + 1
            if (ctx.fsrs != null) {
                goodIvl = max(1L, ctx.fsrs.nextInterval(mems[3]!!.stability, ctx.dr, conf.maxIvl))
                easyIvl = max(goodIvl + 1, ctx.fsrs.nextInterval(mems[4]!!.stability, ctx.dr, conf.maxIvl))
            }
            if (steps.isEmpty()) {
                out[1] = toReview(ctx, base(1), max(1, conf.minLapseIvl).toDouble()).done()
                out[2] = toReview(ctx, base(2), goodIvl.toDouble()).done()
                out[3] = toReview(ctx, base(3), goodIvl.toDouble()).done()
                out[4] = toReview(ctx, base(4), easyIvl.toDouble()).done()
            } else {
                out[1] = toLearning(ctx, base(1), steps[0], steps.size, CardType.RELEARN).done()
                out[2] = toLearning(ctx, base(2), learnHardDelayMins(steps, idx), steps.size - idx, CardType.RELEARN).done()
                out[3] = if (idx + 1 < steps.size) toLearning(ctx, base(3), steps[idx + 1], steps.size - idx - 1, CardType.RELEARN).done() else toReview(ctx, base(3), goodIvl.toDouble()).done()
                out[4] = toReview(ctx, base(4), easyIvl.toDouble()).done()
            }
        }
    }
    return out
}
