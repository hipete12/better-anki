package com.betteranki.app.offline

import kotlin.math.max
import kotlin.math.min

/**
 * Offline study state: the downloaded cards with the local action log replayed on top, and the study queue
 * built like the server's (server/src/sched/queue.ts: daily limits per deck, learning cards coming back,
 * interday learning and new-card mixing, sibling burying, unburying on a new day).
 * Pure Kotlin so it can be unit-tested; persistence and networking live in OfflineRepo.
 */
class OfflineEngine(val pack: Pack, initialEvents: List<OfflineEvent> = emptyList()) {
    private val content = pack.cards.associateBy { it.id }
    private val cards = LinkedHashMap<Long, SchedCard>().apply { pack.cards.forEach { put(it.id, it.sched()) } }
    private val marked = HashMap<Long, Boolean>().apply { pack.cards.forEach { put(it.nid, it.marked) } }
    private val decks = pack.decks.associateBy { it.id }
    private val decksByName = pack.decks.associateBy { it.name.lowercase() }
    private val confs = pack.deckConfigs.associateBy { it.id }
    private val events = ArrayList<OfflineEvent>()
    private var day = pack.today
    /** Per deck for the current day: new done, reviews done, extend new, extend reviews. */
    private val done = HashMap<Long, IntArray>()
    private val answers = ArrayList<Triple<Long, Int, Long>>() // at ms, ease, timeMs

    /** Set when the last answer made a card a leech: (suspended?). */
    var lastLeech: Boolean? = null
        private set

    init {
        pack.deckToday.forEach { done[it.did] = intArrayOf(it.newDone, it.revDone, it.extendNew, it.extendRev) }
        initialEvents.forEach { applyEvent(it) }
    }

    val log: List<OfflineEvent> get() = events
    /** The study day the engine is on, and today's per-deck counts (to carry into the pack after a sync). */
    val currentDay: Long get() = day
    fun todayCounts(): List<PackDeckToday> = done.map { (did, d) -> PackDeckToday(did, d[0], d[1], d[2], d[3]) }
    fun content(cardId: Long) = content[cardId]
    fun card(cardId: Long) = cards[cardId]
    fun isMarked(cardId: Long) = content[cardId]?.let { marked[it.nid] } ?: false
    fun deck(id: Long) = decks[id]
    fun hasDeck(id: Long) = decks.containsKey(id)

    fun dayOf(secs: Long): Long = Math.floorDiv(secs + pack.tzOffsetSecs - pack.config.rolloverHour * 3600L, 86400L)

    // ------------------------------------------------------------ recording

    fun record(e: OfflineEvent) {
        lastLeech = null
        applyEvent(e)
    }

    private fun applyEvent(e: OfflineEvent) {
        events += e
        val secs = e.at / 1000
        ensureDay(dayOf(secs))
        val c = cards[e.cardId] ?: return
        when (e.kind) {
            "answer" -> answer(c, e.ease ?: 3, e.timeMs ?: 0, secs, e.at)
            "bury" -> if (c.queue >= 0) cards[c.id] = c.copy(queue = Queue.USER_BURIED)
            "buryNote" -> siblingsAndSelf(c).forEach { s -> if (s.queue >= 0) cards[s.id] = s.copy(queue = Queue.USER_BURIED) }
            "suspend" -> cards[c.id] = c.copy(queue = Queue.SUSPENDED)
            "suspendNote" -> siblingsAndSelf(c).forEach { s -> cards[s.id] = s.copy(queue = Queue.SUSPENDED) }
            "flag" -> cards[c.id] = c.copy(flags = (c.flags and 7.inv()) or ((e.flag ?: 0) and 7))
            "mark" -> content[c.id]?.let { marked[it.nid] = e.marked == true }
        }
    }

    private fun siblingsAndSelf(c: SchedCard): List<SchedCard> {
        val nid = content[c.id]?.nid ?: return listOf(c)
        return pack.cards.filter { it.nid == nid }.mapNotNull { cards[it.id] }
    }

    fun context(c: SchedCard, now: Long): SchedContext {
        val deck = decks[c.odid.takeIf { it != 0L } ?: c.did]
        val conf = confs[deck?.configId ?: 1L] ?: pack.deckConfigs.firstOrNull() ?: DeckConf()
        return SchedContext(conf, pack.config.fsrs, deck?.desiredRetention ?: conf.desiredRetention, now, pack.config.rolloverHour, pack.tzOffsetSecs)
    }

    private fun answer(c0: SchedCard, ease: Int, timeMs: Long, now: Long, atMs: Long) {
        val wasSuspended = c0.queue == Queue.SUSPENDED
        val c = if (c0.queue < 0) c0.copy(queue = unburiedQueue(c0)) else c0
        val sc = context(c, now)
        val o = computeOutcomes(c, sc).getValue(ease)
        var next = o.card
        if (o.leech) {
            val suspend = sc.conf.leechAction == 0
            if (suspend) next = next.copy(queue = Queue.SUSPENDED)
            lastLeech = suspend
        }
        if (wasSuspended) next = next.copy(queue = Queue.SUSPENDED)
        cards[c.id] = next
        val ms = min(max(0L, timeMs), max(1, sc.conf.capAnswerSecs) * 1000L)
        answers += Triple(atMs, ease, ms)
        val wasNew = c.type == CardType.NEW
        val wasReview = c.queue == Queue.REVIEW || c.queue == Queue.DAY_LEARN
        for (did in chainToTop(c.odid.takeIf { it != 0L } ?: c.did)) {
            val d = done.getOrPut(did) { IntArray(4) }
            if (wasNew) d[0]++
            if (wasReview) d[1]++
        }
        // bury siblings, like the server
        val types = buildSet { if (sc.conf.buryNew) add(Queue.NEW); if (sc.conf.buryReviews) add(Queue.REVIEW); if (sc.conf.buryInterday) add(Queue.DAY_LEARN) }
        if (types.isNotEmpty()) {
            val nid = content[c.id]?.nid
            for (p in pack.cards) {
                if (p.nid != nid || p.id == c.id) continue
                val s = cards[p.id] ?: continue
                if (s.queue !in types) continue
                if ((s.queue == Queue.REVIEW || s.queue == Queue.DAY_LEARN) && s.due > day) continue
                cards[s.id] = s.copy(queue = Queue.SCHED_BURIED)
            }
        }
    }

    private fun unburiedQueue(c: SchedCard) = when (c.type) {
        CardType.NEW -> Queue.NEW
        CardType.REVIEW -> Queue.REVIEW
        else -> if (c.due > 1_000_000_000L) Queue.LEARN else Queue.DAY_LEARN
    }

    /** A new study day: buried cards come back and today's counts start over (as the server does). */
    private fun ensureDay(d: Long) {
        if (d <= day) return
        day = d
        for ((id, c) in cards) if (c.queue == Queue.SCHED_BURIED || c.queue == Queue.USER_BURIED) cards[id] = c.copy(queue = unburiedQueue(c))
        done.clear()
    }

    // ------------------------------------------------------------ decks

    private fun parentsOf(d: PackDeck): List<PackDeck> {
        val parts = d.name.split("::")
        return (parts.size - 1 downTo 1).mapNotNull { decksByName[parts.take(it).joinToString("::").lowercase()] }
    }
    private fun chainToTop(did: Long): List<Long> = decks[did]?.let { d -> listOf(d.id) + parentsOf(d).map { it.id } } ?: listOf(did)
    /** The deck and its subdecks that were downloaded. */
    fun tree(rootId: Long): List<PackDeck> {
        val root = decks[rootId] ?: return emptyList()
        val prefix = root.name.lowercase() + "::"
        return pack.decks.filter { it.id == rootId || it.name.lowercase().startsWith(prefix) }.sortedBy { it.name.lowercase() }
    }

    // ------------------------------------------------------------ queue

    data class Counts(val new: Int, val learn: Int, val review: Int)
    data class Next(val card: SchedCard?, val queueName: String?, val counts: Counts, val nextLearnDue: Long?, val buried: Int)

    private class Gathered(val learnNow: List<SchedCard>, val dayLearn: List<SchedCard>, val reviews: List<SchedCard>, val news: List<SchedCard>)

    private fun gather(rootId: Long, now: Long): Gathered {
        ensureDay(dayOf(now))
        val root = decks[rootId] ?: return Gathered(emptyList(), emptyList(), emptyList(), emptyList())
        val tree = tree(rootId)
        val treeIds = tree.map { it.id }.toSet()
        val inTree = cards.values.filter { it.did in treeIds }
        val learnAhead = now + pack.config.learnAheadMins * 60L
        val learnNow = inTree.filter { (it.queue == Queue.LEARN || it.queue == Queue.PREVIEW) && it.due <= learnAhead }.sortedBy { it.due }

        val remaining = HashMap<Long, IntArray>()
        for (d in tree) {
            val conf = confs[d.configId] ?: DeckConf()
            val t = done[d.id] ?: IntArray(4)
            remaining[d.id] = intArrayOf(
                max(0, (d.newLimit ?: conf.newPerDay) + t[2] - t[0]),
                max(0, (d.reviewLimit ?: conf.reviewsPerDay) + t[3] - t[1]),
            )
        }
        fun chain(d: PackDeck): List<Long> {
            if (d.id == rootId) return listOf(d.id)
            val ids = mutableListOf(d.id)
            for (p in parentsOf(d)) { ids += p.id; if (p.id == rootId) break }
            return ids.filter { it in remaining }
        }
        fun avail(ids: List<Long>, k: Int) = ids.minOf { remaining.getValue(it)[k] }
        fun take(ids: List<Long>, k: Int, n: Int) = ids.forEach { remaining.getValue(it)[k] -= n }

        val rootConf = confs[root.configId] ?: DeckConf()
        val dayLearn = ArrayList<SchedCard>()
        val reviews = ArrayList<SchedCard>()
        val news = ArrayList<SchedCard>()
        for (d in tree) {
            val ids = chain(d)
            var cap = avail(ids, 1)
            if (cap <= 0) continue
            val dl = inTree.filter { it.did == d.id && it.queue == Queue.DAY_LEARN && it.due <= day }.sortedBy { it.due }.take(cap)
            dayLearn += dl; take(ids, 1, dl.size); cap -= dl.size
            if (cap <= 0) continue
            val rv = inTree.filter { it.did == d.id && it.queue == Queue.REVIEW && it.due <= day }.sortedWith(compareBy({ it.due }, { it.id })).take(cap)
            reviews += rv; take(ids, 1, rv.size)
        }
        for (d in tree) {
            val ids = chain(d)
            val conf = confs[d.configId] ?: DeckConf()
            var cap = avail(ids, 0)
            if (!conf.newIgnoreReviewLimit) cap = min(cap, avail(ids, 1))
            if (cap <= 0) continue
            val nw = inTree.filter { it.did == d.id && it.queue == Queue.NEW }.sortedWith(compareBy({ it.due }, { content[it.id]?.ord ?: 0 })).take(cap)
            news += nw; take(ids, 0, nw.size)
            if (!conf.newIgnoreReviewLimit) take(ids, 1, nw.size)
        }
        if (rootConf.newSortOrder == 0) news.sortWith(compareBy { content[it.id]?.ord ?: 0 }) // stable: template, then gather order
        if (rootConf.reviewOrder == 0) reviews.sortWith(compareBy({ it.due }, { seededRandom(it.id, day) }))
        return Gathered(learnNow, dayLearn, reviews, news)
    }

    /** The next card to study in a deck (port of nextCard). */
    fun next(rootId: Long, now: Long): Next {
        val g = gather(rootId, now)
        val counts = Counts(g.news.size, g.learnNow.size + g.dayLearn.size, g.reviews.size)
        val treeIds = tree(rootId).map { it.id }.toSet()
        val buried = cards.values.count { (it.queue == Queue.SCHED_BURIED || it.queue == Queue.USER_BURIED) && it.did in treeIds }
        g.learnNow.firstOrNull { it.due <= now }?.let { return Next(it, "learn", counts, null, buried) }

        val conf = decks[rootId]?.let { confs[it.configId] } ?: DeckConf()
        val a = g.dayLearn.map { it to "learn" }
        val b = g.reviews.map { it to "review" }
        val revLike = when (conf.interdayLearningMix) {
            2 -> a + b
            1 -> b + a
            else -> {
                val out = ArrayList<Pair<SchedCard, String>>()
                var ia = 0; var ib = 0
                repeat(a.size + b.size) {
                    if (ia < a.size && (ib >= b.size || (ia + 1).toDouble() / (a.size + 1) <= (ib + 1).toDouble() / (b.size + 1))) out += a[ia++] else out += b[ib++]
                }
                out
            }
        }
        val pick: Pair<SchedCard, String>? = when {
            g.news.isNotEmpty() && revLike.isNotEmpty() -> when (conf.newMix) {
                1 -> revLike[0]
                2 -> g.news[0] to "new"
                else -> {
                    val t = done[rootId] ?: IntArray(4)
                    val modulus = max(2, (g.news.size + revLike.size) / g.news.size)
                    if ((t[0] + t[1] + 1) % modulus == 0) g.news[0] to "new" else revLike[0]
                }
            }
            revLike.isNotEmpty() -> revLike[0]
            g.news.isNotEmpty() -> g.news[0] to "new"
            else -> null
        }
        if (pick != null) return Next(pick.first, pick.second, counts, null, buried)
        g.learnNow.firstOrNull()?.let { return Next(it, "learn", counts, null, buried) }
        val nextLearn = cards.values.filter { it.did in treeIds && (it.queue == Queue.LEARN || it.queue == Queue.PREVIEW) }.minOfOrNull { it.due }
        return Next(null, null, counts, nextLearn, buried)
    }

    fun counts(rootId: Long, now: Long): Counts = gather(rootId, now).let { Counts(it.news.size, it.learnNow.size + it.dayLearn.size, it.reviews.size) }

    fun outcomes(cardId: Long, now: Long): Map<Int, Outcome> {
        val c = cards.getValue(cardId)
        return computeOutcomes(c, context(c, now))
    }

    /** Answers given offline on the current study day: count, time, how many were Again. */
    fun today(now: Long): Triple<Int, Long, Int> {
        val d = dayOf(now)
        val todays = answers.filter { dayOf(it.first / 1000) == d }
        return Triple(todays.size, todays.sumOf { it.third }, todays.count { it.second == 1 })
    }

    /** Ids of the cards the log touches, for the base copies sent with a sync. */
    fun touchedIds(): Set<Long> = events.map { it.cardId }.toSet()
}
