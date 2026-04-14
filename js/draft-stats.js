// Draft statistics module for Agricola draft tool
// Computes hand grades, per-card quality indicators, and tag probability distributions.
// All math is analytical (order statistics, hypergeometric distribution) — no simulation.
// Uses `var` for Babel standalone compatibility.

var draftStats = (function () {

    // --- State (populated by init()) ---
    var occRanks = [];      // Global ranks of all Occupations, sorted ascending
    var minorRanks = [];    // Global ranks of all Minor Improvements, sorted ascending
    var occMean = 0;        // Mean global rank of Occupations
    var occVar = 0;         // Variance of Occupation global ranks
    var minorMean = 0;
    var minorVar = 0;
    var tagCounts = {};     // { tagName: { occ: N, minor: N } }
    var initialized = false;

    // --- Initialization (call once after card data loads) ---
    function init(cards) {
        if (!cards || cards.length === 0) return;

        var occs = [];
        var minors = [];
        tagCounts = {};

        cards.forEach(function (card) {
            if (typeof card.rank !== 'number' || !isFinite(card.rank)) return;
            if (card.type === 'Occupation') {
                occs.push(card.rank);
            } else if (card.type === 'Minor Improvement') {
                minors.push(card.rank);
            }
            // Count tags
            if (card.tags && card.tags.length > 0) {
                card.tags.forEach(function (tag) {
                    if (!tagCounts[tag]) tagCounts[tag] = { occ: 0, minor: 0 };
                    if (card.type === 'Occupation') tagCounts[tag].occ++;
                    else if (card.type === 'Minor Improvement') tagCounts[tag].minor++;
                });
            }
        });

        occs.sort(function (a, b) { return a - b; });
        minors.sort(function (a, b) { return a - b; });
        occRanks = occs;
        minorRanks = minors;

        // Population statistics
        occMean = mean(occs);
        occVar = variance(occs, occMean);
        minorMean = mean(minors);
        minorVar = variance(minors, minorMean);

        initialized = true;
    }

    function mean(arr) {
        if (arr.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < arr.length; i++) sum += arr[i];
        return sum / arr.length;
    }

    function variance(arr, mu) {
        if (arr.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < arr.length; i++) {
            var d = arr[i] - mu;
            sum += d * d;
        }
        return sum / arr.length;
    }

    // --- Normal CDF approximation (Abramowitz & Stegun) ---
    function normalCDF(z) {
        if (z < -8) return 0;
        if (z > 8) return 1;
        var negative = z < 0;
        if (negative) z = -z;
        var t = 1 / (1 + 0.2316419 * z);
        var d = 0.3989422804014327; // 1/sqrt(2*pi)
        var p = d * Math.exp(-z * z / 2);
        var poly = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530) * t;
        var cdf = 1 - p * poly;
        return negative ? 1 - cdf : cdf;
    }

    // --- Expected rank of the k-th best card (1-indexed) in a hand of n from a pool ---
    // Interpolates into the sorted rank array for the actual global rank.
    function expectedKthRank(k, n, rankArray) {
        var N = rankArray.length;
        if (N === 0 || n === 0 || k < 1 || k > n) return null;
        // Expected position (0-indexed) in the sorted array
        var pos = k * (N + 1) / (n + 1) - 1; // convert to 0-indexed
        if (pos < 0) pos = 0;
        if (pos >= N - 1) return rankArray[N - 1];
        // Linear interpolation
        var low = Math.floor(pos);
        var frac = pos - low;
        return rankArray[low] * (1 - frac) + rankArray[low + 1] * frac;
    }

    // --- Hand percentile ---
    // Lower sum of ranks = better hand. Returns percentile (0-100, higher = better).
    function handPercentile(handCards) {
        if (!initialized) return null;
        var occCards = [];
        var minorCards = [];
        handCards.forEach(function (card) {
            if (typeof card.rank !== 'number' || !isFinite(card.rank)) return;
            if (card.type === 'Occupation') occCards.push(card.rank);
            else if (card.type === 'Minor Improvement') minorCards.push(card.rank);
        });

        if (occCards.length === 0 && minorCards.length === 0) return null;

        // Expected sum and variance for each type
        var expectedSum = 0;
        var totalVar = 0;

        if (occCards.length > 0) {
            var nOcc = occCards.length;
            var NOcc = occRanks.length;
            expectedSum += nOcc * occMean;
            // Finite-population correction: n * sigma^2 * (N-n)/(N-1)
            totalVar += nOcc * occVar * (NOcc - nOcc) / (NOcc - 1);
        }
        if (minorCards.length > 0) {
            var nMin = minorCards.length;
            var NMin = minorRanks.length;
            expectedSum += nMin * minorMean;
            totalVar += nMin * minorVar * (NMin - nMin) / (NMin - 1);
        }

        var actualSum = 0;
        occCards.forEach(function (r) { actualSum += r; });
        minorCards.forEach(function (r) { actualSum += r; });

        if (totalVar === 0) return 50;
        var z = (actualSum - expectedSum) / Math.sqrt(totalVar);
        // Lower sum = better hand. P(random hand has higher sum) = 1 - normalCDF(z).
        // So a great hand (very negative z) gets percentile near 100.
        return Math.round((1 - normalCDF(z)) * 100);
    }

    // --- Hand grade from percentile ---
    function handGrade(percentile) {
        if (percentile === null) return { grade: '—', color: '#888' };
        if (percentile >= 89) return { grade: 'A+', color: '#1a7a1a' };
        if (percentile >= 78) return { grade: 'A', color: '#28a745' };
        if (percentile >= 67) return { grade: 'B+', color: '#5cb85c' };
        if (percentile >= 56) return { grade: 'B', color: '#8B6914' };
        if (percentile >= 45) return { grade: 'C+', color: '#d4a017' };
        if (percentile >= 34) return { grade: 'C', color: '#e67e22' };
        if (percentile >= 23) return { grade: 'D+', color: '#d35400' };
        if (percentile >= 12) return { grade: 'D', color: '#c0392b' };
        return { grade: 'F', color: '#8b0000' };
    }

    // --- Per-card quality: compare actual rank to expected at its position ---
    // Returns { quality: "strong"|"expected"|"weak", delta: number }
    function cardPullQuality(card, sameTypeCards, handSize) {
        if (!initialized || typeof card.rank !== 'number' || !isFinite(card.rank)) {
            return { quality: 'none', delta: 0 };
        }

        var rankArray = card.type === 'Occupation' ? occRanks : minorRanks;
        var N = rankArray.length;
        var n = handSize;

        // Sort same-type cards by rank to find this card's position
        var sorted = sameTypeCards
            .filter(function (c) { return typeof c.rank === 'number' && isFinite(c.rank); })
            .map(function (c) { return c.rank; })
            .sort(function (a, b) { return a - b; });

        var position = sorted.indexOf(card.rank) + 1; // 1-indexed
        if (position === 0) return { quality: 'none', delta: 0 };

        var expected = expectedKthRank(position, n, rankArray);
        if (expected === null) return { quality: 'none', delta: 0 };

        var delta = card.rank - expected; // negative = better than expected

        // Standard deviation for the k-th order statistic position
        var k = position;
        var sdPos = Math.sqrt(k * (n - k + 1) * (N + 1) * (N - n) / ((n + 1) * (n + 1) * (n + 2)));
        // Convert position SD to rank SD (approximate by local rank density)
        var posExpected = k * (N + 1) / (n + 1) - 1;
        var rankDensity = 1; // approximate
        if (posExpected >= 0 && posExpected < N - 1) {
            var lo = Math.max(0, Math.floor(posExpected) - 1);
            var hi = Math.min(N - 1, Math.floor(posExpected) + 1);
            rankDensity = (rankArray[hi] - rankArray[lo]) / (hi - lo);
        }
        var sdRank = sdPos * rankDensity;
        if (sdRank < 10) sdRank = 10; // minimum threshold

        if (delta < -sdRank) return { quality: 'strong', delta: delta };
        if (delta > sdRank) return { quality: 'weak', delta: delta };
        return { quality: 'expected', delta: delta };
    }

    // --- Hypergeometric PMF using recurrence ---
    // Returns array of probabilities P(X=0), P(X=1), ..., P(X=min(K,n))
    // K = tagged cards in pool, N = total pool size, n = draw size
    function hypergeometricPMF(K, N, n) {
        if (N === 0 || n === 0 || K === 0) return [1.0];
        var maxK = Math.min(K, n);
        var probs = new Array(maxK + 1);

        // Start with P(X=0) computed in log space
        var logP0 = 0;
        for (var i = 0; i < n; i++) {
            logP0 += Math.log(N - K - i) - Math.log(N - i);
        }
        probs[0] = Math.exp(logP0);

        // Recurrence: P(k+1) = P(k) * (K-k)(n-k) / ((k+1)(N-K-n+k+1))
        for (var k = 0; k < maxK; k++) {
            var num = (K - k) * (n - k);
            var den = (k + 1) * (N - K - n + k + 1);
            if (den === 0) { probs[k + 1] = 0; continue; }
            probs[k + 1] = probs[k] * num / den;
        }

        return probs;
    }

    // --- Additional tagged cards you might draft across the remaining hands ---
    // Given you see `kSeen` tagged cards (occ + minor) in your current hand,
    // what's P(you can draft 0, 1, 2, 3+ additional tagged cards across the other hands)?
    //
    // Model for each of the `numOtherHands` other hands:
    //   1. Draw `handSize` from the remaining pool (conditional hypergeometric)
    //   2. Opponents draft the best-ranked cards before it reaches you
    //      (`passesBeforeYou` opponents each take 1 occ + 1 minor)
    //   3. You see what's left; you can draft at most 1 occ + 1 minor per hand
    //   4. What matters is P(≥1 tagged card survives to you) per hand,
    //      for occ and minor independently — then combine across hands.
    //
    // Simplification: model each hand independently (slight overcounting of tagged
    // cards across hands, but close enough for display purposes).
    function additionalTagProbability(tag, kSeenOcc, kSeenMinor, handSize, numOtherHands, playerCount) {
        if (!initialized || !tagCounts[tag]) return null;

        var kOccTotal = tagCounts[tag].occ;
        var kMinorTotal = tagCounts[tag].minor;
        var NOcc = occRanks.length;
        var NMinor = minorRanks.length;

        // Remaining tagged cards after your hand is dealt
        var kOccRemaining = kOccTotal - kSeenOcc;
        var kMinorRemaining = kMinorTotal - kSeenMinor;
        // Remaining pool after your hand
        var NOccRemaining = NOcc - handSize;
        var NMinorRemaining = NMinor - handSize;

        // For each other hand, compute P(you get ≥1 tagged card from it).
        // Each other hand has `handSize` cards drawn from the remaining pool.
        // Before you see it, (passNumber) opponents have each taken 1 card of each type.
        // Under "draft best" assumption, they take the lowest-ranked cards.
        // Tagged cards survive if they weren't among the top-ranked picks.
        //
        // Conservative simplification: the probability a tagged card survives opponent
        // drafting is roughly (handSize - passesBeforeYou) / handSize for each tagged
        // card. But actually, what matters is: if the hand has j tagged occs,
        // how many survive after `passes` best-ranked occs are removed?
        // If the tagged cards are randomly positioned in rank order within the hand,
        // the expected number surviving is j * (handSize - passes) / handSize.
        //
        // For a cleaner approach: P(≥1 tagged occ available to you in a hand) =
        //   sum over j=1..max of [P(hand has j tagged occs) * P(≥1 of j survives passes)]
        //
        // P(≥1 of j tagged survives when `passes` best are removed from `handSize`):
        //   = 1 - P(all j tagged are in the top `passes` slots)
        //   = 1 - C(j, min(j,passes)) * C(handSize-j, passes-min(j,passes)) / C(handSize, passes)
        //   Simpler: P(at least 1 tagged card is NOT in top `passes`) = 1 - C(passes,j)/C(handSize,j) when j<=passes
        //   Actually: P(all j tagged land in top passes) = C(passes, j) / C(handSize, j)

        // Per-hand P(≥1 tagged occ you can draft) across rounds 2,3,4 (passes = 1,2,3)
        var perHandProbs = []; // P(≥1 additional tagged card from this hand)

        for (var h = 0; h < numOtherHands; h++) {
            var passes = h + 1; // round 2: 1 pass, round 3: 2 passes, round 4: 3 passes
            var cardsYouSee = handSize - passes; // cards remaining after opponents draft
            if (cardsYouSee <= 0) { perHandProbs.push(0); continue; }

            // P(≥1 tagged occ available) for this hand
            var pOcc = probAtLeastOneTaggedSurvives(kOccRemaining, NOccRemaining, handSize, passes);
            var pMinor = probAtLeastOneTaggedSurvives(kMinorRemaining, NMinorRemaining, handSize, passes);

            // P(≥1 tagged card of either type available to draft from this hand)
            var pEither = 1 - (1 - pOcc) * (1 - pMinor);
            perHandProbs.push(pEither);
        }

        // Now combine across hands: what's P(total additional = 0, 1, 2, 3, ...)?
        // Each hand is (approximately) independent Bernoulli with its own probability.
        // Convolve them iteratively.
        var dist = [1.0]; // start with P(0 additional) = 1
        for (var h2 = 0; h2 < perHandProbs.length; h2++) {
            var p = perHandProbs[h2];
            var newDist = new Array(dist.length + 1);
            for (var k = 0; k < newDist.length; k++) newDist[k] = 0;
            for (var k2 = 0; k2 < dist.length; k2++) {
                newDist[k2] += dist[k2] * (1 - p);
                newDist[k2 + 1] += dist[k2] * p;
            }
            dist = newDist;
        }

        return { probs: dist, perHandProbs: perHandProbs };
    }

    // Helper: P(≥1 tagged card survives opponent drafting in a single hand)
    // kTagged = tagged cards remaining in pool, N = pool size, handSize = cards dealt, passes = opponents who draft before you
    function probAtLeastOneTaggedSurvives(kTagged, N, handSize, passes) {
        if (kTagged <= 0 || N <= 0 || handSize <= 0) return 0;

        // P(hand contains j tagged) * P(≥1 of j survives `passes` removals)
        var pmf = hypergeometricPMF(kTagged, N, handSize);
        var pAtLeastOne = 0;

        for (var j = 1; j < pmf.length; j++) {
            // P(all j tagged are among the top `passes` ranked cards in the hand)
            // = C(passes, j) / C(handSize, j) when j <= passes, else 0
            var pAllTaken;
            if (j > passes) {
                pAllTaken = 0; // can't remove all j if only `passes` cards taken
            } else {
                // C(passes, j) / C(handSize, j)
                var ratio = 1;
                for (var i = 0; i < j; i++) {
                    ratio *= (passes - i) / (handSize - i);
                }
                pAllTaken = ratio;
            }
            pAtLeastOne += pmf[j] * (1 - pAllTaken);
        }

        return pAtLeastOne;
    }

    // --- Get all stats for a hand ---
    function analyzeHand(handCards, handSize, playerCount) {
        if (!initialized) return null;

        var occCards = handCards.filter(function (c) { return c.type === 'Occupation' && typeof c.rank === 'number' && isFinite(c.rank); });
        var minorCards = handCards.filter(function (c) { return c.type === 'Minor Improvement' && typeof c.rank === 'number' && isFinite(c.rank); });

        var percentile = handPercentile(handCards);
        var grade = handGrade(percentile);

        // Per-card quality
        var cardQualities = {};
        handCards.forEach(function (card) {
            if (card.type === 'Occupation') {
                cardQualities[card.name] = cardPullQuality(card, occCards, handSize);
            } else if (card.type === 'Minor Improvement') {
                cardQualities[card.name] = cardPullQuality(card, minorCards, handSize);
            }
        });

        // Expected ranks for the rank distribution table
        var occExpected = [];
        for (var i = 1; i <= handSize; i++) {
            occExpected.push(Math.round(expectedKthRank(i, handSize, occRanks)));
        }
        var minorExpected = [];
        for (var j = 1; j <= handSize; j++) {
            minorExpected.push(Math.round(expectedKthRank(j, handSize, minorRanks)));
        }

        // Tag distributions for tags present in the hand
        var handTagsOcc = {};
        var handTagsMinor = {};
        var handTagsTotal = {};
        handCards.forEach(function (card) {
            if (card.tags) {
                card.tags.forEach(function (tag) {
                    if (!handTagsTotal[tag]) handTagsTotal[tag] = 0;
                    handTagsTotal[tag]++;
                    if (card.type === 'Occupation') {
                        if (!handTagsOcc[tag]) handTagsOcc[tag] = 0;
                        handTagsOcc[tag]++;
                    } else if (card.type === 'Minor Improvement') {
                        if (!handTagsMinor[tag]) handTagsMinor[tag] = 0;
                        handTagsMinor[tag]++;
                    }
                });
            }
        });

        // For 4-player: 3 other hands; for 3-player: 2 other hands
        var numOtherHands = playerCount ? (playerCount - 1) : 3;
        var tagStats = {};
        Object.keys(handTagsTotal).forEach(function (tag) {
            var dist = additionalTagProbability(
                tag,
                handTagsOcc[tag] || 0,
                handTagsMinor[tag] || 0,
                handSize,
                numOtherHands,
                playerCount || 4
            );
            if (dist) {
                tagStats[tag] = {
                    count: handTagsTotal[tag],
                    distribution: dist.probs,
                    perHandProbs: dist.perHandProbs,
                };
            }
        });

        return {
            percentile: percentile,
            grade: grade,
            cardQualities: cardQualities,
            occExpected: occExpected,
            minorExpected: minorExpected,
            tagStats: tagStats,
        };
    }

    return {
        init: init,
        analyzeHand: analyzeHand,
        handPercentile: handPercentile,
        handGrade: handGrade,
        cardPullQuality: cardPullQuality,
        additionalTagProbability: additionalTagProbability,
        hypergeometricPMF: hypergeometricPMF,
        expectedKthRank: expectedKthRank,
        isInitialized: function () { return initialized; },
        // Exposed for debugging:
        _occRanks: function () { return occRanks; },
        _minorRanks: function () { return minorRanks; },
        _tagCounts: function () { return tagCounts; },
    };

})();
