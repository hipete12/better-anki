package com.betteranki.app.offline

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The offline scheduler must agree with the server's. Vectors come from the server's own computeOutcomes:
 * `cd server && bun scripts/sched-vectors.ts ../android/app/src/test/resources/sched_vectors.json`
 */
class SchedulerVectorsTest {
    @Serializable
    data class Expected(
        val type: Int, val queue: Int, val due: Long, val ivl: Int, val factor: Int, val left: Int, val reps: Int, val lapses: Int,
        val stability: Double? = null, val difficulty: Double? = null, val dueInSecs: Long, val revlogIvl: Int, val revlogType: Int, val leech: Boolean,
    )
    @Serializable
    data class Vector(val name: String, val fsrs: Boolean, val rolloverHour: Int, val tzOffsetSecs: Long, val now: Long, val today: Long, val conf: DeckConf, val card: SchedCard, val outcomes: Map<String, Expected>)

    private val vectors: List<Vector> by lazy {
        val text = javaClass.classLoader!!.getResource("sched_vectors.json")!!.readText()
        Json { ignoreUnknownKeys = true }.decodeFromString(text)
    }

    @Test fun matchesServerScheduler() {
        assertTrue("vectors loaded", vectors.size > 100)
        val failures = mutableListOf<String>()
        for (v in vectors) {
            val sc = SchedContext(v.conf, v.fsrs, v.conf.desiredRetention, v.now, v.rolloverHour, v.tzOffsetSecs)
            assertEquals("today for ${v.name}", v.today, sc.today)
            val got = computeOutcomes(v.card, sc)
            for ((r, e) in v.outcomes) {
                val o = got[r.toInt()]!!
                val c = o.card
                fun near(a: Double?, b: Double?) = (a == null && b == null) || (a != null && b != null && abs(a - b) < 1e-6)
                val ok = c.type == e.type && c.queue == e.queue && c.due == e.due && c.ivl == e.ivl && c.factor == e.factor && c.left == e.left &&
                    c.reps == e.reps && c.lapses == e.lapses && near(c.stability, e.stability) && near(c.difficulty, e.difficulty) &&
                    o.dueInSecs == e.dueInSecs && o.revlogIvl == e.revlogIvl && o.revlogType == e.revlogType && o.leech == e.leech
                if (!ok) failures += "${v.name} rating $r\n  expected $e\n  got      $c dueIn=${o.dueInSecs} rlIvl=${o.revlogIvl} rlType=${o.revlogType} leech=${o.leech}"
            }
        }
        assertTrue("${failures.size} mismatches:\n" + failures.take(8).joinToString("\n"), failures.isEmpty())
    }

    @Test fun seededRandomMatchesServer() {
        // values from server/src/util.ts seededRandom
        assertEquals(0.2975282680708915, seededRandom(1, 2, 3), 0.0)
        assertEquals(0.06090267817489803, seededRandom(1794680876159L, 9, 3), 0.0)
        assertEquals(seededRandom(1, 2, 3), seededRandom(1L, 2, 3.0), 0.0)
        assertEquals("5.5", jsNumber(5.5))
        assertEquals("10", jsNumber(10.0))
    }

    @Test fun intervalLabels() {
        assertEquals("1s", intervalLabel(0))
        assertEquals("10m", intervalLabel(600))
        assertEquals("1.5h", intervalLabel(5400))
        assertEquals("12h", intervalLabel(43200))
        assertEquals("4d", intervalLabel(4 * 86400))
        assertEquals("1.1mo", intervalLabel(34 * 86400))
        assertEquals("2y", intervalLabel(730L * 86400 + 43200))
    }
}
