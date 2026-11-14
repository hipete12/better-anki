package com.betteranki.app.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineEngineTest {
    private val t0 = 1_800_000_000L + 13 * 3600 // an afternoon (UTC, tz offset 0)
    private val today = Math.floorDiv(t0 - 4 * 3600L, 86400L)
    private var nextId = 1L

    private fun card(did: Long, type: Int = 0, queue: Int = 0, due: Long = 0, ivl: Int = 0, nid: Long = nextId, ord: Int = 0) =
        PackCard(id = nextId++, nid = nid, ord = ord, did = did, type = type, queue = queue, due = due, ivl = ivl, factor = if (type == 2) 2500 else 0, reps = if (type == 0) 0 else 3)

    private fun pack(cards: List<PackCard>, conf: DeckConf = DeckConf(id = 1, newPerDay = 3, learnSteps = listOf(1.0, 10.0)), decks: List<PackDeck> = listOf(PackDeck(10, "Spanish", 1)), deckToday: List<PackDeckToday> = emptyList()) =
        Pack(base = 5, serverTime = t0 * 1000, tzOffsetSecs = 0, today = today, config = PackConfig(fsrs = false, rolloverHour = 4, learnAheadMins = 20), roots = listOf(10), decks = decks, deckConfigs = listOf(conf), deckToday = deckToday, cards = cards)

    private fun answer(e: OfflineEngine, id: Long, ease: Int, at: Long) = e.record(OfflineEvent("e${e.log.size}", "answer", id, at * 1000, ease = ease, timeMs = 4000))

    @Test fun reviewsFirstWithNewMixedInAndDailyNewLimit() {
        val cards = listOf(card(10, type = 2, queue = 2, due = today, ivl = 5)) + List(5) { card(10) }
        val e = OfflineEngine(pack(cards))
        val n = e.next(10, t0)
        assertEquals(OfflineEngine.Counts(new = 3, learn = 0, review = 1), n.counts) // new limit 3 of 5
        assertNotNull(n.card)
    }

    @Test fun learningCardComesBackWhenDue() {
        val e = OfflineEngine(pack(listOf(card(10), card(10))))
        val first = e.next(10, t0).card!!
        answer(e, first.id, 3, t0) // Good on step 1 of [1m, 10m] -> due in ~10m
        val learning = e.card(first.id)!!
        assertEquals(CardType.LEARN, learning.type)
        assertTrue(learning.due in t0 + 600..t0 + 900)
        val second = e.next(10, t0 + 5).card!!
        assertTrue(second.id != first.id)
        answer(e, second.id, 4, t0 + 5) // Easy graduates
        // nothing else due now; the learning card is still ahead (learn-ahead 20 min covers it)
        val next = e.next(10, t0 + 10)
        assertEquals(first.id, next.card?.id)
        assertEquals("learn", next.queueName)
    }

    @Test fun reviewDoneCountsAgainstTheLimitAndAnswersUseEventTime() {
        val r = card(10, type = 2, queue = 2, due = today, ivl = 10)
        val e = OfflineEngine(pack(listOf(r), conf = DeckConf(id = 1, reviewsPerDay = 1)))
        answer(e, r.id, 3, t0 + 60)
        val after = e.card(r.id)!!
        assertEquals(CardType.REVIEW, after.type)
        assertTrue(after.ivl > 10)
        assertEquals(t0 + 60, after.lastReview)
        assertEquals(OfflineEngine.Counts(0, 0, 0), e.next(10, t0 + 61).counts)
        assertEquals(Triple(1, 4000L, 0), e.today(t0 + 61))
    }

    @Test fun siblingsAreBuriedAndComeBackTheNextDay() {
        val a = card(10, nid = 99)
        val b = card(10, nid = 99, ord = 1)
        val e = OfflineEngine(pack(listOf(a, b), conf = DeckConf(id = 1, buryNew = true, learnSteps = emptyList())))
        answer(e, a.id, 3, t0)
        assertEquals(Queue.SCHED_BURIED, e.card(b.id)!!.queue)
        assertEquals(1, e.next(10, t0 + 1).buried)
        // next day (after the 4am rollover) the sibling is back; the first card is due again as a review
        val tomorrow = e.next(10, t0 + 86400)
        assertEquals(OfflineEngine.Counts(new = 1, learn = 0, review = 1), tomorrow.counts)
        assertEquals(0, tomorrow.buried)
        assertEquals(Queue.NEW, e.card(b.id)!!.queue)
    }

    @Test fun buryFlagSuspendMarkAndReplayingTheLogGivesTheSameState() {
        val cs = List(4) { card(10) }
        val p = pack(cs)
        val e = OfflineEngine(p)
        e.record(OfflineEvent("1", "bury", cs[0].id, t0 * 1000))
        e.record(OfflineEvent("2", "suspend", cs[1].id, t0 * 1000 + 1))
        e.record(OfflineEvent("3", "flag", cs[2].id, t0 * 1000 + 2, flag = 3))
        e.record(OfflineEvent("4", "mark", cs[3].id, t0 * 1000 + 3, marked = true))
        answer(e, cs[3].id, 1, t0 + 5)
        assertEquals(Queue.USER_BURIED, e.card(cs[0].id)!!.queue)
        assertEquals(Queue.SUSPENDED, e.card(cs[1].id)!!.queue)
        assertEquals(3, e.card(cs[2].id)!!.flags)
        assertTrue(e.isMarked(cs[3].id))
        // undo = rebuild from the log minus the last action
        val replayed = OfflineEngine(p, e.log)
        for (c in cs) assertEquals(e.card(c.id), replayed.card(c.id))
        val undone = OfflineEngine(p, e.log.dropLast(1))
        assertEquals(CardType.NEW, undone.card(cs[3].id)!!.type)
    }

    @Test fun subdeckLimitsRollUpToTheParent() {
        val decks = listOf(PackDeck(10, "Lang", 1), PackDeck(11, "Lang::French", 1), PackDeck(12, "Lang::German", 1))
        val cards = List(4) { card(11) } + List(4) { card(12) }
        val e = OfflineEngine(pack(cards, conf = DeckConf(id = 1, newPerDay = 5), decks = decks))
        assertEquals(5, e.counts(10, t0).new) // parent limit
        assertEquals(4, e.counts(11, t0).new) // own deck
        assertEquals(listOf(10L, 11L, 12L), e.tree(10).map { it.id })
    }

    @Test fun todaysCountsFromTheServerCarryOver() {
        val e = OfflineEngine(pack(List(5) { card(10) }, deckToday = listOf(PackDeckToday(10, newDone = 2))))
        assertEquals(1, e.counts(10, t0).new) // 3 per day, 2 done online already
        assertNull(OfflineEngine(pack(emptyList())).next(10, t0).card)
    }

    @Test fun leechSuspendsWhenConfigured() {
        val r = card(10, type = 2, queue = 2, due = today, ivl = 10).copy(lapses = 1)
        val e = OfflineEngine(pack(listOf(r), conf = DeckConf(id = 1, leechThreshold = 2, leechAction = 0, relearnSteps = emptyList())))
        answer(e, r.id, 1, t0)
        assertEquals(true, e.lastLeech)
        assertEquals(Queue.SUSPENDED, e.card(r.id)!!.queue)
    }
}
