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
    var cardsByName = {};   // { cardName: cardObject }
    var initialized = false;

    // Hand sizes by round (matches HAND_SIZE_BY_ROUND in draft.html)
    var HAND_SIZE_BY_ROUND_STATS = { 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4 };

    // Hand rotation: which physical hand number appears in each round, by player count
    var ROTATION_BY_PLAYER_COUNT = {
        3: { 1: 1, 2: 2, 3: 3, 4: 1, 5: 2, 6: 3, 7: 1 },
        4: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 6: 2, 7: 3 }
    };

    // --- Initialization (call once after card data loads) ---
    function init(cards) {
        if (!cards || cards.length === 0) return;

        var occs = [];
        var minors = [];
        tagCounts = {};

        cardsByName = {};
        cards.forEach(function (card) {
            if (card.name) cardsByName[card.name] = card;
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

    // --- P(≥1 tagged card survives) for a known returning hand ---
    // Uses actual card composition and ranks. Under the "opponents take best cards"
    // model, we sort cards by rank and remove the top `passes` of each type.
    // Tagged cards that survive are those not in the top `passes` picks.
    function probAtLeastOneTaggedSurvivesKnown(tag, knownCards, passes) {
        var occs = knownCards
            .filter(function (c) { return c && c.type === 'Occupation' && typeof c.rank === 'number' && isFinite(c.rank); })
            .sort(function (a, b) { return a.rank - b.rank; });
        var minors = knownCards
            .filter(function (c) { return c && c.type === 'Minor Improvement' && typeof c.rank === 'number' && isFinite(c.rank); })
            .sort(function (a, b) { return a.rank - b.rank; });

        // Cards after the top `passes` opponent picks survive
        var survivingOccs = occs.slice(passes);
        var survivingMinors = minors.slice(passes);

        var taggedOccSurvives = survivingOccs.some(function (c) {
            return c.tags && c.tags.indexOf(tag) !== -1;
        });
        var taggedMinorSurvives = survivingMinors.some(function (c) {
            return c.tags && c.tags.indexOf(tag) !== -1;
        });

        return (taggedOccSurvives || taggedMinorSurvives) ? 1.0 : 0.0;
    }

    // --- Additional tagged cards you might draft across the remaining hands ---
    // Given you see `kSeen` tagged cards (occ + minor) in your current hand,
    // what's P(you can draft 0, 1, 2, 3+ additional tagged cards across the other hands)?
    //
    // futureHandsInfo: array of { type: 'known'|'unknown', passes, cards? (known), handSize? (unknown) }
    //   - 'known': a returning hand whose exact cards we saw before — uses rank-based deterministic model
    //   - 'unknown': an unseen hand — uses hypergeometric pool model with correct passes
    //
    // passes = min(round - 1, playerCount - 1): how many opponents draft before you in that round.
    function additionalTagProbability(tag, kSeenOcc, kSeenMinor, handSize, futureHandsInfo) {
        if (!initialized || !tagCounts[tag]) return null;

        var kOccTotal = tagCounts[tag].occ;
        var kMinorTotal = tagCounts[tag].minor;
        var NOcc = occRanks.length;
        var NMinor = minorRanks.length;

        // Remaining tagged cards in the pool after your current hand
        var kOccRemaining = kOccTotal - kSeenOcc;
        var kMinorRemaining = kMinorTotal - kSeenMinor;
        // Remaining pool size (approximate — does not account for prior rounds' drafts)
        var NOccRemaining = NOcc - handSize;
        var NMinorRemaining = NMinor - handSize;

        var perHandProbs = [];

        for (var h = 0; h < futureHandsInfo.length; h++) {
            var handInfo = futureHandsInfo[h];
            var pEither;

            if (handInfo.type === 'known') {
                // We know the exact cards — use rank-based deterministic survival model
                pEither = probAtLeastOneTaggedSurvivesKnown(tag, handInfo.cards, handInfo.passes);
            } else {
                // Unknown future hand — use hypergeometric with correct passes
                var futureHandSize = handInfo.handSize;
                var passes = handInfo.passes;
                var cardsYouSee = futureHandSize - passes;
                if (cardsYouSee <= 0) { perHandProbs.push(0); continue; }

                var pOcc = probAtLeastOneTaggedSurvives(kOccRemaining, NOccRemaining, futureHandSize, passes);
                var pMinor = probAtLeastOneTaggedSurvives(kMinorRemaining, NMinorRemaining, futureHandSize, passes);
                pEither = 1 - (1 - pOcc) * (1 - pMinor);
            }

            perHandProbs.push(pEither);
        }

        // Convolve per-hand Bernoulli distributions to get P(total additional = 0, 1, 2, ...)
        var dist = [1.0];
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
    // seenHands: { roundNum: [cardName, ...] } — cards seen in each prior round
    // userDrafted: { roundNum: { occupation: name, minor: name } } — user's picks per round
    function analyzeHand(handCards, handSize, playerCount, currentRound, seenHands, userDrafted) {
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

        // Build futureHandsInfo: one entry per remaining round after currentRound.
        // For each future round, determine if the hand is already known (returning)
        // or unseen, and compute the correct `passes` (opponents who draft before you).
        var futureHandsInfo = [];
        var round = currentRound || 1;
        var pc = playerCount || 4;
        var rotation = ROTATION_BY_PLAYER_COUNT[pc] || ROTATION_BY_PLAYER_COUNT[4];
        var currentHandNum = rotation[round];

        // Map handNum → first round we saw it (prior rounds + current round)
        var handNumToFirstRound = {};
        for (var r = 1; r < round; r++) {
            var h = rotation[r];
            if (h !== undefined && !handNumToFirstRound[h]) handNumToFirstRound[h] = r;
        }
        // Current round's hand — it may return later, and we know its cards
        if (currentHandNum !== undefined) handNumToFirstRound[currentHandNum] = round;

        for (var fr = round + 1; fr <= 7; fr++) {
            var futureHandNum = rotation[fr];
            if (futureHandNum === undefined) continue;
            var passes = Math.min(fr - 1, pc - 1);
            var futureHandSize = HAND_SIZE_BY_ROUND_STATS[fr] || 4;

            if (handNumToFirstRound[futureHandNum] !== undefined) {
                // Returning hand — resolve to actual card objects
                var priorRound = handNumToFirstRound[futureHandNum];
                var knownCards;
                if (priorRound === round) {
                    // Current hand returning — all cards still known (user hasn't confirmed picks yet)
                    knownCards = handCards;
                } else {
                    var seenCardNames = (seenHands && seenHands[priorRound]) || [];
                    var drafted = (userDrafted && userDrafted[priorRound]) || {};
                    var draftedOcc = drafted.occupation;
                    var draftedMinor = drafted.minor;
                    var remainingNames = seenCardNames.filter(function (n) {
                        return n !== draftedOcc && n !== draftedMinor;
                    });
                    knownCards = remainingNames.map(function (n) { return cardsByName[n]; }).filter(Boolean);
                }
                futureHandsInfo.push({ type: 'known', cards: knownCards, passes: passes });
            } else {
                // Unseen future hand — use corrected passes and hand size
                futureHandsInfo.push({ type: 'unknown', passes: passes, handSize: futureHandSize });
            }
        }

        var tagStats = {};
        Object.keys(handTagsTotal).forEach(function (tag) {
            var dist = additionalTagProbability(
                tag,
                handTagsOcc[tag] || 0,
                handTagsMinor[tag] || 0,
                handSize,
                futureHandsInfo
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
